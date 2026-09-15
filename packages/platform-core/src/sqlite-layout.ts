/**
 * Layout SQLite multi-fichiers (Phase H1.0) — core / brand / plugin/<id>.
 *
 * Migration depuis `resolveDbPath` :
 * - `resolveBrandDbPath` === `resolveDbPath` (même fichier `manifest.dbFileName`)
 *   pour ne pas casser les marques déjà branchées ;
 * - `resolveCoreDbPath` / `resolvePluginDbPath` sont les nouveaux chemins
 *   sous `{userData}/sqlite/` ;
 * - `resolveDbPath` reste un alias déprécié de la base métier (brand).
 *
 * Voir docs/archive/PHASE-H1.md et ARCHITECTURE-INTENTION.md.
 */

import fs from "node:fs";
import path from "node:path";
import type { PathsContext } from "./paths.js";
import { resolveUserDataDir } from "./paths.js";
import { envKey } from "@creezio/brand-config";
import { isValidPluginId } from "./plugins/plugin-manifest.js";

/** Nom fichier SQLite cœur Creezio (sous `sqlite/`). */
export const CORE_DB_FILENAME = "core.db" as const;

/** Dossier relatif userData pour le layout multi-fichiers. */
export const SQLITE_LAYOUT_DIR = "sqlite" as const;

/** Sous-dossier des DB plugins. */
export const PLUGIN_DB_SUBDIR = "plugin" as const;

function readEnvOverride(ctx: PathsContext, suffix: string): string {
  if (ctx.isPackaged) return "";
  const env = ctx.env ?? process.env;
  return (env[envKey(ctx.manifest, suffix)] || "").trim();
}

/** Racine `{userData}/sqlite`. */
export function resolveSqliteRoot(ctx: PathsContext): string {
  const override = readEnvOverride(ctx, "SQLITE_ROOT_OVERRIDE");
  if (override) return override;
  return path.join(resolveUserDataDir(ctx), SQLITE_LAYOUT_DIR);
}

/**
 * Chemin SQLite **core** Creezio (auth, sessions, Product Hub registry,
 * tasks/mails plateforme, config plateforme…).
 */
export function resolveCoreDbPath(ctx: PathsContext): string {
  const override = readEnvOverride(ctx, "CORE_DB_PATH_OVERRIDE");
  if (override) return override;
  return path.join(resolveSqliteRoot(ctx), CORE_DB_FILENAME);
}

/**
 * Chemin SQLite **brand** / métier.
 * Soft-compat : même résolution que `resolveDbPath` (`manifest.dbFileName`
 * sous userData, override `DB_PATH_OVERRIDE` / `BRAND_DB_PATH_OVERRIDE`).
 */
export function resolveBrandDbPath(ctx: PathsContext): string {
  const brandOverride = readEnvOverride(ctx, "BRAND_DB_PATH_OVERRIDE");
  if (brandOverride) return brandOverride;
  const legacyOverride = readEnvOverride(ctx, "DB_PATH_OVERRIDE");
  if (legacyOverride) return legacyOverride;
  return path.join(resolveUserDataDir(ctx), ctx.manifest.dbFileName);
}

/**
 * Chemin SQLite d'un plugin (`sqlite/plugin/<id>.db`).
 * Créé **à l'install** via `ensurePluginDb` — pas au jour 0 serveur.
 */
export function resolvePluginDbPath(ctx: PathsContext, pluginId: string): string {
  if (!isValidPluginId(pluginId)) {
    throw new Error(`pluginId invalide pour resolvePluginDbPath: ${pluginId}`);
  }
  const dirOverride = readEnvOverride(ctx, "PLUGIN_DB_DIR_OVERRIDE");
  const root = dirOverride || path.join(resolveSqliteRoot(ctx), PLUGIN_DB_SUBDIR);
  return path.join(root, `${pluginId}.db`);
}

export type EnsurePluginDbResult = {
  pluginId: string;
  path: string;
  /** true si le fichier n'existait pas avant cet appel. */
  created: boolean;
};

/**
 * Garantit l'existence du fichier DB plugin (mkdir + touch).
 * N'applique **pas** de schéma métier — l'appelant / Product Hub le fait.
 */
export function ensurePluginDb(
  ctx: PathsContext,
  pluginId: string,
): EnsurePluginDbResult {
  const dbPath = resolvePluginDbPath(ctx, pluginId);
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const created = !fs.existsSync(dbPath);
  if (created) {
    fs.writeFileSync(dbPath, Buffer.alloc(0));
  }
  return { pluginId, path: dbPath, created };
}

/** true si le fichier DB plugin existe déjà. */
export function pluginDbExists(ctx: PathsContext, pluginId: string): boolean {
  return fs.existsSync(resolvePluginDbPath(ctx, pluginId));
}

/**
 * H5 — supprime le fichier DB plugin (après close du handle).
 * Ne touche jamais core/brand.
 */
export function removePluginDb(
  ctx: PathsContext,
  pluginId: string,
): { removed: boolean; path: string } {
  const dbPath = resolvePluginDbPath(ctx, pluginId);
  if (!fs.existsSync(dbPath)) {
    return { removed: false, path: dbPath };
  }
  fs.rmSync(dbPath, { force: true });
  return { removed: true, path: dbPath };
}

/**
 * Chemins jour 0 serveur : core + brand uniquement (pas de plugin).
 */
export function resolveDay0SqlitePaths(ctx: PathsContext): {
  core: string;
  brand: string;
} {
  return {
    core: resolveCoreDbPath(ctx),
    brand: resolveBrandDbPath(ctx),
  };
}

/** Garantit les dossiers parents pour core (+ optionnellement brand). */
export function ensureDay0SqliteLayout(
  ctx: PathsContext,
  opts?: { touchBrand?: boolean },
): { core: string; brand: string } {
  const paths = resolveDay0SqlitePaths(ctx);
  fs.mkdirSync(path.dirname(paths.core), { recursive: true });
  if (!fs.existsSync(paths.core)) {
    fs.writeFileSync(paths.core, Buffer.alloc(0));
  }
  if (opts?.touchBrand) {
    fs.mkdirSync(path.dirname(paths.brand), { recursive: true });
    if (!fs.existsSync(paths.brand)) {
      fs.writeFileSync(paths.brand, Buffer.alloc(0));
    }
  }
  return paths;
}
