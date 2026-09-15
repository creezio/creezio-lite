import type { SqliteDatabase } from "./sqlite-driver.js";

export function logDatabaseAccess(
  db: SqliteDatabase,
  input: {
    actor: string;
    action: string;
    tableName?: string | null;
    detail?: Record<string, unknown>;
  },
): void {
  try {
    db.prepare(
      `INSERT INTO db_access_log (actor, action, table_name, detail_json)
       VALUES (?, ?, ?, ?)`,
    ).run(
      input.actor,
      input.action,
      input.tableName ?? null,
      input.detail ? JSON.stringify(input.detail) : null,
    );
  } catch {
    /* table absente (pre-migration) — ignore */
  }
}

export function listAccessLog(db: SqliteDatabase, limit = 100) {
  return db
    .prepare(
      `SELECT id, actor, action, table_name AS tableName, detail_json AS detailJson, created_at AS createdAt
       FROM db_access_log
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(Math.min(500, Math.max(1, limit))) as Array<{
    id: number;
    actor: string;
    action: string;
    tableName: string | null;
    detailJson: string | null;
    createdAt: string;
  }>;
}
