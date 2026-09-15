import type { SqliteDatabase } from "./sqlite-driver.js";
import { getTableMeta } from "./catalog.js";
import { isSafeIdentifier, quoteIdent } from "./identifiers.js";
import { jsonRow } from "./query.js";
import { canCrudTable } from "./whitelist.js";

function assertWritable(table: string) {
  if (!canCrudTable(table)) throw new Error(`Table non modifiable : ${table}`);
}

export function insertRow(
  db: SqliteDatabase,
  table: string,
  values: Record<string, unknown>,
) {
  assertWritable(table);
  const meta = getTableMeta(db, table);
  if (!meta || meta.kind !== "table") throw new Error("Table introuvable");
  const colNames = new Set(meta.columns.map((c) => c.name));
  const entries = Object.entries(values).filter(
    ([k]) => colNames.has(k) && isSafeIdentifier(k),
  );
  if (!entries.length) throw new Error("Aucune colonne valide");
  const cols = entries.map(([k]) => quoteIdent(k)).join(", ");
  const placeholders = entries.map(() => "?").join(", ");
  const info = db
    .prepare(`INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${placeholders})`)
    .run(...entries.map(([, v]) => v ?? null));
  const row = db
    .prepare(`SELECT rowid AS __rowid__, * FROM ${quoteIdent(table)} WHERE rowid = ?`)
    .get(info.lastInsertRowid) as Record<string, unknown>;
  return jsonRow(row);
}

export function updateRow(
  db: SqliteDatabase,
  table: string,
  rowid: number,
  values: Record<string, unknown>,
) {
  assertWritable(table);
  const meta = getTableMeta(db, table);
  if (!meta || meta.kind !== "table") throw new Error("Table introuvable");
  const colNames = new Set(meta.columns.map((c) => c.name));
  const entries = Object.entries(values).filter(
    ([k]) => colNames.has(k) && isSafeIdentifier(k) && !meta.columns.find((c) => c.name === k && c.pk),
  );
  if (!entries.length) throw new Error("Aucune colonne valide à mettre à jour");
  const sets = entries.map(([k]) => `${quoteIdent(k)} = ?`).join(", ");
  const info = db
    .prepare(`UPDATE ${quoteIdent(table)} SET ${sets} WHERE rowid = ?`)
    .run(...entries.map(([, v]) => v ?? null), rowid);
  if (!info.changes) throw new Error("Ligne introuvable");
  const row = db
    .prepare(`SELECT rowid AS __rowid__, * FROM ${quoteIdent(table)} WHERE rowid = ?`)
    .get(rowid) as Record<string, unknown>;
  return jsonRow(row);
}

export function deleteRow(db: SqliteDatabase, table: string, rowid: number) {
  assertWritable(table);
  const info = db
    .prepare(`DELETE FROM ${quoteIdent(table)} WHERE rowid = ?`)
    .run(rowid);
  return info.changes > 0;
}
