/**
 * DDL SQL Product Hub — à exécuter par les migrations verticales des apps.
 * Le kit n'embarque pas better-sqlite3 ; il expose le contrat SQL.
 */

/** Tables Product Hub de base (migration 028 TF2/Certivan). */
export const PRODUCT_HUB_CORE_SQL = `
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
  sections_json TEXT NOT NULL DEFAULT '{}',
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

CREATE TABLE IF NOT EXISTS plugin_impact_reports (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  recommendation TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plugin_n8n_resources (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  tag TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(plugin_product_id, resource_type, external_id)
);

CREATE TABLE IF NOT EXISTS plugin_execution_grants (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  prd_revision_id TEXT NOT NULL REFERENCES plugin_prd_revisions(id) ON DELETE CASCADE,
  token_hash TEXT,
  issued_to TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plugin_grants_product ON plugin_execution_grants(plugin_product_id, expires_at);

CREATE TABLE IF NOT EXISTS plugin_clarifications (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  questions_json TEXT NOT NULL DEFAULT '[]',
  answers_json TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_plugin_clarifications_product
  ON plugin_clarifications(plugin_product_id, status, round);
`;

/** ACL L4 (user) — migration 032 TF2/Certivan. */
export const PRODUCT_HUB_ACL_USER_SQL = `
CREATE TABLE IF NOT EXISTS plugin_acl (
  plugin_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (plugin_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_plugin_acl_user ON plugin_acl(user_id);
`;

/** ACL L3 (org) — contrat kit (apps adoptent en Phase G). */
export const PRODUCT_HUB_ACL_ORG_SQL = `
CREATE TABLE IF NOT EXISTS plugin_acl_org (
  plugin_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (plugin_id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_plugin_acl_org ON plugin_acl_org(org_id);
`;

/**
 * H5 — binding org propriétaire + capacités granulaires see/install/execute.
 * Membership reste dans plugin_acl / plugin_acl_org ; les caps explicites
 * vivent ici (absent ⇒ défaut see+execute pour sujets listés).
 */
export const PRODUCT_HUB_ACL_H5_SQL = `
CREATE TABLE IF NOT EXISTS plugin_org_binding (
  plugin_id TEXT PRIMARY KEY,
  owner_org_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plugin_org_binding_org ON plugin_org_binding(owner_org_id);

CREATE TABLE IF NOT EXISTS plugin_acl_capability (
  plugin_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('org','user')),
  subject_id TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (capability IN ('see','install','execute')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (plugin_id, subject_kind, subject_id, capability)
);
CREATE INDEX IF NOT EXISTS idx_plugin_acl_capability_subject
  ON plugin_acl_capability(subject_kind, subject_id);
`;

/**
 * Tables runtime Product Hub (extraites migration TF 028) — documents, tests,
 * changelog, gates. SoT = core.db (Phase R2) ; pas de split-brain brand.db.
 */
export const PRODUCT_HUB_RUNTIME_SQL = `
CREATE TABLE IF NOT EXISTS plugin_task_dependencies (
  task_id TEXT NOT NULL REFERENCES plugin_tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES plugin_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY(task_id, depends_on_task_id),
  CHECK(task_id <> depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS plugin_documents (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  context_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plugin_documents_product ON plugin_documents(plugin_product_id);

CREATE TABLE IF NOT EXISTS plugin_tickets (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plugin_changelog_entries (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  git_sha TEXT,
  released_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plugin_gate_runs (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  gate TEXT NOT NULL,
  status TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  git_sha TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS plugin_test_definitions (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plugin_test_runs (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  definition_id TEXT REFERENCES plugin_test_definitions(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  git_sha TEXT,
  exit_code INTEGER,
  stdout TEXT NOT NULL DEFAULT '',
  stderr TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
`;

export const PRODUCT_HUB_MANAGED_MARKER = ".product-hub-managed";
