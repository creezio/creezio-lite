/**
 * Schéma logique des index Meili catalogue.
 *
 * Le descripteur SoT est le `BrandMeiliFeed` de la marque (UIDs `catalog_*`
 * via `configureMeiliBrandFeed` / `runFeedIndexation`). Ce module fournit :
 * - les clés meta fingerprint / in-progress (partagées feed ↔ cohérence) ;
 * - les UIDs génériques par défaut (`catalog_products` / `catalog_sites`)
 *   utilisés par la cohérence quand aucun feed n'est configuré ;
 * - les tables SQL comptées (`configureMeiliCatalogSqlTables`) — mapping
 *   LIBRE `clé de compteur → table SQL`, déclaré par la marque.
 *
 * Aucun UID ni clé marque ne vit dans le kit — une marque avec des clés
 * historiques les porte dans SON feed.
 *
 * Bumper INDEX_SCHEMA_VERSION (ou feed.schemaVersion) à chaque changement
 * d'indexes / settings / docs pour forcer une réindexation au boot.
 */

/** v1 = descripteur générique catalog_*. */
export const INDEX_SCHEMA_VERSION = 1;

export const MEILI_FINGERPRINT_META_KEY = "meili_index_fingerprint";

/** Clé meta : indexation en cours (posée au start, effacée à la fin). */
export const MEILI_INDEX_IN_PROGRESS_KEY = "meili_index_in_progress";

export const CATALOG_INDEXES = [
  "catalog_products",
  "catalog_sites",
] as const;

export type CatalogIndexUid = (typeof CATALOG_INDEXES)[number];

/** Alias historique (API cohérence GED) — liste catalogue. */
export const GED_INDEXES = CATALOG_INDEXES;
export type GedIndexUid = CatalogIndexUid;

/**
 * Identité de la clé de compteur fingerprint (H11 : plus d'alias
 * `sites` → `fournisseurs` — la marque déclare `countKey` tel quel).
 */
export function fingerprintCountKey(countKey: string): string {
  return countKey;
}

/**
 * Tables SQL utilisées pour les compteurs de cohérence Meili.
 * Mapping LIBRE `clé de compteur → nom de table` (clés normalisées via
 * `fingerprintCountKey` au comptage). Déclaré par la marque via
 * `configureMeiliCatalogSqlTables` (typiquement `feed.countTables`).
 */
export type MeiliCatalogSqlTables = Record<string, string>;

/**
 * @deprecated H7 — défaut legacy (schéma catalogue hérité) servi UNE version
 * quand aucune marque n'a configuré ses tables. Les marques doivent déclarer
 * `feed.countTables` ; suppression prévue au prochain bump d'architecture.
 */
const LEGACY_DEFAULT_CATALOG_SQL_TABLES: MeiliCatalogSqlTables = {
  produits: "produits",
  fournisseurs: "fournisseurs",
};

let catalogSqlTables: MeiliCatalogSqlTables | null = null;
let warnedLegacyDefault = false;

/** Configure les tables SQL comptées pour la cohérence Meili. */
export function configureMeiliCatalogSqlTables(
  next: Partial<MeiliCatalogSqlTables>,
): void {
  const normalized: MeiliCatalogSqlTables = {};
  for (const [key, table] of Object.entries(next)) {
    if (typeof table === "string") normalized[fingerprintCountKey(key)] = table;
  }
  catalogSqlTables = { ...(catalogSqlTables ?? {}), ...normalized };
}

export function getMeiliCatalogSqlTables(): MeiliCatalogSqlTables {
  if (catalogSqlTables) return catalogSqlTables;
  if (!warnedLegacyDefault) {
    warnedLegacyDefault = true;
    console.warn(
      "[meili][deprecated] aucune table de comptage configurée — fallback " +
        "legacy (produits/fournisseurs) servi UNE version. Déclarer " +
        "feed.countTables (configureMeiliCatalogSqlTables).",
    );
  }
  return { ...LEGACY_DEFAULT_CATALOG_SQL_TABLES };
}

/** Tests uniquement. */
export function resetMeiliCatalogSqlTablesForTests(): void {
  catalogSqlTables = null;
  warnedLegacyDefault = false;
}

/**
 * Compteurs SQL du fingerprint — record LIBRE `clé fingerprint → count`
 * (clés déclarées par la marque via `countKey` / `countTables`).
 */
export type CatalogSqlCounts = Record<string, number>;

/** @deprecated Alias pour compat API cohérence (ex-GedSqlCounts). */
export type GedSqlCounts = CatalogSqlCounts;

export type MeiliFingerprint = {
  indexSchema: number;
  sqliteSchema: number;
  counts: CatalogSqlCounts;
  builtAt: string;
  appVersion?: string;
};

/**
 * @deprecated H7 — mapping legacy servi UNE version quand aucun feed n'est
 * configuré (UIDs génériques + clés fingerprint héritées). Les marques feed
 * passent par `expectedCountsForFeed`.
 */
export function expectedMeiliCounts(
  sql: CatalogSqlCounts,
): Record<CatalogIndexUid, number> {
  return {
    catalog_products: sql.produits ?? 0,
    catalog_sites: sql.fournisseurs ?? 0,
  };
}

export function parseFingerprint(raw: string | null | undefined): MeiliFingerprint | null {
  if (!raw?.trim()) return null;
  try {
    const data = JSON.parse(raw) as MeiliFingerprint;
    if (
      typeof data.indexSchema !== "number" ||
      typeof data.sqliteSchema !== "number" ||
      !data.counts ||
      typeof data.builtAt !== "string"
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function serializeFingerprint(fp: MeiliFingerprint): string {
  return JSON.stringify(fp);
}
