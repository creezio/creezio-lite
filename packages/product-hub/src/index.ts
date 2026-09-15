/**
 * @creezio/product-hub — Product Hub / plugins brand-agnostic (Phase E / P09).
 *
 * Contrats purs + store + control plane + routes HTTP `/plugin-products`
 * + n8n provisioning + fabrique conversationnelle.
 * UI Admin via `./ui` ; scaffolds git / test-runner restent verticaux.
 */

export type { ProductHubBrandTokens } from "./brand-tokens.js";
export {
  grantProcessHint,
  productHubTokensFromManifest,
} from "./brand-tokens.js";

export type { PluginLifecycleState, PluginTaskStatus } from "./lifecycle.js";
export {
  PLUGIN_LIFECYCLE_STATES,
  PLUGIN_LIFECYCLE_TRANSITIONS,
  PLUGIN_TASK_STATUSES,
  assertPluginLifecycleTransition,
  canTransitionPluginLifecycle,
  isPluginLifecycleState,
} from "./lifecycle.js";

export type { PluginPrdRevisionInput, PluginPrdSections } from "./prd.js";
export {
  PLUGIN_PRD_REQUIRED_SECTIONS,
  containsReplacementChar,
  missingPrdCoreFields,
  missingPrdSections,
  parsePluginPrdSections,
} from "./prd.js";

export type {
  PluginClarificationQuestion,
  PluginClarificationRound,
  PluginClarificationStatus,
} from "./clarifications.js";
export { assertClarificationQuestions } from "./clarifications.js";

export type { PluginImpactEvidence, PluginImpactReport } from "./impact.js";
export {
  buildPluginImpactReport,
  collectPluginManifestEvidence,
  textOverlapScore,
} from "./impact.js";

export type { N8nPluginIdentityMode } from "./n8n-tags.js";
export {
  N8N_TAG_MAX_LENGTH,
  isBrandPluginN8nTag,
  pluginN8nTag,
} from "./n8n-tags.js";

export type {
  N8nConnectionStatus,
  N8nExecution,
  N8nRequest,
  N8nTag,
  N8nWorkflow,
  PluginN8nHubDb,
  PluginN8nProvisioning,
  PluginN8nProvisioningDeps,
  PluginN8nSnapshot,
} from "./n8n-provisioning.js";
export {
  createPluginN8nProvisioning,
  resolveN8nTagPrefix,
} from "./n8n-provisioning.js";

export type {
  HermesCreateTaskInput,
  PluginProductsReadonlyDb,
  PluginProductsRouteDeps,
  PluginProductsSession,
} from "./http/plugin-products-routes.js";
export { createPluginProductsRoutes } from "./http/plugin-products-routes.js";

export type { PluginFactoryRouteDeps } from "./http/plugin-factory-routes.js";
export { createPluginFactoryRoutes } from "./http/plugin-factory-routes.js";

export type {
  PluginAclAction,
  PluginAclActor,
  PluginAclCapability,
  PluginAclCapabilityGrant,
  PluginAclDecision,
  PluginAclEntry,
  PluginAclLevel,
  PluginAclPolicy,
} from "./acl.js";
export {
  PLUGIN_ACL_DEFAULT_CAPABILITIES,
  PLUGIN_ACL_LEVEL_ORG,
  PLUGIN_ACL_LEVEL_USER,
  PLUGIN_ACL_ORG_HEADER,
  PLUGIN_ACL_OWNER_HEADER,
  PLUGIN_ACL_USER_HEADER,
  aclEntryToPolicy,
  actorIsPluginAdmin,
  aggregateAclRows,
  canActorExecutePlugin,
  canActorInstallPlugin,
  canActorSeePlugin,
  decidePluginAccess,
  filterVisiblePluginIds,
  isCrossOrgDenied,
  buildPluginAclActorHeaders,
  resolvePluginAclActorFromHeaders,
  subjectKey,
} from "./acl.js";

export type {
  IssueGrantResult,
  ProductHubPrdRevision,
  ProductHubProductDetails,
} from "./grants-flow.js";
export {
  extractExecutionGrantFromRequest,
  issueGrantFromProductDetails,
  isGrantBypassEnabled,
  requirePluginExecutionGrant,
} from "./grants-flow.js";

export {
  PRODUCT_HUB_ACL_H5_SQL,
  PRODUCT_HUB_ACL_ORG_SQL,
  PRODUCT_HUB_ACL_USER_SQL,
  PRODUCT_HUB_CORE_SQL,
  PRODUCT_HUB_RUNTIME_SQL,
  PRODUCT_HUB_MANAGED_MARKER,
} from "./schema-sql.js";

