/**
 * Extensions preload CRM hôte (Hermes / n8n / plugins / flotte / setup…) +
 * télémétrie renderer — extrait gold preload-app ×3 (O7).
 *
 * Les canaux restent les littéraux historiques (handlers main), pas une
 * renumérotation IpcChannels partielle.
 */

import type { ContextBridgeLike, IpcRendererLike } from "./create-desktop-api.js";
import {
  createDesktopApi,
  exposeDesktopApi,
} from "./create-desktop-api.js";

function onChannel<T>(
  ipc: IpcRendererLike,
  channel: string,
  cb: (payload: T) => void,
): () => void {
  const listener = (_event: unknown, payload: unknown) => cb(payload as T);
  ipc.on(channel, listener);
  return () => ipc.removeListener(channel, listener);
}

/** Extensions verticales hôte (hors noyau createDesktopApi). */
export function createCrmHostPreloadExtensions(ipc: IpcRendererLike) {
  return {
    googleLogin: (): Promise<{ ok: boolean; error?: string }> =>
      ipc.invoke("oauth:google-login") as Promise<{
        ok: boolean;
        error?: string;
      }>,

    openAdminWindow: (): Promise<{ ok: boolean; error?: string }> =>
      ipc.invoke("admin:open") as Promise<{ ok: boolean; error?: string }>,

    onAiWorkspaceNavigate: (
      cb: (ev: { actionId: string; href: string }) => void,
    ): (() => void) =>
      onChannel<{ actionId: string; href: string }>(
        ipc,
        "ai-workspace:navigate",
        cb,
      ),
    onAiWorkspaceUiAction: (
      cb: (ev: {
        actionId: string;
        type: string;
        params: Record<string, unknown>;
        tabId?: string;
      }) => void,
    ): (() => void) =>
      onChannel(ipc, "ai-workspace:ui-action", cb),

    getLlmKeyStatus: () => ipc.invoke("config:llm-status"),
    setLlmKey: (
      provider: "openai" | "anthropic",
      key: string | null,
    ) => ipc.invoke("config:set-llm-key", { provider, key }),
    onLlmStatusChanged: (cb: (status: Record<string, unknown>) => void) =>
      onChannel<Record<string, unknown>>(ipc, "config:llm-status-changed", cb),

    getTunnelStatus: () => ipc.invoke("tunnel:status"),
    checkTunnelSlug: (slug: string) =>
      ipc.invoke("tunnel:check-slug", slug),
    reserveTunnel: (slug: string) => ipc.invoke("tunnel:reserve", slug),
    startTunnel: () => ipc.invoke("tunnel:start"),
    stopTunnel: () => ipc.invoke("tunnel:stop"),

    getSetupStatus: () => ipc.invoke("setup:status"),
    generateRecoveryKey: () =>
      ipc.invoke("setup:generate-recovery-key"),
    completeSetup: (payload: Record<string, unknown>) =>
      ipc.invoke("setup:complete", payload),

    getAccount: () => ipc.invoke("config:account"),
    changePassword: (payload: {
      currentPassword: string;
      newPassword: string;
    }) => ipc.invoke("config:change-password", payload),
    recoverPassword: (payload: {
      recoveryKey: string;
      newPassword: string;
    }) => ipc.invoke("auth:recover-password", payload),
    factoryReset: () => ipc.invoke("config:factory-reset"),
    reindexSearch: () => ipc.invoke("search:reindex"),
    setStayLoggedIn: (stay: boolean) =>
      ipc.invoke("auth:set-stay-logged-in", stay),

    getBackgroundSettings: () => ipc.invoke("background:get"),
    setBackgroundSettings: (patch: {
      closeToTray?: boolean;
      launchAtStartup?: boolean;
    }) => ipc.invoke("background:set", patch),

    getHermesStatus: () => ipc.invoke("hermes:status"),
    getHermesLogs: () => ipc.invoke("hermes:logs"),
    retryHermes: () => ipc.invoke("hermes:retry"),
    getHermesConfig: () => ipc.invoke("hermes:get-config"),
    setHermesConfig: (config: Record<string, unknown>) =>
      ipc.invoke("hermes:set-config", config),
    ensureHermesRuntime: () => ipc.invoke("hermes:ensure-runtime"),

    getN8nStatus: () => ipc.invoke("n8n:status"),
    getN8nLogs: () => ipc.invoke("n8n:logs"),
    getN8nConfig: () => ipc.invoke("n8n:get-config"),
    setN8nConfig: (config: Record<string, unknown>) =>
      ipc.invoke("n8n:set-config", config),
    ensureN8nRuntime: () => ipc.invoke("n8n:ensure-runtime"),
    prepareN8nSession: () => ipc.invoke("n8n:prepare-session"),

    getEmbedEnv: (service: "n8n" | "hermes") =>
      ipc.invoke("embed-env:get", service),
    setEmbedEnv: (
      service: "n8n" | "hermes",
      values: Record<string, string>,
    ) => ipc.invoke("embed-env:set", service, values),

    getPluginsStatus: () => ipc.invoke("plugins:status"),
    setPluginEnabled: (id: string, enabled: boolean) =>
      ipc.invoke("plugins:set-enabled", id, enabled),
    scaffoldPlugin: (opts: Record<string, unknown>) =>
      ipc.invoke("plugins:scaffold", opts),
    createPluginExecutionGrant: (opts: Record<string, unknown>) =>
      ipc.invoke("plugins:execution-grant", opts),
    runPluginTests: (id: string) => ipc.invoke("plugins:run-tests", id),
    migratePluginData: (id: string) =>
      ipc.invoke("plugins:data-migrate", id),
    restartPlugin: (id: string) => ipc.invoke("plugins:restart", id),
    archivePluginRuntime: (id: string) =>
      ipc.invoke("plugins:archive-runtime", id),
    deletePlugin: (id: string) => ipc.invoke("plugins:delete", id),
    getPluginVersions: (id: string) =>
      ipc.invoke("plugins:versions", id),
    restorePluginVersion: (id: string, ref: string) =>
      ipc.invoke("plugins:restore-version", id, ref),
    resolvePluginPanel: (id: string) =>
      ipc.invoke("plugins:resolve-panel", id),
    runPluginAcceptCheck: (id: string) =>
      ipc.invoke("plugins:accept-check", id),

    getFleetTelemetry: () => ipc.invoke("fleet:get-telemetry"),
    setFleetTelemetry: (patch: Record<string, unknown>) =>
      ipc.invoke("fleet:set-telemetry", patch),
    reportFleetAction: (action: Record<string, unknown>) =>
      ipc.invoke("fleet:action", action),
    opsTrack: (evt: Record<string, unknown>) =>
      ipc.invoke("ops:track", evt),
  };
}

