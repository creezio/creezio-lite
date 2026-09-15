/**
 * Utilitaires de chemins génériques — paramétrés par AppManifest.
 *
 * Pas d'import Electron ici (testable depuis Node). L'appelant fournit
 * `userDataRoot` (ex. `app.getPath("userData")`) et `isPackaged`.
 *
 * Layout packagé (échelle kit) : `{installDir}/data/` — logs, crash-reports,
 * sqlite, embeds. Pas de Roaming/%APPDATA% pour les données runtime.
 *
 * Source d'abstraction : electron/paths.ts (kit / marques).
 */

import fs from "node:fs";
import path from "node:path";
import type { AppManifest } from "@creezio/brand-config";
import { envKey } from "@creezio/brand-config";

/** Nom du dossier data sous l'install (portable). */
export const INSTALL_DATA_DIRNAME = "data";

export type InstallDataResolveOpts = {
  execPath: string;
  isPackaged: boolean;
  env?: NodeJS.ProcessEnv;
  /** Sous-dossier (défaut `data`). */
  dataDirName?: string;
};

/**
 * Racine d'installation writable (dossier contenant l'exe / l'AppImage).
 * `null` si non packagé.
 *
 * - Windows NSIS / linux-unpacked : `dirname(execPath)`
 * - AppImage : `dirname($APPIMAGE)` (le squashfs monté est read-only)
 */
export function resolveInstallRoot(
  opts: InstallDataResolveOpts,
): string | null {
  if (!opts.isPackaged) return null;
  const env = opts.env ?? process.env;
  const appImage = (env.APPIMAGE || "").trim();
  if (appImage) return path.dirname(path.resolve(appImage));
  return path.dirname(path.resolve(opts.execPath));
}

/**
 * userData packagé = `{installRoot}/data`.
 * `null` si non packagé (garder le défaut Electron / remap segment).
 */
export function resolvePackagedDataDir(
  opts: InstallDataResolveOpts,
): string | null {
  const root = resolveInstallRoot(opts);
  if (!root) return null;
  return path.join(root, opts.dataDirName || INSTALL_DATA_DIRNAME);
}

/**
 * Heuristique avant `app.isPackaged` : `resources/` à côté de l'exe,
 * ou `$APPIMAGE`. Sert au log ultra-early.
 */
export function guessPackagedDataDir(opts: {
  execPath: string;
  env?: NodeJS.ProcessEnv;
  dataDirName?: string;
  existsSync?: (p: string) => boolean;
}): string | null {
  const env = opts.env ?? process.env;
  const exists = opts.existsSync ?? ((p: string) => fs.existsSync(p));
  const name = opts.dataDirName || INSTALL_DATA_DIRNAME;
  const appImage = (env.APPIMAGE || "").trim();
  if (appImage) {
    return path.join(path.dirname(path.resolve(appImage)), name);
  }
  const install = path.dirname(path.resolve(opts.execPath));
  if (exists(path.join(install, "resources"))) {
    return path.join(install, name);
  }
  return null;
}

export type PathsContext = {
  manifest: AppManifest;
  /** Racine userData déjà résolue (Electron ou override). */
  userDataRoot: string;
  /** true = build packagé → ignore les overrides d'env. */
  isPackaged: boolean;
  /** process.env (injectable pour tests). */
  env?: NodeJS.ProcessEnv;
  /**
   * Racine ressources packagées (`process.resourcesPath`) ou racine repo en dev.
   * Requis pour résoudre binaires vendor / preload.
   */
  resourcesRoot?: string;
};

function readEnvOverride(ctx: PathsContext, suffix: string): string {
  if (ctx.isPackaged) return "";
  const env = ctx.env ?? process.env;
  return (env[envKey(ctx.manifest, suffix)] || "").trim();
}

/** Racine userData effective (honore `{PREFIX}_USER_DATA_OVERRIDE` hors packagé). */
export function resolveUserDataDir(ctx: PathsContext): string {
  const override = readEnvOverride(ctx, "USER_DATA_OVERRIDE");
  return override || ctx.userDataRoot;
}

