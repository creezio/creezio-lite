/**
 * Driver SQLite minimal (H2) — compatible node:sqlite DatabaseSync.
 * Les apps Electron peuvent injecter better-sqlite3 via `openDatabase`.
 *
 * Pas d'`import.meta` — dual-build CJS (Electron) l'interdit.
 */

import { createAppRequire } from "./app-require.js";

export type SqliteStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};

export type SqliteDatabase = {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
  close?: () => void;
};

export type OpenSqliteDatabase = (dbPath: string) => SqliteDatabase;

/**
 * Ouvre une DB via `node:sqlite` (Node ≥ 22.5) — tests kit / sandbox.
 */
export function openNodeSqliteDatabase(dbPath: string): SqliteDatabase {
  const require = createAppRequire();
  const mod = require("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      exec(sql: string): void;
      prepare(sql: string): {
        run(...params: unknown[]): unknown;
        get(...params: unknown[]): unknown;
        all(...params: unknown[]): unknown[];
      };
      close(): void;
    };
  };
  const db = new mod.DatabaseSync(dbPath);
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => db.prepare(sql),
    close: () => db.close(),
  };
}
