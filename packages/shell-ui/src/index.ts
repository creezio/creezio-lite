/**
 * @creezio/shell-ui — nav + slots (H1.4 / I7) + libs plateforme (O9).
 * UI React : `@creezio/shell-ui/ui`.
 */

export type { CoreNavItem, NavItem, NavSlot, NavSlotId } from "./types.js";
export { CORE_NAV_ITEMS, coreNavItems } from "./core-nav.js";
export type {
  NavCatalogEntry,
  NavCatalogError,
  NavCatalogFeatures,
  NavCatalogGroup,
  NavCatalogSessionItem,
  NavCatalogSource,
  NavIconName,
  NavOverride,
  ResolveNavCatalogInput,
  ResolveNavCatalogResult,
} from "./nav-catalog.js";
export {
  NAV_ICON_ALLOWLIST,
  defaultOsCatalogEntries,
  isKnownNavIcon,
  listOsNavEntries,
  parseNavCatalogSessionItems,
  registerDefaultOsNavEntries,
  registerOsNavEntry,
  resetOsNavRegistryForTests,
  resolveNavCatalog,
} from "./nav-catalog.js";
export type { NavRegistry } from "./registry.js";
export { createNavRegistry, mergeNav } from "./registry.js";
export type {
  CreateNavShellAdapterOptions,
  NavRenderGroup,
  NavRenderItem,
  NavRenderModel,
  NavShellAdapter,
} from "./adapters/nav-shell.js";
export { createNavShellAdapter } from "./adapters/nav-shell.js";

/* ── O9 : brand + libs plateforme ── */
export type { ShellUiBrand, ShellUiLoginBrand } from "./brand.js";
export {
  configureShellUiBrand,
  getShellUiBrand,
  getShellDesktopApi,
  resetShellUiBrandForTests,
  subscribeShellUiBrand,
} from "./brand.js";

export {
  API_SCOPE_FULL,
  API_SCOPE_CRM_READ,
  API_SCOPE_CRM_WRITE,
  API_SCOPE_TASKS_RUN,
  normalizeApiScopes,
  parseApiKeyScopes,
  apiKeyAllowsMethod,
  apiKeyAllowsTasks,
  scopesFromPluginPermissions,
} from "./lib/api-scopes.js";

export {
  cn,
  formatDate,
  formatDateTime,
  formatMoney,
  parsePage,
  formatVariationPct,
  formatDeltaMoney,
  variationTone,
} from "./lib/utils.js";

export {
  resolvePublicOrigin,
  resolveCookieSecure,
  isLoopbackHost,
  type HeaderReader,
  type ResolvedOrigin,
} from "./lib/public-origin.js";

export {
  trailForRequestLogs,
  trailForAnalytics,
  trailForLoading,
  type TrailCrumb,
} from "./lib/page-trails.js";

export {
  trackServer,
  trackServerDebounced,
  type ServerOpsLevel,
  type ServerOpsEvent,
} from "./lib/ops-track.js";
export { reportServerIncident } from "./lib/server-incident.js";
export { haversineKm } from "./lib/geo-distance.js";
export { thumbUrl } from "./lib/img.js";
export { optimizeCoverUrl } from "./lib/optimize-cover-url.js";
export { buildCatalogSuspenseKey } from "./lib/catalog-suspense-key.js";
export {
  normalizeTabDocumentUrl,
  isSameTabDocument,
  isSameTabOrigin,
} from "./lib/tab-document-url.js";
export {
  CRM_HOME_PATH,
  SERVER_COCKPIT_PATH,
  defaultHomePathSync,
  resolveDesktopHomePath,
} from "./lib/desktop-home-path.js";
export {
  isKeepAliveProtectedKey,
  rankKeepAliveEvictionKeys,
  configureKeepAliveFullscreenMatchers,
} from "./lib/keepalive-eviction.js";

export {
  CREEZIO_DATA_CHANGED_EVENT,
  CREEZIO_DATA_CHANGED_HEADER,
  emitDataChanged,
  subscribeDataChanged,
  parseDataChangedHeader,
  inferResourceFromToolName,
  installCreezioDataChangedFetch,
  resetDataChangedFetchForTests,
  type CreezioDataChangedDetail,
} from "./lib/data-changed.js";
