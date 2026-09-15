/**
 * Sessions IA côté serveur — parité `ai-workspace/manager.ts` Electron sans
 * fenêtre : chaque collaborateur IA a UN Chromium persistant
 * (`{browserDataRoot}/<aiUserId>`) avec :
 * - une page CRM sidecar (cookie session persona via Network.setCookie,
 *   atterrissage /taches?assignee=<id>) pilotée en `ui_*` via le driver CDP ;
 * - des onglets sites externes (`external_*`) pilotés par le MÊME driver
 *   partagé que l'app desktop (shared-driver.ts) ;
 * - un screencast in-process (BrowserScreencaster → publishScreencastFrame).
 *
 * `executeSupplierRequest` = exécuteur in-process du même contrat wire que le
 * bridge Electron (`ai_workspace_*` + `external_*`) — enregistrable comme
 * abonné local de dispatchSupplierAction (routage serveur B3).
 */

import path from "node:path";
import { checkWebHostAllowed } from "@creezio/platform-core";
import { BrowserHost, type CdpPage } from "./browser-host.js";
import { BrowserScreencaster } from "./browser-screencaster.js";
import {
  driverPageContext,
  driverVerbOf,
  runDriverVerb,
  type DriverParams,
  type DriverResult,
} from "./shared-driver.js";
import { publishScreencastFrame } from "./screencast-hub.js";

export type AiSessionHostOptions = {
  /** Racine des profils persistants (ex. /data/browser). */
  browserDataRoot: string;
  /** Nom du cookie de session CRM (configureAuth marque). */
  sessionCookieName: string;
  /** Base URL CRM (harness local, ex. http://127.0.0.1:18791). */
  crmBaseUrl: () => string;
  /** Mint un JWT session persona pour l'IA (côté @creezio/auth). */
  mintSessionToken: (aiUserId: string) => Promise<string>;
  /** Publication frames (défaut : hub in-process screencast-hub.ts). */
  publishFrame?: (
    aiUserId: string,
    dataB64: string,
  ) => { viewers: number; seq: number };
  /** Chemin d'atterrissage CRM (défaut /taches?assignee=<id>). */
  taskHref?: string;
  chromiumBinary?: string;
  headless?: boolean;
  display?: string;
  /** Proxy sortant Chromium (`--proxy-server=`) — voir chromium-process.ts. */
  proxyServer?: string;
  onLog?: (line: string) => void;
};

type ExternalTab = {
  tabId: string;
  siteId: number;
  page: CdpPage;
  url: string;
  title: string;
};

type AiBrowserSession = {
  aiUserId: string;
  label: string;
  browser: BrowserHost;
  crmPage: CdpPage;
  tabs: Map<string, ExternalTab>;
  activeTabId: string | null;
  ready: boolean;
};

export type AiSessionInfo = {
  userId: string;
  label: string;
  partition: string;
  ready: boolean;
  active: boolean;
  presentation: "server";
  tabs: number;
};

export type SupplierActionRequestLike = {
  actionId: string;
  type: string;
  tabId?: string;
  params: Record<string, unknown>;
};

function sanitizeProfileSegment(aiUserId: string): string {
  return aiUserId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "ai";
}

function aiUserIdOf(params: Record<string, unknown>): string {
  const raw =
    params.ai_user_id ?? params.aiUserId ?? params.user_id ?? params.userId;
  return typeof raw === "string" ? raw.trim() : "";
}

export class AiSessionHost {
  private sessions = new Map<string, AiBrowserSession>();
  private tabSeq = 0;
  readonly screencaster: BrowserScreencaster;

  constructor(private readonly opts: AiSessionHostOptions) {
    this.screencaster = new BrowserScreencaster({
      surfaceOf: (aiUserId) => this.currentSurface(aiUserId),
      publishFrame: opts.publishFrame ?? publishScreencastFrame,
      onLog: opts.onLog,
    });
  }

  private log(line: string): void {
    (this.opts.onLog || ((l: string) => console.log(`[ai-session-host] ${l}`)))(
      line,
    );
  }

  /** Surface courante : onglet externe actif sinon page CRM. */
  private currentSurface(aiUserId: string): CdpPage | null {
    const s = this.sessions.get(aiUserId);
    if (!s) return null;
    const active = s.activeTabId ? s.tabs.get(s.activeTabId) : null;
    if (active && !active.page.closed) return active.page;
    return s.crmPage.closed ? null : s.crmPage;
  }

  hasSession(aiUserId: string): boolean {
    const s = this.sessions.get(aiUserId);
    return Boolean(s && s.browser.alive);
  }

