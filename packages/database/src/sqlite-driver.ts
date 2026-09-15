/**
 * Driver SQLite minimal — compatible better-sqlite3 / node:sqlite.
 * Port Database kit → @creezio/database (R1).
 */
import { createAppRequire } from "@creezio/platform-core";

export type SqliteRunResult = {
  changes: number;
  lastInsertRowid: number | bigint;
};

export type SqliteStatement = {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};

export type SqliteDatabase = {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
  close?: () => void;
};

export type OpenSqliteDatabase = (path: string) => SqliteDatabase;

export function openNodeSqliteDatabase(dbPath: string): SqliteDatabase {
  const require = createAppRequire();
  const mod = require("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      exec(sql: string): void;
      prepare(sql: string): {
        run(...params: unknown[]): SqliteRunResult;
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
