export {
  CATALOG_INDEXES,
  GED_INDEXES,
  INDEX_SCHEMA_VERSION,
  MEILI_FINGERPRINT_META_KEY,
  MEILI_INDEX_IN_PROGRESS_KEY,
  configureMeiliCatalogSqlTables,
  expectedMeiliCounts,
  fingerprintCountKey,
  getMeiliCatalogSqlTables,
  parseFingerprint,
  resetMeiliCatalogSqlTablesForTests,
  serializeFingerprint,
} from "./index-schema.js";
export type {
  CatalogIndexUid,
  CatalogSqlCounts,
  GedIndexUid,
  GedSqlCounts,
  MeiliCatalogSqlTables,
  MeiliFingerprint,
} from "./index-schema.js";

export {
  GENERIC_CATALOG_INDEXES,
  configureMeiliBrandFeed,
  expectedCountsForFeed,
  getMeiliBrandFeed,
  resetMeiliBrandFeedForTests,
} from "./feed.js";
export type {
  BrandMeiliDocument,
  BrandMeiliFeed,
  BrandMeiliIndexSpec,
  GenericCatalogIndexUid,
  MeiliFeedSqliteDb,
} from "./feed.js";

export {
  buildFingerprint,
  countCatalogSql,
  countGedSql,
  readCoherenceDbSnapshot,
  readFingerprintFromDb,
  readIndexInProgress,
  readSqliteSchemaVersion,
  writeFingerprintToDb,
} from "./coherence-db.js";
export type {
  CoherenceDbSnapshot,
  MeiliIndexInProgress,
} from "./coherence-db.js";

export type { MeiliCoherencePaths, MeiliReadyDecision } from "./coherence.js";
export {
  configureMeiliCoherencePaths,
  decideMeiliReady,
  meiliCoherenceScriptPath,
} from "./coherence.js";

export { runIndexation } from "./indexer.js";
export {
  ensureMeiliPaginationSettings,
  runFeedIndexation,
  searchMeiliIndexes,
} from "./generic-indexer.js";
export {
  DEFAULT_MEILI_MAX_TOTAL_HITS,
  mergeMeiliIndexSettings,
  needsMeiliMaxTotalHitsRaise,
  resolveMeiliMaxTotalHitsFloor,
} from "./pagination-settings.js";
export type { MeiliSettingsJson } from "./pagination-settings.js";
export {
  browseMeiliIndex,
  browseMeiliIndexOutcome,
  meiliFilterEq,
} from "./browse.js";
export type {
  MeiliBrowseOutcome,
  MeiliBrowseRequest,
  MeiliBrowseResult,
} from "./browse.js";
