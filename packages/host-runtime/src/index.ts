/**
 * @creezio/host-runtime — host runtime Node pur du kit (P1.b).
 *
 * Extrait de @creezio/electron-shell (déménagement pur, zéro changement de
 * comportement) : embeds Hermes/n8n/tunnel, plugins host + control plane,
 * sandbox, ai-workspace, node/npm embarqués, launchers serveur, wiring host
 * marque (host-stack / brand-host-stack / brand-host-runtime), logger,
 * crash-reporter, local-config.
 *
 * AUCUN import statique d'`electron` (valeurs via `loadElectron()`, types
 * via `import type`) — gate `test-phase-host-no-electron`.
 */

export {
  initLogger,
  initEarlyBootLogger,
  ensureLogsDir,
  log,
  logError,
  logFilePath,
  getLogRing,
  recentLines,
  logFileTail,
  scoped,
  feedChildLine,
  setOpsLineHandler,
} from "./logger.js";
export type {
  EarlyBootLogResult,
  EarlyBootLogSource,
} from "./logger.js";

export { loadElectron } from "./load-electron.js";

export {
  factoryResetSessionPartition,
  wipeLocalUserData,
} from "./factory-reset-runtime.js";

export type {
  BrandKernelHttpHandle,
  BrandKernelLike,
} from "./brand-kernel-http.js";
export { listenBrandKernelHttp } from "./brand-kernel-http.js";

export type {
  RunningServer,
  StartServerCoreOptions,
  StartServerPaths,
} from "./server-env.js";
export {
  findFreePort,
  startNextServerCore,
  waitForHealth,
} from "./server-env.js";

export type {
  HermesLaunchRequest,
  HostProcessHandle,
  N8nLaunchRequest,
  TunnelLaunchRequest,
} from "./contracts.js";
export {
  DEFAULT_HOST_ONLY_ELECTRON_MODULES,
  buildEmbedHostEnv,
  cloudflaredEnvKey,
} from "./contracts.js";

export type {
  HostLogFn,
  HostRuntimeContext,
} from "./context.js";
export { hostLog, hostProductName } from "./context.js";

export type { SafeStorageBackend } from "./safe-storage.js";
export {
  canEncrypt,
  loadElectronSafeStorage,
  loadElectronSafeStorageSync,
  openValue,
  sealValue,
} from "./safe-storage.js";

export type {
  LocalAuth,
  LocalConfigPath,
  LocalConfigStore,
  LocalConfigStoreOptions,
  TunnelConfig,
} from "./local-config.js";
export {
  createLocalConfigStore,
  createLocalConfigStoreSync,
} from "./local-config.js";

export type {
  TunnelIngressPorts,
  TunnelRuntimeStatus,
  TunnelService,
} from "./tunnel/tunnel.js";
export {
  createTunnelService,
  buildTunnelPublicUrls,
  deriveTunnelServiceUrl,
} from "./tunnel/tunnel.js";
export type {
  CloudflaredExitInfo,
  CloudflaredRespawnDecision,
  CloudflaredRespawnPolicy,
} from "./tunnel/cloudflared-respawn.js";
export {
  CLOUDFLARED_RESPAWN,
  cloudflaredRespawnDelayMs,
  describeCloudflaredExit,
  resolveCloudflaredRespawnPolicy,
  shouldRespawnCloudflared,
} from "./tunnel/cloudflared-respawn.js";

// export * : alias legacy nommés marque purgés en H12 (codemod scripts/codemods/H12)
export * from "./node-runtime.js";

export * from "./npm-cli.js";

export * from "./sandbox/embed-sandbox.js";
export {
  buildConfinedPath,
  overridesAllowed,
  resolveSystemBinary,
} from "./sandbox/os-sandbox.js";

// export * (idem : alias legacy non épelés)
export * from "./hermes/launcher.js";
export {
  LEARNED_SITE_SKILL_PREFIX,
  brandHermesSkillsDirCandidates,
  isLearnedSiteSkillName,
  kitHermesSkillsDir,
  seedHermesSkillsFromDirs,
} from "./hermes/skills-seed.js";
// export * (idem : alias legacy non épelés)
export * from "./hermes/runtime-bootstrap.js";

export type {
  N8nAgentKeysHooks,
  N8nHost,
  N8nStatusPayload,
  RunningN8n,
  StartN8nOptions,
} from "./n8n/launcher.js";
export { createN8nHost } from "./n8n/launcher.js";
export {
  ensureN8nRuntime,
  getN8nBootstrapError,
  getN8nBootstrapPhase,
  loadN8nRuntimeManifest,
  n8nEntryPath,
  n8nPackageJsonPath,
  n8nRuntimeCacheDir,
  n8nVendorDir,
  __resetN8nBootstrapStateForTests,
} from "./n8n/runtime-bootstrap.js";
export {
  ensureKitOsBinaries,
  kitBinaryPaths,
  type EnsureKitBinariesResult,
  type KitBinaryName,
} from "./ensure-kit-binaries.js";

