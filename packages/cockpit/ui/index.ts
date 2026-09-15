/**
 * @creezio/cockpit/ui — ServerCockpitShell + CockpitClient.
 */

export { CockpitClient } from "./cockpit-client";
export type { CockpitClientProps } from "./cockpit-client";

export { ServerCockpitShell } from "./server-cockpit-shell";
export type {
  ServerCockpitShellProps,
  ServerCockpitExtraTab,
} from "./server-cockpit-shell";

export { useCockpitDashboard } from "./hooks/use-cockpit-dashboard";
export type { UseCockpitDashboardOpts } from "./hooks/use-cockpit-dashboard";

export { StatusDot } from "./parts/status-dot";
export type { CockpitVisualVariant } from "./parts/status-dot";
export { ServiceCard } from "./parts/service-card";

export {
  configureCockpit,
  getCockpitConfig,
  resetCockpitConfigForTests,
  resolveCockpitConfig,
  buildJoinLink,
} from "@creezio/cockpit";
export type { CockpitConfig } from "@creezio/cockpit";

export type {
  CockpitTabId,
  CockpitHealth,
  CockpitServiceHealth,
  CockpitUser,
  CockpitAiActivity,
  CockpitAclPlugin,
  CockpitDesktopSessions,
  CockpitRequestLogEntry,
  CockpitTunnelLive,
} from "@creezio/cockpit";
export { DEFAULT_COCKPIT_TABS } from "@creezio/cockpit";
