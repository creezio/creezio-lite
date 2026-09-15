/**
 * Registre de presets de feed Meili — côté FACTORY uniquement.
 *
 * Le contrat OS (`@creezio/brand-spec` `meili.feedPreset`) est un id libre :
 * `none`, `custom`, ou une clé de ce registre. La factory PEUT connaître des
 * presets verticaux (générateurs legacy assumés), le contrat OS non.
 *
 * Chaque preset rend le fichier `meili-feed.ts` complet INLINÉ dans le code
 * de la marque — aucun preset runtime dans le kit (créateur runtime déprécié
 * H7, retiré au prochain bump).
 */
import type { ProductModel } from "../product-model.js";

export type MeiliFeedPresetRenderer = (model: ProductModel) => string;

const registry = new Map<string, MeiliFeedPresetRenderer>();

/**
 * Normalise un id de preset : trim/minuscules + valeur legacy
 * `<vertical>-catalog` (brand.yaml antérieurs à H7) ramenée à `<vertical>`.
 */
export function normalizeMeiliFeedPresetId(raw: string): string {
  const id = raw.trim().toLowerCase();
  return id.endsWith("-catalog") ? id.slice(0, -"-catalog".length) : id;
}

export function registerMeiliFeedPreset(
  id: string,
  renderer: MeiliFeedPresetRenderer,
): void {
  registry.set(normalizeMeiliFeedPresetId(id), renderer);
}

export function getMeiliFeedPreset(
  id: string | undefined,
): MeiliFeedPresetRenderer | null {
  if (!id) return null;
  return registry.get(normalizeMeiliFeedPresetId(id)) ?? null;
}

export function listMeiliFeedPresetIds(): string[] {
  return [...registry.keys()].sort();
}

function brandProgressPrefix(model: ProductModel, max: number): string {
  return (
    model.brandId
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, max) || "BRAND"
  );
}

/**
 * Preset catalogue CHR (générateur legacy assumé — fixture --from-prd de la
 * première marque) : produits + fournisseurs, UIDs génériques catalog_*.
 */
function renderChrCatalogFeedTs(model: ProductModel): string {
  return `/**
 * Feed Meili marque ${model.brandId} — config OS (pas de moteur maison).
 * UIDs génériques catalog_* (aucun préfixe legacy marque dans le feed).
 * Feed catalogue généré par la factory (preset catalogue CHR inliné).
 */
import {
  configureMeiliBrandFeed,
  configureMeiliCatalogSqlTables,
  type BrandMeiliFeed,
} from "@creezio/search";

export const brandMeiliFeed: BrandMeiliFeed = {
  id: ${JSON.stringify(`${model.brandId}-catalog`)},
  schemaVersion: 1,
  progressPrefix: "${brandProgressPrefix(model, 32)}",
  countTables: { produits: "produits", fournisseurs: "fournisseurs" },
  indexes: [
    {
      uid: "catalog_products",
      countKey: "produits",
      table: "produits",
      columns: ["id", "nom", "categorie", "fournisseur_id", "unite"],
      docType: "product",
      excludeArchived: true,
      settings: {
        searchableAttributes: ["nom", "categorie", "unite"],
        filterableAttributes: ["type", "fournisseur_id", "categorie"],
        pagination: { maxTotalHits: 100000 },
        displayedAttributes: [
          "id",
          "type",
          "nom",
          "categorie",
          "fournisseur_id",
          "unite",
        ],
      },
    },
    {
      uid: "catalog_sites",
      countKey: "fournisseurs",
      table: "fournisseurs",
      columns: ["id", "nom", "contact", "email", "telephone", "site_web"],
      docType: "site",
      excludeArchived: true,
      settings: {
        searchableAttributes: ["nom", "contact", "email"],
        filterableAttributes: ["type"],
        pagination: { maxTotalHits: 100000 },
        displayedAttributes: [
          "id",
          "type",
          "nom",
          "contact",
          "email",
          "telephone",
          "site_web",
        ],
      },
    },
  ],
  obsoleteIndexUids: [],
  metaIndexUid: "catalog_meta",
};

export function applyBrandMeiliConfig(): void {
  configureMeiliCatalogSqlTables(brandMeiliFeed.countTables);
  configureMeiliBrandFeed(brandMeiliFeed);
}
`;
}

registerMeiliFeedPreset("chr", renderChrCatalogFeedTs);
