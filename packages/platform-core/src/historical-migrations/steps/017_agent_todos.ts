/**
 * Step 017 — todos agent synchronisés avec Hermes Kanban.
 * Porté depuis scripts/migrate_v17_agent_todos.py.
 */

import type { Migration } from "../types.js";

const DDL = `
CREATE TABLE IF NOT EXISTS agent_todos (
  id TEXT PRIMARY KEY,
  hermes_task_id TEXT UNIQUE,
  hermes_cron_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN (
      'triage','todo','scheduled','ready','running','blocked','review','done','archived'
    )),
  priority INTEGER NOT NULL DEFAULT 0,
  recurring_schedule TEXT,
  source TEXT NOT NULL DEFAULT 'assistant'
    CHECK (source IN ('assistant','ui','sync','hermes')),
  conversation_id TEXT,
  restaurant_id INTEGER,
  idempotency_key TEXT UNIQUE,
  result TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_todos_status ON agent_todos(status);
CREATE INDEX IF NOT EXISTS idx_agent_todos_hermes ON agent_todos(hermes_task_id);
CREATE INDEX IF NOT EXISTS idx_agent_todos_updated ON agent_todos(updated_at DESC);
`;

const migration: Migration = {
  version: 17,
  name: "agent-todos",
  up(db) {
    db.exec(DDL);
  },
};

export default migration;
