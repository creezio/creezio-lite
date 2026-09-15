export type {
  ConversationalPluginFactory,
  ConversationalPluginFactoryAdapters,
  FactoryMaterializeResult,
  FactoryPhase,
  FactoryScaffoldResult,
  FactorySessionSnapshot,
  FactoryWriteFilesResult,
} from "./types.js";

export { createConversationalPluginFactory } from "./session.js";
export {
  derivePluginIdentity,
  slugifyPluginId,
} from "./slug.js";
export {
  defaultClarificationQuestions,
  draftPrdFromIntention,
  needsClarification,
} from "./draft-prd.js";
export type { DraftPrdFromIntentionInput } from "./draft-prd.js";
export { buildPluginScaffoldFiles } from "./scaffold-files.js";
export { createFsPluginScaffoldAdapters } from "./fs-adapters.js";
export type { LlmPrdDrafterOptions, PrdDrafter } from "./prd-drafter.js";
export {
  createOptionalLlmPrdDrafter,
  deterministicPrdDrafter,
} from "./prd-drafter.js";
