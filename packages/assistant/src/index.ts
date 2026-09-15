/**
 * @creezio/assistant — chat plateforme (store I2 + runtime/UI N3 + chat O4/O4r).
 *
 * Extension marque : configureAssistantBrand({ appMap, prompts, mcp, tasks, tools, auth, meili, … }).
 * Métier = discovery MCP ; tasks = adapter ; pas de BrandTools.executeTool.
 */

export type {
  AssistantConversation,
  AssistantMessage,
  AssistantRole,
  AssistantStore,
  CreateConversationInput,
  AppendMessageInput,
} from "./types.js";
export { ASSISTANT_IPC_SURFACE } from "./types.js";
export { ASSISTANT_CORE_SQL, ensureAssistantRichColumnsSql } from "./schema.js";
export { createMemoryAssistantStore } from "./memory-store.js";
export type {
  CreateSqliteAssistantStoreOptions,
  SqliteAssistantStore,
} from "./sqlite-store.js";
export { createSqliteAssistantStore } from "./sqlite-store.js";
export type { OpenSqliteDatabase, SqliteDatabase } from "./sqlite-driver.js";
export { openNodeSqliteDatabase } from "./sqlite-driver.js";
export {
  getKitAssistantStore,
  requireKitAssistantStore,
} from "./env-store.js";

/* ── Brand extension (N3) ── */
export type {
  AssistantAppMapConfig,
  AssistantAppPage,
  AssistantAuthSession,
  AssistantBrandConfig,
  AssistantBrandIdentity,
  AssistantBrandTools,
  AssistantDbAccess,
  AssistantHermesConfig,
  AssistantMeiliConfig,
  AssistantMcpCallResult,
  AssistantMcpConfig,
  AssistantMcpToolDef,
  AssistantPromptsConfig,
  AssistantRagHit,
  AssistantTasksConfig,
  AssistantToolDefinition,
  HermesWorkUser,
} from "./brand/types.js";
export {
  assistantAppMapPages,
  assistantBrandTools,
  assistantDb,
  assistantHermes,
  assistantIdentity,
  assistantMcp,
  assistantMeili,
  assistantPrompts,
  assistantTasks,
  assistantToolDefinitions,
  buildBrandHermesWorkBrief,
  buildBrandPersonalAgentBrief,
  configureAssistantBrand,
  mergeAssistantBrandConfig,
  getAssistantBrandConfig,
  requireAssistantBrand,
  requireAssistantDb,
  assistantModuleSources,
} from "./brand/registry.js";
export type {
  BrandModuleAssistantSource,
  BrandModuleAssistantEntitySource,
  BrandModuleAssistantContextSource,
  BrandModuleAssistantToolSource,
} from "./brand/module-sources.js";
export {
  applyModuleAssistantSources,
  composeEntitySources,
  createEntitySourcesFromModuleSources,
  entityRuleFromModuleSource,
  isContextAssistantSource,
  isEntityAssistantSource,
  isToolAssistantSource,
  toolDefinitionFromModuleSource,
} from "./brand/module-sources.js";
export {
  APP_MAP,
  appMapPromptSection,
  getAppMap,
  pageInfoFor,
  type AppPage,
} from "./brand/app-map-shim.js";
export {
  ASSISTANT_SYSTEM_PROMPT,
  DEFAULT_MAX_TOOL_ROUNDS,
  OPENAI_CHAT_MAX_TOOLS,
  TOOL_DEFINITIONS,
  buildSystemPrompt,
  formatNowParis,
  getToolDefinitions,
  maxToolRounds,
  selectOpenAiToolDefinitions,
  shouldAuditDistribution,
} from "./brand/prompts-shim.js";
export type {
  AssistantSource,
  AssistantSourceType,
} from "./brand/sources-shim.js";
export {
  collectSourcesFromSqlRows,
  sourceLinkMatchers,
} from "./brand/sources-shim.js";

