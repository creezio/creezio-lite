/**
 * @creezio/cockpit — config + types (non-React).
 * UI React : `@creezio/cockpit/ui`.
 */

export const COCKPIT_PACKAGE = "@creezio/cockpit" as const;

export type {
  CockpitTabId,
  CockpitServiceHealth,
  CockpitHealth,
  CockpitUser,
  CockpitAiActivity,
  CockpitAclPlugin,
  CockpitDesktopSessions,
  CockpitRequestLogEntry,
  CockpitTunnelLive,
} from "./types.js";
export { DEFAULT_COCKPIT_TABS } from "./types.js";

export type { CockpitConfig } from "./config.js";
export {
  configureCockpit,
  getCockpitConfig,
  resetCockpitConfigForTests,
  resolveCockpitConfig,
  buildJoinLink,
} from "./config.js";
