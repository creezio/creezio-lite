/**
 * @creezio/mcp-facade — MCP d'app unique (H1.2 / discovery H2.3 / proxy H4 / M9).
 */

export type {
  DiscoverToolsBySpaceFn,
  DiscoverToolsFn,
  McpAuthResult,
  McpAuthorizeContext,
  McpAuthorizeToolCallFn,
  McpBearerActor,
  McpCallToolOpts,
  McpFacadeOptions,
  McpListToolsResult,
  McpPublicSurfaceMode,
  McpRegisteredTool,
  McpResolveBearerActorFn,
  McpToolCallActor,
  McpToolCallResult,
  McpToolDefinition,
  McpToolHandler,
  McpToolPolicyDecision,
  McpToolsBySpace,
  McpToolSpace,
} from "./types.js";

export type { McpFacade } from "./facade.js";
export { createMcpFacade } from "./facade.js";
export { signMcpJwt, verifyMcpBearer } from "./jwt.js";
export {
  assertNamespacedToolName,
  isLegacyAliasName,
  parseNamespacedToolName,
} from "./namespace.js";
export type { ParsedToolName } from "./namespace.js";
export type {
  DecidePluginAccessFn,
  PluginAclActorResolver,
  PluginAclPolicyResolver,
} from "./policy.js";
export {
  composeToolPolicies,
  createDenyUnauthorizedPluginToolPolicy,
  denyCrossLayerToolCall,
} from "./policy.js";

export type {
  CreezioCoreMcpToolName,
  CreateCoreMcpToolsOptions,
} from "./core-tools.js";
export {
  CREEZIO_CORE_MCP_TOOL_NAMES,
  createCoreMcpTools,
} from "./core-tools.js";

export type {
  McpFacadeMode,
  McpFacadeRole,
  McpProductExecutor,
  McpUpstreamRef,
} from "./runtime.js";
export {
  MCP_PRODUCT_EXECUTOR,
  resolveMcpFacadeRole,
} from "./runtime.js";

export type { WrapMcpFacadeWithHonoProxyOptions } from "./hono-proxy.js";
export {
  __mcpHonoProxyTest,
  wrapMcpFacadeWithHonoProxy,
} from "./hono-proxy.js";

/* ── O4r3 : Hono /mcp ← façade marque (même SoT) ── */

export type {
  BindFacadeToolsToHonoOptions,
  HonoMcpSdkResult,
  HonoMcpToolRegisterFn,
} from "./hono-bind.js";
export {
  bindFacadeToolsToHono,
  mcpFacadeResultToSdk,
} from "./hono-bind.js";

/* ── D-P18 : brand factory + OAuth/transport SoT ── */

export type { CreateBrandMcpFacadeOptions } from "./brand-facade.js";
export { createBrandMcpFacade } from "./brand-facade.js";

export type {
  BrandModuleOpsSource,
  GenerateModuleToolsInvoke,
  GenerateModuleToolsOptions,
} from "./module-ops-tools.js";
export {
  discoverModuleToolsFromBrandModules,
  discoverModuleToolsFromKernel,
  generateModuleToolsFromListedOps,
  generateModuleToolsFromMountedOps,
  generateModuleToolsFromOperations,
} from "./module-ops-tools.js";

export type {
  CreateMcpHonoAppOptions,
  McpApiKeyRecord,
  McpConnectedServer,
  McpOAuthAdapters,
  McpOAuthRoutesConfig,
  McpOAuthSession,
  McpOAuthSessionBridge,
  McpOAuthSessionUser,
  McpOAuthSqliteDatabase,
  McpServerAuthContext,
  McpStreamableTransport,
  ConsumedCode,
  CreateCodeInput,
  McpAccessToken,
  McpOAuthClient,
  RegisterClientInput,
  RotatedRefresh,
  McpRateLimitResult,
} from "./oauth/index.js";

