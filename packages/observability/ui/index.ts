/**
 * Observability Admin UI (usage analytics N6 + request-logs / api-endpoints O5).
 * Consommer via `@creezio/observability/ui`.
 */
export { AnalyticsClient } from "./analytics-client";
export {
  AnalyticsProductivityPanel,
  type ProductivityPayload,
} from "./analytics-productivity-panel";
export {
  UsageAnalyticsProvider,
  type UsageAnalyticsProviderSession,
} from "./usage-analytics-provider";
export { SessionUsageAnalyticsProvider } from "./session-usage-analytics-provider";

export {
  flushUsageAnalytics,
  setUsageAnalyticsSession,
  trackUsagePageView,
  trackUsageEvent,
  ensureUsageAnalyticsDom,
} from "./usage-analytics-client";

/** Tokens UI marque (aidAttr / fleet) — safe client via dist. */
export {
  configureUsageAnalyticsUiBrand,
  getUsageAnalyticsUiBrand,
  type UsageAnalyticsUiBrand,
  type FleetActionPayload,
} from "../dist/usage/ui-brand.js";

/* ── O5 : request-logs / api-endpoints ── */
export { RequestLogsClient } from "./request-logs-client";
export { ApiEndpointsClient } from "./api-endpoints-client";
export type {
  RequestLogEntry,
  RequestLogSource,
  RequestLogDetail,
} from "../dist/request-logs/request-logs.js";
