// @ts-nocheck — Electron session/WebContentsView (shim kit mince)
/**
 * Espaces workspace dédiés aux collaborateurs IA sur le host Electron.
 *
 * Chaque IA a :
 * - une WebContentsView CRM (partition `persist:{aiPartitionSlug}-<userId>`) avec JWT persona ;
 * - son propre manager onglets (partitions isolées marque) ;
 * - un TabWorkspaceProvider React isolé (sessionStorage de la partition).
 *
 * « Voir comme IA X » = show(X) — affiche cette vue (fake-cursor live),
 * pas un overlay logs ni un swap cookie sur la vue owner.
 */

import type { BaseWindow, WebContentsView } from "electron";
import fs from "node:fs";
import { log, logError } from "../logger.js";
import { loadElectron } from "../load-electron.js";

import { AiProfileWindow } from "./profile-window.js";
import {
  aiPartitionName,
  aiShareWebSessions,
  aiSupplierPartitionPrefix,
  getAiWorkspaceHostBindings,
} from "./bindings.js";
import type { AiSupplierTabsLike, AiTabInfo as TabInfo } from "./types.js";

/**
 * Présentation d'un workspace IA (P2 multi-profils, décision Q1) :
 * - "embedded" : WebContentsView dans la fenêtre principale (historique,
 *   « Voir comme IA » qui remplace la vue owner) ;
 * - "window"   : fenêtre dédiée persistante (close → hide, décision Q8),
 *   en PARALLÈLE de l'owner — jamais de masquage croisé.
 * La présentation est fixée à la création du workspace (pas de re-parentage).
 */
export type AiWorkspacePresentation = "embedded" | "window";

export type AiWorkspaceInfo = {
  userId: string;
  label: string;
  partition: string;
  ready: boolean;
  active: boolean;
  presentation: AiWorkspacePresentation;
  /** Fenêtre dédiée visible (mode window uniquement). */
  windowVisible?: boolean;
};

type AiWorkspace = {
  userId: string;
  label: string;
  partition: string;
  view: WebContentsView;
  tabs: AiSupplierTabsLike;
  ready: boolean;
  baseUrl: string;
  presentation: AiWorkspacePresentation;
  /** Fenêtre dédiée (mode window uniquement). */
  profileWindow: AiProfileWindow | null;
};

export type AiWorkspaceManagerOptions = {
  /**
   * Présentation par défaut des nouveaux workspaces quand ensure() ne la
   * précise pas. Défaut absolu : "embedded" (compatibilité tests/e2e) ;
   * main.ts branche le réglage local-config (défaut produit : "window").
   */
  defaultPresentation?: () => AiWorkspacePresentation;
  /** true pendant le vrai quit — laisse les fenêtres IA se fermer. */
  isQuitting?: () => boolean;
  /** Notifié à chaque création/visibilité/fermeture de fenêtre IA (tray). */
  onWindowsChanged?: () => void;
};

export type AiWorkspaceUiActionRequest = {
  actionId: string;
  type: string;
  params: Record<string, unknown>;
  tabId?: string;
};

export { aiSupplierPartitionPrefix, aiShareWebSessions } from "./bindings.js";

export class AiWorkspaceManager {
  private workspaces = new Map<string, AiWorkspace>();
  private activeUserId: string | null = null;
  private pendingUiResults = new Map<
    string,
    {
      resolve: (r: Record<string, unknown>) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private win: BaseWindow,
    /** Vue CRM owner — jamais détruite. */
    private ownerAppView: WebContentsView,
    private ownerTabs: AiSupplierTabsLike,
    private readonly opts: AiWorkspaceManagerOptions = {},
  ) {}

  private infoOf(w: AiWorkspace): AiWorkspaceInfo {
    return {
      userId: w.userId,
      label: w.label,
      partition: w.partition,
      ready: w.ready,
      active: this.activeUserId === w.userId,
      presentation: w.presentation,
      ...(w.presentation === "window"
        ? { windowVisible: w.profileWindow?.isVisible() ?? false }
        : {}),
    };
  }

