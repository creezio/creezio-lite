export {
  ARCHITECTURE_VERSION,
} from "./architecture-version.js";
export type { ArchitectureVersion } from "./architecture-version.js";

export type { WebHostCheck } from "./web-allowlist.js";
export {
  WEB_HOST_NOT_ALLOWED_CODE,
  checkWebHostAllowed,
  readWebAllowedHosts,
} from "./web-allowlist.js";

export type { PathsContext, InstallDataResolveOpts } from "./paths.js";
export {
  INSTALL_DATA_DIRNAME,
  feedUrlForKind,
  guessPackagedDataDir,
  meiliBinaryCandidates,
  resolveAssistantDbPath,
  resolveDbPath,
  resolveHermesHomeDir,
  resolveInstallRoot,
  resolveLocalConfigPath,
  resolveLogsDir,
  resolveMainLogPath,
  resolveMeiliDataDir,
  resolveN8nHomeDir,
  resolveNodeRuntimeDir,
  resolvePackagedDataDir,
  resolvePreloadPath,
  resolveResourcesRoot,
  resolveTunnelHomeDir,
  resolveUploadsDir,
  resolveUserDataDir,
  userDataDirForKind,
} from "./paths.js";

/* ── M8 : core.db via env (Next/CRM) + contrat stores ── */
export {
  ensureCoreDbParent,
  resolveCoreDbPathFromEnv,
  resolvePluginDocumentsDirFromEnv,
} from "./core-db-env.js";
export type {
  PlatformBackend,
  PlatformDomain,
  PlatformDomainContract,
} from "./platform-stores-contract.js";
export {
  DEPRECATED_SHADOW_ONLY,
  PLATFORM_STORES_CONTRACT,
} from "./platform-stores-contract.js";

/* ── Phase H1.0 : SQLite multi-fichiers ── */
export type { EnsurePluginDbResult } from "./sqlite-layout.js";
export {
  CORE_DB_FILENAME,
  PLUGIN_DB_SUBDIR,
  SQLITE_LAYOUT_DIR,
  ensureDay0SqliteLayout,
  ensurePluginDb,
  pluginDbExists,
  removePluginDb,
  resolveBrandDbPath,
  resolveCoreDbPath,
  resolveDay0SqlitePaths,
  resolvePluginDbPath,
  resolveSqliteRoot,
} from "./sqlite-layout.js";

/* ── Phase H2 : runtime multi-DB + migrations ── */
export type {
  OpenSqliteDatabase,
  SqliteDatabase,
  SqliteStatement,
} from "./sqlite-driver.js";
export { openNodeSqliteDatabase } from "./sqlite-driver.js";
export { createAppRequire } from "./app-require.js";

export type {
  EnsureMigrationsResult,
  SqliteMigration,
} from "./sqlite-migrations.js";
export {
  SQLITE_META_MIGRATION,
  SQLITE_MIGRATIONS_TABLE,
  composeMigrations,
  ensureMigrations,
  listAppliedMigrations,
} from "./sqlite-migrations.js";

/* ── M11 : migrations SQLite cœur (auth + Product Hub) ── */
export type {
  PlatformCoreMigrationId,
  PlatformCoreMigrationsOptions,
} from "./core-migrations.js";
export {
  PLATFORM_CORE_MIGRATION_IDS,
  platformCoreMigrations,
} from "./core-migrations.js";

/* ── N4 : migrations historiques brand.db (schema_version) ── */
export type {
  HistoricalMigration,
  HistoricalMigrationReport,
  HistoricalSqliteDb,
  Migration,
  PlatformHistoricalStepVersion,
  RunHistoricalMigrationsOptions,
} from "./historical-migrations/index.js";
export {
  PLATFORM_HISTORICAL_STEP_VERSIONS,
  addColumnIfMissing,
  platformHistoricalMigrationByName,
  platformHistoricalMigrations,
  runHistoricalMigrations,
  tableColumns,
  tableExists,
} from "./historical-migrations/index.js";

