/** Driver SQLite minimal — @creezio/mails (I3 + inbox). */
import { createAppRequire } from "@creezio/platform-core";

export type SqliteStatement = {
  run(...params: unknown[]): { changes?: number; lastInsertRowid?: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};

export type SqliteDatabase = {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
  close?: () => void;
  transaction?<T>(fn: () => T): T;
};

export type OpenSqliteDatabase = (path: string) => SqliteDatabase;

export function openNodeSqliteDatabase(dbPath: string): SqliteDatabase {
  const require = createAppRequire();
  const mod = require("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      exec(sql: string): void;
      prepare(sql: string): {
        run(...params: unknown[]): {
          changes?: number;
          lastInsertRowid?: number | bigint;
        };
        get(...params: unknown[]): unknown;
        all(...params: unknown[]): unknown[];
      };
      close(): void;
      transaction?<T>(fn: () => T): () => T;
    };
  };
  const db = new mod.DatabaseSync(dbPath);
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => db.prepare(sql),
    close: () => db.close(),
    transaction: db.transaction
      ? <T>(fn: () => T) => {
          const wrapped = db.transaction!(fn);
          return wrapped();
        }
      : undefined,
  };
}