export {
  isProductHubManaged,
  markProductHubManaged,
  productHubManagedPath,
} from "./managed-marker.js";

export type {
  PluginClarificationRecord,
  PluginImpactReportRecord,
  PluginPrdRevisionRecord,
  PluginProductRecord,
  PluginTaskRecord,
  ProductHubStore,
} from "./store/types.js";

export {
  createMemoryProductHubStore,
  createProductRequest,
} from "./store/memory-store.js";

export type {
  CreateSqliteProductHubStoreOptions,
  SqliteProductHubStore,
} from "./store/sqlite-store.js";
export {
  createSqliteProductHubStore,
  createSqliteProductRequest,
} from "./store/sqlite-store.js";
export type {
  OpenSqliteDatabase,
  SqliteDatabase,
  SqliteStatement,
} from "./store/sqlite-driver.js";
export { openNodeSqliteDatabase } from "./store/sqlite-driver.js";
export type { MigrateLegacyBrandProductHubOnceOptions } from "./store/migrate-legacy.js";
export { migrateLegacyBrandProductHubOnce } from "./store/migrate-legacy.js";
export type {
  BrandProductHubBindings,
  CreateBrandProductHubBindingsOptions,
} from "./store/brand-bindings.js";
export { createBrandProductHubBindings } from "./store/brand-bindings.js";
export type {
  CachedSqliteProductHubAccessor,
  CreateCachedSqliteProductHubAccessorOptions,
} from "./store/cached-accessor.js";
export { createCachedSqliteProductHubAccessor } from "./store/cached-accessor.js";

export type {
  PluginControlPlaneAcl,
  PluginControlPlaneAdapters,
  PluginControlPlaneOptions,
  PluginControlPlaneState,
} from "./control-plane/types.js";
export {
  createPluginControlPlaneHandler,
  startPluginControlPlane,
} from "./control-plane/server.js";
export type {
  CreatePluginControlPlaneAclFromStoreOptions,
  PluginHubAclStoreSurface,
} from "./control-plane/acl-from-store.js";
export { createPluginControlPlaneAclFromStore } from "./control-plane/acl-from-store.js";
export { withBearerServiceKeyFallback } from "./control-plane/acl-service-key.js";

export type {
  ProductHubHost,
  ProductHubHostDeps,
} from "./host-api.js";
export { createProductHubHost } from "./host-api.js";

export type {
  PluginAclAdminRow,
  PluginAclAdminStore,
  UpsertPluginAclAdminInput,
} from "./admin/plugin-acl-admin.js";
export {
  clearPluginAclAdmin,
  getPluginAclAdmin,
  listPluginAclAdmin,
  previewPluginAclAccess,
  upsertPluginAclAdmin,
} from "./admin/plugin-acl-admin.js";

/** V1 / C3 — fabrique plugins conversationnelle. */
export type {
  ConversationalPluginFactory,
  ConversationalPluginFactoryAdapters,
  DraftPrdFromIntentionInput,
  FactoryMaterializeResult,
  FactoryPhase,
  FactoryScaffoldResult,
  FactorySessionSnapshot,
  FactoryWriteFilesResult,
  LlmPrdDrafterOptions,
  PrdDrafter,
} from "./factory/index.js";
export {
  buildPluginScaffoldFiles,
  createConversationalPluginFactory,
  createFsPluginScaffoldAdapters,
  createOptionalLlmPrdDrafter,
  defaultClarificationQuestions,
  derivePluginIdentity,
  deterministicPrdDrafter,
  draftPrdFromIntention,
  needsClarification,
  slugifyPluginId,
} from "./factory/index.js";

/**
 * Modules encore verticaux (apps marques) après P09 HTTP SoT.
 * Routes `/plugin-products` + n8n provisioning = kit (`createPluginProductsRoutes`).
 */
export const PRODUCT_HUB_VERTICAL_REMAINING = [
  "plugin-git",
  "plugin-data",
  "plugin-accept-check",
  "plugin-test-runner",
  "plugin-crm-key",
] as const;

/* ── N6 : plugin-ui helpers + brand tokens ── */
export {
  configureProductHubUiBrand,
  getProductHubUiBrand,
  resetProductHubUiBrandForTests,
  getDesktopApi,
  pluginSidebarItems,
  notifyPluginsChanged,
  resolvePluginPanelOpenTarget,
  isPluginPanelOpenTarget,
  openPluginPanelInWorkspace,
  isRemoteDesktopClient,
} from "./plugin-ui/index.js";

export type {
  ProductHubUiBrand,
  DesktopApiBridge,
  PluginPanelOpenTarget,
  PluginPanelOpenFail,
  PluginStatusSnapshot,
  PluginSidebarItem,
} from "./plugin-ui/index.js";
