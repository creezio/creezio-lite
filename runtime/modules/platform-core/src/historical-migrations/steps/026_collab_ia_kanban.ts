import type { Migration } from "../types.js";

/** Kanban collaboratif distinct des agent_todos Hermes. Les références métier
 * sont volontairement nullables : références métier marque optionnelles (GED). */
const migration: Migration = {
  version: 26,
  name: "collab-ia-kanban",
  up(db) {
    db.exec(`
CREATE TABLE IF NOT EXISTS cabinet_tasks (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog','in_progress','done','cancelled')),
 position REAL NOT NULL DEFAULT 0, assignee_user_id TEXT,
 entreprise_id TEXT, dossier_id TEXT, restaurant_id TEXT, created_by TEXT,
 priority INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cabinet_tasks_status ON cabinet_tasks(status);
CREATE INDEX IF NOT EXISTS idx_cabinet_tasks_assignee ON cabinet_tasks(assignee_user_id);
CREATE INDEX IF NOT EXISTS idx_cabinet_tasks_position ON cabinet_tasks(status, position);
CREATE TABLE IF NOT EXISTS task_runs (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL, assignee_user_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
 host_device_id TEXT, started_at TEXT, finished_at TEXT, last_error TEXT,
 step_count INTEGER NOT NULL DEFAULT 0, hitl_prompt TEXT, hitl_response TEXT, retry_of TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);
CREATE INDEX IF NOT EXISTS idx_task_runs_assignee ON task_runs(assignee_user_id);
CREATE TABLE IF NOT EXISTS agent_session_logs (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, seq INTEGER NOT NULL,
 level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('debug','info','warn','error','tool','decision','nav')),
 event_type TEXT NOT NULL, message TEXT NOT NULL, payload_json TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(run_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_agent_session_logs_run ON agent_session_logs(run_id, seq);`);
  },
};
export default migration;
