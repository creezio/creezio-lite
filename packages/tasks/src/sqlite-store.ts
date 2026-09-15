/**
 * Store tasks plateforme — sqlite **core** (Phase I3).
 */

import crypto from "node:crypto";
import { PLATFORM_TASKS_CORE_SQL, type PlatformTask, type PlatformTasksStore } from "./types.js";
import {
  openNodeSqliteDatabase,
  type OpenSqliteDatabase,
  type SqliteDatabase,
} from "./sqlite-driver.js";

function now(): string {
  return new Date().toISOString();
}

type Row = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
  updated_at: string;
};

function fromRow(r: Row): PlatformTask {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    body: r.body,
    status: r.status as PlatformTask["status"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export type SqliteTasksStore = PlatformTasksStore & {
  close(): void;
  readonly dbPath: string;
};

export type CreateSqliteTasksStoreOptions = {
  coreDbPath: string;
  openDatabase?: OpenSqliteDatabase;
};

export function createSqliteTasksStore(
  opts: CreateSqliteTasksStoreOptions,
): SqliteTasksStore {
  const open = opts.openDatabase || openNodeSqliteDatabase;
  const db: SqliteDatabase = open(opts.coreDbPath);
  db.exec(PLATFORM_TASKS_CORE_SQL);

  const store: SqliteTasksStore = {
    dbPath: opts.coreDbPath,
    close() {
      db.close?.();
    },
    create(input) {
      return store.upsertWithId!({
        id: crypto.randomUUID(),
        userId: input.userId,
        title: input.title,
        body: input.body,
        status: "open",
      });
    },
    upsertWithId(input) {
      const ts = now();
      const existing = store.get(input.id);
      const t: PlatformTask = {
        id: input.id,
        userId: input.userId,
        title: input.title.trim(),
        body: input.body || "",
        status: input.status || existing?.status || "open",
        createdAt: existing?.createdAt || ts,
        updatedAt: ts,
      };
      if (!t.title) throw new Error("title_required");
      db.prepare(
        `INSERT INTO creezio_platform_tasks
        (id, user_id, title, body, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          user_id = excluded.user_id,
          title = excluded.title,
          body = excluded.body,
          status = excluded.status,
          updated_at = excluded.updated_at`,
      ).run(
        t.id,
        t.userId,
        t.title,
        t.body,
        t.status,
        t.createdAt,
        t.updatedAt,
      );
      return t;
    },
    list(userId) {
      const rows = db
        .prepare(
          `SELECT * FROM creezio_platform_tasks WHERE user_id = ?
           ORDER BY updated_at DESC`,
        )
        .all(userId) as Row[];
      return rows.map(fromRow);
    },
    get(id) {
      const row = db
        .prepare(`SELECT * FROM creezio_platform_tasks WHERE id = ?`)
        .get(id) as Row | undefined;
      return row ? fromRow(row) : undefined;
    },
    update(id, patch, actorUserId) {
      const t = store.get(id);
      if (!t) throw new Error("not_found");
      if (t.userId !== actorUserId) throw new Error("forbidden");
      const updated: PlatformTask = {
        ...t,
        ...("title" in patch && patch.title !== undefined
          ? { title: patch.title }
          : {}),
        ...("body" in patch && patch.body !== undefined
          ? { body: patch.body }
          : {}),
        ...("status" in patch && patch.status !== undefined
          ? { status: patch.status }
          : {}),
        updatedAt: now(),
      };
      db.prepare(
        `UPDATE creezio_platform_tasks
         SET title = ?, body = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        updated.title,
        updated.body,
        updated.status,
        updated.updatedAt,
        id,
      );
      return updated;
    },
    remove(id, actorUserId) {
      const t = store.get(id);
      if (!t) return false;
      if (t.userId !== actorUserId) throw new Error("forbidden");
      db.prepare(`DELETE FROM creezio_platform_tasks WHERE id = ?`).run(id);
      return true;
    },
  };

  return store;
}
