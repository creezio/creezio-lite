/**
 * Fabrique l'objet exposé via contextBridge sous `window[bridgeName]`.
 *
 * Port structurel de electron/preload-app.ts (kit) — sans hardcoder
 * le nom du bridge.
 *
 * ⚠️ Préload packagé via extraResources (hors asar) : NE PAS `require`
 * `@creezio/shell` ni le manifest depuis le preload compilé — Node ne
 * résout pas `node_modules` depuis `resources/electron/`. Préférer un
 * littéral `contextBridge.exposeInMainWorld("…Desktop", api)` dans le
 * preload de l'app, ou bundler le preload (esbuild) pour inliner ce module.
 */

import type {
  DesktopBridge,
  DesktopConnectionProfile,
  DesktopContentRect,
  DesktopInfo,
  DesktopSupplierTabOpened,
  DesktopTabInfo,
  DesktopTabLoadState,
  DesktopUpdateStatus,
} from "./types.js";
import { IpcChannels } from "./ipc-channels.js";

/** Sous-ensemble ipcRenderer requis par le bridge. */
export type IpcRendererLike = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  send: (channel: string, ...args: unknown[]) => void;
  on: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void,
  ) => void;
  removeListener: (
    channel: string,
    listener: (...args: unknown[]) => void,
  ) => void;
};

export type ContextBridgeLike = {
  exposeInMainWorld: (apiKey: string, api: unknown) => void;
};

function onChannel<T>(
  ipc: IpcRendererLike,
  channel: string,
  cb: (payload: T) => void,
): () => void {
  const listener = (_event: unknown, payload: unknown) => cb(payload as T);
  ipc.on(channel, listener);
  return () => ipc.removeListener(channel, listener);
}

/**
 * API noyau partagée (Client + Serveur). Les extensions verticales
 * (plugins, Hermes status…) restent dans le preload de chaque marque.
 */
