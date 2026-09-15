export type {
  AiWorkspaceHostBindings,
} from "./bindings.js";
export {
  __resetAiWorkspaceHostBindingsForTests,
  aiPartitionName,
  aiShareWebSessions,
  aiSupplierPartitionPrefix,
  configureAiWorkspaceHost,
  getAiWorkspaceHostBindings,
  tryGetAiWorkspaceHostBindings,
} from "./bindings.js";

export type {
  AiSupplierTab,
  AiSupplierTabsFactory,
  AiSupplierTabsLike,
  AiTabInfo,
  SupplierActionRequest,
} from "./types.js";

export type {
  AiProfileWindowOptions,
} from "./profile-window.js";
export { AiProfileWindow } from "./profile-window.js";

export type {
  AiWorkspaceInfo,
  AiWorkspaceManagerOptions,
  AiWorkspacePresentation,
  AiWorkspaceUiActionRequest,
} from "./manager.js";
export {
  AiWorkspaceManager,
} from "./manager.js";

export type {
  AiScreencasterOptions,
  PostFrameResult,
} from "./screencast.js";
export { AiScreencaster } from "./screencast.js";

export {
  executeAiWorkspaceAction,
  isAiWorkspaceActionType,
} from "./actions.js";
