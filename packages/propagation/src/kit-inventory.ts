/**
 * Inventaire versions packages kit (local workspace + métadonnées).
 * Utilisé par la console et `kit:version`.
 */

import fs from "node:fs";
import path from "node:path";
import { KIT_PACKAGES, type CreezioPackageName } from "./packages.js";

export type KitPackageVersionRow = {
  name: CreezioPackageName;
  dir: string;
  version: string;
  summary: string;
  layer: string;
  dependsOn: CreezioPackageName[];
  /** true si package.json lu depuis le disque */
  local: boolean;
  /** Chemin package.json */
  packageJsonPath: string | null;
  /** Docs gate / phase liées */
  docs: string[];
};

export type KitInventory = {
  generatedAt: string;
  kitRoot: string;
  rootVersion: string | null;
  packages: KitPackageVersionRow[];
};

function readJsonVersion(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const j = JSON.parse(raw) as { version?: string };
    return typeof j.version === "string" ? j.version : null;
  } catch {
    return null;
  }
}

export function collectKitInventory(kitRoot: string): KitInventory {
  const rootPkg = path.join(kitRoot, "package.json");
  const rootVersion = readJsonVersion(rootPkg);

  const packages: KitPackageVersionRow[] = KIT_PACKAGES.map((meta) => {
    const packageJsonPath = path.join(
      kitRoot,
      "packages",
      meta.dir,
      "package.json",
    );
    const version = readJsonVersion(packageJsonPath);
    return {
      name: meta.name,
      dir: meta.dir,
      version: version || "0.0.0",
      summary: meta.summary,
      layer: meta.layer,
      dependsOn: [...meta.dependsOn],
      local: version !== null,
      packageJsonPath: version !== null ? packageJsonPath : null,
      docs: [
        "docs/PROPAGATION.md",
        "docs/archive/PHASE-F.md",
        "docs/PLATFORM-VS-VERTICAL.md",
      ],
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    kitRoot,
    rootVersion,
    packages,
  };
}

/** Versions publiées = locales tant que le registry npm privé n'est pas branché. */
export type PublishedKitHint = {
  name: CreezioPackageName;
  localVersion: string;
  publishedVersion: string | null;
  publishChannel: "workspace-local" | "npm-private" | "unpublished";
  note: string;
};

export function publishedHintsFromInventory(
  inventory: KitInventory,
): PublishedKitHint[] {
  return inventory.packages.map((p) => ({
    name: p.name,
    localVersion: p.version,
    publishedVersion: p.local ? p.version : null,
    publishChannel: p.local ? "workspace-local" : "unpublished",
    note: p.local
      ? "Version workspace locale (= source de vérité Phase F ; npm registry hors scope)"
      : "package.json introuvable",
  }));
}
