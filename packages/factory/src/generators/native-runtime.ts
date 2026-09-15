/**
 * Générateurs runtime natif OS — SQLite + api-kernel (pas de sidecar JSON).
 */
import type { AppManifest } from "@creezio/brand-config";
import type { ProductModel } from "../product-model.js";
import { getMeiliFeedPreset } from "./meili-feed-presets.js";
import { renderBrandSchemaSql } from "./schema.js";

/** Cookie session aligné `sessionCookieNameForBrand` (@creezio/app-runtime). */
function sessionCookieNameForBrandId(brandId: string): string {
  return `${brandId.replace(/[^a-z0-9_]/gi, "_")}_session`;
}

/**
 * Bindings plateforme — `configureAuth({ ownerPermissions: collectNavPermissions() })`
 * via `applyBrandModuleAuth`. Access-control n'est pas activé ici : les
 * groupes sont fusionnés seulement si la marque a déjà appelé
 * `configureAccessControl` (admin).
 */
export function renderBrandPlatformBindingsTs(brandId: string): string {
  const cookie = sessionCookieNameForBrandId(brandId);
  return `/**
 * creezio:owned-by-brand
 * Auth / access : permissions nav collectées depuis les navItems des modules.
 * Un \`brand module init\` avec \`permission: "nav.<id>"\` alimente l'owner
 * au prochain boot — plus de catalogue \`nav-permissions.ts\`.
 */
import { applyBrandModuleAuth } from "@creezio/app-runtime";
import {
  collectNavPermissions,
  collectPermissionGroups,
} from "./modules/index.js";

export function applyBrandPlatformBindings(): void {
  applyBrandModuleAuth({
    cookieName: ${JSON.stringify(cookie)},
    ownerPermissions: collectNavPermissions(),
    permissionGroups: collectPermissionGroups(),
  });
}
`;
}

export function renderBrandMigrationsTs(model: ProductModel): string {
  const sql = renderBrandSchemaSql(model)
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
  return `/**
 * Migrations brand ${model.brandId} — généré --from-prd (SQL métier marque).
 * Appliquées via createSqliteRuntime (OS @creezio/platform-core).
 * Consommateur du registre : \`...collectModuleMigrations()\` pour les
 * migrations \`mod_<module>_*\` (brand module init / modules/<id>.ts).
 */
import { composeMigrations, type SqliteMigration } from "@creezio/platform-core";
import { interactiveDemoMigrations } from "@creezio/interactive-demo";
import { onboardingContentMigrations } from "@creezio/onboarding";
import { collectModuleMigrations } from "./modules/index.js";

export const BRAND_SCHEMA_SQL = \`${sql}\`;

/**
 * Clés API service (portable kit 020+025) — requis par le kit : clé CRM
 * Hermes (ensure-crm-key-db) et résolution d'intégrations plateforme
 * (@creezio/integrations, canal clé service).
 */
export const BRAND_API_KEYS_SQL = \`
CREATE TABLE IF NOT EXISTS api_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL,
  scopes       TEXT NOT NULL DEFAULT 'full',
  user_id      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_active
  ON api_keys (key_hash)
  WHERE revoked_at IS NULL;
\`;

export function brandMigrations(): SqliteMigration[] {
  return composeMigrations(
    {
      id: "fromprd_brand_001_schema",
      sql: BRAND_SCHEMA_SQL,
    },
    {
      id: "fromprd_brand_api_keys",
      sql: BRAND_API_KEYS_SQL,
    },
    interactiveDemoMigrations(),
    onboardingContentMigrations(),
    collectModuleMigrations(),
  );
}
`;
}

/**
 * Mounts métier — consommateur du registre \`modules/\`.
 * EntitySpecs + mounts manuscrits vivent dans \`modules/<id>.ts\` ;
 * schema / dashboard / search restent des mounts partagés d'assemblage.
 */
