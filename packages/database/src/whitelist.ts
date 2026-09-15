/**
 * Policy écriture / automation Admin Database.
 * Fail-closed : aucune table métier CRUD-able sans `configureDatabasePolicy`.
 * Les allowlists métier vivent dans chaque marque (jamais dans ce kit).
 */

/** Tables jamais automatisables / jamais éditables via le module Database. */
export const DEFAULT_FORBIDDEN_WRITE_TABLES = [
  "users",
  "api_keys",
  "meta",
  "mcp_clients",
  "mcp_tokens",
  "mcp_tool_policies",
  "mcp_audit_logs",
  "plugin_acl",
  "db_automations",
  "db_automation_events",
  "db_automation_runs",
  "db_saved_views",
  "db_access_log",
] as const;

/** Défaut vide = fail-closed (CRUD métier impossible sans configureDatabasePolicy). */
let crudWhitelist = new Set<string>();
let forbiddenWriteTables = new Set<string>(DEFAULT_FORBIDDEN_WRITE_TABLES);

/**
 * Configure la policy CRUD / écriture.
 * Sans `crudAllowlist`, aucune table métier n’est CRUD-able.
 */
export function configureDatabasePolicy(opts: {
  crudAllowlist?: Iterable<string>;
  forbiddenWriteTables?: Iterable<string>;
}): void {
  if (opts.crudAllowlist) {
    crudWhitelist = new Set(opts.crudAllowlist);
  }
  if (opts.forbiddenWriteTables) {
    forbiddenWriteTables = new Set(opts.forbiddenWriteTables);
  }
}

/** Snapshot runtime de l’allowlist CRUD (vide tant que la marque n’a pas configuré). */
export function getCrudAllowlist(): ReadonlySet<string> {
  return crudWhitelist;
}

/** Snapshot runtime des tables interdites en écriture. */
export function getForbiddenWriteTables(): ReadonlySet<string> {
  return forbiddenWriteTables;
}

/** @deprecated préférer getCrudAllowlist() — snapshot mutable, ne pas muter. */
export const CRUD_WHITELIST = crudWhitelist;

/** @deprecated préférer getForbiddenWriteTables() / DEFAULT_FORBIDDEN_WRITE_TABLES. */
export const FORBIDDEN_WRITE_TABLES = forbiddenWriteTables;

export function canCrudTable(table: string): boolean {
  return crudWhitelist.has(table) && !forbiddenWriteTables.has(table);
}

export function canAutomateTable(table: string): boolean {
  if (!table || table.startsWith("sqlite_")) return false;
  if (forbiddenWriteTables.has(table)) return false;
  if (
    table.startsWith("db_automation") ||
    table === "db_saved_views" ||
    table === "db_access_log"
  ) {
    return false;
  }
  return true;
}
