/**
 * Migrations historiques brand.db (schema_version) — plateforme SoT kit (N4).
 *
 * Hors scope : steps métier marques ; `platformCoreMigrations` (core.db).
 */

export type {
  HistoricalMigration,
  HistoricalSqliteDb,
  Migration,
} from "./types.js";
export {
  addColumnIfMissing,
  tableColumns,
  tableExists,
} from "./types.js";

export type {
  HistoricalMigrationReport,
  RunHistoricalMigrationsOptions,
} from "./runner.js";
export { runHistoricalMigrations } from "./runner.js";

export type { PlatformHistoricalStepVersion } from "./steps/index.js";
export {
  PLATFORM_HISTORICAL_STEP_VERSIONS,
  platformHistoricalMigrationByName,
  platformHistoricalMigrations,
} from "./steps/index.js";
