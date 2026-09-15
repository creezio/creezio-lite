/**
 * @creezio/observability — activité / usages / CP (V2 SQLite) + boîte noire
 * desktop ops/fleet (R4).
 */

export type {
  ActivityAction,
  ControlPlaneAction,
  ObservabilityEvent,
  ObservabilityEventKind,
  ObservabilityQuery,
  ObservabilityStore,
  OrgActivityAggregate,
  PluginUsageAggregate,
  RecordObservabilityEventInput,
} from "./types.js";
export { OBSERVABILITY_EVENT_KINDS } from "./types.js";

export { OBSERVABILITY_CORE_SQL } from "./schema.js";

export { createMemoryObservabilityStore } from "./memory-store.js";

export type {
  CreateSqliteObservabilityStoreOptions,
  SqliteObservabilityStore,
} from "./sqlite-store.js";
export { createSqliteObservabilityStore } from "./sqlite-store.js";

export type { OpenSqliteDatabase, SqliteDatabase } from "./sqlite-driver.js";
export { openNodeSqliteDatabase } from "./sqlite-driver.js";

export type { EmitActor } from "./helpers.js";
export {
  recordActivity,
  recordControlPlaneEvent,
  recordPluginUsage,
} from "./helpers.js";

export { createObservabilityApiMount } from "./api-mount.js";

/* ── R4 : ops journal / rules / emit / fleet ── */

export type {
  OpsBootSummary,
  OpsEvent,
  OpsEventInput,
  OpsLevel,
} from "./ops/types.js";
export {
  MAX_CTX_BYTES,
  OPS_EVENT_PREFIX,
  OPS_EVENT_PREFIXES,
  OPS_LEVELS,
  TF2EVENT_PREFIX,
  parseOpsLine,
  redactOpsCtx,
  sanitizeOpsEventInput,
  serializeOpsEvent,
} from "./ops/types.js";

export type { OpsJournalHooks } from "./ops/journal.js";
export {
  __resetOpsJournalForTests,
  consumeOpsLine,
  currentBootSummary,
  drainPendingOpsEvents,
  getOpsBootId,
  getOpsDir,
  initOpsJournal,
  persistBootSummary,
  readPreviousBootSummaries,
  setOpsJournalHooks,
  track,
  trackCrashMirror,
  trackDecision,
  trackExternal,
} from "./ops/journal.js";

export type { BootRuleFinding } from "./ops/rules.js";
export { evaluateBootRules, evaluateRulesPure } from "./ops/rules.js";

export { emitOpsEvent } from "./ops/emit.js";

export type {
  CreateFleetAgentOptions,
  FleetAgent,
  FleetAgentRuntimeHooks,
  FleetHealthSnapshot,
  FleetTelemetrySnapshot,
} from "./ops/fleet-agent.js";
export { createFleetAgent } from "./ops/fleet-agent.js";

/* ── M7 : fleet activity ring + samples (hooks chemins) ── */

export type {
  FleetAction,
  FleetSessionContext,
  FleetSurface,
} from "./ops/fleet-activity.js";
export {
  _resetFleetActivityForTests,
  drainFleetActions,
  getFleetSessionContext,
  recordFleetAction,
  sampleFleetActions,
  setFleetSessionContext,
} from "./ops/fleet-activity.js";

export type { FleetSamples, FleetSamplesPaths } from "./ops/fleet-samples.js";
export { createFleetSamples } from "./ops/fleet-samples.js";

/* ── N6 : usage analytics ── */

export {
  configureUsageAnalytics,
  getUsageAnalyticsAdapters,
  resetUsageAnalyticsAdaptersForTests,
  configureUsageAnalyticsUiBrand,
  getUsageAnalyticsUiBrand,
  resetUsageAnalyticsUiBrandForTests,
  formatDuration,
  usageAnalyticsReady,
  ensureUsageAnalyticsSchema,
  insertUsageEvents,
  recordUsageEvent,
  resolvePeriodFilters,
  getUsageOverview,
  getUsageTimeline,
  getTopPages,
  getTopClicks,
  getUserStats,
  listUsageEvents,
  purgeUsageEvents,
  BREAK_MIN_MS,
  BREAK_MAX_MS,
  getProductivityReport,
  createUsageAnalyticsIngestRoutes,
  createUsageAnalyticsAdminRoutes,
} from "./usage/index.js";

export type {
  UsageAnalyticsAdapters,
  UsageAnalyticsSqliteDatabase,
  UsageAnalyticsSqliteStatement,
  FleetActionPayload,
  UsageAnalyticsUiBrand,
  UsagePeriod,
  UsageUserKind,
  UsageEventInput,
  UsageEventRow,
  UsageFilters,
  UsageOverview,
  TimelineBucket,
  PageStat,
  ClickStat,
  UserStat,
  HeatmapCell,
  DailyProductivity,
  BreakSpan,
  FocusBlock,
  ProductivitySummary,
  ProductivityReport,
  UsageAnalyticsSession,
  UsageAnalyticsRouteDeps,
} from "./usage/index.js";

/* ── O5 : request-logs admin ── */

export {
  configureRequestLogs,
  getRequestLogsConfig,
  resetRequestLogsConfigForTests,
  resolveFleetStateDir,
  getRequestLogCapacity,
  _resetRequestLogsForTests,
  isSecretKey,
  redactSecrets,
  pushRequestLog,
  listRequestLogs,
  clearRequestLogs,
  parseJsonRpcMessages,
  summarizeMcpRequest,
  summarizeMcpResponse,
  extractApiErrorMessage,
  shouldSkipRequestLog,
  requestLogApiMiddleware,
  requestLogMcpMiddleware,
  createRequestLogsRoutes,
} from "./request-logs/index.js";

export type {
  RequestLogsConfig,
  RequestLogSource,
  RequestLogDetail,
  RequestLogEntry,
  ListRequestLogsOpts,
} from "./request-logs/index.js";

/* ── O5 : registre Admin /admin/endpoints ── */

export type {
  ApiEndpointRecord,
  ApiEndpointRouteInput,
  ApiEndpointsRegistry,
  CreateApiEndpointsRoutesOptions,
} from "./api-endpoints/index.js";
export {
  buildApiEndpointsRegistry,
  buildOpenApiDocumentFromRegistry,
  collectHonoRoutes,
  createApiEndpointsRoutes,
} from "./api-endpoints/index.js";
