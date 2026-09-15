export { IpcChannels } from "./ipc-channels.js";
export type { IpcChannelGroup } from "./ipc-channels.js";

export type {
  DesktopAppKind,
  DesktopBridge,
  DesktopConnectionProfile,
  DesktopContentRect,
  DesktopInfo,
  DesktopExternalTabOpened,
  DesktopSupplierTabOpened,
  DesktopTabInfo,
  DesktopTabLoadState,
  DesktopUpdateState,
  DesktopUpdateStatus,
} from "./types.js";

export { getDesktopBridge } from "./types.js";

export type { ContextBridgeLike, IpcRendererLike } from "./create-desktop-api.js";
export { createDesktopApi, exposeDesktopApi } from "./create-desktop-api.js";

export type {
  CrmHostDesktopApi,
  CrmHostPreloadExtensions,
  PreloadTelemetryOptions,
} from "./create-crm-host-preload.js";
export {
  buildCrmHostDesktopApi,
  createCrmHostPreloadExtensions,
  installPreloadTelemetry,
  wireCrmHostPreload,
} from "./create-crm-host-preload.js";
