export type {
  BrandKernelHandle,
  BootBrandKernelFn,
  BrandCatalogHost,
  StartBrandDesktopConfig,
  BrandDesktopHandle,
  StartBrandKernelHarnessConfig,
  BrandKernelHarnessHandle,
} from "./types.js";

export {
  applyBrandModuleAuth,
  sessionCookieNameForBrand,
  type ApplyBrandModuleAuthOptions,
} from "./apply-brand-module-auth.js";
export {
  createBrandModuleRegistry,
  collectNavPermissionsFromModules,
  collectPermissionGroupsFromModules,
  type BrandMeiliIndex,
  type BrandModuleAssistantContextSource,
  type BrandModuleAssistantEntitySource,
  type BrandModuleAssistantSource,
  type BrandModuleAssistantToolSource,
  type BrandModuleDef,
  type BrandModuleOnboarding,
  type BrandModuleRegistry,
  type BrandNavItem,
  type BrandPermissionGroup,
  type OnboardingContent,
} from "./module-contract.js";
export { startBrandDesktop } from "./start-brand-desktop.js";
export { startBrandKernelHarness } from "./start-brand-kernel-harness.js";
export {
  createFleetAccessMount,
  fleetStateFilePath,
  readFleetState,
  startFleetHeartbeat,
  type FleetAccessMountOptions,
  type FleetHeartbeatHandle,
  type FleetHeartbeatState,
  type StartFleetHeartbeatConfig,
} from "./fleet-heartbeat.js";
export {
  createBrandKernel,
  brandKernelBooter,
  type CreateBrandKernelOptions,
  type BrandKernelBoot,
} from "./create-brand-kernel.js";
export {
  composeBrandOs,
  type ComposeBrandOsOptions,
  type BrandOsComposition,
  type BrandOsStatus,
} from "./compose-brand-os.js";
export {
  createPluginToolsDiscovery,
  type CreatePluginToolsDiscoveryOptions,
  type PluginToolsHostLike,
} from "./plugin-tools-discovery.js";
export {
  createPluginProxyMount,
} from "./plugin-proxy-mount.js";
export {
  seedPluginsFromDirs,
  type SeedPluginsResult,
} from "./plugin-seed.js";
export {
  createPluginAclMcpWiring,
  type PluginAclMcpWiring,
} from "./plugin-acl-wiring.js";
export {
  listenBrandOsHttp,
  resolveBrandOsHttpHost,
  type BrandOsHttpHandle,
} from "./listen-brand-os-http.js";
export {
  CATALOG_INTERNAL_HEADER,
  CATALOG_INTERNAL_SECRET_ENV,
  PUBLIC_MODULE_PATHS,
  anyModuleMachineKeyVerifier,
  assertModuleMountSession,
  catalogInternalHeaderAllows,
  createBrandApiKeyModuleVerifier,
  createPluginDiskKeyModuleVerifier,
  ensureCatalogInternalSecret,
  isAdminApiPath,
  isCatalogInternalBootPath,
  isModuleApiPath,
  isPublicModulePath,
  sessionFromNodeHeaders,
  type ModuleMachineKeyVerifier,
  type ModuleMountAuthDecision,
  type ModuleMountBrandDb,
  type PublicModulePathRule,
} from "./module-mount-auth.js";
export {
  startBrandUiPlane,
  hasBrandUiPlane,
  type BrandUiPlaneHandle,
} from "./start-brand-ui-plane.js";
export {
  createBootProgressReporter,
  type BootProgressReporter,
  type BootStepId,
} from "./boot-progress.js";
export {
  listenBrandBootHttp,
  type BrandBootHttpHandle,
} from "./listen-brand-boot-http.js";
export {
  installBrandOsDesktop,
  brandPreloadPath,
  type InstallBrandOsDesktopOptions,
} from "./install-brand-os-desktop.js";
export {
  resolveNativeWarmFlags,
  warmBrandNativeHosts,
  type NativeWarmFlags,
  type WarmNativeHostsResult,
} from "./warm-brand-native-hosts.js";
export {
  mountBrandMcpSurface,
  mcpSurfaceHandlesPath,
  type BrandMcpSurface,
} from "./mount-brand-mcp-surface.js";
export {
  adminDatabaseHandlesPath,
  createBrandAdminDatabaseRoutes,
  registerRuntimeDatabaseStores,
} from "./mount-brand-admin-database.js";
export {
  mountBrandEmailSurface,
  emailSurfaceHandlesPath,
  type BrandEmailSurface,
} from "./mount-brand-email-surface.js";
export {
  mountBrandPlatformSurface,
  platformSurfaceHandlesPath,
  createPlatformTasksBrandAdapters,
  getBrandPlatformRuntime,
  type BrandPlatformSurface,
  type BrandPlatformRuntime,
  type DesktopPresenceRegistry,
} from "./mount-brand-platform-surface.js";
export {
  openBrandPlatformStore,
  PLATFORM_KANBAN_CORE_SQL,
  PLATFORM_USERS_CORE_SQL,
  type BrandPlatformStore,
} from "./brand-platform-store.js";
export {
  startBrandBrowserSidecar,
  browserSidecarRequested,
  SERVER_BROWSER_HOST_ID,
  type BrandBrowserSidecarHandle,
} from "./wire-brand-browser-sidecar.js";
export {
  createApiKeyBearerActorResolver,
  registerHermesHostMcpTools,
  type ApiKeyRow,
  type CreateApiKeyBearerActorResolverOptions,
  type RegisterHermesHostMcpToolsOptions,
} from "./hermes-mcp-host-tools.js";
export {
  handleMcpJsonRpcRequest,
  isJsonRpcBody,
  type McpJsonRpcResponse,
} from "./mcp-jsonrpc.js";
export {
  applyBrandCatalogEnvDefaults,
  applyNativeEmbedNextEnv,
  applyStoredEmailEnv,
  applyStoredLlmEnv,
  harnessTunnelProvisionRequested,
  probeTunnelPublicUrl,
  runHarnessCatalogImportPhase,
  runHarnessFleetPhase,
  runHarnessHermesBridgePhase,
  runHarnessPluginsPhase,
  runHarnessTunnelPhase,
  type HarnessTunnelPhaseResult,
  type TunnelPublicProbeResult,
} from "./harness-server-phases.js";
export {
  buildCockpitHealth,
  type CockpitHealthPayload,
  type CockpitServiceHealth,
} from "./cockpit-health.js";
