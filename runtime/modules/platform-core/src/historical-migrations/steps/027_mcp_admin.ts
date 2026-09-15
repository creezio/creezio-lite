import type { Migration } from "../types.js";

function columns(db: Parameters<Migration["up"]>[0], table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
}

const migration: Migration = {
  version: 27,
  name: "mcp-admin",
  up(db) {
    const clientColumns = columns(db, "mcp_oauth_clients");
    if (!clientColumns.has("enabled")) {
      db.exec(`ALTER TABLE mcp_oauth_clients ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`);
    }
    if (!clientColumns.has("revoked_at")) {
      db.exec(`ALTER TABLE mcp_oauth_clients ADD COLUMN revoked_at TEXT`);
    }
    if (!clientColumns.has("last_used_at")) {
      db.exec(`ALTER TABLE mcp_oauth_clients ADD COLUMN last_used_at TEXT`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_tool_policies (
        tool_name TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        allowed_roles TEXT NOT NULL DEFAULT 'owner,collaborator',
        allowed_scopes TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS mcp_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        event TEXT NOT NULL,
        actor TEXT,
        client_id TEXT,
        tool_name TEXT,
        outcome TEXT NOT NULL DEFAULT 'ok',
        detail_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_audit_created
        ON mcp_audit_logs(created_at);
    `);
  },
};

export default migration;
