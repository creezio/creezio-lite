/**
 * Migrations SQLite **cœur** plateforme (M11).
 *
 * Compose auth + Product Hub (ACL H5 + runtime) — SoT kit.
 * Les marques ne doivent plus dupliquer cette liste ; elles gardent
 * uniquement `brand-migrations` métier.
 *
 * N4 — couverture vs steps historiques brand.db :
 * - `028/030/032` plugin_* → `PRODUCT_HUB_*_SQL` + `migrateLegacyBrandProductHubOnce`
 * - auth utilisateurs kit → `AUTH_CORE_SQL` (`creezio_users`, pas table `users` legacy)
 * - autres steps plateforme (api_keys, mcp, tasks brand, emails, analytics, …)
 *   → `platformHistoricalMigrations()` (brand.db / schema_version)
 *
 * Chargement SQL via `createAppRequire` (asar-safe) pour éviter le cycle
 * compile-time `platform-core → auth|product-hub → platform-core`.
 * Ne jamais ancrer sur `process.cwd()` — packagé Win = installDir sans node_modules.
 */

import { composeMigrations, type SqliteMigration } from "./sqlite-migrations.js";
import { createAppRequire } from "./app-require.js";

/** IDs stables (TF gold H3 / I10 / R2) — ne pas renommer après apply. */
export const PLATFORM_CORE_MIGRATION_IDS = [
  "h3_core_001_auth",
  "h3_core_002_product_hub",
  "i10_core_003_product_hub_acl_h5",
  "r2_core_004_product_hub_runtime",
] as const;

export type PlatformCoreMigrationId =
  (typeof PLATFORM_CORE_MIGRATION_IDS)[number];

export type PlatformCoreMigrationsOptions = {
  /** Inclure `PRODUCT_HUB_RUNTIME_SQL` (défaut true — parité TF R2). */
  includeProductHubRuntime?: boolean;
  /** Migrations cœur additionnelles (assistant, tasks, mails, obs…). */
  extras?: readonly SqliteMigration[];
};

type AuthSqlMod = { AUTH_CORE_SQL: string };
type HubSqlMod = {
  PRODUCT_HUB_CORE_SQL: string;
  PRODUCT_HUB_ACL_USER_SQL: string;
  PRODUCT_HUB_ACL_ORG_SQL: string;
  PRODUCT_HUB_ACL_H5_SQL: string;
  PRODUCT_HUB_RUNTIME_SQL: string;
};

function loadWorkspaceRequire(): NodeRequire {
  return createAppRequire();
}

function loadAuthSql(req: NodeRequire): string {
  const mod = req("@creezio/auth") as AuthSqlMod;
  if (typeof mod.AUTH_CORE_SQL !== "string" || !mod.AUTH_CORE_SQL.trim()) {
    throw new Error("platformCoreMigrations: AUTH_CORE_SQL introuvable (@creezio/auth)");
  }
  return mod.AUTH_CORE_SQL;
}

function loadHubSql(req: NodeRequire): HubSqlMod {
  const mod = req("@creezio/product-hub") as HubSqlMod;
  for (const key of [
    "PRODUCT_HUB_CORE_SQL",
    "PRODUCT_HUB_ACL_USER_SQL",
    "PRODUCT_HUB_ACL_ORG_SQL",
    "PRODUCT_HUB_ACL_H5_SQL",
    "PRODUCT_HUB_RUNTIME_SQL",
  ] as const) {
    if (typeof mod[key] !== "string" || !mod[key].trim()) {
      throw new Error(
        `platformCoreMigrations: ${key} introuvable (@creezio/product-hub)`,
      );
    }
  }
  return mod;
}

/**
 * Migrations SQLite cœur Creezio (auth + Product Hub).
 * IDs = `PLATFORM_CORE_MIGRATION_IDS` (TF gold).
 */
export function platformCoreMigrations(
  opts?: PlatformCoreMigrationsOptions,
): SqliteMigration[] {
  const req = loadWorkspaceRequire();
  const authSql = loadAuthSql(req);
  const hub = loadHubSql(req);
  const includeRuntime = opts?.includeProductHubRuntime !== false;

  const groups: SqliteMigration[] = [
    { id: "h3_core_001_auth", sql: authSql },
    {
      id: "h3_core_002_product_hub",
      sql: [
        hub.PRODUCT_HUB_CORE_SQL,
        hub.PRODUCT_HUB_ACL_USER_SQL,
        hub.PRODUCT_HUB_ACL_ORG_SQL,
      ].join("\n"),
    },
    {
      id: "i10_core_003_product_hub_acl_h5",
      sql: hub.PRODUCT_HUB_ACL_H5_SQL,
    },
  ];

  if (includeRuntime) {
    groups.push({
      id: "r2_core_004_product_hub_runtime",
      sql: hub.PRODUCT_HUB_RUNTIME_SQL,
    });
  }

  return composeMigrations(...groups, ...(opts?.extras ?? []));
}