export function createDesktopApi(
  ipc: IpcRendererLike,
  opts?: { customWindowChrome?: boolean },
): DesktopBridge {
  const C = IpcChannels;
  return {
    isDesktop: true,
    customWindowChrome:
      opts?.customWindowChrome ??
      (typeof process !== "undefined" && process.platform === "win32"),

    getInfo: () => ipc.invoke(C.desktop.info) as Promise<DesktopInfo>,

    getConnectionProfile: () =>
      ipc.invoke(C.connection.get) as Promise<DesktopConnectionProfile>,
    testConnection: (url: string) =>
      ipc.invoke(C.connection.test, url) as Promise<{
        ok: boolean;
        status: number;
        baseUrl?: string;
        error?: string;
      }>,
    chooseConnection: (profile) =>
      ipc.invoke(C.connection.choose, profile) as Promise<
        { ok: true; profile: unknown } | { ok: false; error: string }
      >,
    applyConnection: (profile) =>
      ipc.invoke(C.connection.apply, profile) as Promise<
        { ok: true; relaunching?: boolean } | { ok: false; error: string }
      >,
    rechooseConnection: () =>
      ipc.invoke(C.connection.rechoose) as Promise<
        { ok: true; relaunching?: boolean } | { ok: false; error: string }
      >,
    forgetRememberedServer: (id: string) =>
      ipc.invoke(C.profiles.forgetServer, id) as Promise<{
        ok: boolean;
        error?: string;
      }>,

    minimizeWindow: () => ipc.invoke(C.window.minimize) as Promise<void>,
    toggleMaximizeWindow: () =>
      ipc.invoke(C.window.maximizeToggle) as Promise<{ isMaximized: boolean }>,
    closeWindow: () => ipc.invoke(C.window.close) as Promise<void>,
    isWindowMaximized: () =>
      ipc.invoke(C.window.isMaximized) as Promise<boolean>,
    onWindowMaximizedChanged: (cb) =>
      onChannel<boolean>(ipc, C.window.maximizedChanged, cb),

    openTab: (siteId: number | string, url: string) =>
      ipc.invoke(C.tabs.open, siteId, url) as Promise<{
        tabId: string;
        siteId: number | string;
        fournisseurId: number | string;
        loadState?: "loading" | "ready" | "error";
        url?: string;
      }>,
    closeTab: (tabId: string) =>
      ipc.invoke(C.tabs.close, tabId) as Promise<void>,
    activateTab: (tabId: string, rect?: DesktopContentRect) =>
      ipc.invoke(C.tabs.activate, tabId, rect) as Promise<
        { ok: boolean; error?: string } | void
      >,
    activateSite: (siteId: number | string, url: string, rect?: DesktopContentRect) =>
      ipc.invoke(C.tabs.activateSite, siteId, url, rect) as Promise<{
        ok: boolean;
        error?: string;
        tabId?: string;
        siteId?: number | string;
        fournisseurId?: number | string;
        loadState?: "loading" | "ready" | "error";
        url?: string;
      }>,
    setContentRect: (rect: DesktopContentRect) =>
      ipc.invoke(C.tabs.setContentRect, rect) as Promise<void>,
    showCrm: () => ipc.invoke(C.tabs.showCrm) as Promise<void>,
    listTabs: () => ipc.invoke(C.tabs.list) as Promise<DesktopTabInfo[]>,
    onTabsChanged: (cb) =>
      onChannel<DesktopTabInfo[]>(ipc, C.tabs.changed, cb),
    onTabLoadState: (cb) =>
      onChannel<DesktopTabLoadState>(ipc, C.tabs.loadState, cb),
    onExternalTabOpened: (cb) => {
      const offExt = onChannel<DesktopSupplierTabOpened>(
        ipc,
        C.tabs.externalOpened,
        cb,
      );
      const offLegacy = onChannel<DesktopSupplierTabOpened>(
        ipc,
        C.tabs.supplierOpened,
        cb,
      );
      return () => {
        offExt();
        offLegacy();
      };
    },
    /** @deprecated → onExternalTabOpened */
    onSupplierTabOpened: (cb) => {
      const offExt = onChannel<DesktopSupplierTabOpened>(
        ipc,
        C.tabs.externalOpened,
        cb,
      );
      const offLegacy = onChannel<DesktopSupplierTabOpened>(
        ipc,
        C.tabs.supplierOpened,
        cb,
      );
      return () => {
        offExt();
        offLegacy();
      };
    },

    googleLogin: () =>
      ipc.invoke(C.auth.googleLogin) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    logout: () => ipc.invoke(C.auth.logout) as Promise<{ ok: boolean }>,
    retrySetup: () => {
      ipc.send(C.setup.retry);
    },

    // Compat kit : handlers main écoutent souvent `update:get-status`.
    getUpdateStatus: () =>
      ipc.invoke(C.update.getStatus) as Promise<DesktopUpdateStatus>,
    checkForUpdates: () =>
      ipc.invoke(C.update.check) as Promise<DesktopUpdateStatus>,
    downloadAndInstallUpdate: () =>
      ipc.invoke(C.update.downloadInstall) as Promise<DesktopUpdateStatus>,
    onUpdateChanged: (cb) =>
      onChannel<DesktopUpdateStatus>(ipc, C.update.changed, cb),

    setAssistantChrome: (mode: "fab" | "hidden") =>
      ipc.invoke(C.assistant.setChrome, mode) as Promise<void>,
    onAssistantOpenRequest: (cb) =>
      onChannel<void>(ipc, C.assistant.openRequest, () => cb()),

    /* ── N2p — espaces IA (canaux IpcChannels.aiWorkspace) ── */
    getAiWorkspaceIdentity: () =>
      ipc.invoke(C.aiWorkspace.identity) as Promise<{
        userId: string | null;
        label: string;
        active: boolean;
      }>,
    listAiWorkspaces: () =>
      ipc.invoke(C.aiWorkspace.list) as Promise<
        Array<{
          userId: string;
          label: string;
          partition: string;
          ready: boolean;
          active: boolean;
        }>
      >,
    ensureAiWorkspace: (opts: {
      userId: string;
      token: string;
      baseUrl?: string;
      label?: string;
      show?: boolean;
    }) => ipc.invoke(C.aiWorkspace.ensure, opts) as Promise<unknown>,
    showAiWorkspace: (userId: string) =>
      ipc.invoke(C.aiWorkspace.show, userId) as Promise<unknown>,
    showOwnerWorkspace: () =>
      ipc.invoke(C.aiWorkspace.showOwner) as Promise<{ ok: true }>,
    ackAiWorkspaceAction: (
      actionId: string,
      result: Record<string, unknown>,
    ) => {
      ipc.send(C.aiWorkspace.actionResult, { actionId, result });
    },
  };
}

/** Expose l'API sous `window[bridgeName]` (contextIsolation). */
export function exposeDesktopApi(
  contextBridge: ContextBridgeLike,
  bridgeName: string,
  api: DesktopBridge,
): void {
  contextBridge.exposeInMainWorld(bridgeName, api);
}