export {
  ACCESS_TOKEN_TTL_S,
  REFRESH_TOKEN_TTL_S,
  MCP_SCOPE,
  MCP_SCOPE_LEGACY,
  MCP_SCOPE_READ,
  MCP_SCOPE_WRITE,
  MCP_SCOPES,
  McpPublicUrlRequiredError,
  canonicalizeMcpUrl,
  checkMcpRateLimit,
  configureMcpOAuth,
  consumeAuthCode,
  createAuthCode,
  createMcpHonoApp,
  createMcpOAuthRoutes,
  createRefreshToken,
  getClient,
  getMcpOAuthAdapters,
  isMcpPublicUrlRequiredError,
  mcpBaseUrl,
  mcpCorsAllowlist,
  mcpOauthReady,
  mcpResourceUrl,
  normalizeMcpScopes,
  peekAuthCode,
  pruneExpiredCodes,
  rateLimitHeaders,
  registerClient,
  resetMcpOAuthAdaptersForTests,
  resetMcpRateLimits,
  resolveMcpCorsOrigin,
  resolveMcpPublicUrl,
  resourceAcceptable,
  rotateRefreshToken,
  signAccessToken,
  touchOAuthClientLastUsed,
  verifyAccessToken,
  verifyClientSecret,
  verifyPkceS256,
} from "./oauth/index.js";

/** Host-only tools typiques (hors factory marque) — desktop / introspection. */
export const CREEZIO_PLATFORM_HOST_MCP_TOOL_NAMES = [
  "open_external_tab",
  "list_tools_by_space",
] as const;

/* ── D-P18 : open_external_tab host tool SoT ── */

export type {
  CreateOpenExternalTabHostMcpToolsOptions,
  OpenExternalTabHostMcpRegisterFn,
  OpenExternalTabHostMcpToolConfig,
  OpenExternalTabResolveResult,
  OpenExternalTabResolved,
  OpenExternalTabUser,
} from "./open-external-tab-host-tools.js";
export {
  CREEZIO_OPEN_EXTERNAL_TAB_MCP_TOOL_NAME,
  createOpenExternalTabHostMcpTools,
} from "./open-external-tab-host-tools.js";

/* ── N6 : MCP admin (port kit) ── */

export {
  configureMcpAdmin,
  getMcpAdminAdapters,
  isMcpAdminConfigured,
  resetMcpAdminAdaptersForTests,
  ensureMcpAdminSchema,
  seedMcpToolPolicies,
  listMcpToolPolicies,
  getMcpToolPolicy,
  disabledMcpToolPolicyNames,
  filterListedToolsByEnabledPolicy,
  updateMcpToolPolicy,
  listMcpClients,
  setMcpClientEnabled,
  revokeMcpClient,
  rotateMcpClientSecret,
  clientCanAuthenticate,
  touchMcpClient,
  mcpAdminStatus,
  mcpDiagnostics,
  mcpMetrics,
  auditMcpAdmin,
  listMcpAuditLogs,
  pruneMcpAuditLogs,
  exportMcpDiagnostics,
  createMcpAdminRoutes,
  checkToolPolicy,
  createToolPolicyAuthorize,
  getStoredMcpToolPolicy,
  registerGuardedMcpTool,
} from "./admin/index.js";

export type {
  McpAdminAdapters,
  McpAdminSqliteDatabase,
  McpAdminSqliteStatement,
  McpRequestLogEntry,
  McpToolDefinition as McpAdminToolDefinition,
  McpToolPolicy,
  McpAdminClient,
  CreateMcpAdminRoutesOptions,
  CreateToolPolicyAuthorizeOptions,
  GuardedMcpServerLike,
  GuardedMcpToolContext,
  GuardedMcpToolDefinition,
  RegisterGuardedMcpToolOptions,
  ToolPolicyActor,
  ToolPolicyDenialReason,
  ToolPolicyGuardOptions,
  ToolPolicyView,
} from "./admin/index.js";
