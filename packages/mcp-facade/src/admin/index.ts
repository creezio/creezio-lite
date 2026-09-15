/**
 * MCP admin — policies, clients OAuth, diagnostics, routes Hono (N6).
 */

export type {
  McpAdminAdapters,
  McpAdminSqliteDatabase,
  McpAdminSqliteStatement,
  McpRequestLogEntry,
  McpToolDefinition,
} from "./types.js";

export {
  configureMcpAdmin,
  getMcpAdminAdapters,
  isMcpAdminConfigured,
  resetMcpAdminAdaptersForTests,
} from "./adapters.js";

export type {
  McpToolPolicy,
  McpAdminClient,
} from "./mcp-admin.js";

export {
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
} from "./mcp-admin.js";

export type { CreateMcpAdminRoutesOptions } from "./http-routes.js";
export { createMcpAdminRoutes } from "./http-routes.js";

/* ── M1 : garde d'enforcement réutilisable des policies ── */

export type {
  CreateToolPolicyAuthorizeOptions,
  GuardedMcpServerLike,
  GuardedMcpToolContext,
  GuardedMcpToolDefinition,
  RegisterGuardedMcpToolOptions,
  ToolPolicyActor,
  ToolPolicyDenialReason,
  ToolPolicyGuardOptions,
  ToolPolicyView,
} from "./tool-policy-guard.js";
export {
  checkToolPolicy,
  createToolPolicyAuthorize,
  getStoredMcpToolPolicy,
  registerGuardedMcpTool,
} from "./tool-policy-guard.js";
