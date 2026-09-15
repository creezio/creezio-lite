import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "./sqlite-driver.js";
import { isSafeIdentifier } from "./identifiers.js";

export type SavedViewConfig = {
  sort?: string;
  sortDir?: "asc" | "desc";
  q?: string;
  columns?: string[];
  filters?: Array<{
    column: string;
    op: string;
    value?: string;
  }>;
};

export type SavedView = {
  id: string;
  tableName: string;
  name: string;
  config: SavedViewConfig;
  createdAt: string;
  updatedAt: string;
};

function mapView(row: {
  id: string;
  table_name: string;
  name: string;
  config_json: string;
  created_at: string;
  updated_at: string;
}): SavedView {
  let config: SavedViewConfig = {};
  try {
    config = JSON.parse(row.config_json) as SavedViewConfig;
  } catch {
    config = {};
  }
  return {
    id: row.id,
    tableName: row.table_name,
    name: row.name,
    config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listSavedViews(db: SqliteDatabase, tableName: string): SavedView[] {
  if (!isSafeIdentifier(tableName)) return [];
  const rows = db
    .prepare(
      `SELECT id, table_name, name, config_json, created_at, updated_at
       FROM db_saved_views WHERE table_name = ? ORDER BY name COLLATE NOCASE`,
    )
    .all(tableName) as Array<{
    id: string;
    table_name: string;
    name: string;
    config_json: string;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map(mapView);
}

export function createSavedView(
  db: SqliteDatabase,
  input: { tableName: string; name: string; config: SavedViewConfig },
): SavedView {
  if (!isSafeIdentifier(input.tableName)) throw new Error("Table invalide");
  const id = randomUUID();
  const name = input.name.trim() || "Vue";
  db.prepare(
    `INSERT INTO db_saved_views (id, table_name, name, config_json)
     VALUES (?, ?, ?, ?)`,
  ).run(id, input.tableName, name, JSON.stringify(input.config ?? {}));
  return listSavedViews(db, input.tableName).find((v) => v.id === id)!;
}

export function updateSavedView(
  db: SqliteDatabase,
  id: string,
  patch: { name?: string; config?: SavedViewConfig },
): SavedView | null {
  const row = db
    .prepare(
      `SELECT id, table_name, name, config_json, created_at, updated_at
       FROM db_saved_views WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        table_name: string;
        name: string;
        config_json: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  const name = patch.name?.trim() || row.name;
  const config =
    patch.config !== undefined ? JSON.stringify(patch.config) : row.config_json;
  db.prepare(
    `UPDATE db_saved_views
     SET name = ?, config_json = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(name, config, id);
  return mapView({
    ...row,
    name,
    config_json: config,
    updated_at: new Date().toISOString(),
  });
}

export function deleteSavedView(db: SqliteDatabase, id: string): boolean {
  return db.prepare(`DELETE FROM db_saved_views WHERE id = ?`).run(id).changes > 0;
}
