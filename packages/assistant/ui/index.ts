/**
 * Assistant UI (port kit — N3).
 * Consommer via `@creezio/assistant/ui`.
 */
export {
  AssistantProvider,
  ASSISTANT_PANEL_WIDTH_PX,
  ASSISTANT_FAB_SAFE_PX,
  useAssistantUi,
  useAssistantUiOptional,
} from "./assistant-provider";
export { AssistantRoot } from "./assistant-root";
export { AssistantWidget } from "./assistant-widget";
export { AssistantMessageContent } from "./assistant-message-content";
export { AssistantTracePanel } from "./assistant-trace-panel";
export {
  AssistantToolSteps,
  type AssistantToolStep,
} from "./assistant-tool-steps";
export { UiDriver, runUiAction, runUiNavigate } from "./ui-driver";
// Contrat activeSurface (module pur, sans DB) — le chrome client (shell-ui)
// doit l'importer d'ici, JAMAIS depuis la racine @creezio/assistant qui tire
// better-sqlite3 (casse le build webpack Next côté marque).
export {
  resolveActiveSurface,
  type ActiveSurface,
} from "../dist/runtime/active-surface.js";
export { useVoiceInput } from "./use-voice-input";
export { getFakeCursor } from "./fake-cursor";
export {
  configureAssistantTabWorkspace,
  useTabWorkspaceOptional as useAssistantTabWorkspaceOptional,
  type AssistantTabWorkspace,
} from "./tab-workspace-shim";
