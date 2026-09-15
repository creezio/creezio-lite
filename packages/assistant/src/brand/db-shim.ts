/**
 * Shim DB — délègue à configureAssistantBrand({ db }).
 */
import { requireAssistantDb } from "./registry.js";

export type Row = Record<string, unknown>;

export function queryAll<T = Row>(sql: string, params: unknown[] = []): T[] {
  return requireAssistantDb().queryAll<T>(sql, params);
}

export function queryOne<T = Row>(
  sql: string,
  params: unknown[] = [],
): T | undefined {
  return requireAssistantDb().queryOne<T>(sql, params);
}

export function getDbPath(): string {
  return requireAssistantDb().getDbPath();
}

export function tableExists(name: string): boolean {
  const db = requireAssistantDb();
  if (db.tableExists) return db.tableExists(name);
  try {
    const row = db.queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?`,
      [name],
    );
    return Boolean(row && Number(row.c) > 0);
  } catch {
    return false;
  }
}

export function getDb() {
  const db = requireAssistantDb();
  if (!db.getDb) {
    throw new Error("@creezio/assistant: db.getDb() requis pour explore/run-sql");
  }
  return db.getDb();
}

export function getWriteDb() {
  return getDb();
}