export type {
  CreateSqliteRuntimeOptions,
  OpenPluginResult,
  SqliteHandle,
  SqliteLayerKind,
  SqliteLayerRef,
  SqliteRuntime,
  SqliteRuntimeStatus,
} from "./sqlite-runtime.js";
export {
  createSqliteRuntime,
  resolveLayerPath,
} from "./sqlite-runtime.js";

export type {
  AiWorkspacePresentationSetting,
  BackgroundSettings,
  ConnectionProfile,
  EmbedMode,
  HermesEmbedConfig,
  LocalBindHost as LocalBindHostSchema,
  LocalConfigFileV1,
  N8nEmbedConfig,
  RememberedServer,
  StoredValue,
  TunnelConfigPublic,
  TunnelMetaStored,
  TunnelPublicUrlsStored,
  TunnelServicePorts,
} from "./local-config-schema.js";
export {
  LOCAL_CONFIG_VERSION,
  emptyLocalConfig,
  isLocalConfigV1,
} from "./local-config-schema.js";

export type {
  FleetScopeId,
  FleetTelemetryConfig,
  FleetTelemetryPatch,
  FleetTelemetryScopes,
} from "./fleet-telemetry.js";
export {
  FLEET_CONSENT_VERSION,
  FLEET_SCOPE_IDS,
  applyFleetTelemetryPatch,
  basicSupportScopes,
  defaultFleetScopes,
  defaultFleetTelemetry,
  isFleetScopeActive,
  sanitizeFleetTelemetry,
} from "./fleet-telemetry.js";

export type {
  BootBehavior,
  PickerVariant,
  RuntimeAppKind,
} from "./app-kind.js";
export {
  APP_KIND_FILENAME,
  appKindEnvValue,
  appKindFilePayload,
  appUserModelIdFor,
  bootBehaviorFor,
  displayNameFor,
  isAllowedServerCockpitPath,
  parseAppKind,
  readAppKindFile,
  resolveAppKind,
  userDataDirForAppKind,
} from "./app-kind.js";

export type {
  ConnectionMode,
  ConnectionProfile as ConnectionProfileRuntime,
  ConnectionProfilePublic,
  LocalBindHost,
} from "./connection-profile.js";
export {
  assertProfileReady,
  defaultLocalProfile,
  defaultProfileForAppKind,
  normalizeLocalBind,
  normalizeRemoteUrl,
  resolveBootProfile,
  sanitizeConnectionProfile,
  testRemoteHealth,
  unsetConnectionProfile,
  unwrapBootProfileResult,
} from "./connection-profile.js";

export type { ProfileLaunch, ProfileMode } from "./profile-launch.js";
export {
  parseJoinDeepLink,
  parseProfileArgv,
  profileArgFor,
  profileDirSegment,
  profileUserDataDir,
  sanitizeProfileSegment,
} from "./profile-launch.js";

export type {
  TunnelEmbedService,
  TunnelHostMode,
  TunnelHostService,
  TunnelPublicUrls,
  TunnelUrlOpts,
} from "./tunnel-urls.js";
export {
  TUNNEL_EMBED_SERVICES,
  TUNNEL_HOST_SERVICES,
  TUNNEL_UNIVERSAL_SSL_ENV,
  buildTunnelPublicUrls,
  deriveTunnelServiceUrl,
  portFromLocalUrl,
  resolveTunnelHostMode,
  splitCrmHostname,
  stripTunnelServicePrefix,
  tunnelServiceHostname,
} from "./tunnel-urls.js";

export type {
  TunnelDnsRecordSpec,
  TunnelIngressOpts,
  TunnelIngressPorts,
  TunnelIngressRule,
  TunnelSlugKind,
} from "./tunnel-cf.js";
export {
  BRAND_WEB_SLUGS,
  FLAT_SERVICE_PREFIXES,
  REGISTRY_SLUGS,
  RESERVED_SLUGS,
  SLUG_RE,
  TUNNEL_DEFAULT_PORTS,
  agentTunnelCfName,
  agentTunnelDeprovisionDnsHosts,
  buildAgentTunnelIngressRules,
  buildTunnelIngressRules,
  isZoneLevelKind,
  normalizeSlug,
  normalizeTunnelPorts,
  parseEnvFileText,
  parseExtraHostnames,
  slugCheckLocal,
  tunnelAgentHostname,
  tunnelDeprovisionDnsHosts,
  tunnelDnsRecordSpecs,
  tunnelPublicUrls,
} from "./tunnel-cf.js";

