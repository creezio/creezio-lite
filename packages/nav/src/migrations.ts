/**
 * Migrations brand.db du module nav (overrides sidebar uniquement).
 * Le catalogue lui-même n'est PAS persisté (code + registre — pas de dual-write).
 */

import type { SqliteMigration } from "@creezio/platform-core";

export const NAV_SCHEMA_SQL = `-- Overrides sidebar (@creezio/nav) — brand.db

CREATE TABLE IF NOT EXISTS nav_overrides (
  entry_id    TEXT PRIMARY KEY,
  hidden      INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER,
  label       TEXT,
  icon        TEXT,
  grp         TEXT,
  permission  TEXT,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL
);
`;

/** Migrations brand.db — composer dans le kernel (auto-register app-runtime). */
export function navMigrations(): SqliteMigration[] {
  return [{ id: "nav_001_overrides", sql: NAV_SCHEMA_SQL }];
}