export type { N8nApiKeyBrand, N8nApiKeyStored } from "./n8n/api-key.js";
export {
  N8N_HERMES_API_SCOPES,
  cookieHeaderFromSetCookie,
  ensureN8nApiKey,
  extractRawN8nApiKey,
  fetchN8nApiKeyScopes,
  getN8nBridgeEnv,
  n8nApiKeyPath,
  n8nHttpJson,
  n8nLoginSucceeded,
  n8nNeedsOwnerSetup,
  readStoredN8nApiKey,
  writeStoredN8nApiKey,
} from "./n8n/api-key.js";

export type {
  N8nAgentIsolationBrand,
  N8nAgentKeyStored,
  N8nAgentKeysFile,
} from "./n8n/agent-isolation.js";
export {
  agentIdSegment,
  ensureHermesAgentWorkspace,
  ensureN8nAgentApiKey,
  hermesAgentWorkspaceDir,
  n8nAgentKeyLabel,
  n8nAgentKeysPath,
  n8nAgentTag,
  readStoredN8nAgentKeys,
  revokeN8nAgentApiKey,
  writeStoredN8nAgentKeys,
} from "./n8n/agent-isolation.js";

export type {
  HermesCrmKeyBrand,
  HermesCrmKeyPaths,
  HermesCrmKeyStored,
} from "./hermes/crm-key.js";
export {
  ensureHermesCrmApiKey,
  generateHermesCrmApiKey,
  getHermesFullBridgeEnv,
  hermesCrmKeyPath,
  readHermesCrmApiKey,
  writeHermesCrmApiKey,
} from "./hermes/crm-key.js";
export type {
  N8nBootstrapPhase,
  N8nRuntimeManifest,
} from "./n8n/runtime-bootstrap.js";

export type {
  PluginsHost,
  RunningPlugin as HostRunningPlugin,
} from "./plugins/host.js";
export {
  PLUGIN_VERTICAL_REMAINING,
  createPluginsHost,
} from "./plugins/host.js";
export {
  ensurePluginControlToken,
  generatePluginControlToken,
  getPluginControlBridgeEnv,
  pluginControlTokenPath,
  pluginControlTokenPrefix,
  readPluginControlToken,
} from "./plugins/control-token.js";
export type { StartHostPluginControlPlaneOptions } from "./plugins/control-plane.js";
export { startHostPluginControlPlane } from "./plugins/control-plane.js";

export type {
  PluginHostBindings,
  PluginLlmKeys,
} from "./plugins/brand-bindings.js";
export {
  __resetPluginHostBindingsForTests,
  assignPluginEnv,
  configurePluginHost,
  getPluginHostBindings,
  pluginCrmKeyFileName,
  pluginEnvKeys,
  pluginGitIdentity,
  resolveApplyOsSandboxEnv,
  resolveBuildIsolatedNodeEnv,
  resolveFindFreePort,
  tryGetPluginHostBindings,
} from "./plugins/brand-bindings.js";

export type {
  DiscoveredPlugin,
  PluginAcceptance,
  PluginAcceptanceSmoke,
  PluginManifest,
  PluginPanelConfig,
  PluginPermission,
} from "./plugins/runtime.js";
export {
  PLUGIN_MANIFEST_FILE,
  discoverPlugins,
  hasPluginPermission,
  isValidPluginId,
  parsePluginManifest,
  pluginEnabledFlagPath,
  pluginSiteId,
  pluginsRootDir,
  scaffoldPlugin,
  scaffoldPluginUiCss,
  setPluginEnabled,
} from "./plugins/runtime.js";

export type { RunningPlugin } from "./plugins/launcher.js";
export {
  createPluginScaffold,
  createPluginScaffoldWithGit,
  deletePlugin,
  enablePlugin,
  getPluginLogs,
  getPluginVersions,
  getPluginsCrmPort,
  getRunningPlugins,
  listPlugins,
  pluginsStatusPayload,
  pluginsStatusPayloadWithGit,
  proxyPluginHealth,
  resolvePluginPanel,
  restartPlugin,
  restorePluginToVersion,
  setPluginsCrmPort,
  startEnabledPlugins,
  stopAllPlugins,
  writePluginFiles,
  writePluginFilesAndCommit,
} from "./plugins/launcher.js";

export type {
  PluginGitCommit,
  PluginGitStatus,
} from "./plugins/git.js";
export {
  bumpPluginManifestPatch,
  commitPluginChanges,
  ensurePluginGitRepo,
  getPluginGitStatus,
  isPluginGitRepo,
  listPluginVersions,
  resetGitBinaryCache,
  resolveGitBinary,
  restorePluginVersion,
} from "./plugins/git.js";

export type {
  PluginControlApiState,
} from "./plugins/control-extras.js";
export {
  PLUGIN_CONTROL_PREFERRED_PORT,
  archivePluginRuntime,
  createPluginExecutionGrant,
  getPluginControlApi,
  /** Bridge env depuis API running (TF gold) — distinct du helper token+ctx. */
  getPluginControlBridgeEnv as getPluginControlApiBridgeEnv,
  handleBrandExtras,
  handlePluginControlExtras,
  migratePluginData,
  startPluginControlApi,
  stopPluginControlApi,
  validatePluginExecutionGrant,
} from "./plugins/control-extras.js";

