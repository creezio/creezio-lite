/**
 * Types admin MCP (port kit — N6).
 * Le registre métier des tools reste injecté par la marque.
 */

export type McpToolDefinition = {
  name: string;
  category: string;
  access: "read" | "write";
  requiredScope: string;
  defaultRoles?: string[];
  annotations?: Record<string, boolean>;
  description?: string;
  /** Absent = seed enabled (historique). false = désactivé jusqu'à /admin/mcp. */
  mcpPublishDefault?: boolean;
};

export type McpAdminSqliteStatement = {
  run(...params: unknown[]): { changes: number; lastInsertRowid?: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};

export type McpAdminSqliteDatabase = {
  exec(sql: string): unknown;
  prepare(sql: string): McpAdminSqliteStatement;
  transaction?: <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) => (...args: TArgs) => TResult;
};

export type McpRequestLogEntry = {
  status: number;
  durationMs: number;
  detail: Record<string, unknown>;
};

export type McpAdminAdapters = {
  getDb: () => McpAdminSqliteDatabase;
  getWriteDb: () => McpAdminSqliteDatabase;
  tableExists: (name: string) => boolean;
  /** Registre tools métier (seed policies). */
  listTools: () => McpToolDefinition[];
  mcpOauthReady: () => boolean;
  resolveMcpPublicUrl: () => string | null;
  /** Logs process MCP pour métriques (optionnel → métriques vides). */
  listRequestLogs?: (opts: {
    source: string;
    limit: number;
  }) => { logs: McpRequestLogEntry[] };
  /** Filename export diagnostic (défaut creezio). */
  diagnosticFilenamePrefix?: string;
  /**
   * Rôles acceptés dans `updateMcpToolPolicy` / seed des policies
   * (défaut ["owner","collaborator"] — comportement historique).
   */
  policyRoleNames?: string[];
  /**
   * Scopes acceptés dans `updateMcpToolPolicy`
   * (défaut ["crm","crm:read","crm:write","full"] — comportement historique).
   */
  policyScopeNames?: string[];
};