export function renderBrandModuleApiTs(model: ProductModel): string {
  const pagesJson = JSON.stringify(
    model.pages.map((p) => ({ id: p.id, path: p.path, title: p.title })),
  );
  const flowsJson = JSON.stringify(model.flows);

  return `/**
 * Mounts métier ${model.brandId} — api-kernel /api/v1/modules/* + brand.db.
 * Consommateur du registre de modules (\`modules/index.ts\`) : les EntitySpec
 * et mounts manuscrits vivent dans \`modules/<id>.ts\` (standard kit
 * DOC-STANDARD-MODULE.md). Ne pas ré-inliner de métier ici.
 */
import { createRequire } from "node:module";
import type {
  ApiKernel,
  ApiMount,
  ApiRequest,
} from "@creezio/api-kernel";
import { registerEntityMounts } from "@creezio/api-kernel";
import { mergeAssistantBrandConfig } from "@creezio/assistant";
import {
  collectInteractiveDemoDefaults,
  createInteractiveDemoMount,
  genericOsTourScenario,
} from "@creezio/interactive-demo";
import { createOnboardingContentMount } from "@creezio/onboarding";
import {
  collectApiMounts,
  collectAssistantSources,
  collectDemoScenarios,
  collectEntitySpecs,
  collectOnboardingContent,
} from "./modules/index.js";

const require = createRequire(import.meta.url);

function qstr(req: ApiRequest, key: string): string {
  const v = req.query?.[key];
  if (Array.isArray(v)) return String(v[0] ?? "");
  return v == null ? "" : String(v);
}

function createSchemaMount(): ApiMount {
  return {
    dbLayer: "brand",
    operations: [
      {
        id: "get",
        method: "GET",
        path: "/",
        description: "Schéma métier (entités, pages, flux)",
      },
    ],
    handle: async ({ req }) => {
      if (req.method.toUpperCase() !== "GET") {
        return { status: 405, body: { error: "method_not_allowed" } };
      }
      return {
        status: 200,
        body: {
          brandId: ${JSON.stringify(model.brandId)},
          entities: Object.keys(collectEntitySpecs()),
          pages: ${pagesJson},
          flows: ${flowsJson},
        },
      };
    },
  };
}

function createDashboardMount(): ApiMount {
  return {
    dbLayer: "brand",
    operations: [
      {
        id: "get",
        method: "GET",
        path: "/",
        description: "Compteurs dashboard métier",
      },
    ],
    handle: async ({ req, db }) => {
      if (!db) return { status: 503, body: { error: "db_unavailable" } };
      if (req.method.toUpperCase() !== "GET") {
        return { status: 405, body: { error: "method_not_allowed" } };
      }
      const specs = collectEntitySpecs();
      const entityIds = Object.keys(specs);
      const archivable = new Set(
        entityIds.filter((id) => specs[id]!.archivable),
      );
      const count = (table: string, where = "") =>
        (
          db.prepare(\`SELECT COUNT(*) AS c FROM \${table} \${where}\`).get() as {
            c: number;
          }
        ).c;
      const entityCount = (table: string, where = "") =>
        entityIds.includes(table) ? count(table, where) : 0;
      return {
        status: 200,
        body: {
          fournisseurs: archivable.has("fournisseurs")
            ? entityCount("fournisseurs", "WHERE archived_at IS NULL")
            : entityCount("fournisseurs"),
          produits: archivable.has("produits")
            ? entityCount("produits", "WHERE archived_at IS NULL")
            : entityCount("produits"),
          prix: entityCount("prix"),
          panier_lignes: entityCount("panier_lignes"),
          commandes: entityCount("commandes"),
          promos: entityIds.includes("prix")
            ? count("prix", "WHERE promo = 1")
            : 0,
          entities: Object.fromEntries(
            entityIds.map((id) => [
              id,
              archivable.has(id)
                ? count(id, "WHERE archived_at IS NULL")
                : count(id),
            ]),
          ),
        },
      };
    },
  };
}

function mapMeiliSearchHit(h: Record<string, unknown>): {
  index: string;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
} {
  const index = String(h._index || h.index || "");
  const id = String(h.id ?? "");
  const title = String(h.title || h.nom || id || "");
  const href =
    index === "catalog_products" || index.endsWith("_products")
      ? "/produits/" + encodeURIComponent(id)
      : index === "catalog_sites" || index.endsWith("_sites")
        ? "/marketplaces/" + encodeURIComponent(id)
        : "/" + index.replace(/^catalog_/, "") + "/" + encodeURIComponent(id);
  return {
    index,
    id,
    title,
    subtitle: h.subtitle != null ? String(h.subtitle) : undefined,
    href,
  };
}

/**
 * Index Meili pas prêt : indexation en cours (marqueur posé par l'indexeur
 * kit) ou fingerprint jamais écrit — sert engine:"indexing" (le client
 * réessaie), jamais un scan SQL de secours.
 */
function meiliIndexNotReady(db: {
  prepare(sql: string): { get(...args: unknown[]): unknown };
}): boolean {
  try {
    const hasMeta = db.prepare(
      "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='meta'",
    ).get() as { c: number };
    if (!hasMeta || Number(hasMeta.c) === 0) return true;
    if (db.prepare("SELECT value FROM meta WHERE key='meili_index_in_progress'").get()) {
      return true;
    }
    return !db
      .prepare("SELECT value FROM meta WHERE key='meili_index_fingerprint'")
      .get();
  } catch {
    return false;
  }
}

function createSearchMount(): ApiMount {
  return {
    dbLayer: "brand",
    operations: [
      {
        id: "search",
        method: "GET",
        path: "/",
        description: "Recherche métier (Meili core fail-closed)",
      },
    ],
    handle: async ({ req, db }) => {
      if (!db) return { status: 503, body: { error: "db_unavailable" } };
      if (req.method.toUpperCase() !== "GET") {
        return { status: 405, body: { error: "method_not_allowed" } };
      }
      const q = qstr(req, "q").trim();
      if (!q) return { status: 200, body: { engine: "none", items: [], hits: [] } };

      const host = process.env.MEILI_HOST || "";
      if (host) {
        try {
          const { searchMeiliIndexes } = await import("@creezio/search");
          const { brandMeiliFeed } = await import("./meili-feed.js");
          const hits = await searchMeiliIndexes({
            host,
            masterKey: process.env.MEILI_MASTER_KEY || "",
            indexUids: brandMeiliFeed.indexes.map((i) => i.uid),
            query: q,
          });
          // 0 hit Meili EST la réponse — jamais de fallback SQL
          // parce que la tokenisation ne matche pas.
          const mapped = hits.map((h) => mapMeiliSearchHit(h));
          if (hits.length === 0 && meiliIndexNotReady(db)) {
            return { status: 200, body: { engine: "indexing", items: [], hits: [] } };
          }
          return { status: 200, body: { engine: "meili", items: hits, hits: mapped } };
        } catch (err) {
          // Meili core fail-closed : Meili configuré mais injoignable =
          // incident visible — JAMAIS de scan SQL de secours sur le catalogue.
          if (process.env.CREEZIO_ALLOW_NO_MEILI !== "1") {
            return {
              status: 503,
              body: {
                error: "meili_unavailable",
                reason: err instanceof Error ? err.message : String(err),
              },
            };
          }
        }
      } else if (process.env.CREEZIO_ALLOW_NO_MEILI !== "1") {
        return { status: 503, body: { error: "meili_unavailable", reason: "unconfigured" } };
      }

      // CREEZIO_ALLOW_NO_MEILI=1 UNIQUEMENT (dev/tests hors-browse) :
      // scan SQL visible, engine:"sql" — interdit en production.
      const specs = collectEntitySpecs();
      const needle = q.toLowerCase();
      const items: Array<Record<string, unknown>> = [];
      for (const table of Object.keys(specs)) {
        const rows = db.prepare(\`SELECT * FROM \${table}\`).all() as Array<
          Record<string, unknown>
        >;
        for (const r of rows) {
          if (r.archived_at) continue;
          const hay = Object.values(r)
            .filter((v) => typeof v === "string")
            .join(" ")
            .toLowerCase();
          if (hay.includes(needle)) {
            items.push({ ...r, _table: table, _index: "sql" });
          }
        }
      }
      return {
        status: 200,
        body: {
          engine: "sql",
          items,
          hits: items.map((r) => mapMeiliSearchHit(r)),
        },
      };
    },
  };
}

export function registerBrandModuleApi(api: ApiKernel): void {
  mergeAssistantBrandConfig({ moduleSources: collectAssistantSources() });
  registerEntityMounts(api, collectEntitySpecs());
  for (const [id, mount] of collectApiMounts()) {
    api.registerModuleApi(id, mount);
  }
  api.registerModuleApi(
    "onboarding",
    createOnboardingContentMount({ defaults: collectOnboardingContent() }),
  );
  api.registerModuleApi("schema", createSchemaMount());
  api.registerModuleApi("dashboard", createDashboardMount());
  api.registerModuleApi("search", createSearchMount());
  api.registerModuleApi(
    "interactive-demo",
    createInteractiveDemoMount({
      defaults: collectInteractiveDemoDefaults([
        {
          moduleId: "os",
          scenarios: [
            genericOsTourScenario({
              productName: ${JSON.stringify(model.brandName)},
            }),
          ],
        },
        { moduleId: "brand", scenarios: collectDemoScenarios() },
      ]),
    }),
  );
  // Bonus marque optionnel (brand-bonus-api.ts) — ignore si absent.
  try {
    const bonus = require("./brand-bonus-api.js") as {
      registerBrandBonusApi?: (a: ApiKernel) => void;
    };
    bonus.registerBrandBonusApi?.(api);
  } catch {
    /* pas de bonus */
  }
}
`;
}

