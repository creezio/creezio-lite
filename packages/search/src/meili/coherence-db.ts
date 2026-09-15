/**
 * Accès SQLite pour la cohérence Meili — process Node vanilla uniquement
 * (better-sqlite3 ABI Node). Ne jamais importer depuis electron/main.ts.
 *
 * Compteurs alignés sur l'indexeur catalogue (tables déclarées par la
 * marque via `configureMeiliCatalogSqlTables` / `feed.countTables`).
 */

import path from "node:path";
import { createAppRequire } from "@creezio/platform-core";
import {
  INDEX_SCHEMA_VERSION,
  MEILI_FINGERPRINT_META_KEY,
  MEILI_INDEX_IN_PROGRESS_KEY,
  getMeiliCatalogSqlTables,
  parseFingerprint,
  serializeFingerprint,
  type CatalogSqlCounts,
  type MeiliFingerprint,
} from "./index-schema.js";

type SqliteStmt = {
  get(...args: unknown[]): unknown;
  run(...args: unknown[]): unknown;
};

type DatabaseCtor = new (
  filename: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => {
  prepare(sql: string): SqliteStmt;
  close(): void;
};

function loadDatabase(): DatabaseCtor {
  const req = createAppRequire();
  return req("better-sqlite3") as DatabaseCtor;
}

export type GedSqlCounts = CatalogSqlCounts;

function tableExists(db: { prepare(sql: string): SqliteStmt }, name: string): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { c: number };
  return row.c > 0;
}

function count(db: { prepare(sql: string): SqliteStmt }, sql: string): number {
  const row = db.prepare(sql).get() as { c: number };
  return Number(row?.c || 0);
}

/** Identifiant table SQLite sûr (alphanum + underscore). */
function safeTableName(name: string): string | null {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : null;
}

/** Compteurs SQL alignés sur l'indexeur catalogue (tables déclarées marque). */
export function countCatalogSql(dbPath: string): CatalogSqlCounts {
  const tables = getMeiliCatalogSqlTables();
  const db = new (loadDatabase())(dbPath, { readonly: true, fileMustExist: true });
  try {
    const counts: CatalogSqlCounts = {};
    for (const [key, table] of Object.entries(tables)) {
      const safe = safeTableName(table);
      counts[key] =
        safe && tableExists(db, safe)
          ? count(db, `SELECT COUNT(*) AS c FROM ${safe}`)
          : 0;
    }
    return counts;
  } finally {
    db.close();
  }
}

/** @deprecated Alias historique (API cohérence GED). */
export function countGedSql(dbPath: string): CatalogSqlCounts {
  return countCatalogSql(dbPath);
}

export function readSqliteSchemaVersion(dbPath: string): number {
  const db = new (loadDatabase())(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (!tableExists(db, "meta")) return 0;
    const row = db
      .prepare(`SELECT value FROM meta WHERE key='schema_version'`)
      .get() as { value: string } | undefined;
    return Number(row?.value || 0);
  } finally {
    db.close();
  }
}

export function readFingerprintFromDb(dbPath: string): MeiliFingerprint | null {
  const db = new (loadDatabase())(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (!tableExists(db, "meta")) return null;
    const row = db
      .prepare(`SELECT value FROM meta WHERE key=?`)
      .get(MEILI_FINGERPRINT_META_KEY) as { value: string } | undefined;
    return parseFingerprint(row?.value);
  } finally {
    db.close();
  }
}

export function writeFingerprintToDb(dbPath: string, fp: MeiliFingerprint): void {
  const db = new (loadDatabase())(dbPath, { fileMustExist: true });
  try {
    db.prepare(
      `INSERT INTO meta(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(MEILI_FINGERPRINT_META_KEY, serializeFingerprint(fp));
  } finally {
    db.close();
  }
}

export function buildFingerprint(opts: {
  sql: CatalogSqlCounts;
  sqliteSchema: number;
  appVersion?: string;
}): MeiliFingerprint {
  return {
    indexSchema: INDEX_SCHEMA_VERSION,
    sqliteSchema: opts.sqliteSchema,
    counts: opts.sql,
    builtAt: new Date().toISOString(),
    appVersion: opts.appVersion,
  };
}

export type MeiliIndexInProgress = { startedAt: string; appVersion?: string };

export function readIndexInProgress(dbPath: string): MeiliIndexInProgress | null {
  const db = new (loadDatabase())(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (!tableExists(db, "meta")) return null;
    const row = db
      .prepare(`SELECT value FROM meta WHERE key=?`)
      .get(MEILI_INDEX_IN_PROGRESS_KEY) as { value: string } | undefined;
    if (!row?.value) return null;
    try {
      const data = JSON.parse(row.value) as MeiliIndexInProgress;
      return typeof data.startedAt === "string" ? data : null;
    } catch {
      return null;
    }
  } finally {
    db.close();
  }
}

export type CoherenceDbSnapshot = {
  sql: CatalogSqlCounts;
  sqliteSchema: number;
  fingerprint: MeiliFingerprint | null;
  /** Indexation précédente jamais terminée (marqueur resté en place). */
  indexInProgress: MeiliIndexInProgress | null;
};

export function readCoherenceDbSnapshot(dbPath: string): CoherenceDbSnapshot {
  return {
    sql: countCatalogSql(dbPath),
    sqliteSchema: readSqliteSchemaVersion(dbPath),
    fingerprint: readFingerprintFromDb(dbPath),
    indexInProgress: readIndexInProgress(dbPath),
  };
}
