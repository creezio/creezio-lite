/**
 * Canaux IPC communs aux shells desktop Creezio.
 *
 * Extraits des preload-app.ts (kit, Certivan, Fidu) — contrat
 * de nommage partagé. Le runtime Electron (handlers) sera porté en Phase B.
 */

export const IpcChannels = {
  desktop: {
    info: "desktop:info",
  },
  connection: {
    get: "connection:get",
    test: "connection:test",
    choose: "connection:choose",
    apply: "connection:apply",
    rechoose: "connection:rechoose",
  },
  profiles: {
    forgetServer: "profiles:forget-server",
  },
  window: {
    minimize: "window:minimize",
    maximizeToggle: "window:maximize-toggle",
    close: "window:close",
    isMaximized: "window:isMaximized",
    maximizedChanged: "window:maximized-changed",
  },
  tabs: {
    open: "tabs:open",
    close: "tabs:close",
    activate: "tabs:activate",
    activateSite: "tabs:activate-site",
    setContentRect: "tabs:set-content-rect",
    showCrm: "tabs:show-crm",
    list: "tabs:list",
    changed: "tabs:changed",
    loadState: "tabs:load-state",
    /** SoT wire — ouverture site externe. */
    externalOpened: "tabs:external-opened",
    /**
     * @deprecated wire historique TF — les mains émettent encore ce canal ;
     * le preload écoute les deux (external + supplier).
     */
    supplierOpened: "tabs:supplier-opened",
  },
  setup: {
    retry: "setup:retry",
    status: "setup:status",
    complete: "setup:complete",
  },
  auth: {
    googleLogin: "auth:google-login",
    account: "auth:account",
    changePassword: "auth:change-password",
    recoverPassword: "auth:recover-password",
    logout: "auth:logout",
    setStayLoggedIn: "auth:set-stay-logged-in",
    generateRecoveryKey: "auth:generate-recovery-key",
  },
  update: {
    /** Alias historique kit (`update:get-status`) — préférer `status`. */
    status: "update:status",
    getStatus: "update:get-status",
    check: "update:check",
    downloadInstall: "update:download-install",
    changed: "update:changed",
  },
  admin: {
    open: "admin:open",
  },
  splash: {
    model: "splash:model",
  },
  assistant: {
    setChrome: "assistant:set-chrome",
    openRequest: "assistant:open-request",
  },
  llm: {
    keyStatus: "llm:key-status",
    setKey: "llm:set-key",
    statusChanged: "llm:status-changed",
  },
  factory: {
    reset: "factory:reset",
  },
  search: {
    reindex: "search:reindex",
  },
  background: {
    get: "background:get",
    set: "background:set",
  },
  /** N2 — espaces collaborateurs IA (handlers dans brand-desktop-runtime). */
  aiWorkspace: {
    identity: "ai-workspace:identity",
    list: "ai-workspace:list",
    ensure: "ai-workspace:ensure",
    show: "ai-workspace:show",
    showOwner: "ai-workspace:show-owner",
    actionResult: "ai-workspace:action-result",
  },
  renderer: {
    error: "renderer-error",
  },
} as const;

export type IpcChannelGroup = typeof IpcChannels;
