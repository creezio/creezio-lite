// Port exporté du lot D03 (docs/contracts/agent-provider-transport.md §8.2).
// Aucun effet à l'import ; le transport interne n'est pas réexporté afin qu'aucun
// appelant ne puisse choisir une URL arbitraire.
export type {
  AgentProviderId, ProviderCredential, ProviderClientOptions, ProviderRequestOptions, ProviderFailureCode,
  ProviderFailureReason, ProviderFailureInit, DeliveryKnowledge, ProviderCapability,
  CursorProvider, CursorAgent, CursorAgentStatus, CursorRun, CursorRunStatus, CursorCreateAgentInput, CursorCreateAgentResult,
  CursorCancelResult, CursorModel, CursorModelList, CursorModelParam, CursorRepo, CursorEnv, CursorGitBranch,
  XaiProvider, XaiModel, XaiModelList, XaiCreateResponseInput, XaiInputItem, XaiInputContent, XaiFunctionTool, XaiToolChoice,
  XaiResponse, XaiResponseStatus, XaiOutputItem, XaiUsage,
} from './types.ts';
export { ProviderFailure, providerFailureMessages } from './types.ts';
export { createCursorProvider, cursorAgentIdPattern, cursorRunIdPattern, cursorAgentStatuses, cursorRunStatuses, cursorLimits } from './cursor.ts';
export { createXaiProvider, xaiResponseStatuses, xaiLimits } from './xai.ts';
export { agentProviderCapabilities } from './catalog.ts';
