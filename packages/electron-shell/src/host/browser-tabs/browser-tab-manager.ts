// @ts-nocheck — Electron WebContents/session (shim kit mince, N7)
/**
 * Onglets sites externes : une WebContentsView par onglet, chacune dans une
 * partition persistante `persist:fournisseur-<id>` (cookies/sessions isolés
 * par outil, conservés entre les lancements).
 *
 * Layout : la vue UI CRM occupe toute la fenêtre ; la vue site active
 * n'occupe QUE la content area du workspace (`ContentRect` : x, y, width,
 * height) — sidebar / tab bar restent hors bounds. Panel assistant ouvert =
 * slot rétréci (push React). Panel fermé = ContentRect full-bleed sous le
 * FAB ; le FAB est une WebContentsView topmost (`AssistantChromeOverlay`).
 *
 * Robustesse : AUCUNE erreur d'onglet ne doit être fatale — un échec de
 * chargement affiche une page d'erreur DANS l'onglet, toute exception est
 * loggée + rapportée (kind "tab-error"), les webContents détruits sont
 * ignorés, et les bounds sont toujours clampés dans la fenêtre.
 *
 * Navigation SPA : loadAndWait short-circuite si même document (tab-url.ts) ;
 * le spinner React ne s'affiche que sur intent-load (pas main-nav-start).
 */

import type { BaseWindow, WebContentsView, Session } from "electron";
import { loadElectron } from "@creezio/host-runtime";
import fs from "node:fs";
import crypto from "node:crypto";
import { log, logError } from "@creezio/host-runtime";
import { instrumentWebContents } from "../web-telemetry.js";
import { reportCrash } from "@creezio/host-runtime";
import { CHROME_UA } from "./chrome-ua.js";
import {
  reduceTabNativeLoadState,
  type TabLoadPhase,
} from "./tab-load-state.js";
import { isSameTabDocument, isSameTabOrigin } from "./tab-url.js";
import { browserTabPreloadPath } from "./browser-tab-preload-path.js";

export type BrowserTabManagerDeps = {
  /**
   * Chemin absolu preload onglet.
   * O1 : défaut = `browserTabPreloadPath()` (kit) ; TF peut surcharger
   * avec son preload-supplier métier.
   */
  resolvePreloadPath?: () => string;
};

let resolvePreloadPathImpl: (() => string) | null = null;

/** Wiring marque — chemin preload onglet (défaut kit si omis). */
export function configureBrowserTabs(opts: BrowserTabManagerDeps = {}): void {
  resolvePreloadPathImpl = opts.resolvePreloadPath ?? browserTabPreloadPath;
}

function resolvePreloadPath(): string {
  if (!resolvePreloadPathImpl) {
    // Auto-config défaut kit (O1) si configureBrowserTabs omis.
    configureBrowserTabs();
  }
  return resolvePreloadPathImpl!();
}

/** Id de site externe opaque (UUID marque ou entier historique). */
export type SiteId = number | string;

export type TabInfo = {
  tabId: string;
  siteId: SiteId;
  /** @deprecated → siteId */
  fournisseurId: SiteId;
  url: string;
  title: string;
  active: boolean;
};

export type TabLoadState = {
  tabId: string;
  siteId: SiteId;
  /** @deprecated → siteId */
  fournisseurId: SiteId;
  state: "loading" | "ready" | "error";
  error?: string;
  url?: string;
};

export type ContentRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Onglet site externe (WebContentsView). Alias historique : SupplierTab. */
export type BrowserTab = {
  tabId: string;
  /** Id opaque du site (identité renderer : UUID marque ou entier). */
  siteId: SiteId;
  /** Partition persistante numérique dérivée (session Electron). */
  partitionKey: number;
  /**
   * @deprecated → siteId (miroir pour marques TF non migrées).
   * Toujours égal à `siteId`.
   */
  fournisseurId: SiteId;
  view: WebContentsView;
  debuggerAttached: boolean;
  /** Chargement document principal — vue masquée tant que loading (spinner React). */
  loadState: TabLoadPhase;
};

