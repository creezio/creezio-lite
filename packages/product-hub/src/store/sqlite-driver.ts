/**
 * Driver SQLite minimal pour Product Hub (H1.8).
 * Compatible better-sqlite3 et node:sqlite DatabaseSync.
 *
 * Note : pas d'`import.meta` — le dual-build CJS (Electron) l'interdit.
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

/**
 * Ouvre une DB via `node:sqlite` (Node ≥ 22.5) — pour tests kit / sandbox.
 * Les apps Electron peuvent injecter better-sqlite3 via `openDatabase`.
 */
export function openNodeSqliteDatabase(dbPath: string): SqliteDatabase {
  // createRequire accepte n'importe quel chemin fichier valide ; les builtins
  // (`node:sqlite`) se résolvent indépendamment du cwd.
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