export type {
  CfAgentTunnelEnsureOpts,
  CfAgentTunnelEnsureResult,
  CfDnsRecord,
  CfTunnelEnsureOpts,
  CfTunnelEnsureResult,
  CfTunnelEnv,
  DeprovisionCfAgentTunnelOpts,
  DeprovisionCfSlugOpts,
  EnsureCfTunnelDnsOpts,
} from "./tunnel-cf-client.js";
export {
  CfApiError,
  cfApi,
  createCfTunnel,
  deleteCfTunnel,
  deprovisionCfAgentTunnel,
  deprovisionCfSlug,
  ensureCfAgentTunnel,
  ensureCfAgentTunnelDns,
  ensureCfCnameRecord,
  ensureCfEmailDns,
  ensureCfTunnel,
  ensureCfTunnelDns,
  extractAgentRule,
  removeCfTunnelAgentRule,
  getCfTunnel,
  getCfTunnelConfig,
  listCfDnsRecords,
  missingCfTunnelEnvKeys,
  putCfTunnelIngress,
  resolveCfTunnelEnv,
  resolveCfZoneName,
  verifyCfApiToken,
} from "./tunnel-cf-client.js";

export {
  factoryResetPartitionPrefixes,
  factoryResetTargets,
} from "./factory-reset.js";

export type { BindHost } from "./ports.js";
export {
  findFreePort,
  httpGetStatus,
  waitForHealth,
  waitForMeiliHealth,
} from "./ports.js";

export type {
  UpdateEvent,
  UpdateState,
  UpdateStatus,
} from "./updater-state.js";
export {
  initialUpdateStatus,
  reduceUpdateEvent,
} from "./updater-state.js";

export {
  brandEnv,
  buildNextHostEnv,
  nodeBinaryEnvKey,
} from "./env-brand.js";

/* ── Phase B.2 : embeds purs ── */
export type {
  EmbedHostGate,
  EmbedToolMode,
} from "./embeds/embed-stack-hooks.js";
export {
  EMBED_IPC,
  EMBED_TOOL_SITE_IDS,
  PLUGIN_SITE_ID_RANGE,
  normalizeEmbedHttpOrigin,
  shouldSpawnHostOnlyEmbed,
} from "./embeds/embed-stack-hooks.js";

export type {
  EmbedEnvPanel,
  EmbedEnvPanelVar,
  EmbedEnvService,
  EmbedEnvVarDef,
} from "./embeds/embed-env-catalog.js";
export {
  HERMES_ENV_CATALOG,
  HERMES_LOCKED_KEYS,
  N8N_ENV_CATALOG,
  N8N_LOCKED_KEYS,
  OS_SANDBOX_LOCKED_KEYS,
  buildEmbedEnvPanel,
  catalogFor,
  isEmbedEnvService,
  lockedKeySet,
  mergeEmbedUserEnv,
  sanitizeUserEnvOverlay,
} from "./embeds/embed-env-catalog.js";

export type {
  HermesEmbedConfig as HermesEmbedConfigPure,
  HermesEmbedMode,
  HermesRuntimeStatus,
  HermesWebuiStatus,
} from "./embeds/hermes-embed.js";
export {
  HERMES_DEFAULT_API_PORT,
  HERMES_DEFAULT_WEBUI_PORT,
  HERMES_DESKTOP_API_PORT,
  HERMES_DESKTOP_WEBUI_PORT,
  HERMES_EXE_BUNDLE_CEILING_MB,
  buildHermesHomeEnvFile,
  buildNextHermesEnv,
  hermesBinEnvKey,
  hermesBinaryCandidates,
  hermesPublicStatus,
  normalizeHttpOrigin,
  resolveHermesBinary,
  sanitizeHermesEmbedConfig,
  shouldSpawnEmbeddedHermes,
} from "./embeds/hermes-embed.js";