  listSessions(): AiSessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => this.infoOf(s));
  }

  private infoOf(s: AiBrowserSession): AiSessionInfo {
    return {
      userId: s.aiUserId,
      label: s.label,
      partition: path.join(
        this.opts.browserDataRoot,
        sanitizeProfileSegment(s.aiUserId),
      ),
      ready: s.ready,
      active: s.browser.alive,
      presentation: "server",
      tabs: s.tabs.size,
    };
  }

  /**
   * Crée (ou rafraîchit le cookie de) la session IA. Chromium crashé →
   * relance sur le même profil persistant.
   */
  async ensure(opts: {
    aiUserId: string;
    label?: string;
  }): Promise<AiSessionInfo> {
    const aiUserId = String(opts.aiUserId || "").trim();
    if (!aiUserId) throw new Error("ai_user_id requis");
    const baseUrl = this.opts.crmBaseUrl().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(baseUrl)) {
      throw new Error("baseUrl CRM invalide");
    }

    let session = this.sessions.get(aiUserId);
    if (session && !session.browser.alive) {
      // Chromium mort — nettoyage puis relance (profil disque conservé).
      await this.close(aiUserId).catch(() => {});
      session = undefined;
    }

    if (!session) {
      const userDataDir = path.join(
        this.opts.browserDataRoot,
        sanitizeProfileSegment(aiUserId),
      );
      const browser = await BrowserHost.launch({
        userDataDir,
        ...(this.opts.chromiumBinary ? { binary: this.opts.chromiumBinary } : {}),
        ...(this.opts.headless !== undefined
          ? { headless: this.opts.headless }
          : {}),
        ...(this.opts.display ? { display: this.opts.display } : {}),
        ...(this.opts.proxyServer ? { proxyServer: this.opts.proxyServer } : {}),
        ...(this.opts.onLog ? { onLog: () => {} } : {}),
      });
      const crmPage = await browser.newPage();
      session = {
        aiUserId,
        label: opts.label || aiUserId,
        browser,
        crmPage,
        tabs: new Map(),
        activeTabId: null,
        ready: false,
      };
      this.sessions.set(aiUserId, session);
      this.log(`session créée ${aiUserId} profil=${userDataDir}`);
    } else if (opts.label) {
      session.label = opts.label;
    }

    const token = await this.opts.mintSessionToken(aiUserId);
    await session.crmPage.setCookie({
      url: baseUrl,
      name: this.opts.sessionCookieName,
      value: token,
    });

    if (!session.ready) {
      const taskHref = this.opts.taskHref || "/taches";
      await session.crmPage.navigate(
        `${baseUrl}${taskHref}?assignee=${encodeURIComponent(aiUserId)}`,
      );
      session.ready = true;
    }
    return this.infoOf(session);
  }

  async navigate(opts: {
    aiUserId: string;
    href: string;
  }): Promise<DriverResult> {
    const session = this.sessions.get(opts.aiUserId);
    if (!session || !session.ready) {
      return {
        ok: false,
        error: "Espace IA non prêt — appeler ai_workspace_ensure d’abord",
        code: "ai_workspace_missing",
      };
    }
    if (!opts.href.startsWith("/")) {
      return { ok: false, error: "href/path CRM requis (ex. /clients)" };
    }
    const baseUrl = this.opts.crmBaseUrl().replace(/\/+$/, "");
    // Retour à la surface CRM (parité show + navigate Electron).
    session.activeTabId = null;
    await session.crmPage.navigate(`${baseUrl}${opts.href}`);
    const page = await driverPageContext(session.crmPage);
    return { ok: true, page };
  }

  async openTab(opts: {
    aiUserId: string;
    params: Record<string, unknown>;
  }): Promise<DriverResult> {
    const siteId = Number(
      opts.params.site_id ?? opts.params.siteId ?? opts.params.fournisseur_id ?? opts.params.fournisseurId ?? 0,
    );
    const url = typeof opts.params.url === "string" ? opts.params.url : "";
    if (!Number.isFinite(siteId) || siteId <= 0) {
      return { ok: false, error: "site_id invalide" };
    }
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: "url invalide (http(s):// requis)" };
    }
    // H0 — allowlist `*_WEB_ALLOWED_HOSTS` appliquée AU NIVEAU HOST, AVANT
    // toute session/spawn : même un appel qui contourne le runner de tâches
    // est refusé ici (fail-closed).
    const hostCheck = checkWebHostAllowed(url);
    if (!hostCheck.ok) {
      this.log(`open_tab refusé (${hostCheck.code}) : ${url}`);
      return { ok: false, error: hostCheck.error, code: hostCheck.code };
    }
    const session = this.sessions.get(opts.aiUserId);
    if (!session) {
      return {
        ok: false,
        error: "Espace IA absent — ensure d’abord",
        code: "ai_workspace_missing",
      };
    }
    // Un onglet par site (parité SupplierTabManager) : réutiliser si présent.
    for (const tab of session.tabs.values()) {
      if (tab.siteId === siteId && !tab.page.closed) {
        session.activeTabId = tab.tabId;
        await tab.page.navigate(url);
        const page = await driverPageContext(tab.page);
        tab.url = String(page.url || url);
        tab.title = String(page.title || url);
        return { ok: true, tabId: tab.tabId, page };
      }
    }
    this.tabSeq += 1;
    const tabId = `srv-tab-${this.tabSeq}`;
    const page = await session.browser.newPage(url);
    const ctx = await driverPageContext(page);
    const tab: ExternalTab = {
      tabId,
      siteId,
      page,
      url: String(ctx.url || url),
      title: String(ctx.title || url),
    };
    session.tabs.set(tabId, tab);
    session.activeTabId = tabId;
    this.log(`onglet ouvert ${opts.aiUserId} ${tabId} → ${url}`);
    return { ok: true, tabId, page: ctx };
  }

  listTabs(aiUserId: string): Array<Record<string, unknown>> {
    const session = this.sessions.get(aiUserId);
    if (!session) return [];
    return Array.from(session.tabs.values()).map((tab) => ({
      tabId: tab.tabId,
      siteId: tab.siteId,
      fournisseurId: tab.siteId,
      url: tab.url,
      title: tab.title,
      active: session.activeTabId === tab.tabId,
    }));
  }

  async closeTab(aiUserId: string, tabId: string): Promise<boolean> {
    const session = this.sessions.get(aiUserId);
    const tab = session?.tabs.get(tabId);
    if (!session || !tab) return false;
    await tab.page.close().catch(() => {});
    session.tabs.delete(tabId);
    if (session.activeTabId === tabId) session.activeTabId = null;
    return true;
  }

  /** Actions `external_*` (alias `supplier_*`) sur les onglets externes. */
  async webAction(opts: {
    aiUserId: string;
    webType: string;
    params?: Record<string, unknown>;
    tabId?: string;
  }): Promise<DriverResult> {
    const session = this.sessions.get(opts.aiUserId);
    if (!session) {
      return {
        ok: false,
        error: "Espace IA absent — ensure d’abord",
        code: "ai_workspace_missing",
      };
    }
    const actionType = String(opts.webType || "").replace(
      /^supplier_/,
      "external_",
    );
    const params: DriverParams = opts.params || {};

    if (actionType === "external_list_tabs") {
      return { ok: true, tabs: this.listTabs(opts.aiUserId) };
    }
    if (actionType === "external_open_tab") {
      return this.openTab({ aiUserId: opts.aiUserId, params });
    }

    const tabId =
      opts.tabId ||
      (typeof params.tabId === "string" ? params.tabId : "") ||
      session.activeTabId ||
      "";
    const tab = tabId ? session.tabs.get(tabId) : null;
    if (!tab || tab.page.closed) {
      return {
        ok: false,
        error: `Onglet introuvable (tabId=${tabId || "—"}). Faire external_list_tabs (alias supplier_list_tabs) d'abord.`,
        tabs: this.listTabs(opts.aiUserId),
      };
    }
    session.activeTabId = tab.tabId;
    const verb = driverVerbOf(actionType);
    if (!verb) {
      return { ok: false, error: `Action inconnue: ${opts.webType}` };
    }
    const result = await runDriverVerb(tab.page, verb, params);
    const page = result.page as { url?: string; title?: string } | undefined;
    if (page?.url) tab.url = page.url;
    if (page?.title) tab.title = page.title;
    return result;
  }

  /** Actions `ui_*` (souris virtuelle) sur la page CRM persona, via CDP. */
  async uiAction(opts: {
    aiUserId: string;
    type: string;
    params?: Record<string, unknown>;
  }): Promise<DriverResult> {
    const session = this.sessions.get(opts.aiUserId);
    if (!session || !session.ready) {
      return {
        ok: false,
        error: "Espace IA non prêt — appeler ai_workspace_ensure d’abord",
        code: "ai_workspace_missing",
      };
    }
    // Surface CRM redevient active (parité show Electron).
    session.activeTabId = null;
    const verb = driverVerbOf(opts.type);
    if (!verb) {
      return { ok: false, error: `Action UI inconnue: ${opts.type}` };
    }
    return runDriverVerb(session.crmPage, verb, opts.params || {});
  }

  startScreencast(aiUserId: string): Promise<Record<string, unknown>> {
    return this.screencaster.start(aiUserId);
  }

  stopScreencast(aiUserId: string): Promise<Record<string, unknown>> {
    return this.screencaster.stop(aiUserId);
  }

  async close(aiUserId: string): Promise<boolean> {
    const session = this.sessions.get(aiUserId);
    if (!session) return false;
    await this.screencaster.stop(aiUserId).catch(() => {});
    for (const tab of session.tabs.values()) {
      await tab.page.close().catch(() => {});
    }
    await session.browser.close().catch(() => {});
    this.sessions.delete(aiUserId);
    this.log(`session fermée ${aiUserId}`);
    return true;
  }

  async closeAll(): Promise<void> {
    for (const aiUserId of Array.from(this.sessions.keys())) {
      await this.close(aiUserId).catch(() => {});
    }
  }

  /**
   * Exécuteur in-process du contrat wire bridge (parité
   * electron-shell/ai-workspace/actions.ts). `defaultAiUserId` = identité de
   * l'abonné local (actions external_* sans ai_user_id explicite).
   */
  async executeSupplierRequest(
    req: SupplierActionRequestLike,
    defaultAiUserId?: string,
  ): Promise<DriverResult> {
    try {
      const type = String(req.type || "");
      const params = req.params || {};
      const aiUserId = aiUserIdOf(params) || defaultAiUserId || "";

      if (type === "ai_workspace_list") {
        return { ok: true, workspaces: this.listSessions() };
      }
      if (type === "ai_workspace_show_owner") {
        // Serveur headless : pas de fenêtre owner à réafficher.
        return { ok: true, active: null };
      }
      if (type === "ai_workspace_ensure") {
        if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
        const label = typeof params.label === "string" ? params.label : aiUserId;
        const info = await this.ensure({ aiUserId, label });
        return { ok: true, workspace: info };
      }
      if (type === "ai_workspace_show") {
        if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
        const session = this.sessions.get(aiUserId);
        if (!session) {
          return {
            ok: false,
            error: `Espace IA inconnu: ${aiUserId}`,
            code: "ai_workspace_missing",
          };
        }
        // « Voir comme IA » côté serveur = screencast (pas de fenêtre).
        return { ok: true, workspace: this.infoOf(session) };
      }
      if (type === "ai_workspace_navigate") {
        if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
        const href =
          (typeof params.href === "string" && params.href) ||
          (typeof params.path === "string" && params.path) ||
          "";
        return this.navigate({ aiUserId, href });
      }
      if (type === "ai_workspace_list_tabs") {
        if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
        return { ok: true, tabs: this.listTabs(aiUserId) };
      }
      if (
        type === "ai_workspace_open_tab" ||
        type === "ai_workspace_supplier_open_tab"
      ) {
        if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
        return this.openTab({ aiUserId, params });
      }
      if (type === "ai_workspace_web_action") {
        if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
        const webType =
          (typeof params.web_type === "string" && params.web_type) || "";
        if (
          !webType.startsWith("external_") &&
          !webType.startsWith("supplier_")
        ) {
          return {
            ok: false,
            error: "web_type external_* requis (alias supplier_* accepté)",
          };
        }
        const webParams =
          params.web_params && typeof params.web_params === "object"
            ? (params.web_params as Record<string, unknown>)
            : {};
        const webTabId =
          typeof params.tab_id === "string" && params.tab_id
            ? params.tab_id
            : req.tabId;
        return this.webAction({
          aiUserId,
          webType,
          params: webParams,
          ...(webTabId ? { tabId: webTabId } : {}),
        });
      }
      if (type === "ai_workspace_ui_action") {
        if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
        const uiType =
          (typeof params.ui_type === "string" && params.ui_type) ||
          (typeof params.type === "string" && params.type) ||
          "";
        const uiParams =
          params.ui_params && typeof params.ui_params === "object"
            ? (params.ui_params as Record<string, unknown>)
            : params;
        if (!uiType) return { ok: false, error: "ui_type requis" };
        return this.uiAction({ aiUserId, type: uiType, params: uiParams });
      }
      if (type === "ai_workspace_screencast_start") {
        if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
        return this.startScreencast(aiUserId);
      }
      if (type === "ai_workspace_screencast_stop") {
        if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
        return this.stopScreencast(aiUserId);
      }
      if (type === "ai_workspace_close") {
        if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
        const closed = await this.close(aiUserId);
        return { ok: true, closed };
      }

      // Actions external_* / supplier_* top-level (surface = onglets de l'IA).
      if (/^(external_|supplier_)/.test(type)) {
        if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
        return this.webAction({
          aiUserId,
          webType: type,
          params,
          ...(req.tabId ? { tabId: req.tabId } : {}),
        });
      }

      return { ok: false, error: `Action IA inconnue: ${type}` };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