export function renderMeiliFeedTs(model: ProductModel): string {
  // Registre de presets factory (meili-feed-presets.ts) : `meili.feedPreset`
  // du brand.yaml prioritaire, sinon le vertical du modèle sert d'id de
  // preset — aucun vertical énuméré dans les types.
  const preset =
    getMeiliFeedPreset(model.meiliFeedPreset) ??
    getMeiliFeedPreset(model.vertical);
  if (!preset) {
    // Première entité RÉELLE du spec — jamais un hardcode « notes » : la
    // table indexée doit exister dans le schema brand généré (sinon
    // l'indexation Meili plante sur une table absente — vécu foove2-admin).
    const ent = model.entities[0];
    if (!ent) {
      return `/**
 * Feed Meili OS shell — aucune table métier tant que module init n'a pas posé d'entité.
 */
import {
  configureMeiliBrandFeed,
  configureMeiliCatalogSqlTables,
  type BrandMeiliFeed,
} from "@creezio/search";

export const brandMeiliFeed: BrandMeiliFeed = {
  id: "${model.brandId}-os",
  schemaVersion: 1,
  progressPrefix: "${model.brandId.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 24) || "BRAND"}",
  countTables: {},
  indexes: [],
  metaIndexUid: "catalog_meta",
};

export function applyBrandMeiliConfig(): void {
  configureMeiliCatalogSqlTables(brandMeiliFeed.countTables);
  configureMeiliBrandFeed(brandMeiliFeed);
}
`;
    }
    const textFields = ent.fields
      .filter((f) => f.type === "text")
      .map((f) => f.name);
    const searchable = textFields.length
      ? textFields
      : ent.fields.slice(0, 1).map((f) => f.name);
    const columns = ["id", ...searchable];
    return `/**
 * Feed Meili générique — première entité du spec (${ent.id}).
 */
import {
  configureMeiliBrandFeed,
  configureMeiliCatalogSqlTables,
  type BrandMeiliFeed,
} from "@creezio/search";

export const brandMeiliFeed: BrandMeiliFeed = {
  id: "${model.brandId}-${ent.id}",
  schemaVersion: 1,
  progressPrefix: "${model.brandId.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 24) || "BRAND"}",
  countTables: { "${ent.id}": "${ent.id}" },
  indexes: [
    {
      uid: "catalog_products",
      countKey: "${ent.id}",
      table: "${ent.id}",
      columns: ${JSON.stringify(columns)},
      docType: "${ent.id}",
      settings: {
        searchableAttributes: ${JSON.stringify(searchable)},
        displayedAttributes: ${JSON.stringify(["id", "type", ...searchable])},
      },
    },
  ],
  metaIndexUid: "catalog_meta",
};

export function applyBrandMeiliConfig(): void {
  configureMeiliCatalogSqlTables(brandMeiliFeed.countTables);
  configureMeiliBrandFeed(brandMeiliFeed);
}
`;
  }

  return preset(model);
}

