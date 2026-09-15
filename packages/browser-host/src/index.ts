/**
 * @creezio/browser-host — navigateur Chromium sidecar serveur (sans Electron).
 *
 * - Scripts driver partagés (SoT, consommés aussi par electron-shell) ;
 * - driver external_* / ui_* portable derrière `CdpTransport` ;
 * - spawn/supervision Chromium + client CDP websocket ;
 * - sessions IA (page CRM persona + onglets externes + screencast in-process).
 */

export { DRIVER_HELPERS, FAKE_CURSOR_INJECT } from "./driver-scripts.js";
export type {
  CdpTransport,
  DriverParams,
  DriverResult,
  DriverVerb,
} from "./shared-driver.js";
export {
  driverClick,
  driverListTargets,
  driverPageContext,
  driverRead,
  driverScreenshot,
  driverScroll,
  driverType,
  driverVerbOf,
  runDriverVerb,
  trustedClick,
  trustedEnter,
  trustedTypeText,
} from "./shared-driver.js";
export { CdpConnection } from "./cdp-connection.js";
export { chromeMajorFromProduct, chromeUaForProduct } from "./chrome-ua.js";
export {
  findChromiumBinary,
  launchChromium,
  type ChromiumHandle,
  type ChromiumLaunchOptions,
} from "./chromium-process.js";
export {
  BrowserHost,
  CdpPage,
  type BrowserHostOptions,
  type ScreencastFrameHandler,
} from "./browser-host.js";
export {
  BrowserScreencaster,
  type BrowserScreencasterOptions,
} from "./browser-screencaster.js";
export {
  clearScreencastFrame,
  publishScreencastFrame,
  screencastViewerCount,
  subscribeScreencast,
  type ScreencastFrame,
} from "./screencast-hub.js";
export {
  AiSessionHost,
  type AiSessionHostOptions,
  type AiSessionInfo,
  type SupplierActionRequestLike,
} from "./ai-session-host.js";
