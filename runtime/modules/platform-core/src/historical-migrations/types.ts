/**
 * Contrat d'une migration SQLite historique (brand.db / schema_version).
 *
 * IMPORTANT ABI : ces migrations tournent dans un process Node VANILLA
 * (spawn depuis le main Electron), jamais dans le process Electron lui-même,
 * pour charger better-sqlite3 compilé pour Node.
 *
 * Extrait TF gold (N4) — ne pas inventer de DDL.
 */

/** Surface SQLite minimale attendue (better-sqlite3 compatible). */
export type HistoricalSqliteDb = {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
    run(...args: unknown[]): unknown;
  };
  pragma?(key: string): unknown;
  close?(): void;
  transaction?<T>(fn: () => T): () => T;
};

export type HistoricalMigration = {
  /** Version cible de schema_version (meta) après application. */
  version: number;
  /** Nom court, ex. "api-keys" (v20). */
  name: string;
  /**
   * Applique la migration. Appelée DANS une transaction ouverte par le
   * runner ; doit être idempotente (CREATE TABLE IF NOT EXISTS…).
   */
  up: (db: HistoricalSqliteDb) => void;
};

/** Colonnes existantes d'une table (util partagé par les steps). */
export function tableColumns(db: HistoricalSqliteDb, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${JSON.stringify(table).slice(1, -1)})`).all() as {
    name: string;
  }[];
  return new Set(rows.map((r) => r.name));
}

export function tableExists(db: HistoricalSqliteDb, name: string): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type IN ('table','view') AND name=?`)
    .get(name) as { c: number };
  return row.c > 0;
}

/** ALTER TABLE ADD COLUMN idempotent. */
export function addColumnIfMissing(
  db: HistoricalSqliteDb,
  table: string,
  column: string,
  ddl: string,
): void {
  if (!tableColumns(db, table).has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

/** Alias historique TF — `Migration` = `HistoricalMigration`. */
export type Migration = HistoricalMigration;
