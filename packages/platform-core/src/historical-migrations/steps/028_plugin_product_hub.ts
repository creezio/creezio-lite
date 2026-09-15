import type { Migration } from "../types.js";

/**
 * Product Hub plugins — **LEGACY brand.db** (pré-R2).
 *
 * SoT runtime = `@creezio/product-hub` + `core.db` (`PRODUCT_HUB_CORE_SQL` +
 * `PRODUCT_HUB_RUNTIME_SQL`). Cette migration peut encore s'appliquer sur
 * brand.db pour compat historique ; Next n'y écrit plus `plugin_*`.
 */
const migration: Migration = {
  version: 28,
  name: "plugin-product-hub",
  up(db) {
    db.exec(`
CREATE TABLE IF NOT EXISTS plugin_products (
  id TEXT PRIMARY KEY,
  plugin_id TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  lifecycle_state TEXT NOT NULL DEFAULT 'request_received',
  conversation_id TEXT NOT NULL,
  decision TEXT CHECK (decision IN ('create','evolve')),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plugin_products_conversation ON plugin_products(conversation_id);
CREATE INDEX IF NOT EXISTS idx_plugin_products_plugin ON plugin_products(plugin_id);
CREATE INDEX IF NOT EXISTS idx_plugin_products_state ON plugin_products(lifecycle_state);

CREATE TABLE IF NOT EXISTS plugin_prd_revisions (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  problem TEXT NOT NULL DEFAULT '',
  users TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '',
  out_of_scope TEXT NOT NULL DEFAULT '',
  acceptance_criteria TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL,
  validated_by TEXT,
  validated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(plugin_product_id, version)
);
CREATE INDEX IF NOT EXISTS idx_plugin_prd_product ON plugin_prd_revisions(plugin_product_id, version DESC);

CREATE TABLE IF NOT EXISTS plugin_tasks (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'backlog',
  priority INTEGER NOT NULL DEFAULT 0,
  hermes_task_id TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  cancelled_at TEXT,
  archived_at TEXT,
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plugin_tasks_board ON plugin_tasks(plugin_product_id, status, position);
CREATE TABLE IF NOT EXISTS plugin_task_dependencies (
  task_id TEXT NOT NULL REFERENCES plugin_tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES plugin_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY(task_id, depends_on_task_id),
  CHECK(task_id <> depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS plugin_documents (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  filename TEXT NOT NULL, media_type TEXT NOT NULL, storage_path TEXT NOT NULL,
  sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0,
  context_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plugin_documents_product ON plugin_documents(plugin_product_id);

CREATE TABLE IF NOT EXISTS plugin_tickets (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open', priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS plugin_changelog_entries (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  version TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  git_sha TEXT, released_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS plugin_gate_runs (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  gate TEXT NOT NULL, status TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}',
  git_sha TEXT, started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT
);
CREATE TABLE IF NOT EXISTS plugin_impact_reports (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  recommendation TEXT NOT NULL, summary TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS plugin_test_definitions (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  name TEXT NOT NULL, relative_path TEXT NOT NULL, timeout_ms INTEGER NOT NULL DEFAULT 30000,
  enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS plugin_test_runs (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  definition_id TEXT REFERENCES plugin_test_definitions(id) ON DELETE SET NULL,
  status TEXT NOT NULL, git_sha TEXT, exit_code INTEGER,
  stdout TEXT NOT NULL DEFAULT '', stderr TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT
);
CREATE TABLE IF NOT EXISTS plugin_n8n_resources (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL, external_id TEXT NOT NULL, name TEXT NOT NULL,
  tag TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}',
  archived_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(plugin_product_id, resource_type, external_id)
);
CREATE TABLE IF NOT EXISTS plugin_execution_grants (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  prd_revision_id TEXT NOT NULL REFERENCES plugin_prd_revisions(id) ON DELETE CASCADE,
  token_hash TEXT, issued_to TEXT NOT NULL, expires_at TEXT NOT NULL,
  used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plugin_grants_product ON plugin_execution_grants(plugin_product_id, expires_at);
`);
  },
};

export default migration;
