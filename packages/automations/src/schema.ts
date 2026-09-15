/**
 * Schema SQLite core — rules + runs automations (C4).
 */

export const AUTOMATIONS_CORE_SQL = `
CREATE TABLE IF NOT EXISTS creezio_automation_rules (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  trigger TEXT NOT NULL,
  filter_json TEXT NOT NULL DEFAULT '{}',
  actions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creezio_automation_runs (
  id TEXT PRIMARY KEY NOT NULL,
  rule_id TEXT NOT NULL,
  trigger TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  actions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_creezio_automation_runs_at
  ON creezio_automation_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creezio_automation_rules_trigger
  ON creezio_automation_rules(trigger);
`;