/** @deprecated → BrowserTab */
export type SupplierTab = BrowserTab;

/** Domaines de popups d'auth fédérée à laisser s'ouvrir en vraie fenêtre. */
const OAUTH_POPUP_HOSTS = [
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "appleid.apple.com",
  "facebook.com",
  "www.facebook.com",
];

const MIN_CONTENT = 40;

/** Page d'erreur affichée DANS l'onglet quand le site ne charge pas. */
function tabErrorHtml(url: string, description: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><title>Page inaccessible</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f7fb;color:#1e2430;font-family:system-ui">
<div style="max-width:560px;padding:32px;text-align:center">
<div style="font-size:40px">🌐</div>
<h1 style="font-size:17px;margin-top:12px">Impossible d'ouvrir cette page</h1>
<p style="font-size:13px;opacity:.75;word-break:break-all;line-height:1.5">${esc(url)}</p>
<p style="font-size:13px;opacity:.75">${esc(description)}</p>
<p style="font-size:12px;opacity:.55;margin-top:18px">Vérifiez l'adresse ou votre connexion, puis rouvrez l'onglet.</p>
</div></body></html>`)}`;
}

function stableHash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(h, 31) + input.charCodeAt(i)) >>> 0;
  }
  return 1_000_000_000 + (h % 1_000_000_000);
}

/**
 * Id de partition : id outil numérique (annuaire), hash stable de l'id opaque
 * (UUID marque), ou hash du hostname si siteId absent/≤ 0 (évite une
 * partition globale partagée `extsite-0`).
 */
export function resolvePartitionId(siteId: SiteId, url: string): number {
  if (typeof siteId === "number" && Number.isFinite(siteId) && siteId > 0) {
    return Math.floor(siteId);
  }
  if (typeof siteId === "string" && siteId.trim()) {
    return stableHash(siteId.trim());
  }
  try {
    const host = new URL(url).hostname || "unknown";
    return stableHash(host);
  } catch {
    return 0;
  }
}

function clampRect(rect: ContentRect, winW: number, winH: number): ContentRect | null {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (width < MIN_CONTENT || height < MIN_CONTENT) return null;
  if (x >= winW - MIN_CONTENT || y >= winH - MIN_CONTENT) return null;
  return {
    x,
    y,
    width: Math.min(width, winW - x),
    height: Math.min(height, winH - y),
  };
}

export type SupplierTabManagerOptions = {
  /**
   * Préfixe de partition supplier (ex. `brand-ai-<userId>` →
   * `persist:brand-ai-<userId>-extsite-<key>`). Vide = comportement historique
   * `persist:fournisseur-<key>` (workspace owner Tempo).
   */
  partitionPrefix?: string;
  /** Si true : manager inactif (pas d’applyBounds / vues masquées). */
  suspended?: boolean;
};

export class SupplierTabManager {
  private tabs = new Map<string, SupplierTab>();
  private activeTabId: string | null = null;
  private contentRect: ContentRect | null = null;
  private onChanged: (() => void) | null = null;
  private onAfterBounds: (() => void) | null = null;
  private onLoadState: ((ev: TabLoadState) => void) | null = null;
  private partitionPrefix: string;
  private suspended: boolean;

  constructor(
    private win: BaseWindow,
    /** Vue UI CRM — reste en dessous, jamais retirée. */
    private appView: WebContentsView,
    opts?: SupplierTabManagerOptions,
  ) {
    this.partitionPrefix = (opts?.partitionPrefix || "").trim();
    this.suspended = Boolean(opts?.suspended);
    this.win.on("resize", () => this.applyBounds());
  }

  /** Désactive ce manager (espace IA masqué / owner masqué). */
  suspend(): void {
    this.suspended = true;
    // Ne PAS appeler showCrm() : ça effacerait activeTabId et empêcherait
    // resume() de restaurer l’onglet site natif au retour.
    for (const t of this.tabs.values()) {
      try {
        t.view.setVisible(false);
      } catch (e) {
        logError("tabs", e);
      }
    }
    try {
      this.appView.setVisible(false);
    } catch (e) {
      logError("tabs", e);
    }
  }

