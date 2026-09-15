import type { Migration } from "../types.js";
import { createAppRequire } from "../../app-require.js";

/**
 * Module Database avancé (style Notion) — SoT SQL = `@creezio/database` (R1).
 * Tables : automations, outbox, runs, vues, access log.
 * Chargement runtime via createAppRequire (asar-safe) — pas de cycle build.
 */
function loadDatabaseCoreSql(): string {
  const mod = createAppRequire()("@creezio/database") as {
    DATABASE_CORE_SQL?: string;
  };
  if (typeof mod.DATABASE_CORE_SQL !== "string" || !mod.DATABASE_CORE_SQL.trim()) {
    throw new Error(
      "platformHistoricalMigrations: DATABASE_CORE_SQL introuvable (@creezio/database)",
    );
  }
  return mod.DATABASE_CORE_SQL;
}

const migration: Migration = {
  version: 33,
  name: "database-automations",
  up(db) {
    db.exec(loadDatabaseCoreSql());
  },
};

export default migration;
