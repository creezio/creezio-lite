/**
 * Store plateforme (core.db) pour la surface serveur :
 * - schéma kanban unifié `tasks` / `task_runs` / `agent_session_logs`
 *   (parité migrations kit 029/026/031, idempotent) ;
 * - utilisateurs plateforme `creezio_platform_users` (collaborateurs
 *   human/ai) + projection owner depuis `creezio_users` (@creezio/auth) ;
 * - adapter DB `TasksDbAdapter` pour le runtime @creezio/tasks.
 */

import { randomUUID } from "node:crypto";
import { openNodeSqliteDatabase, type SqliteDatabase } from "@creezio/auth";
import type {
  TasksDbAdapter,
  TasksUser,
  TasksUsersAdapter,
} from "@creezio/tasks";

/** Kanban unifié plateforme — même contrat colonnes que kit (029+026+031). */
export const PLATFORM_KANBAN_CORE_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
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
  next_run_at TEXT,
  source TEXT NOT NULL DEFAULT 'ui'
    CHECK (source IN ('assistant','ui','sync','hermes')),
  conversation_id TEXT,
  idempotency_key TEXT UNIQUE,
  result TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_position ON tasks(status, position);
CREATE INDEX IF NOT EXISTS idx_tasks_executor ON tasks(executor_kind);
CREATE INDEX IF NOT EXISTS idx_tasks_hermes ON tasks(hermes_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_next_run
  ON tasks(next_run_at) WHERE next_run_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, assignee_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  host_device_id TEXT, started_at TEXT, finished_at TEXT, last_error TEXT,
  step_count INTEGER NOT NULL DEFAULT 0, hitl_prompt TEXT, hitl_response TEXT,
  retry_of TEXT, usage_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);
CREATE INDEX IF NOT EXISTS idx_task_runs_assignee ON task_runs(assignee_user_id);