  /** Réactive ce manager et restaure les bounds. */
  resume(): void {
    this.suspended = false;
    try {
      this.appView.setVisible(true);
    } catch (e) {
      logError("tabs", e);
    }
    this.applyBounds();
  }

  isSuspended(): boolean {
    return this.suspended;
  }

  /** Callback notifié à chaque changement (création, navigation, fermeture). */
  setOnChanged(cb: () => void): void {
    this.onChanged = cb;
  }

  /**
   * Appelé après chaque applyBounds (ex. remonter le FAB chrome au-dessus
   * de la WebContentsView fournisseur).
   */
  setOnAfterBounds(cb: () => void): void {
    this.onAfterBounds = cb;
  }

  /** Chargement document principal (nav start → finish/fail/stop) pour spinner UI. */
  setOnLoadState(cb: (ev: TabLoadState) => void): void {
    this.onLoadState = cb;
  }

  private notify(): void {
    try {
      this.onChanged?.();
    } catch (e) {
      logError("tabs", e);
    }
  }

  private emitLoadState(
    tab: SupplierTab,
    state: TabLoadPhase,
    extra?: { error?: string; url?: string },
  ): void {
    const prev = tab.loadState;
    tab.loadState = state;
    const ev: TabLoadState = {
      tabId: tab.tabId,
      siteId: tab.siteId,
      fournisseurId: tab.siteId,
      state,
      error: extra?.error,
      url: extra?.url,
    };
    try {
      this.onLoadState?.(ev);
    } catch (e) {
      logError("tabs", e);
    }
    // applyBounds seulement si la visibilité native peut changer.
    if (prev !== state) this.applyBounds();
  }

  /**
   * Si Chromium est déjà idle mais l'état UI est resté `loading` (IPC raté,
   * did-start-loading parasite, listener React monté tard), forcer `ready`.
   */
  private resyncLoadStateIfIdle(tab: SupplierTab): void {
    const wc = tab.view.webContents;
    if (wc.isDestroyed()) return;
    if (wc.isLoading()) return;
    const url = wc.getURL() || "";
    const next = reduceTabNativeLoadState(tab.loadState, {
      type: "sync-already-idle",
      url: url || undefined,
    });
    if (next !== tab.loadState) {
      this.emitLoadState(tab, next, { url: url || undefined });
    }
  }

  private supplierSession(partitionKey: number): Session {
    /**
     * Embeds (Hermes/n8n, siteId ≥ 900000) : `persist:extsite-<id>`
     * — aligné cookie injection (`prepareN8nUiSession`).
     * Fournisseurs catalogue : `persist:fournisseur-<id>` (historique Tempo).
     * Workspace IA : préfixe `brand-ai-<userId>-extsite-<id>`.
     */
    const isEmbedTool = partitionKey >= 900_000;
    const name = this.partitionPrefix
      ? `persist:${this.partitionPrefix}-extsite-${partitionKey}`
      : isEmbedTool
        ? `persist:extsite-${partitionKey}`
        : `persist:fournisseur-${partitionKey}`;
    const ses = loadElectron().session.fromPartition(name);
    ses.setUserAgent(CHROME_UA);
    return ses;
  }

  getContentRect(): ContentRect | null {
    return this.contentRect;
  }

  /** Met à jour le rectangle de la content area (mesuré par l'UI CRM). */
  setContentRect(rect: ContentRect): void {
    const { width, height } = this.win.getContentBounds();
    const clamped = clampRect(rect, width, height);
    this.contentRect = clamped;
    this.applyBounds();
  }

  list(): TabInfo[] {
    const infos: TabInfo[] = [];
    for (const t of this.tabs.values()) {
      let url = "";
      let title = "";
      try {
        if (!t.view.webContents.isDestroyed()) {
          url = t.view.webContents.getURL();
          title = t.view.webContents.getTitle();
        }
      } catch (e) {
        logError("tabs", e);
      }
      infos.push({
        tabId: t.tabId,
        siteId: t.siteId,
        fournisseurId: t.siteId,
        url,
        title,
        active: t.tabId === this.activeTabId,
      });
    }
    return infos;
  }