export function renderBrandKernelHarnessMjs(
  m: AppManifest,
  model: ProductModel,
): string {
  const prefix = m.envPrefix;
  return `#!/usr/bin/env node
/**
 * Harness Node — façade @creezio/app-runtime (même kernel que le desktop).
 * Usage: npm run build:electron && METIER_DATA_DIR=... METIER_PORT=... node scripts/brand-kernel-harness.mjs
 *
 * Fichier GÉNÉRÉ par la factory creezio (template kit) : la même façade pour
 * toutes les marques. Les modules optionnels (catalog-sync, brand-mcp-tools,
 * brand-platform-bindings) sont chargés s'ils existent dans build/electron —
 * le métier reste dans la marque, l'orchestration dans le kit.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  applyBrandCatalogEnvDefaults,
  startBrandKernelHarness,
} from "@creezio/app-runtime";
import { loadLocalEnv } from "./load-local-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadLocalEnv(root);
const PORT = Number(process.env.METIER_PORT || process.env.PORT || 18791);
const electron = path.join(root, "build/electron");

// Catalogue : léger par défaut (tests/CI — pas de download distant).
// Docker prod : CREEZIO_CATALOG=1 (profil prod) ou ${prefix}_CATALOG_ENABLE=1.
// À faire AVANT l'import des modules marque (ils lisent l'env à l'import).
applyBrandCatalogEnvDefaults(${JSON.stringify(prefix)});

const importMod = (name) =>
  import(pathToFileURL(path.join(electron, name)).href);
const importOptional = (name) =>
  fs.existsSync(path.join(electron, name)) ? importMod(name) : null;

const manifestMod = await importMod("app-manifest.js");
const migMod = await importMod("brand-migrations.js");
const apiMod = await importMod("brand-module-api.js");
const feedMod = await importMod("meili-feed.js");
const catalogMod = await importOptional("catalog-sync.js");
const mcpMod = await importOptional("brand-mcp-tools.js");
const bindMod = await importOptional("brand-platform-bindings.js");

const manifestExport = Object.keys(manifestMod).find((k) =>
  k.endsWith("Manifest"),
);
if (!manifestExport) throw new Error("AppManifest introuvable");

const dataDir = process.env.METIER_DATA_DIR || undefined;

await startBrandKernelHarness({
  brandId: ${JSON.stringify(model.brandId)},
  appRoot: root,
  port: PORT,
  manifest: manifestMod[manifestExport],
  brandMigrations: migMod.brandMigrations(),
  registerModuleApi: apiMod.registerBrandModuleApi,
  beforeBoot: () => {
    feedMod.applyBrandMeiliConfig?.();
    bindMod?.applyBrandPlatformBindings?.();
  },
  meiliFeed: feedMod.brandMeiliFeed,
  ...(catalogMod?.createBrandCatalogHost
    ? { catalogHost: catalogMod.createBrandCatalogHost(dataDir) }
    : {}),
  ...(mcpMod?.createBrandModuleMcpTools
    ? { discoverModuleTools: mcpMod.createBrandModuleMcpTools }
    : {}),
});
`;
}