/**
 * Chemin SQLite principal (= base **brand** / métier).
 *
 * @deprecated Préférer `resolveBrandDbPath` (H1.0). Alias conservé pour
 * soft-compat des marques déjà branchées (marques).
 */
export function resolveDbPath(ctx: PathsContext): string {
  const override = readEnvOverride(ctx, "DB_PATH_OVERRIDE");
  if (override) return override;
  return path.join(resolveUserDataDir(ctx), ctx.manifest.dbFileName);
}

/** Config locale JSON. */
export function resolveLocalConfigPath(ctx: PathsContext): string {
  return path.join(resolveUserDataDir(ctx), ctx.manifest.localConfigFileName);
}

/** Base conversations assistant (nom commun aux 3 marques). */
export function resolveAssistantDbPath(ctx: PathsContext): string {
  return path.join(resolveUserDataDir(ctx), "assistant_chats.db");
}

export function resolveUploadsDir(ctx: PathsContext): string {
  return path.join(resolveUserDataDir(ctx), "uploads", "img");
}

export function resolveMeiliDataDir(ctx: PathsContext): string {
  return path.join(resolveUserDataDir(ctx), "meili");
}

export function resolveHermesHomeDir(ctx: PathsContext): string {
  return path.join(resolveUserDataDir(ctx), "hermes-home");
}

export function resolveN8nHomeDir(ctx: PathsContext): string {
  return path.join(resolveUserDataDir(ctx), "n8n-home");
}

export function resolveLogsDir(ctx: PathsContext): string {
  return path.join(resolveUserDataDir(ctx), "logs");
}

export function resolveMainLogPath(ctx: PathsContext): string {
  return path.join(resolveLogsDir(ctx), `${ctx.manifest.logBasename}.log`);
}

export function resolveTunnelHomeDir(ctx: PathsContext): string {
  return path.join(resolveUserDataDir(ctx), "tunnel-home");
}

export function resolveNodeRuntimeDir(ctx: PathsContext): string {
  return path.join(resolveUserDataDir(ctx), `${ctx.manifest.brandId}-node`);
}

/**
 * Calcule le userData cible pour un kind packagé (client/server).
 * Pure — l'appelant crée le dossier et appelle `app.setPath`.
 */
export function userDataDirForKind(
  manifest: AppManifest,
  kind: "client" | "server",
  currentUserData: string,
): string {
  const parent = path.dirname(currentUserData);
  const segment =
    kind === "server"
      ? manifest.server.userDataSegment
      : manifest.client.userDataSegment;
  return path.join(parent, segment);
}

/** Feed auto-update pour un kind. */
export function feedUrlForKind(
  manifest: AppManifest,
  kind: "client" | "server",
): string {
  return kind === "server" ? manifest.server.feedUrl : manifest.client.feedUrl;
}

/**
 * Racine ressources embarquées.
 * - packagé : `resourcesRoot` (= process.resourcesPath)
 * - dev     : fourni par l'appelant (racine repo crm/)
 */
export function resolveResourcesRoot(ctx: PathsContext): string {
  if (ctx.resourcesRoot) return ctx.resourcesRoot;
  return resolveUserDataDir(ctx);
}

/** Candidats binaire Meilisearch (OS courant). */
export function meiliBinaryCandidates(ctx: PathsContext): string[] {
  const root = resolveResourcesRoot(ctx);
  const plat =
    process.platform === "win32"
      ? "win-x64"
      : process.platform === "darwin"
        ? "darwin"
        : "linux";
  const name =
    process.platform === "win32" ? "meilisearch.exe" : "meilisearch";
  return [
    path.join(root, "bin", `meilisearch-${plat}`, name),
    path.join(root, "resources", "bin", `meilisearch-${plat}`, name),
    path.join(root, "vendor", "meilisearch", name),
  ];
}

/** Chemin preload compilé sous build/electron ou resources. */
export function resolvePreloadPath(
  ctx: PathsContext,
  fileName: string,
): string {
  const root = resolveResourcesRoot(ctx);
  return path.join(root, "build", "electron", fileName);
}
