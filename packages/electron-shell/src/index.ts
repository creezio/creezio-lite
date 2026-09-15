/**
 * @creezio/electron-shell — desktop Electron plateforme (réduit P1.b,
 * shims retirés en H12).
 *
 * Ce package ne contient QUE le desktop pur : boot, fenêtres, tray,
 * updater, splash, chrome, sessions desktop, browser-tabs, télémétrie
 * WebContents. Le host runtime Node pur vit dans `@creezio/host-runtime`,
 * le sous-domaine Meili dans `@creezio/search`, les helpers ressources kit
 * dans `@creezio/platform-core` — importer depuis ces packages SoT.
 *
 * H12 : les ré-exports `@deprecated` P1.b (compat host historique) et le
 * shim subpath `./meili` ont été SUPPRIMÉS — migration des marques via
 * `scripts/codemods/H12/` (`creezio upgrade`). Ne jamais ré-exporter un
 * symbole host depuis ce barrel.
 */

/* ═══════════════ Desktop natif (SoT ici) ═══════════════ */

export {
  windowChromeBarHtml,
  windowChromeCss,
  windowChromeJs,
} from "./window-chrome.js";

export type {
  SplashHtmlOptions,
  SplashStepId,
  SplashStepStatus,
  SplashStepView,
  SplashViewModel,
} from "./splash-ui.js";
export {
  SPLASH_STEP_WEIGHTS,
  activateSplashStep,
  completeSplashStep,
  computeOverallPercent,
  createLocalSplashSteps,
  createRemoteSplashSteps,
  createSplashModel,
  estimateEmbedPercent,
  formatElapsedMs,
  sanitizeSplashDetail,
  splashDataUrl,
  splashHtmlDocument,
  stepProgressRatio,
  updateSplashStep,
} from "./splash-ui.js";

export type {
  SetupAutoUpdaterOptions,
  UpdateStatus,
  UpdaterSend,
} from "./updater.js";
export {
  checkForUpdatesNow,
  downloadAndInstallUpdate,
  getUpdaterStatus,
  reduceUpdateEvent,
  registerUpdateIpc,
  sendUpdateToWebContents,
  setUpdaterRenderer,
  setupAutoUpdater,
} from "./updater.js";

export type { TrayAiWorkspaceEntry, TrayControllerOptions } from "./tray.js";
export {
  TrayController,
  applyLaunchAtStartup,
  installCloseToTray,
} from "./tray.js";

export {
  adminWindowVisible,
  closeAdminWindow,
  openAdminWindow,
} from "./admin-window.js";

export type {
  DesktopBootContext,
  PrepareDesktopBootOptions,
} from "./boot.js";
export { prepareDesktopBoot, writeAppKindFile } from "./boot.js";

export {
  createHostRuntime,
  localConfigPathForBoot,
  pathsContextFromBoot,
  prepareHostDesktop,
  vendorDir,
} from "./main-facade.js";
export type { CreateHostRuntimeOptions } from "./main-facade.js";

export { installBrandDesktopRuntime } from "./desktop/brand-desktop-runtime.js";
export type {
  BrandDesktopDeps,
  BrandDesktopHosts,
  BrandDesktopPaths,
  BrandDesktopVertical,
} from "./desktop/brand-desktop-runtime.js";

export type {
  DesktopSessionApi,
  DesktopSessionInfo,
  DesktopSessionStatus,
} from "./desktop/desktop-session.js";
export {
  createDesktopSessionStore,
  registerDesktopSessionIpc,
  spawnBrandMetierApi,
} from "./desktop/desktop-session.js";

export type {
  AssistantChromeBrand,
  AssistantChromeMode,
  ContentRect as AssistantChromeContentRect,
} from "./desktop/assistant-chrome.js";
export {
  ASSISTANT_FAB_MARGIN_PX,
  ASSISTANT_FAB_SIZE_PX,
  AssistantChromeOverlay,
  assistantFabScreenRect,
  rectsOverlap,
} from "./desktop/assistant-chrome.js";

export type {
  GoogleOAuthLoopbackOptions,
  GoogleOAuthTokenStore,
  GoogleTokens,
} from "./desktop/oauth-loopback.js";
export {
  googleLoginLoopback,
  storedGoogleTokens,
} from "./desktop/oauth-loopback.js";

export type {
  PickerRememberedServer,
  ProfilePickerBrand,
} from "./desktop/profile-picker-html.js";
export { profilePickerHtml } from "./desktop/profile-picker-html.js";

export type { ErrorPageBrand } from "./desktop/error-page-html.js";
export {
  errorPageDataUrl,
  errorPageHtmlDocument,
} from "./desktop/error-page-html.js";

export { instrumentWebContents } from "./host/web-telemetry.js";

/* ── N7 : browser tabs → import `@creezio/electron-shell/browser-tabs`
 * (pas le barrel principal : évite de tirer `electron` dans les tests Node). */
