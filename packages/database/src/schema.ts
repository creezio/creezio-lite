/**
 * Schéma SQL core — tables Admin Database / automations row-level.
 * Identique à la migration kit v33 (préfixe `db_*` conservé pour compat).
 */
export const DATABASE_CORE_SQL = `
CREATE TABLE IF NOT EXISTS db_automations (
  id            TEXT PRIMARY KEY,
  table_name    TEXT NOT NULL,
  name          TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  trigger_type  TEXT NOT NULL,
  watch_columns TEXT,
  conditions    TEXT NOT NULL DEFAULT '{"op":"and","rules":[]}',
  actions       TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_db_automations_table
  ON db_automations(table_name, enabled);

CREATE TABLE IF NOT EXISTS db_automation_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name    TEXT NOT NULL,
  row_rowid     INTEGER,
  op            TEXT NOT NULL,
  before_json   TEXT,
  after_json    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_db_automation_events_pending
  ON db_automation_events(status, id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS db_automation_runs (
  id            TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  event_id      INTEGER,
  status        TEXT NOT NULL,
  attempt       INTEGER NOT NULL DEFAULT 0,
  response_code INTEGER,
  error         TEXT,
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  next_retry_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_db_automation_runs_auto
  ON db_automation_runs(automation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_db_automation_runs_retry
  ON db_automation_runs(status, next_retry_at)
  WHERE status = 'retrying';

CREATE TABLE IF NOT EXISTS db_saved_views (
  id            TEXT PRIMARY KEY,
  table_name    TEXT NOT NULL,
  name          TEXT NOT NULL,
  config_json   TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_db_saved_views_table
  ON db_saved_views(table_name);

CREATE TABLE IF NOT EXISTS db_access_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor         TEXT NOT NULL,
  action        TEXT NOT NULL,
  table_name    TEXT,
  detail_json   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_db_access_log_created
  ON db_access_log(created_at DESC);
`;