export { buildPluginControlPlaneAdapters } from "./plugins/control-adapters.js";

export type { PluginCrmKeyStored } from "./plugins/crm-key.js";
export {
  PLUGIN_CRM_KEY_FILE,
  ensurePluginCrmApiKey,
  pluginCrmKeyPath,
  readPluginCrmApiKey,
} from "./plugins/crm-key.js";

export type {
  AcceptCheckItem,
  AcceptCheckResult,
} from "./plugins/accept-check.js";
export {
  resolvePluginSmokes,
  runPluginAcceptCheck,
} from "./plugins/accept-check.js";

export type { PluginTestResult } from "./plugins/test-runner.js";
export { runPluginTests } from "./plugins/test-runner.js";

export type { PluginDataMigrationReport } from "./plugins/data.js";
export {
  applyPluginDataMigrations,
  runPluginDataCli,
} from "./plugins/data.js";

export {
  PLUGIN_RUNTIME_FILE,
  PLUGIN_SITE_ID_BASE,
  PLUGIN_SITE_ID_SPAN,
  pluginAcceptsHook,
  pluginHookUrl,
  pluginN8nWebhookUrl,
  pluginRuntimePath,
  readPluginRuntimeState,
  writePluginRuntimeState,
} from "./plugins/events.js";
export type {
  PluginRuntimeEntry,
  PluginRuntimeState,
} from "./plugins/events.js";

export {
  issuePluginExecutionGrant,
  verifyPluginExecutionGrant,
} from "./plugins/execution-grant.js";
export type {
  PluginExecutionGrantPayload,
  PluginGrantAction,
} from "./plugins/execution-grant.js";

export type { HostStack } from "./host-stack.js";
export { createHostStack, lazyHost } from "./host-stack.js";

export type {
  BrandHostPathsModule,
  BrandHostStack,
  BrandHostStackConfig,
  BrandLocalConfigStoreLike,
} from "./brand-host-stack.js";
export { createBrandHostStack } from "./brand-host-stack.js";
export type {
  BrandFleetInput,
  BrandHostRuntimeConfig,
  BrandHostSingletons,
  BrandRuntimePaths,
} from "./brand-host-runtime.js";
export {
  brandEnsureCrmKeyDbScript,
  createBrandHostRuntime,
  createBrandHostRuntimeContext,
  createHermesCrmKeyPaths,
  createHermesCrmKeySurface,
  createHermesCrmOnlyBridgeEnv,
  createN8nAgentKeysHooks,
} from "./brand-host-runtime.js";

export type {
  FeatureOffFleetAgentHost,
  FeatureOffFleetSamplesHost,
  FeatureOffHost,
  FeatureOffHostOptions,
  FeatureOffPluginAcceptHost,
  FeatureOffPluginControlExtras,
  FeatureOffPluginTestsHost,
  FeatureOffPluginsHost,
  FeatureOffPluginsStatus,
} from "./feature-off-host.js";
export { createFeatureOffHost } from "./feature-off-host.js";

export type { CrashKind, CrashReporterConfig } from "./crash-reporter.js";
export {
  configureCrashReporter,
  crashEndpoint,
  crashLogHint,
  crashReportsDir,
  flushPendingCrashReports,
  getBootStage,
  getBootTimeline,
  getInstallId,
  initCrashReporter,
  installGlobalHandlers,
  installEarlyCrashWriter,
  reportCrash,
  reportCrashDebounced,
  setBootStage,
} from "./crash-reporter.js";

export type { BridgeOptions } from "./bridge-client.js";
export { BridgeClient } from "./bridge-client.js";

export type {
  BrandServerLauncherDeps,
  ServerSpawnFn,
  StartBrandServerOptions,
} from "./server-launcher.js";
export {
  startBrandNextServer,
  findFreePort as findServerFreePort,
  waitForHealth as waitForServerHealth,
} from "./server-launcher.js";

export type {
  AiWorkspaceHostBindings,
  AiWorkspaceInfo,
  AiWorkspaceManagerOptions,
  AiWorkspacePresentation,
  AiWorkspaceUiActionRequest,
  AiProfileWindowOptions,
  AiScreencasterOptions,
  AiSupplierTabsFactory,
  AiSupplierTabsLike,
  AiTabInfo,
  PostFrameResult,
  SupplierActionRequest,
} from "./ai-workspace/index.js";
export {
  AiProfileWindow,
  AiScreencaster,
  AiWorkspaceManager,
  __resetAiWorkspaceHostBindingsForTests,
  aiPartitionName,
  aiShareWebSessions,
  aiSupplierPartitionPrefix,
  configureAiWorkspaceHost,
  executeAiWorkspaceAction,
  getAiWorkspaceHostBindings,
  isAiWorkspaceActionType,
  tryGetAiWorkspaceHostBindings,
} from "./ai-workspace/index.js";