  get(tabId: string): SupplierTab | undefined {
    return this.tabs.get(tabId);
  }

  getActive(): SupplierTab | undefined {
    return this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
  }

  /**
   * Retrouve une vue vivante depuis l'identité stable du site.
   *
   * `tabId` est une identité de session transmise au renderer de façon
   * asynchrone. Le site + son URL restent disponibles dans l'onglet workspace
   * même si ce patch React n'a pas encore eu lieu (ou après restauration de
   * session). Pour les sites anonymes (`siteId = 0`), l'URL retrouve la
   * partition hachée créée par openTab.
   */
  private findLiveTabForSite(siteId: SiteId, url: string): SupplierTab | undefined {
    const partitionKey = resolvePartitionId(siteId, url);
    return Array.from(this.tabs.values()).find(
      (t) => t.partitionKey === partitionKey && !t.view.webContents.isDestroyed(),
    );
  }

  /**
   * Réactive une vue déjà ouverte par identité stable, sans navigation ni
   * reload. Filet de sécurité quand le renderer ne connaît pas encore (ou plus)
   * son tabId Electron.
   */
  activateSite(
    siteId: SiteId,
    url: string,
    rect?: ContentRect,
  ):
    | {
        ok: true;
        tabId: string;
        siteId: SiteId;
        /** @deprecated → siteId */
        fournisseurId: SiteId;
        loadState: TabLoadPhase;
        url?: string;
      }
    | { ok: false; error: string } {
    const tab = this.findLiveTabForSite(siteId, url);
    if (!tab) {
      log("tabs", `activateSite: vue absente pour site ${siteId} (${url})`);
      return { ok: false, error: "tab-not-found" };
    }
    const activated = this.activate(tab.tabId, rect);
    if (!activated.ok) return activated;
    let currentUrl = "";
    try {
      currentUrl = tab.view.webContents.getURL() || "";
    } catch {
      /* la vue vient d'être détruite : l'appelant gardera son URL seed */
    }
    return {
      ok: true,
      tabId: tab.tabId,
      siteId: tab.siteId,
      fournisseurId: tab.siteId,
      loadState: tab.loadState,
      url: currentUrl || undefined,
    };
  }