export type {
  N8nEmbedConfig as N8nEmbedConfigPure,
  N8nEmbedMode,
  N8nRuntimeStatus,
} from "./embeds/n8n-embed.js";
export {
  N8N_AUDIT,
  N8N_DEFAULT_PORT,
  N8N_DESKTOP_PORT,
  N8N_EXE_BUNDLE_CEILING_MB,
  buildN8nSpawnEnv,
  buildNextN8nEnv,
  describeN8nSpawnKind,
  isNodeSpawnableN8nEntry,
  n8nBinEnvKey,
  n8nEntryCandidates,
  n8nHomeLooksWarm,
  n8nPublicStatus,
  normalizeN8nPublicBaseUrl,
  resolveN8nEntry,
  sanitizeN8nEmbedConfig,
  shouldSpawnEmbeddedN8n,
} from "./embeds/n8n-embed.js";

export type {
  RecoveryEnvelope,
  RecoveryVerifier,
  RecoveryWrappedSecrets,
} from "./recovery-key.js";
export {
  createRecoveryVerifier,
  generateRecoveryKey,
  normalizeRecoveryKey,
  unwrapSecretsWithRecoveryKey,
  verifyRecoveryKey,
  wrapSecretsWithRecoveryKey,
} from "./recovery-key.js";

/* ── O3 : installer prefs + licensing (purs) ── */
export type { InstallerPrefs } from "./installer-prefs.js";
export {
  INSTALLER_PREFS_FILENAME,
  consumeInstallerPrefsFile,
  installerPrefsPath,
  parseInstallerPrefs,
} from "./installer-prefs.js";

export type { LicenseStatus, LicensingOptions } from "./licensing.js";
export { checkLicense, storeLicenseKey } from "./licensing.js";

export {
  N8N_INSTALL_MIN_FREE_BYTES,
  WINDOWS_NPM_ENOSPC_EXIT,
  cleanupN8nInstallArtifacts,
  diskSpacePreflightMessage,
  formatBytesFr,
  formatN8nDiskSpaceError,
  getFreeDiskBytes,
  isDiskSpaceError,
} from "./disk-space.js";

/* ── Phase B.2 : plugins (contrats purs) ── */
export type {
  PluginRuntimeEntry,
  PluginRuntimeState,
} from "./plugins/plugin-events.js";
export {
  PLUGIN_RUNTIME_FILE,
  PLUGIN_SITE_ID_BASE,
  PLUGIN_SITE_ID_SPAN,
  pluginAcceptsHook,
  pluginHookUrl,
  pluginN8nWebhookUrl,
  pluginRuntimePath,
  pluginSiteId,
  readPluginRuntimeState,
  writePluginRuntimeState,
} from "./plugins/plugin-events.js";

export type {
  PluginExecutionGrantPayload,
  PluginGrantAction,
} from "./plugins/plugin-execution-grant.js";
export {
  issuePluginExecutionGrant,
  verifyPluginExecutionGrant,
} from "./plugins/plugin-execution-grant.js";

export type {
  DiscoveredPlugin,
  PluginAcceptance,
  PluginAcceptanceSmoke,
  PluginManifest,
  PluginMcpToolSpec,
  PluginPanelConfig,
  PluginPermission,
} from "./plugins/plugin-manifest.js";
export {
  PLUGIN_MANIFEST_FILE,
  discoverPlugins,
  hasPluginPermission,
  isValidPluginId,
  parsePluginManifest,
  pluginEnabledFlagPath,
  pluginsRootDir,
  setPluginEnabled,
} from "./plugins/plugin-manifest.js";

/* ── P1.b : helpers bas du graphe partagés search / host-runtime ── */
export {
  electronShellPackageRoot,
  kitOsResourcesRoot,
  kitOsVendorDir,
} from "./kit-os-resources.js";
export { envForNodeScriptSpawn } from "./node-spawn-env.js";
