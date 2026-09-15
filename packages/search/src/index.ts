/**
 * @creezio/search — sous-domaine recherche Meili du kit (P1.b).
 *
 * Extrait de @creezio/electron-shell (déménagement pur, zéro changement de
 * comportement) : feed marque, indexation générique, browse fail-closed,
 * cohérence SQLite↔Meili, launcher Meili, boot Meili marque.
 *
 * Contrat Meili CORE fail-closed inchangé (0.10.13/0.10.14) — voir
 * AGENTS.md de ce package.
 */

export type { RunningMeili, StartMeiliOptions } from "./meili-launcher.js";
export { startMeili } from "./meili-launcher.js";

export type { BrandMeiliBootResult } from "./brand-meili-boot.js";
export {
  isMeiliRequiredError,
  maybeBootBrandMeili,
  MeiliRequiredError,
} from "./brand-meili-boot.js";

export type {
  BrandMeiliDocument,
  BrandMeiliFeed,
  BrandMeiliIndexSpec,
  CatalogIndexUid,
  CatalogSqlCounts,
  CoherenceDbSnapshot,
  GedIndexUid,
  GedSqlCounts,
  GenericCatalogIndexUid,
  MeiliCatalogSqlTables,
  MeiliCoherencePaths,
  MeiliFingerprint,
  MeiliIndexInProgress,
  MeiliBrowseRequest,
  MeiliBrowseResult,
  MeiliBrowseOutcome,
  MeiliFeedSqliteDb,
  MeiliReadyDecision,
  MeiliSettingsJson,
} from "./meili/index.js";
export {
  CATALOG_INDEXES,
  GED_INDEXES,
  GENERIC_CATALOG_INDEXES,
  INDEX_SCHEMA_VERSION,
  MEILI_FINGERPRINT_META_KEY,
  MEILI_INDEX_IN_PROGRESS_KEY,
  buildFingerprint,
  configureMeiliBrandFeed,
  configureMeiliCatalogSqlTables,
  configureMeiliCoherencePaths,
  countCatalogSql,
  countGedSql,
  DEFAULT_MEILI_MAX_TOTAL_HITS,
  decideMeiliReady,
  ensureMeiliPaginationSettings,
  expectedCountsForFeed,
  expectedMeiliCounts,
  fingerprintCountKey,
  getMeiliBrandFeed,
  meiliCoherenceScriptPath,
  getMeiliCatalogSqlTables,
  mergeMeiliIndexSettings,
  needsMeiliMaxTotalHitsRaise,
  parseFingerprint,
  readCoherenceDbSnapshot,
  readFingerprintFromDb,
  readIndexInProgress,
  readSqliteSchemaVersion,
  resetMeiliBrandFeedForTests,
  resetMeiliCatalogSqlTablesForTests,
  resolveMeiliMaxTotalHitsFloor,
  runFeedIndexation,
  runIndexation,
  browseMeiliIndex,
  browseMeiliIndexOutcome,
  meiliFilterEq,
  searchMeiliIndexes,
  serializeFingerprint,
  writeFingerprintToDb,
} from "./meili/index.js";
