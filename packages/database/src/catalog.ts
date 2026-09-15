import type { SqliteDatabase } from "./sqlite-driver.js";
import { isSystemTable, quoteIdent } from "./identifiers.js";

export type CatalogEntry = {
  name: string;
  kind: "table" | "view";
  sql: string | null;
  rowCount: number;
  system: boolean;
  group: "metier" | "systeme" | "vues";
};

export type ColumnInfo = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
};

function countRows(db: SqliteDatabase, name: string): number {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(name)}`).get() as {
      c: number;
    };
    return row.c;
  } catch {
    return 0;
  }
}

export function listCatalog(
  db: SqliteDatabase,
  opts: { includeSystem?: boolean } = {},
): CatalogEntry[] {
  const includeSystem = opts.includeSystem === true;
  const rows = db
    .prepare(
      `SELECT name, type, sql
       FROM sqlite_master
       WHERE type IN ('table', 'view')
         AND name NOT LIKE 'sqlite_%'
       ORDER BY type ASC, name COLLATE NOCASE`,
    )
    .all() as Array<{ name: string; type: string; sql: string | null }>;

  const entries: CatalogEntry[] = [];
  for (const row of rows) {
    const system = isSystemTable(row.name);
    if (system && !includeSystem) continue;
    const kind = row.type === "view" ? "view" : "table";
    entries.push({
      name: row.name,
      kind,
      sql: row.sql,
      rowCount: countRows(db, row.name),
      system,
      group: kind === "view" ? "vues" : system ? "systeme" : "metier",
    });
  }
  return entries;
}

export function getTableMeta(db: SqliteDatabase, name: string) {
  const master = db
    .prepare(
      `SELECT name, type, sql FROM sqlite_master
       WHERE type IN ('table','view') AND name = ?`,
    )
    .get(name) as { name: string; type: string; sql: string | null } | undefined;
  if (!master) return null;

  const identifier = quoteIdent(name);
  const columns = db.prepare(`PRAGMA table_info(${identifier})`).all() as ColumnInfo[];
  const foreignKeys = db
    .prepare(`PRAGMA foreign_key_list(${identifier})`)
    .all() as Array<Record<string, unknown>>;
  const indexes = db
    .prepare(`PRAGMA index_list(${identifier})`)
    .all() as Array<Record<string, unknown>>;

  return {
    name: master.name,
    kind: (master.type === "view" ? "view" : "table") as "table" | "view",
    sql: master.sql,
    columns,
    foreignKeys,
    indexes,
    system: isSystemTable(master.name),
  };
}
