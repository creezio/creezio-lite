/**
 * Contrats observabilité native (vision V2).
 */

export const OBSERVABILITY_EVENT_KINDS = [
  "activity",
  "plugin_usage",
  "control_plane",
] as const;

export type ObservabilityEventKind = (typeof OBSERVABILITY_EVENT_KINDS)[number];

export type ActivityAction =
  | "login"
  | "logout"
  | "navigate"
  | "factory.intention"
  | "factory.materialize"
  | "factory.iterate"
  | "api.call"
  | "mcp.tool"
  | "custom";

export type ControlPlaneAction =
  | "install"
  | "uninstall"
  | "enable"
  | "disable"
  | "grant"
  | "write_files"
  | "restart"
  | "list";

export type ObservabilityEvent = {
  id: string;
  kind: ObservabilityEventKind;
  /** Action métier (activity / control_plane) ou outil (plugin_usage). */
  action: string;
  orgId: string | null;
  userId: string | null;
  brandId: string | null;
  pluginId: string | null;
  /** Payload JSON sérialisable. */
  meta: Record<string, unknown>;
  createdAt: string;
};

export type RecordObservabilityEventInput = {
  kind: ObservabilityEventKind;
  action: string;
  orgId?: string | null;
  userId?: string | null;
  brandId?: string | null;
  pluginId?: string | null;
  meta?: Record<string, unknown>;
  /** Override id / createdAt (tests). */
  id?: string;
  createdAt?: string;
};

export type ObservabilityQuery = {
  kind?: ObservabilityEventKind;
  orgId?: string;
  pluginId?: string;
  action?: string;
  since?: string;
  until?: string;
  limit?: number;
};

export type PluginUsageAggregate = {
  pluginId: string;
  orgId: string | null;
  count: number;
  lastAt: string;
};

export type OrgActivityAggregate = {
  orgId: string;
  count: number;
  lastAt: string;
};

export type ObservabilityStore = {
  record(input: RecordObservabilityEventInput): ObservabilityEvent;
  list(query?: ObservabilityQuery): ObservabilityEvent[];
  aggregatePluginUsage(opts?: {
    orgId?: string;
    since?: string;
    limit?: number;
  }): PluginUsageAggregate[];
  aggregateOrgActivity(opts?: {
    since?: string;
    limit?: number;
  }): OrgActivityAggregate[];
  count(query?: ObservabilityQuery): number;
};
