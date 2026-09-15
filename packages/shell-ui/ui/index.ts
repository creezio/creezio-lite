/**
 * @creezio/shell-ui/ui — primitives + shell CRM UI (O9, gold TF).
 * Consommer via `@creezio/shell-ui/ui`.
 */

/* ── Brand / hosts (aussi via package root) ── */
export {
  configureShellUiBrand,
  getShellUiBrand,
  getShellDesktopApi,
  resetShellUiBrandForTests,
  type ShellUiBrand,
} from "../dist/brand.js";
export {
  configureTabWorkspaceHost,
  useTabWorkspace,
  useTabWorkspaceOptional,
  useOpenTab,
  openExternalSiteFromWorkspace,
  normalizeOpenExternalSiteOpts,
  type TabWorkspaceHost,
  type OpenExternalSiteOpts,
} from "./workspace/tab-workspace-host";
export {
  configureGlobalSearchHost,
  useGlobalSearch,
  type GlobalSearchHost,
} from "./global-search-host";

/* ── Primitives ── */
export * from "./primitives/button";
export * from "./primitives/badge";
export * from "./primitives/input";
export * from "./primitives/card";
export * from "./primitives/tabs";
export * from "./primitives/label";
export * from "./primitives/separator";
export * from "./primitives/skeleton";
export * from "./primitives/dialog";
export * from "./primitives/sheet";
export * from "./primitives/select";
export * from "./primitives/dropdown-menu";
export * from "./primitives/scroll-area";
export * from "./primitives/avatar";
export * from "./primitives/breadcrumb";
export * from "./primitives/command";
export * from "./primitives/sonner";
export * from "./primitives/chart";

/* ── Lib client ── */
export * from "./lib/aid";
export { useShellUiBrand } from "./lib/use-shell-ui-brand";
export type { ShellUiLoginBrand } from "../dist/brand.js";
export * from "./lib/desktop-host";
export * from "./lib/n8n-ui";
export * from "./lib/hermes-ui";
export * from "./lib/fleet-tracker-client";
export * from "./lib/ai-workspace-client";
export * from "./lib/ai-screencast-hub";
export {
  useCreezioResource,
  useCreezioResources,
  type UseCreezioResourceOptions,
} from "./lib/use-creezio-resource";

/* ── Layout / chrome ── */
export * from "./layout/page-chrome";
export * from "./layout/page-toolbar-context";
export * from "./layout/section-view-shell";
export * from "./layout/entity-header";
export * from "./layout/sandbox-banner";
export * from "./layout/app-shell";
export * from "./layout/desktop-update-banner";
export * from "./layout/sidebar";
export * from "./layout/sidebar-host";
export * from "./layout/native-os-nav";
export { resolveNavIcon } from "./layout/nav-icons";
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
  type NavCatalogEntry,
  type NavCatalogError,
  type NavCatalogFeatures,
  type NavCatalogGroup,
  type NavCatalogSessionItem,
  type NavCatalogSource,
  type NavIconName,
  type NavOverride,
  type ResolveNavCatalogInput,
  type ResolveNavCatalogResult,
} from "../dist/nav-catalog.js";
export {
  NAV_CATALOG_ENDPOINT,
  NavCatalogLoader,
  applyNavCatalogItemsToSidebar,
  mapNavCatalogSessionToSidebar,
} from "./layout/nav-catalog-loader";

/* ── Workspace ── */
export * from "./workspace/types";
export * from "./workspace/workspace-config";
export {
  TabWorkspaceProvider,
  getWorkspaceTabNavigate,
  useTabWorkspace as useTabWorkspaceImpl,
  useTabWorkspaceOptional as useTabWorkspaceOptionalImpl,
  useOpenTab as useOpenTabImpl,
  type NavigateOptions,
  type OpenExternalSiteOpts as TabWorkspaceOpenExternalSiteOpts,
} from "./workspace/tab-workspace-context";
export * from "./workspace/workspace-shell";
export * from "./workspace/workspace-root";
export * from "./workspace/workspace-tab-bar";
export * from "./workspace/keep-alive";
export * from "./workspace/ai-workspace-banner";
export * from "./workspace/impersonation-banner";
export { configureAiActivityPanel, AiActivityPanelHost } from "./workspace/ai-activity-panel-host";
export * from "./workspace/window-chrome-controls";
export * from "./workspace/ai-workspace-agent-host";
export * from "./workspace/use-location-search";

/* ── Pages OS composées (wrappers marque = re-export) ── */
export { DesktopSettingsPage } from "./os-pages/desktop-settings-page";

/* ── Settings desktop ── */
export * from "./settings/desktop-hermes-settings";
export * from "./settings/desktop-n8n-settings";
export * from "./settings/desktop-fleet-telemetry-settings";
export * from "./settings/desktop-tunnel";
export * from "./settings/desktop-embed-env-panel";
export * from "./settings/desktop-connection-settings";
export * from "./settings/desktop-llm-keys";
export * from "./settings/desktop-update-settings";
export * from "./settings/desktop-background-settings";
export * from "./settings/ops-diagnostic-settings";
export * from "./settings/api-keys-settings";
export * from "./settings/agent-profile-settings";
export * from "./settings/account-settings";
export * from "./settings/search-reindex-settings";
export * from "./settings/factory-reset-settings";
export * from "./settings/locked-config-field";
export * from "./settings/host-only-settings";

/* ── Desktop / PWA / misc ── */
export * from "./desktop/site-link";
export * from "./desktop/external-site-slot";
export * from "./desktop/external-site-surface";
export * from "./desktop/desktop-bridge";
export * from "./desktop/auth-window-chrome";
export * from "./desktop/window-chrome-controls";
export * from "./pwa/client-error-reporter";
export * from "./pwa/register-sw";
export * from "./page-loading/list-page-loading";
export * from "./page-loading/entity-page-loading";
export * from "./desktop-types";

export * from "./list-toolbar";
export * from "./data-table";
export * from "./range-filters";
export * from "./faceted-filters";
export * from "./search-input";
export * from "./global-search";
export { GlobalSearchProvider, useGlobalSearch as useGlobalSearchImpl } from "./search/global-search-provider";
export * from "./search/global-search-config";
export * from "./search/search-history";
export * from "./pagination";
export * from "./app-error-boundary";