  /**
   * Ouvre un onglet site externe sur `url`.
   * Si un onglet de la même partition (`siteId`) existe déjà, il est réutilisé.
   * @param siteId Id de partition (ex. entité métier marque, ou 0 = hash host).
   */
  async openTab(siteId: SiteId, url: string): Promise<BrowserTab> {
    try {
      new URL(url); // validation précoce : erreur claire plutôt qu'onglet blanc
    } catch {
      throw new Error(`URL d'onglet invalide : « ${url} »`);
    }

    const partitionKey = resolvePartitionId(siteId, url);
    const existing = this.findLiveTabForSite(siteId, url);
    if (existing) {
      // SPA / sync URL : ne pas loadURL si le document est déjà affiché
      // (sinon Hermes chat / sidebars SPA se remountent à chaque pushState).
      await this.loadAndWait(existing, url);
      this.activeTabId = existing.tabId;
      this.applyBounds();
      this.notify();
      return existing;
    }

    const ses = this.supplierSession(partitionKey);
    const preload = resolvePreloadPath();
    if (!fs.existsSync(preload)) {
      // Artefact incomplet (packaging cassé) : sans preload, l'onglet serait
      // ouvert mais muet (pas d'IPC, pilotage IA dégradé) — on refuse avec
      // une erreur explicite que l'UI affiche en bannière, plutôt qu'un
      // crash-report silencieux + onglet zombie.
      reportCrash("tab-error", { step: "openTab", missingPreload: preload });
      throw new Error(
        `Onglet externe indisponible : preload manquant dans l'artefact ` +
          `(${preload}). Réinstaller l'application ou vérifier le packaging ` +
          `(gate after-pack desktop-tooling).`,
      );
    }
    const { WebContentsView } = loadElectron();
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        // Bots/IA : les événements CDP routés compositeur (mouseWheel,
        // mouseMoved) doivent être ACKés même vue masquée / fenêtre occluse
        // (fenêtre IA cachée Q8, owner dans le tray) — sinon deadlock.
        backgroundThrottling: false,
      },
    });
    view.webContents.setUserAgent(CHROME_UA);
    view.setVisible(false);

    const tabId = `tab-${crypto.randomBytes(4).toString("hex")}`;
    // L'identité renvoyée au renderer reste l'id opaque d'origine (UUID
    // marque…) ; la partition numérique ne sert qu'à la session persistante.
    const echoSiteId: SiteId =
      (typeof siteId === "string" && siteId.trim()) ||
      (typeof siteId === "number" && Number.isFinite(siteId) && siteId > 0)
        ? siteId
        : partitionKey;
    const tab: BrowserTab = {
      tabId,
      siteId: echoSiteId,
      partitionKey,
      fournisseurId: echoSiteId, // miroir déprécié
      view,
      debuggerAttached: false,
      loadState: "loading",
    };
    this.tabs.set(tabId, tab);
    instrumentWebContents(view.webContents, `${tabId}/f${partitionKey}`);
    log("tabs", `onglet ${tabId} (site ${partitionKey}) → ${url}`);
    this.wireLoadEvents(tab);

    view.webContents.setWindowOpenHandler(({ url: targetUrl, disposition }) => {
      let host = "";
      let currentUrl = "";
      try {
        host = new URL(targetUrl).hostname;
        if (!view.webContents.isDestroyed()) {
          currentUrl = view.webContents.getURL() || "";
        }
      } catch {
        return { action: "deny" };
      }
      const isOauthHost = OAUTH_POPUP_HOSTS.some(
        (h) => host === h || host.endsWith("." + h),
      );
      const sameOrigin = Boolean(currentUrl && isSameTabOrigin(currentUrl, targetUrl));
      // Popup réelle : OAuth fédéré, new-window, ou window.open same-origin
      // (même partition cookies — ex. flux métier / upload).
      const allowPopup =
        isOauthHost ||
        disposition === "new-window" ||
        (sameOrigin && disposition === "default");
      if (allowPopup) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            width: 520,
            height: 720,
            autoHideMenuBar: true,
            webPreferences: {
              session: ses,
              contextIsolation: true,
              sandbox: true,
            },
          },
        };
      }
      if (disposition === "foreground-tab" || disposition === "background-tab") {
        void this.loadAndWait(tab, targetUrl).catch((e) => logError("tabs", e));
        return { action: "deny" };
      }
      void loadElectron().shell.openExternal(targetUrl).catch((e) => logError("tabs", e));
      return { action: "deny" };
    });

    const onNav = () => this.notify();
    view.webContents.on("did-navigate", onNav);
    view.webContents.on("did-navigate-in-page", onNav);
    view.webContents.on("page-title-updated", onNav);

    view.webContents.on("render-process-gone", (_e, details) => {
      if (details.reason === "clean-exit") return;
      const msg = `Le rendu de l'onglet s'est arrêté (${details.reason}).`;
      if (!view.webContents.isDestroyed()) {
        void view.webContents.loadURL(tabErrorHtml(url, msg)).catch(() => {});
      }
      this.emitLoadState(tab, "error", { error: msg, url });
      this.notify();
    });

    this.win.contentView.addChildView(view);
    this.activeTabId = tabId;
    this.emitLoadState(tab, "loading", { url });
    await this.loadAndWait(tab, url);
    this.applyBounds();
    this.notify();
    return tab;
  }

  /**
   * Navigation principale uniquement → IPC load-state + masquage pendant loading.
   * Ne pas écouter `did-start-loading` : il refire après finish (iframes /
   * sous-ressources) et rebloquait l'overlay React sans ready de sortie.
   */
  private wireLoadEvents(tab: SupplierTab): void {
    const wc = tab.view.webContents;
    /** true le temps de charger la data:-page d'erreur (évite flash « loading »). */
    let loadingErrorPage = false;

    wc.on("did-start-navigation", (_e, url, isInPlace, isMainFrame) => {
      if (wc.isDestroyed() || loadingErrorPage || !this.tabs.has(tab.tabId)) return;
      const next = reduceTabNativeLoadState(tab.loadState, {
        type: "main-nav-start",
        isMainFrame: Boolean(isMainFrame),
        isInPlace: Boolean(isInPlace),
        url: typeof url === "string" ? url : undefined,
      });
      if (next !== tab.loadState) {
        this.emitLoadState(tab, next, {
          url: typeof url === "string" ? url : undefined,
        });
      }
    });

    wc.on("did-finish-load", () => {
      if (wc.isDestroyed() || !this.tabs.has(tab.tabId)) return;
      const current = wc.getURL() || "";
      if (loadingErrorPage || current.startsWith("data:text/html")) {
        loadingErrorPage = false;
        const next = reduceTabNativeLoadState(tab.loadState, {
          type: "main-finish",
          url: current || undefined,
        });
        this.emitLoadState(tab, next, { url: current || undefined });
        this.notify();
        return;
      }
      const next = reduceTabNativeLoadState(tab.loadState, {
        type: "main-finish",
        url: current || undefined,
      });
      this.emitLoadState(tab, next, { url: current || undefined });
      this.notify();
    });

    wc.on("did-stop-loading", () => {
      if (wc.isDestroyed() || loadingErrorPage || !this.tabs.has(tab.tabId)) return;
      const current = wc.getURL() || "";
      const next = reduceTabNativeLoadState(tab.loadState, {
        type: "stop-loading",
        stillLoading: wc.isLoading(),
        url: current || undefined,
      });
      if (next !== tab.loadState) {
        this.emitLoadState(tab, next, { url: current || undefined });
        this.notify();
      }
    });

    wc.on(
      "did-fail-load",
      (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
        const aborted = errorCode === -3; /* ERR_ABORTED */
        const next = reduceTabNativeLoadState(tab.loadState, {
          type: "main-fail",
          isMainFrame: Boolean(isMainFrame),
          aborted,
        });
        if (next === tab.loadState) return;
        const msg = `${errorDescription} (${errorCode})`;
        log(
          "tabs",
          `onglet ${tab.tabId}: échec chargement ${errorCode} ${errorDescription} ${validatedURL}`,
        );
        this.emitLoadState(tab, next, {
          error: msg,
          url: validatedURL || undefined,
        });
        if (!wc.isDestroyed() && next === "error") {
          loadingErrorPage = true;
          void wc
            .loadURL(tabErrorHtml(validatedURL || "", msg))
            .catch(() => {
              loadingErrorPage = false;
            });
        }
        this.notify();
      },
    );
  }

  /**
   * Charge une URL et attend la fin de chargement (timeout doux 20 s).
   * No-op si le document courant est déjà la cible (évite reload SPA).
   */
  async loadAndWait(tab: SupplierTab, url: string): Promise<void> {
    const wc = tab.view.webContents;
    if (wc.isDestroyed()) return;
    let current = "";
    try {
      current = wc.getURL() || "";
    } catch {
      current = "";
    }
    if (current && isSameTabDocument(current, url)) {
      this.resyncLoadStateIfIdle(tab);
      return;
    }
    const next = reduceTabNativeLoadState(tab.loadState, { type: "intent-load" });
    this.emitLoadState(tab, next, { url });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, 20000);
      function done() {
        clearTimeout(timer);
        try {
          wc.removeListener("did-finish-load", done);
          wc.removeListener("did-fail-load", done);
        } catch {
          /* webContents détruit entre-temps */
        }
        resolve();
      }
      wc.once("did-finish-load", done);
      wc.once("did-fail-load", done);
      wc.loadURL(url).catch((e) => {
        this.emitLoadState(tab, "error", {
          error: e instanceof Error ? e.message : String(e),
          url,
        });
        done();
      });
    });
  }

  /**
   * Active un onglet. `rect` optionnel met à jour la content area.
   * Sans nouveau rect, réutilise `contentRect` (conservé après showCrm) —
   * indispensable pour réactiver Hermes au retour d'onglet.
   */
  activate(
    tabId: string,
    rect?: ContentRect,
  ): { ok: true } | { ok: false; error: string } {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      log("tabs", `activate: tab inconnu « ${tabId} »`);
      return { ok: false, error: "tab-not-found" };
    }
    if (tab.view.webContents.isDestroyed()) {
      return { ok: false, error: "webcontents-destroyed" };
    }
    if (rect) {
      const { width, height } = this.win.getContentBounds();
      this.contentRect = clampRect(rect, width, height);
    }
    this.activeTabId = tabId;
    for (const t of this.tabs.values()) {
      try {
        // Visibilité finale gérée dans applyBounds (rect requis).
        t.view.setVisible(false);
      } catch (e) {
        logError("tabs", e);
      }
    }
    // Page déjà chargée + état UI bloqué sur loading → ready immédiat.
    this.resyncLoadStateIfIdle(tab);
    this.applyBounds();
    this.notify();
    return { ok: true };
  }

  /**
   * Masque tous les onglets : l'UI CRM reprend toute la fenêtre.
   * Ne clear PAS contentRect — réutilisé au prochain activate sans rect.
   */
  showCrm(): void {
    this.activeTabId = null;
    for (const t of this.tabs.values()) {
      try {
        t.view.setVisible(false);
      } catch (e) {
        logError("tabs", e);
      }
    }
    this.notify();
  }

  /** Remonte la vue dans le contentView (au-dessus de appView, sous FAB). */
  private bringViewToFront(view: WebContentsView): void {
    try {
      this.win.contentView.removeChildView(view);
    } catch {
      /* pas encore enfant / déjà retiré */
    }
    try {
      this.win.contentView.addChildView(view);
    } catch (e) {
      logError("tabs", e);
    }
  }

  /**
   * Ferme la vue Electron de l'onglet. Les cookies de la partition
   * `persist:extsite-<id>` sont CONSERVÉS (pas de clearStorageData).
   */
  closeTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    this.tabs.delete(tabId);
    if (this.activeTabId === tabId) this.activeTabId = null;
    try {
      if (tab.debuggerAttached) tab.view.webContents.debugger.detach();
    } catch {
      /* déjà détaché */
    }
    try {
      this.win.contentView.removeChildView(tab.view);
    } catch (e) {
      logError("tabs", e);
    }
    try {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    } catch (e) {
      logError("tabs", e);
    }
    this.notify();
  }

  closeAll(): void {
    for (const tabId of Array.from(this.tabs.keys())) this.closeTab(tabId);
  }

  private applyBounds(): void {
    if (this.suspended) {
      for (const t of this.tabs.values()) {
        try {
          t.view.setVisible(false);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    try {
      if (this.win.isDestroyed()) return;
      const { width, height } = this.win.getContentBounds();
      this.appView.setBounds({ x: 0, y: 0, width, height });
      const active = this.getActive();
      if (active && !active.view.webContents.isDestroyed()) {
        const rect = this.contentRect
          ? clampRect(this.contentRect, width, height)
          : null;
        // Pendant loading : vue masquée → le spinner React du slot est visible.
        const showNative =
          Boolean(rect) &&
          (active.loadState === "ready" || active.loadState === "error");
        if (!showNative) {
          active.view.setVisible(false);
        } else {
          this.bringViewToFront(active.view);
          active.view.setBounds(rect!);
          active.view.setVisible(true);
        }
        // Masquer les autres (déjà fait dans activate, ceinture + bretelles).
        for (const t of this.tabs.values()) {
          if (t.tabId !== active.tabId) {
            try {
              t.view.setVisible(false);
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch (e) {
      logError("tabs", e);
      reportCrash("tab-error", {
        step: "applyBounds",
        message: e instanceof Error ? e.message : String(e),
      });
    }
    // Toujours remonter le FAB chrome (même si aucune vue supplier visible).
    try {
      this.onAfterBounds?.();
    } catch (cbErr) {
      logError("tabs", cbErr);
    }
  }
}


/** Alias classe (N7) — SoT type = BrowserTab ci-dessus. */
export { SupplierTabManager as BrowserTabManager };
