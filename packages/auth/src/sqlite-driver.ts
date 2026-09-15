/**
 * Driver SQLite minimal pour @creezio/auth (Phase I1).
 * Compatible better-sqlite3 et node:sqlite DatabaseSync.
 * Pas d'`import.meta` — dual-build CJS Electron.
 */

import { createAppRequire } from "@creezio/platform-core";

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

export type OpenSqliteDatabase = (path: string) => SqliteDatabase;

/** Ouvre une DB via `node:sqlite` (Node ≥ 22.5) — tests kit / sandbox. */
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