  list(): AiWorkspaceInfo[] {
    return Array.from(this.workspaces.values()).map((w) => this.infoOf(w));
  }

  getActiveUserId(): string | null {
    return this.activeUserId;
  }

  findByWebContentsId(wcId: number): AiWorkspaceInfo | null {
    for (const w of this.workspaces.values()) {
      try {
        if (!w.view.webContents.isDestroyed() && w.view.webContents.id === wcId) {
          return this.infoOf(w);
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  getTabs(userId: string): AiSupplierTabsLike | null {
    return this.workspaces.get(userId)?.tabs ?? null;
  }

  getView(userId: string): WebContentsView | null {
    return this.workspaces.get(userId)?.view ?? null;
  }

  /**
   * Crée (ou rafraîchit le cookie de) la vue CRM IA, sans forcément l’afficher.
   * `presentation` est appliquée à la CRÉATION uniquement (pas de re-parentage
   * d'un workspace existant) ; absente → défaut du manager (embedded).
   */
  async ensure(opts: {
    userId: string;
    token: string;
    baseUrl: string;
    label?: string;
    presentation?: AiWorkspacePresentation;
  }): Promise<AiWorkspaceInfo> {
    const userId = String(opts.userId || "").trim();
    if (!userId) throw new Error("ai_user_id requis");
    const baseUrl = String(opts.baseUrl || "").replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(baseUrl)) {
      throw new Error("baseUrl invalide");
    }
    const token = String(opts.token || "").trim();
    if (!token) throw new Error("token session IA requis");

    let ws = this.workspaces.get(userId);
    if (!ws) {
      const presentation: AiWorkspacePresentation =
        opts.presentation ?? this.opts.defaultPresentation?.() ?? "embedded";
      ws = await this.createWorkspace(
        userId,
        baseUrl,
        opts.label || userId,
        presentation,
      );
      this.workspaces.set(userId, ws);
      if (presentation === "window") this.opts.onWindowsChanged?.();
    } else if (opts.label) {
      ws.label = opts.label;
      ws.profileWindow?.setLabel(opts.label);
    }

    await this.setSessionCookie(ws, baseUrl, token);

    if (!ws.ready) {
      await this.loadCrm(ws, baseUrl);
      ws.ready = true;
    }

    return this.infoOf(ws);
  }

  /**
   * Affiche le workspace IA.
   * - mode window : ouvre la fenêtre dédiée SANS masquer l'owner (sans voler
   *   le focus si elle était déjà visible) ;
   * - mode embedded : comportement historique (masque owner + autres IA
   *   embarquées dans la fenêtre principale).
   */
  show(userId: string): AiWorkspaceInfo {
    const ws = this.workspaces.get(userId);
    if (!ws) throw new Error(`Espace IA inconnu: ${userId}`);

    if (ws.presentation === "window") {
      // Parallèle à l'owner : aucune suspension croisée.
      ws.profileWindow?.showInactive();
      if (!ws.tabs.getActive()) {
        ws.tabs.showCrm();
      }
      log("ai-workspace", `show window ${userId} (${ws.label})`);
      return this.infoOf(ws);
    }

    this.ownerTabs.suspend();
    try {
      this.ownerAppView.setVisible(false);
    } catch (e) {
      logError("ai-workspace", e);
    }

    for (const other of this.workspaces.values()) {
      if (other.userId === userId) continue;
      if (other.presentation === "window") continue; // fenêtres parallèles intouchées
      other.tabs.suspend();
      try {
        other.view.setVisible(false);
      } catch (e) {
        logError("ai-workspace", e);
      }
    }

    ws.tabs.resume();
    try {
      ws.view.setVisible(true);
      const { width, height } = this.win.getContentBounds();
      ws.view.setBounds({ x: 0, y: 0, width, height });
    } catch (e) {
      logError("ai-workspace", e);
    }
    // Premier affichage (aucun onglet site) → CRM plein écran.
    // Sinon resume()/applyBounds a déjà restauré l’onglet actif.
    if (!ws.tabs.getActive()) {
      ws.tabs.showCrm();
    }
    this.activeUserId = userId;
    log("ai-workspace", `show ${userId} (${ws.label})`);
    return { ...this.infoOf(ws), active: true };
  }

  /** Réaffiche le workspace owner (n'affecte pas les fenêtres IA parallèles). */
  showOwner(): void {
    for (const ws of this.workspaces.values()) {
      if (ws.presentation === "window") continue;
      ws.tabs.suspend();
      try {
        ws.view.setVisible(false);
      } catch (e) {
        logError("ai-workspace", e);
      }
    }
    try {
      this.ownerAppView.setVisible(true);
      const { width, height } = this.win.getContentBounds();
      this.ownerAppView.setBounds({ x: 0, y: 0, width, height });
    } catch (e) {
      logError("ai-workspace", e);
    }
    // resume() restaure l’onglet site actif s’il y en avait un — ne pas
    // showCrm() ici (sinon React croit encore l’onglet site actif mais la
    // WebContentsView a disparu).
    this.ownerTabs.resume();
    this.activeUserId = null;
    log("ai-workspace", "show owner");
  }

  /* ── Fenêtres IA (P2) ── */

  /** Fenêtres IA existantes (pour le menu tray / cockpit). */
  listWindows(): Array<{ userId: string; label: string; visible: boolean }> {
    const out: Array<{ userId: string; label: string; visible: boolean }> = [];
    for (const ws of this.workspaces.values()) {
      if (ws.presentation !== "window" || !ws.profileWindow) continue;
      out.push({
        userId: ws.userId,
        label: ws.label,
        visible: ws.profileWindow.isVisible(),
      });
    }
    return out;
  }

  /** BaseWindow du profil IA (mode window) — tests / cockpit. */
  getWindow(userId: string): BaseWindow | null {
    const ws = this.workspaces.get(userId);
    if (!ws?.profileWindow) return null;
    try {
      return ws.profileWindow.win.isDestroyed() ? null : ws.profileWindow.win;
    } catch {
      return null;
    }
  }

  /** Ouvre + focus la fenêtre IA (tray / cockpit « Ouvrir le workspace »). */
  openWindow(userId: string): boolean {
    const ws = this.workspaces.get(userId);
    if (!ws || ws.presentation !== "window" || !ws.profileWindow) return false;
    ws.profileWindow.show();
    if (!ws.tabs.getActive()) ws.tabs.showCrm();
    return true;
  }

  /** Masque la fenêtre IA (équivalent close → hide, Q8). */
  hideWindow(userId: string): boolean {
    const ws = this.workspaces.get(userId);
    if (!ws || ws.presentation !== "window" || !ws.profileWindow) return false;
    ws.profileWindow.hide();
    return true;
  }

  /**
   * VRAIE fermeture d'un workspace (libère la RAM — Q8) : détruit onglets,
   * vue CRM et fenêtre. Le prochain ensure() recrée tout (sessions web
   * conservées : partitions persist:*).
   */
  closeWorkspace(userId: string): boolean {
    const ws = this.workspaces.get(userId);
    if (!ws) return false;
    for (const tab of ws.tabs.list()) {
      try {
        ws.tabs.closeTab(tab.tabId);
      } catch (e) {
        logError("ai-workspace", e);
      }
    }
    try {
      if (!ws.view.webContents.isDestroyed()) ws.view.webContents.close();
    } catch (e) {
      logError("ai-workspace", e);
    }
    if (ws.presentation === "window") {
      ws.profileWindow?.destroy();
    } else {
      try {
        this.win.contentView.removeChildView(ws.view);
      } catch (e) {
        logError("ai-workspace", e);
      }
      if (this.activeUserId === userId) this.showOwner();
    }
    this.workspaces.delete(userId);
    if (this.activeUserId === userId) this.activeUserId = null;
    log("ai-workspace", `workspace fermé (vraie fermeture) : ${userId}`);
    this.opts.onWindowsChanged?.();
    return true;
  }

  /** Arrêt app : détruit toutes les fenêtres IA (avant destruction du main win). */
  destroyAllWindows(): void {
    for (const ws of this.workspaces.values()) {
      if (ws.presentation === "window") ws.profileWindow?.destroy();
    }
  }

  listTabs(userId: string): TabInfo[] {
    const tabs = this.getTabs(userId);
    return tabs ? tabs.list() : [];
  }

  /**
   * Envoie une action UiDriver dans la vue IA et attend l’ACK IPC.
   */
  runUiAction(
    userId: string,
    req: AiWorkspaceUiActionRequest,
  ): Promise<Record<string, unknown>> {
    const ws = this.workspaces.get(userId);
    if (!ws || !ws.ready) {
      return Promise.resolve({
        ok: false,
        error: "Espace IA non prêt — appeler ai_workspace_ensure d’abord",
      });
    }
    return this.waitRendererResult(req.actionId, () => {
      if (ws.view.webContents.isDestroyed()) {
        throw new Error("WebContents IA détruit");
      }
      ws.view.webContents.send("ai-workspace:ui-action", req);
    });
  }

  /**
   * Demande une navigation CRM avec fake-cursor dans la vue IA.
   * Attend l’ack renderer (timeout 45s).
   */
  navigateCrm(
    userId: string,
    href: string,
    actionId: string,
  ): Promise<Record<string, unknown>> {
    const ws = this.workspaces.get(userId);
    if (!ws || !ws.ready) {
      return Promise.resolve({
        ok: false,
        error: "Espace IA non prêt — appeler ai_workspace_ensure d’abord",
      });
    }
    return this.waitRendererResult(actionId, () => {
      if (ws.view.webContents.isDestroyed()) {
        throw new Error("WebContents IA détruit");
      }
      ws.view.webContents.send("ai-workspace:navigate", {
        actionId,
        href,
      });
    });
  }

  private waitRendererResult(
    actionId: string,
    send: () => void,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingUiResults.delete(actionId);
        resolve({
          ok: false,
          error: "Timeout action espace IA (45s)",
          code: "ai_workspace_timeout",
        });
      }, 45_000);
      this.pendingUiResults.set(actionId, { resolve, timer });
      try {
        send();
      } catch (e) {
        clearTimeout(timer);
        this.pendingUiResults.delete(actionId);
        resolve({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });
  }

  resolvePending(actionId: string, result: Record<string, unknown>): boolean {
    const entry = this.pendingUiResults.get(actionId);
    if (!entry) return false;
    this.pendingUiResults.delete(actionId);
    clearTimeout(entry.timer);
    entry.resolve(result);
    return true;
  }

  private async createWorkspace(
    userId: string,
    baseUrl: string,
    label: string,
    presentation: AiWorkspacePresentation,
  ): Promise<AiWorkspace> {
    const partition = aiPartitionName(userId);
    const b = getAiWorkspaceHostBindings();
    const appPreload = b.preloadPath("preload.js");
    if (!fs.existsSync(appPreload)) {
      b.reportCrash("web-event", {
        view: "ai-crm",
        event: "preload-missing",
        preloadPath: appPreload,
      });
      throw new Error(
        `preload.js introuvable (${appPreload}) — le workspace IA exige le ` +
          `preload moderne (H11, plus de fallback preload-app.js).`,
      );
    }
    const { WebContentsView, session } = loadElectron();
    const view = new WebContentsView({
      webPreferences: {
        partition,
        preload: appPreload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        // Vue CRM persona pilotée en arrière-plan (fenêtre IA masquée Q8) :
        // pas de throttling renderer, sinon les actions/screencast se figent.
        backgroundThrottling: false,
      },
    });

    let profileWindow: AiProfileWindow | null = null;
    if (presentation === "window") {
      // Fenêtre dédiée persistante (Q8 : close → hide), créée MASQUÉE —
      // affichée au premier show()/openWindow().
      profileWindow = new AiProfileWindow({
        label,
        isQuitting: this.opts.isQuitting ?? (() => false),
        onVisibilityChanged: () => this.opts.onWindowsChanged?.(),
      });
      profileWindow.attach(view);
      view.setVisible(true);
    } else {
      view.setVisible(false);
      this.win.contentView.addChildView(view);
    }
    b.instrumentWebContents(view.webContents, `ai-crm/${userId}`);

    const hostWindow = profileWindow ? profileWindow.win : this.win;
    const tabs = b.createSupplierTabs(hostWindow, view, {
      partitionPrefix: aiShareWebSessions() ? "" : aiSupplierPartitionPrefix(userId),
      // Mode window : manager actif immédiatement (fenêtre parallèle) ;
      // mode embedded : suspendu tant que show() n'a pas remplacé l'owner.
      suspended: presentation !== "window",
    });
    tabs.setOnChanged(() => {
      try {
        if (!view.webContents.isDestroyed()) {
          view.webContents.send("tabs:changed", tabs.list());
        }
      } catch (e) {
        logError("ai-workspace", e);
      }
    });
    tabs.setOnLoadState((ev) => {
      try {
        if (!view.webContents.isDestroyed()) {
          view.webContents.send("tabs:load-state", ev);
        }
      } catch (e) {
        logError("ai-workspace", e);
      }
    });

    view.webContents.on("render-process-gone", (_e, details) => {
      if (details.reason === "clean-exit") return;
      const ws = this.workspaces.get(userId);
      if (!ws) return;
      ws.ready = false;
      setTimeout(() => {
        if (!view.webContents.isDestroyed()) {
          void this.loadCrm(ws, baseUrl).then(() => {
            ws.ready = true;
          });
        }
      }, 1000);
    });

    log(
      "ai-workspace",
      `créé ${userId} partition=${partition} presentation=${presentation}`,
    );
    return {
      userId,
      label,
      partition,
      view,
      tabs,
      ready: false,
      baseUrl,
      presentation,
      profileWindow,
    };
  }

  private async setSessionCookie(
    ws: AiWorkspace,
    baseUrl: string,
    token: string,
  ): Promise<void> {
    const { session } = loadElectron();
    const ses = session.fromPartition(ws.partition);
    try {
      await ses.cookies.remove(baseUrl, getAiWorkspaceHostBindings().sessionCookieName);
    } catch {
      /* ignore */
    }
    await ses.cookies.set({
      url: baseUrl,
      name: getAiWorkspaceHostBindings().sessionCookieName,
      value: token,
      httpOnly: true,
      sameSite: "lax",
    });
  }

  private async loadCrm(ws: AiWorkspace, baseUrl: string): Promise<void> {
    // P4 : le workspace d'un collaborateur IA atterrit sur son inbox de
    // missions (/taches filtré sur lui) plutôt que sur le dashboard générique.
    const url = `${baseUrl}/taches?assignee=${encodeURIComponent(ws.userId)}`;
    await new Promise<void>((resolve) => {
      const wc = ws.view.webContents;
      const timer = setTimeout(done, 30_000);
      function done() {
        clearTimeout(timer);
        try {
          wc.removeListener("did-finish-load", done);
          wc.removeListener("did-fail-load", done);
        } catch {
          /* ignore */
        }
        resolve();
      }
      wc.once("did-finish-load", done);
      wc.once("did-fail-load", done);
      wc.loadURL(url).catch((e) => {
        logError("ai-workspace", e);
        done();
      });
    });
    // Marqueur runtime pour le renderer (bandeau + agent bus).
    try {
      const prefix = getAiWorkspaceHostBindings().sessionStoragePrefix;
      await ws.view.webContents.executeJavaScript(
        `(() => { try { sessionStorage.setItem(${JSON.stringify(prefix + '-user')}, ${JSON.stringify(ws.userId)}); sessionStorage.setItem(${JSON.stringify(prefix + '-label')}, ${JSON.stringify(ws.label)}); } catch(e) {} })();`,
        true,
      );
    } catch (e) {
      logError("ai-workspace", e);
    }
  }
}