export type CrmHostPreloadExtensions = ReturnType<
  typeof createCrmHostPreloadExtensions
>;

/** API desktop CRM complète (noyau + extensions hôte). */
export function buildCrmHostDesktopApi(
  ipc: IpcRendererLike,
  opts?: { customWindowChrome?: boolean },
) {
  return {
    ...createDesktopApi(ipc, opts),
    ...createCrmHostPreloadExtensions(ipc),
  };
}

export type CrmHostDesktopApi = ReturnType<typeof buildCrmHostDesktopApi>;

export type PreloadTelemetryOptions = {
  /** Classe CSS zone titlebar à ignorer (ex. `.creezio-titlebar-no-drag`). */
  titlebarNoDragClass: string;
  /** Attribut data aid (défaut kit `data-creezio-aid`). */
  aidAttr?: string;
};

/**
 * Forward erreurs renderer + capture clics flotte (preload).
 * Side-effect : listeners window/document.
 */
export function installPreloadTelemetry(
  ipc: IpcRendererLike,
  opts: PreloadTelemetryOptions,
): void {
  const aidAttr = opts.aidAttr ?? "data-creezio-aid";

  function forwardRendererError(payload: {
    kind: string;
    message: string;
    stack?: string;
    file?: string;
    line?: number;
  }): void {
    try {
      ipc.send("renderer-error", {
        ...payload,
        url: typeof window !== "undefined" ? window.location.href : "",
      });
    } catch {
      /* best-effort */
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("error", (e) => {
      forwardRendererError({
        kind: "window-error",
        message: String(e.message || e.error || "erreur inconnue"),
        stack: e.error instanceof Error ? e.error.stack : undefined,
        file: e.filename,
        line: e.lineno,
      });
    });

    window.addEventListener("unhandledrejection", (e) => {
      const reason = e.reason;
      forwardRendererError({
        kind: "unhandledrejection",
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    });
  }

  function fleetClickLabel(el: Element): string {
    const aid = el.getAttribute(aidAttr);
    if (aid) return aid.slice(0, 120);
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.slice(0, 120);
    const title = el.getAttribute("title");
    if (title) return title.slice(0, 120);
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 120);
    const tag = el.tagName.toLowerCase();
    const href = el.getAttribute("href");
    if (href) return `${tag} ${href}`.slice(0, 120);
    return tag;
  }

  let lastFleetClickKey = "";
  let lastFleetClickAt = 0;

  function reportFleetClick(ev: Event): void {
    try {
      const t = ev.target;
      if (!(t instanceof Element)) return;
      if (t.closest(opts.titlebarNoDragClass)) return;
      const el =
        t.closest(
          `[${aidAttr}],button,a,[role='button'],[role='tab'],input[type='submit'],input[type='button'],input[type='checkbox'],input[type='radio'],select,summary`,
        ) || null;
      if (!el) return;
      if (
        el instanceof HTMLInputElement &&
        el.type !== "submit" &&
        el.type !== "button" &&
        el.type !== "checkbox" &&
        el.type !== "radio"
      ) {
        return;
      }
      const label = fleetClickLabel(el);
      const path = `${location.pathname}${location.search}`.slice(0, 300);
      const key = `${label}|${path}`;
      const now = Date.now();
      if (key === lastFleetClickKey && now - lastFleetClickAt < 300) return;
      lastFleetClickKey = key;
      lastFleetClickAt = now;
      void ipc.invoke("fleet:action", {
        type: "ui.click",
        label,
        path,
        meta: {
          name: "ui.click",
          category: "ui",
          aid: el.getAttribute(aidAttr) || null,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role") || null,
          surface: "crm",
          source: "preload",
        },
      });
    } catch {
      /* best-effort */
    }
  }

  function installFleetPreloadCapture(): void {
    document.addEventListener("click", reportFleetClick, true);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", installFleetPreloadCapture);
    } else {
      installFleetPreloadCapture();
    }
  }
}

/** Wire complet marque : expose bridge + télémétrie. */
export function wireCrmHostPreload(opts: {
  ipc: IpcRendererLike;
  contextBridge: ContextBridgeLike;
  bridgeName: string;
  titlebarNoDragClass: string;
  aidAttr?: string;
  customWindowChrome?: boolean;
}): CrmHostDesktopApi {
  const api = buildCrmHostDesktopApi(opts.ipc, {
    customWindowChrome: opts.customWindowChrome,
  });
  exposeDesktopApi(opts.contextBridge, opts.bridgeName, api as never);
  installPreloadTelemetry(opts.ipc, {
    titlebarNoDragClass: opts.titlebarNoDragClass,
    aidAttr: opts.aidAttr,
  });
  return api;
}
