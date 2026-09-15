/**
 * Cibles factory-reset — logique PURE (chemins).
 * Le wipe Electron (sessions) reste dans @creezio/electron-shell.
 *
 * Port paramétré de electron/factory-reset.ts (kit).
 */

import path from "node:path";
import type { AppManifest } from "@creezio/brand-config";
import type { PathsContext } from "./paths.js";
import {
  resolveAssistantDbPath,
  resolveDbPath,
  resolveLocalConfigPath,
  resolveMeiliDataDir,
  resolveUserDataDir,
} from "./paths.js";
import {
  resolveBrandDbPath,
  resolveCoreDbPath,
  resolveSqliteRoot,
} from "./sqlite-layout.js";

/**
 * Liste des chemins userData ciblés (hors logs / install-id).
 * Les préfixes marque (`{brandId}-node`, `.{brandId}-…`) sont dérivés de brandId.
 */
export function factoryResetTargets(
  ctx: PathsContext,
  extras: string[] = [],
): string[] {
  const root = resolveUserDataDir(ctx);
  const brand = ctx.manifest.brandId;
  return [
    resolveLocalConfigPath(ctx),
    resolveDbPath(ctx),
    resolveBrandDbPath(ctx),
    resolveCoreDbPath(ctx),
    resolveSqliteRoot(ctx),
    resolveAssistantDbPath(ctx),
    path.join(root, "uploads"),
    resolveMeiliDataDir(ctx),
    path.join(root, "catalog-download.gz.part"),
    path.join(root, "Partitions"),
    path.join(root, "Cookies"),
    path.join(root, "Cookies-journal"),
    path.join(root, "Local Storage"),
    path.join(root, "Session Storage"),
    path.join(root, "IndexedDB"),
    path.join(root, "hermes-home"),
    path.join(root, "hermes-runtime"),
    path.join(root, "hermes-webui-state"),
    path.join(root, "n8n-home"),
    path.join(root, "n8n-runtime"),
    path.join(root, "plugins"),
    path.join(root, `.${brand}-hermes-crm-api-key.json`),
    path.join(root, `.${brand}-plugins-api-token`),
    path.join(root, `${brand}-node`),
    path.join(root, `${brand}-npm`),
    path.join(root, "tool-cache"),
    path.join(root, "os-appdata"),
    path.join(root, "tunnel-home"),
    path.join(root, "tmp"),
    ...extras,
  ];
}

/** Préfixes de partitions Chromium à purger (fournisseur / extsite / AI). */
export function factoryResetPartitionPrefixes(
  manifest: AppManifest,
): string[] {
  return [
    "fournisseur-",
    "extsite-",
    `${manifest.brandId}-ai-`,
    manifest.sessionPartition,
  ];
}
