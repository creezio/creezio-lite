export type { NewAppOptions, ScaffoldResult } from "./scaffold.js";
export { scaffoldNewApp, renderManifestTs } from "./scaffold.js";
export { runCli, parseArgs } from "./cli.js";
export { runBrandCli, parseBrandArgs } from "./brand-cli.js";
export {
  runUpgradeCli,
  parseUpgradeArgs,
  archVersionForLockstep,
  detectBrandArchitectureVersion,
  listCodemodVersions,
  resolveCodemodsDir,
  targetLockstepVersion,
} from "./upgrade-cli.js";
export { spawnNpmAt, npmEnvForProject } from "./npm-isolated.js";
export type {
  ProductModel,
  ProductEntity,
  ProductPage,
  ProductFlow,
  ProductField,
  PlatformNeeds,
  FieldType,
} from "./product-model.js";
export {
  parseProductPrd,
  isProductSpecStub,
  safeBrandId,
  assertProductModel,
  corePurchaseEntities,
  corePurchasePages,
  coreOrderFlow,
  chrCatalogEntities,
  chrCatalogPages,
  chrOrderFlow,
  defaultPlatformNeeds,
  isChrModel,
} from "./product-model.js";
export { writeFromPrdArtifacts } from "./scaffold-from-prd.js";
export {
  registerMeiliFeedPreset,
  getMeiliFeedPreset,
  listMeiliFeedPresetIds,
  normalizeMeiliFeedPresetId,
  type MeiliFeedPresetRenderer,
} from "./generators/meili-feed-presets.js";
export {
  scaffoldAdminRepo,
  type AdminRepoOptions,
  type AdminRepoResult,
} from "./admin-repo.js";
export {
  resolveGithubToken,
  createPrivateRepo,
  deleteRepo,
  pushInitialCommit,
  createBrandGithubRepos,
  maybePushBrandRepos,
  GITHUB_REPOS_SKIPPED_MSG,
  type GithubRepoSpec,
  type CreateRepoResult,
} from "./github-repos.js";
export {
  isPackageLockInSync,
  ensureBrandPackageLocks,
  pinCreezioDepsToKitWorktree,
  type PkgJson,
} from "./package-lock.js";
export {
  CREEZIO_MANIFEST_CANDIDATES,
  applyCreezioManifestSync,
  creezioManifestRole,
  creezioSyncPlanHasChanges,
  planCreezioManifestSync,
  requiredCreezioDepsForRole,
  type CreezioManifestRole,
  type CreezioManifestSyncPlan,
} from "./sync-creezio-deps.js";
export { prepareBrandDistribution } from "./prepare-brand-distribution.js";
export {
  applyVpsNativeWarmDefaults,
  isServerDockerBackupEnabled,
  resolveServerDockerBackupEnabled,
  SERVER_DOCKER_BACKUP_ENV,
  OCI_IMAGE_SOURCE_LABEL,
  parseGithubHttpsSource,
  resolveBrandGithubSourceUrl,
  requireImageSourceForRegistry,
  ociImageSourceBuildArgs,
  collectDockerBuildArgs,
} from "./server-docker-cli.js";
export {
  loadServerRegistry,
  saveServerRegistry,
  allocateServerPort,
  buildDockerRunArgs,
  serverImageName,
  serverContainerName,
  validInstanceName,
  registryPath,
  type ServerRegistry,
  type ServerRegistryInstance,
} from "./server-docker-registry.js";
export {
  CREATE_CF_ENV_KEYS,
  CREATE_TUNNEL_ENV_KEYS,
  RESERVED_SLUGS_FALLBACK,
  deriveCreateTunnelSlug,
  formatMissingProvisionerError,
  isExplicitTunnelLocal,
  loadReservedSlugs,
  applyAdminPublicTunnelDefaults,
  extraHostnamesKey,
  isAdminBrandId,
  parseExtraHostnamesList,
  resolveCreateTunnelPolicy,
  resolveMigrateStackPlan,
  type CreateTunnelPolicy,
  type CreateTunnelPolicyInput,
} from "./server-docker-tunnel.js";
export {
  AGENT_TUNNEL_CONTAINER,
  AGENT_TUNNEL_IMAGE_DEFAULT,
  agentTunnelEnvPath,
  agentUrlNeedsDedicatedPersist,
  applyDedicatedAgentUrlToFleetHosts,
  applyDedicatedAgentUrlToHostState,
  buildAgentTunnelRunArgs,
  canonicalDedicatedAgentUrl,
  discoverFleetHostsJsonPaths,
  needsDedicatedAgentTunnelMigration,
  parseAgentPublicUrl,
  persistDedicatedAgentUrlInFleetHostsFile,
  formatFleetHostsEaccesError,
  formatStackFileEaccesError,
  isFsPermissionError,
  CREEZIO_SERVER_DOCKER_WRAPPER,
  defaultSudoExec,
  permissionError,
  readTextFileDirectOrSudo,
  writeTextFileDirectOrSudo,
  renderAgentTunnelEnvFile,
  resolveAgentTunnelImage,
} from "./server-docker-agent-tunnel.js";
export {
  CREATE_OWNER_ENV_KEYS,
  E2E_OWNER_ENV_KEYS,
  applyFirstRunOwner,
  defaultE2eEmail,
  formatMissingOwnerError,
  formatOwnerLoginLog,
  generateOwnerPassword,
  resolveCreateOwnerPolicy,
  resolveEnsureOwnerCreds,
  type CreateOwnerPolicy,
  type CreateOwnerPolicyInput,
} from "./server-docker-owner.js";
export {
  compareVersionTags,
  selectTagsToPrune,
  parseImageRef,
  collectInUseKeys,
  collectReleaseKeys,
  serversFileImageRefs,
  fetchFleetReleaseRefs,
  planRepoGc,
  resolveRegistryGcKeep,
  resolveRegistryGcServersFiles,
  runRegistryGc,
  runRegistryGcCommand,
  REGISTRY_GC_KEEP_DEFAULT,
  REGISTRY_SEMVER_KEEP_MIN,
  REGISTRY_GC_DEFAULT_HOST,
  REGISTRY_GC_DEFAULT_CONTAINER,
  REGISTRY_AUTO_TAG_RE,
  REGISTRY_SEMVER_TAG_RE,
  registryTagFamily,
  resolveSemverKeep,
  type FleetReleaseRef,
  type RegistryGcResult,
  type RegistryGcOpts,
  type RepoGcPlan,
} from "./server-docker-registry-gc.js";
export {
  isGhcrRegistry,
  parseGhcrRegistry,
  selectGhcrTagsToPrune,
  planGhcrPackageGc,
  resolveGhcrToken,
  resolveGhcrSemverKeep,
  runGhcrGc,
  runGhcrGcCommand,
  runGhcrPublishRetention,
  GHCR_SEMVER_KEEP_MIN,
  type GhcrGcResult,
  type GhcrGcOpts,
} from "./server-docker-ghcr-gc.js";
export {
  writeAppFile,
  isOwnedByBrand,
  OWNED_BY_BRAND_MARKER,
} from "./write-app-file.js";
export {
  kitPluginTemplatesDir,
  listKitPluginTemplates,
  installKitPluginTemplate,
  type InstallKitPluginTemplateResult,
} from "./plugin-templates.js";
