export {
  configureUsageAnalytics,
  getUsageAnalyticsAdapters,
  resetUsageAnalyticsAdaptersForTests,
  type UsageAnalyticsAdapters,
  type UsageAnalyticsSqliteDatabase,
  type UsageAnalyticsSqliteStatement,
} from "./adapters.js";

export {
  configureUsageAnalyticsUiBrand,
  getUsageAnalyticsUiBrand,
  resetUsageAnalyticsUiBrandForTests,
  type FleetActionPayload,
  type UsageAnalyticsUiBrand,
} from "./ui-brand.js";

export type { UsagePeriod, UsageUserKind } from "./usage-analytics-shared.js";
export { formatDuration } from "./usage-analytics-shared.js";

export type {
  UsageEventInput,
  UsageEventRow,
  UsageFilters,
  UsageOverview,
  TimelineBucket,
  PageStat,
  ClickStat,
  UserStat,
} from "./usage-analytics.js";
export {
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
} from "./usage-analytics.js";

export type {
  HeatmapCell,
  DailyProductivity,
  BreakSpan,
  FocusBlock,
  ProductivitySummary,
  ProductivityReport,
} from "./usage-analytics-productivity.js";
export {
  BREAK_MIN_MS,
  BREAK_MAX_MS,
  getProductivityReport,
} from "./usage-analytics-productivity.js";


export type {
  UsageAnalyticsSession,
  UsageAnalyticsRouteDeps,
} from "./http-routes.js";
export {
  createUsageAnalyticsIngestRoutes,
  createUsageAnalyticsAdminRoutes,
} from "./http-routes.js";
