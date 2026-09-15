/**
 * Migrations SQLite par couche (H2.1).
 *
 * Chaque fichier DB (core / brand / plugin/<id>) a sa propre table
 * `_creezio_schema_migrations` — pas de versioning partagé entre couches.
 */

import type { SqliteDatabase } from "./sqlite-driver.js";

/** Table de suivi des migrations (par fichier DB). */
export const SQLITE_MIGRATIONS_TABLE = "_creezio_schema_migrations" as const;

export type SqliteMigration = {
  /** Identifiant stable, ex. `h2_001_auth`. Jamais renommer après apply. */
  id: string;
  /** DDL / DML idempotent recommandé (`CREATE TABLE IF NOT EXISTS`…). */
  sql: string;
};

export type EnsureMigrationsResult = {
  applied: string[];
  already: string[];
};

const ID_RE = /^[a-z0-9][a-z0-9_.-]{0,127}$/;

function assertMigrationId(id: string): void {
  if (!ID_RE.test(id)) {
    throw new Error(`migration id invalide: ${id}`);
  }
}

/**
 * Applique les migrations manquantes dans l'ordre du tableau.
 * Retourne les ids nouvellement appliqués / déjà présents.
 */
export function ensureMigrations(
  db: SqliteDatabase,
  migrations: readonly SqliteMigration[],
): EnsureMigrationsResult {
  db.exec(`
CREATE TABLE IF NOT EXISTS ${SQLITE_MIGRATIONS_TABLE} (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`);

  const applied: string[] = [];
  const already: string[] = [];
  const seen = new Set<string>();

  for (const m of migrations) {
    assertMigrationId(m.id);
    if (seen.has(m.id)) {
      throw new Error(`migration id dupliqué: ${m.id}`);
    }
    seen.add(m.id);

    const row = db
      .prepare(`SELECT id FROM ${SQLITE_MIGRATIONS_TABLE} WHERE id = ?`)
      .get(m.id) as { id?: string } | undefined;
    if (row?.id) {
      already.push(m.id);
      continue;
    }
    db.exec(m.sql);
    db.prepare(
      `INSERT INTO ${SQLITE_MIGRATIONS_TABLE} (id, applied_at) VALUES (?, ?)`,
    ).run(m.id, new Date().toISOString());
    applied.push(m.id);
  }

  return { applied, already };
}

/** Liste les ids déjà appliqués (ordre d'insertion). */
export function listAppliedMigrations(db: SqliteDatabase): string[] {
  db.exec(`
CREATE TABLE IF NOT EXISTS ${SQLITE_MIGRATIONS_TABLE} (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`);
  const rows = db
    .prepare(
      `SELECT id FROM ${SQLITE_MIGRATIONS_TABLE} ORDER BY applied_at ASC, id ASC`,
    )
    .all() as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/**
 * Migration méta kit (info couche) — safe sur toute DB.
 * Les DDL métier (auth, Product Hub, brand) sont injectés par l'appelant
 * pour éviter les dépendances circulaires packages.
 */
export const SQLITE_META_MIGRATION: SqliteMigration = {
  id: "h2_000_schema_info",
  sql: `
CREATE TABLE IF NOT EXISTS _creezio_schema_info (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
};

/** Compose une liste de migrations en préfixant la méta kit. */
export function composeMigrations(
  ...groups: Array<SqliteMigration | readonly SqliteMigration[] | undefined>
): SqliteMigration[] {
  const out: SqliteMigration[] = [SQLITE_META_MIGRATION];
  const seen = new Set<string>([SQLITE_META_MIGRATION.id]);
  for (const g of groups) {
    if (!g) continue;
    const list = Array.isArray(g) ? g : [g];
    for (const m of list) {
      if (seen.has(m.id)) {
        throw new Error(`composeMigrations: id dupliqué ${m.id}`);
      }
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}
