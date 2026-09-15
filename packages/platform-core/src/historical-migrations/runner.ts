/**
 * Runner de migrations SQLite historiques (brand.db / schema_version).
 *
 * IMPORTANT ABI : better-sqlite3 est compilé pour Node vanilla. Ce runner ne
 * doit PAS être importé dans le process Electron : le main le lance en
 * sous-process via le même binaire Node que le serveur :
 *   node …/runner.js <dbPath>
 *
 * Extrait TF gold (N4) — ops event optionnel via `@creezio/observability`.
 */

import fs from "node:fs";
import path from "node:path";
import type { HistoricalMigration, HistoricalSqliteDb } from "./types.js";
import { platformHistoricalMigrations } from "./steps/index.js";
import { createAppRequire } from "../app-require.js";

export type HistoricalMigrationReport = {
  from: number;
  to: number;
  applied: string[];
  backupPath: string | null;
};

type BetterSqliteCtor = new (filename: string) => HistoricalSqliteDb & {
  pragma(key: string): unknown;
  close(): void;
  transaction<T>(fn: () => T): () => T;
};

function loadBetterSqlite3(): BetterSqliteCtor {
  const req = createAppRequire();
  return req("better-sqlite3") as BetterSqliteCtor;
}

function emitOpsSafe(payload: Record<string, unknown>): void {
  try {
    const req = createAppRequire();
    const obs = req("@creezio/observability") as {
      emitOpsEvent?: (p: Record<string, unknown>) => void;
    };
    obs.emitOpsEvent?.(payload);
  } catch {
    /* peer optionnel */
  }
}

function readSchemaVersion(db: HistoricalSqliteDb): number {
  const hasMeta = db
    .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='meta'`)
    .get() as { c: number };
  if (!hasMeta.c) return 0;
  const row = db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get() as
    | { value: string }
    | undefined;
  const n = Number(row?.value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function writeSchemaVersion(db: HistoricalSqliteDb, version: number): void {
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.prepare(
    `INSERT INTO meta(key, value) VALUES('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  ).run(String(version));
  db.prepare(
    `INSERT INTO meta(key, value) VALUES('updated_at', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  ).run(new Date().toISOString());
}

export type RunHistoricalMigrationsOptions = {
  /** Steps à appliquer (défaut = `platformHistoricalMigrations()`). */
  migrations?: readonly HistoricalMigration[];
  log?: (line: string) => void;
};

/**
 * Amène la base au schéma courant pour les steps fournis.
 * Relancer est un no-op (steps idempotents + version stockée).
 */
export function runHistoricalMigrations(
  dbPath: string,
  opts?: RunHistoricalMigrationsOptions,
): HistoricalMigrationReport {
  const log = opts?.log ?? ((l: string) => console.log(l));
  const migrations = [...(opts?.migrations ?? platformHistoricalMigrations())].sort(
    (a, b) => a.version - b.version,
  );

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const existedBefore = fs.existsSync(dbPath);
  const Database = loadBetterSqlite3();
  const db = new Database(dbPath);
  db.pragma("busy_timeout = 10000");
  db.pragma("foreign_keys = OFF");

  const migrationsStarted = Date.now();
  try {
    const current = readSchemaVersion(db);
    const pendingSteps = migrations.filter((m) => m.version > current);
    if (pendingSteps.length === 0) {
      log(`schema_version=${current} — aucune migration à appliquer.`);
      emitOpsSafe({
        level: "decision",
        kind: "migrations.run",
        outcome: "noop",
        ctx: { schemaVersion: current },
      });
      return { from: current, to: current, applied: [], backupPath: null };
    }

    let backupPath: string | null = null;
    if (existedBefore && current > 0) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      backupPath = `${dbPath}.bak-v${current}-${stamp}`;
      fs.copyFileSync(dbPath, backupPath);
      log(`sauvegarde → ${backupPath}`);
    }

    const applied: string[] = [];
    for (const step of pendingSteps) {
      log(`migration v${step.version} (${step.name})…`);
      const tx = db.transaction(() => {
        step.up(db);
        writeSchemaVersion(db, step.version);
      });
      tx();
      applied.push(`v${step.version} ${step.name}`);
    }

    const to = readSchemaVersion(db);
    log(`schéma à jour : v${current} → v${to} (${applied.length} step(s)).`);
    emitOpsSafe({
      level: "decision",
      kind: "migrations.run",
      outcome: "applied",
      durationMs: Date.now() - migrationsStarted,
      ctx: { from: current, to, applied },
    });
    return { from: current, to, applied, backupPath };
  } finally {
    db.pragma("foreign_keys = ON");
    db.close();
  }
}