export function renderMainFromPrdNativeTs(
  m: AppManifest,
  model: ProductModel,
): string {
  const exportName = m.brandId.replace(/-([a-z])/g, (_, c: string) =>
    c.toUpperCase(),
  );
  const manifestExport = `${exportName}Manifest`;
  return `/**
 * Main Electron — déclaration marque uniquement (métier + identité).
 * Orchestration OS = @creezio/app-runtime (P&P natif : shell runtime,
 * hosts Hermes/n8n/tunnel, Meili/cloudflared kit, MCP local).
 * Opt-out shell : CREEZIO_DESKTOP_SHELL=window
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { startBrandDesktop } from "@creezio/app-runtime";
import { ${manifestExport} as manifest } from "./app-manifest.js";
import { verticalSlot } from "./vertical-slot.js";
import { brandMigrations } from "./brand-migrations.js";
import { registerBrandModuleApi } from "./brand-module-api.js";
import { brandMeiliFeed, applyBrandMeiliConfig } from "./meili-feed.js";
import { applyBrandPlatformBindings } from "./brand-platform-bindings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

startBrandDesktop({
  manifest,
  electronDirname: __dirname,
  brandMigrations: brandMigrations(),
  registerModuleApi: registerBrandModuleApi,
  beforeBoot: () => {
    applyBrandPlatformBindings();
    applyBrandMeiliConfig();
  },
  meiliFeed: brandMeiliFeed,
  navItems: verticalSlot.items,
  // Défaut kit = "runtime". Opt-out explicite pour CI/fenêtre seule.
  desktopShell:
    process.env.CREEZIO_DESKTOP_SHELL === "window" ? "window" : "runtime",
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
// entities=${model.entities.length}
`;
}
