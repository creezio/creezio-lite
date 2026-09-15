import type { Migration } from "../types.js";
import { tableExists } from "../types.js";

/**
 * Kanban unifié « Tâches » : une seule table `tasks` avec un exécutant par
 * tâche (`human` | `ai` | `hermes`).
 *
 * - Absorbe `cabinet_tasks` (collab humains/IA — executor déduit de users.kind)
 *   et `agent_todos` (missions Hermes — executor 'hermes', lien hermes_task_id).
 * - Statuts unifiés : backlog / in_progress / blocked / done / cancelled.
 *   Mapping Hermes : triage|todo|scheduled → backlog · ready|running →
 *   in_progress · blocked|review → blocked · done → done · archived → cancelled.
 *   Le statut Hermes brut est conservé dans `hermes_status`.
 * - `parent_task_id` : sous-tâches (délégation collab IA → Hermes).
 * - Supprime les colonnes métier feature-off (entreprise_id / dossier_id /
 *   restaurant_id) et retire `nav.todos` des permissions collaborateurs
 *   (l'onglet /todos disparaît au profit de /taches).
 */

const HERMES_STATUS_MAP: Record<string, string> = {
  triage: "backlog",
  todo: "backlog",
  scheduled: "backlog",
  ready: "in_progress",
  running: "in_progress",
  blocked: "blocked",
  review: "blocked",
  done: "done",
  archived: "cancelled",
};

const migration: Migration = {
  version: 29,
  name: "unified-tasks",
  up(db) {
    if (tableExists(db, "tasks")) return;

    db.exec(`
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'backlog'
    CHECK (status IN ('backlog','in_progress','blocked','done','cancelled')),
  position REAL NOT NULL DEFAULT 0,
  executor_kind TEXT NOT NULL DEFAULT 'human'
    CHECK (executor_kind IN ('human','ai','hermes')),
  assignee_user_id TEXT,
  parent_task_id TEXT,
  created_by TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  hermes_task_id TEXT UNIQUE,
  hermes_cron_id TEXT,
  hermes_status TEXT,
  recurring_schedule TEXT,
  source TEXT NOT NULL DEFAULT 'ui'
    CHECK (source IN ('assistant','ui','sync','hermes')),
  conversation_id TEXT,
  idempotency_key TEXT UNIQUE,
  result TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_user_id);
CREATE INDEX idx_tasks_position ON tasks(status, position);
CREATE INDEX idx_tasks_executor ON tasks(executor_kind);
CREATE INDEX idx_tasks_hermes ON tasks(hermes_task_id);
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);`);

    // 1) Reprise cabinet_tasks → tasks (executor déduit du kind de l'assigné).
    if (tableExists(db, "cabinet_tasks")) {
      db.exec(`
INSERT INTO tasks (
  id, title, body, status, position, executor_kind, assignee_user_id,
  created_by, priority, source, created_at, updated_at
)
SELECT
  ct.id, ct.title, ct.body, ct.status, ct.position,
  CASE WHEN u.kind = 'ai' THEN 'ai' ELSE 'human' END,
  ct.assignee_user_id, ct.created_by, ct.priority, 'ui',
  ct.created_at, ct.updated_at
FROM cabinet_tasks ct
LEFT JOIN users u ON u.id = ct.assignee_user_id;`);
      db.exec("DROP TABLE cabinet_tasks;");
    }

    // 2) Reprise agent_todos → tasks executor 'hermes' (statut mappé,
    //    statut Hermes brut conservé dans hermes_status).
    if (tableExists(db, "agent_todos")) {
      const todos = db
        .prepare(
          `SELECT id, hermes_task_id, hermes_cron_id, title, body, status,
                  priority, recurring_schedule, source, conversation_id,
                  idempotency_key, result, last_synced_at, created_at, updated_at
           FROM agent_todos`,
        )
        .all() as Array<Record<string, unknown>>;
      const insert = db.prepare(
        `INSERT OR IGNORE INTO tasks (
           id, title, body, status, position, executor_kind, assignee_user_id,
           created_by, priority, hermes_task_id, hermes_cron_id, hermes_status,
           recurring_schedule, source, conversation_id, idempotency_key,
           result, last_synced_at, created_at, updated_at
         ) VALUES (
           @id, @title, @body, @status, @position, 'hermes', NULL,
           NULL, @priority, @hermes_task_id, @hermes_cron_id, @hermes_status,
           @recurring_schedule, @source, @conversation_id, @idempotency_key,
           @result, @last_synced_at, @created_at, @updated_at
         )`,
      );
      let position = 0;
      for (const t of todos) {
        const raw = String(t.status || "todo");
        insert.run({
          id: String(t.id),
          title: String(t.title || ""),
          body: String(t.body || ""),
          status: HERMES_STATUS_MAP[raw] || "backlog",
          position: (position += 1),
          priority: Number(t.priority) || 0,
          hermes_task_id: t.hermes_task_id != null ? String(t.hermes_task_id) : null,
          hermes_cron_id: t.hermes_cron_id != null ? String(t.hermes_cron_id) : null,
          hermes_status: raw,
          recurring_schedule:
            t.recurring_schedule != null ? String(t.recurring_schedule) : null,
          source: ["assistant", "ui", "sync", "hermes"].includes(String(t.source))
            ? String(t.source)
            : "ui",
          conversation_id:
            t.conversation_id != null ? String(t.conversation_id) : null,
          idempotency_key:
            t.idempotency_key != null ? String(t.idempotency_key) : null,
          result: t.result != null ? String(t.result) : null,
          last_synced_at:
            t.last_synced_at != null ? String(t.last_synced_at) : null,
          created_at: String(t.created_at || new Date().toISOString()),
          updated_at: String(t.updated_at || new Date().toISOString()),
        });
      }
      db.exec("DROP TABLE agent_todos;");
    }

    // 3) nav.todos n'existe plus — purge des permissions stockées.
    if (tableExists(db, "users")) {
      const users = db
        .prepare("SELECT id, permissions_json FROM users")
        .all() as Array<{ id: string; permissions_json: string }>;
      const update = db.prepare(
        "UPDATE users SET permissions_json = ?, updated_at = datetime('now') WHERE id = ?",
      );
      for (const u of users) {
        let perms: unknown;
        try {
          perms = JSON.parse(u.permissions_json || "[]");
        } catch {
          continue;
        }
        if (!Array.isArray(perms) || !perms.includes("nav.todos")) continue;
        const next = perms.filter((p) => p !== "nav.todos");
        if (!next.includes("nav.taches")) next.push("nav.taches");
        update.run(JSON.stringify(next), u.id);
      }
    }
  },
};
export default migration;