CREATE TABLE IF NOT EXISTS agent_session_logs (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, seq INTEGER NOT NULL,
  level TEXT NOT NULL DEFAULT 'info'
    CHECK (level IN ('debug','info','warn','error','tool','decision','nav')),
  event_type TEXT NOT NULL, message TEXT NOT NULL, payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(run_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_agent_session_logs_run
  ON agent_session_logs(run_id, seq);
`;

/** Collaborateurs plateforme (human/ai) — l'owner reste dans creezio_users. */
export const PLATFORM_USERS_CORE_SQL = `
CREATE TABLE IF NOT EXISTS creezio_platform_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'collaborator' CHECK (role IN ('owner','collaborator')),
  kind TEXT NOT NULL DEFAULT 'human' CHECK (kind IN ('human','ai')),
  active INTEGER NOT NULL DEFAULT 1,
  permissions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export type BrandPlatformStore = {
  db: SqliteDatabase;
  dbAdapter: TasksDbAdapter;
  usersAdapter: TasksUsersAdapter;
  getOwner: () => TasksUser | null;
  getUserById: (id: string) => TasksUser | null;
  listUsers: () => TasksUser[];
  createCollaborator: (opts: {
    username: string;
    kind?: "human" | "ai";
    permissions?: string[];
  }) => TasksUser;
  updateCollaborator: (
    id: string,
    patch: {
      username?: string;
      kind?: "human" | "ai";
      permissions?: string[];
      active?: boolean;
    },
  ) => TasksUser;
  setCollaboratorActive: (id: string, active: boolean) => boolean;
  close: () => void;
};

function parsePermissions(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function openBrandPlatformStore(opts: {
  coreDbPath: string;
  ownerPermissions?: readonly string[];
}): BrandPlatformStore {
  const db = openNodeSqliteDatabase(opts.coreDbPath);
  db.exec(PLATFORM_KANBAN_CORE_SQL);
  db.exec(PLATFORM_USERS_CORE_SQL);

  const ownerPermissions = [...(opts.ownerPermissions || [])];

  function ownerRow(): { id: string; email: string } | null {
    try {
      const row = db
        .prepare(
          `SELECT id, email FROM creezio_users ORDER BY created_at ASC LIMIT 1`,
        )
        .get() as { id?: string; email?: string } | undefined;
      if (!row?.id) return null;
      return { id: String(row.id), email: String(row.email || "") };
    } catch {
      return null;
    }
  }

  function getOwner(): TasksUser | null {
    const row = ownerRow();
    if (!row) return null;
    return {
      id: row.id,
      username: row.email,
      role: "owner",
      kind: "human",
      active: true,
      permissions: ownerPermissions,
    };
  }

  function collaboratorById(id: string): TasksUser | null {
    const row = db
      .prepare(`SELECT * FROM creezio_platform_users WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      username: String(row.username),
      role: row.role === "owner" ? "owner" : "collaborator",
      kind: row.kind === "ai" ? "ai" : "human",
      active: Number(row.active) === 1,
      permissions: parsePermissions(row.permissions),
    };
  }

  function getUserById(id: string): TasksUser | null {
    const owner = getOwner();
    if (owner && owner.id === id) return owner;
    return collaboratorById(id);
  }

  function listUsers(): TasksUser[] {
    const out: TasksUser[] = [];
    const owner = getOwner();
    if (owner) out.push(owner);
    const rows = db
      .prepare(`SELECT id FROM creezio_platform_users ORDER BY created_at ASC`)
      .all() as Array<{ id: string }>;
    for (const r of rows) {
      const u = collaboratorById(String(r.id));
      if (u) out.push(u);
    }
    return out;
  }

  function createCollaborator(input: {
    username: string;
    kind?: "human" | "ai";
    permissions?: string[];
  }): TasksUser {
    const username = String(input.username || "").trim();
    if (!username) throw new Error("username requis");
    const kind = input.kind === "ai" ? "ai" : "human";
    const id = `${kind}-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO creezio_platform_users (id, username, role, kind, active, permissions)
       VALUES (?, ?, 'collaborator', ?, 1, ?)`,
    ).run(id, username, kind, JSON.stringify(input.permissions || []));
    const user = collaboratorById(id);
    if (!user) throw new Error("création collaborateur échouée");
    return user;
  }

  function updateCollaborator(
    id: string,
    patch: {
      username?: string;
      kind?: "human" | "ai";
      permissions?: string[];
      active?: boolean;
    },
  ): TasksUser {
    const current = collaboratorById(id);
    if (!current || current.role === "owner") {
      throw new Error("Collaborateur introuvable");
    }
    const username = (patch.username ?? current.username).trim();
    if (!username) throw new Error("username requis");
    db.prepare(
      `UPDATE creezio_platform_users
       SET username = ?, kind = ?, permissions = ?, active = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      username,
      patch.kind === "ai" || (patch.kind === undefined && current.kind === "ai")
        ? "ai"
        : "human",
      JSON.stringify(patch.permissions ?? current.permissions),
      (patch.active ?? current.active) ? 1 : 0,
      id,
    );
    const user = collaboratorById(id);
    if (!user) throw new Error("mise à jour collaborateur échouée");
    return user;
  }

  function setCollaboratorActive(id: string, active: boolean): boolean {
    const res = db
      .prepare(
        `UPDATE creezio_platform_users
         SET active = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(active ? 1 : 0, id) as { changes?: number };
    return Number(res?.changes || 0) > 0;
  }

  const dbAdapter: TasksDbAdapter = {
    getWriteDb: () => ({
      prepare: (sql: string) => {
        const stmt = db.prepare(sql);
        return {
          run: (...args: unknown[]) => {
            const r = stmt.run(...args) as { changes?: number };
            return { changes: Number(r?.changes || 0) };
          },
          get: (...args: unknown[]) => stmt.get(...args),
          all: (...args: unknown[]) => stmt.all(...args),
        };
      },
    }),
    queryAll: <T>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(...params) as T[],
    queryOne: <T>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).get(...params) as T | null | undefined,
    tableExists: (name: string) => {
      const row = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
        )
        .get(name);
      return Boolean(row);
    },
  };

  const usersAdapter: TasksUsersAdapter = {
    getById: getUserById,
    list: listUsers,
    getOwner,
    ready: () => true,
  };

  return {
    db,
    dbAdapter,
    usersAdapter,
    getOwner,
    getUserById,
    listUsers,
    createCollaborator,
    updateCollaborator,
    setCollaboratorActive,
    close: () => db.close?.(),
  };
}