/* ── Runtime (N3, TF gold) ── */
export {
  ASSISTANT_FAB_MARGIN_PX,
  ASSISTANT_FAB_SAFE_PX,
  ASSISTANT_FAB_SIZE_PX,
  assistantFabScreenRect,
  formatActiveSurfaceRuntimeBlock,
  /** SoT — id partition site externe depuis `/site/<id>`. */
  siteIdFromSurfaceHref,
  /** @deprecated → siteIdFromSurfaceHref */
  fournisseurIdFromSurfaceHref,
  isExternalSurfaceHref,
  /** @deprecated → isExternalSurfaceHref */
  isSupplierSurfaceHref,
  looksLikeSurfaceCommand,
  parseActiveSurface,
  parseExternalTabSummaries,
  /** @deprecated → parseExternalTabSummaries */
  parseSupplierTabSummaries,
  rectsOverlap,
  resolveActiveSurface,
  type ActiveSurface,
  type ActiveSurfaceCrm,
  isExternalActiveSurface,
  /** @deprecated → ActiveSurfaceExternal */
  type ActiveSurfaceSupplier,
  type ActiveSurfaceExternal,
  type ActiveSurfaceTabLike,
  type ScreenRect,
  type ExternalTabSummary,
  /** @deprecated → ExternalTabSummary */
  type SupplierTabSummary,
} from "./runtime/active-surface.js";
export {
  looksLikeUiCommand,
  shouldForceRunSql,
  shouldPreferSearchKnowledge,
} from "./runtime/routing.js";
export {
  extractVilleHint,
  normalizeVilleKey,
} from "./runtime/geo-hint.js";
export {
  ASSISTANT_MODES,
  CHAT_MODE_ADDENDUM,
  UI_TOOL_NAMES,
  buildHermesWorkSystemBrief,
  buildPersonalAgentWorkBrief,
  isAssistantMode,
  isUiToolName,
  parseAssistantMode,
  type AssistantMode,
} from "./runtime/modes.js";
export {
  defaultModel,
  modelLabel,
  modelOptions,
  modelOptionsDetailed,
  resolveModel,
  supportsTemperature,
  type ModelOption,
  type ModelTier,
} from "./runtime/models.js";
export {
  RAG_INDEXES,
  enrichHitsGeo,
  isKeywordOnlyIndex,
  productQueryForMeili,
  ragIndexes,
  searchKnowledge,
  villeMatches,
  type RagHit,
  type SearchKnowledgeResult,
} from "./runtime/meili-rag.js";
export * from "./runtime/agent-loop.js";
export * from "./runtime/anthropic-chat.js";
export * from "./runtime/chat-db.js";
export * from "./runtime/explore-tools.js";
export * from "./runtime/hermes-client.js";
export * from "./runtime/hermes-kanban.js";
export * from "./runtime/hermes-models.js";
export * from "./runtime/run-sql.js";
export * from "./runtime/schema-catalog.js";
export * from "./runtime/sql-process-guard.js";
export * from "./runtime/surface-router.js";
export * from "./runtime/tool-trace.js";
export * from "./runtime/ui-actions.js";
export * from "./runtime/whisper.js";
export {
  handleAssistantChat,
  maxDuration,
} from "./runtime/assistant-chat.js";
export {
  createAssistantRoutes,
  type AssistantDesktopPresence,
  type AssistantPluginProduct,
  type AssistantPluginProductHub,
  type AssistantRoutesDeps,
  type AssistantRoutesFeatures,
  type AssistantSession,
} from "./http/assistant-routes.js";
export {
  PLATFORM_TASK_TOOL_ALIASES,
  PLATFORM_TASK_TOOL_DEFINITIONS,
  PLATFORM_TOOL_DEFINITIONS,
} from "./runtime/platform-tool-definitions.js";
export {
  callAssistantMcpTool,
  ensureMcpToolCache,
  mcpFacadeToAssistantConfig,
  openaiSafeToolName,
  refreshMcpToolCache,
  resolveMcpToolName,
  sessionAuthFromRequest,
} from "./runtime/mcp-tools.js";
export { executeTaskTool, taskToolDefinitions } from "./runtime/tasks-tools.js";
export {
  createEntitySourcesFromRules,
  createFormatSearchHit,
} from "./brand/entity-projections.js";
export type { EntitySourceKindRule } from "./brand/entity-projections.js";
