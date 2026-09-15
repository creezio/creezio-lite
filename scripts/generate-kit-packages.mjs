#!/usr/bin/env node
/**
 * Générateur du manifeste des packages kit publiés —
 * `packages/platform-core/kit-packages.json`.
 *
 * Pourquoi : les apps consommatrices (gates deps-integrity, tooling de
 * propagation) ont besoin de la liste OFFICIELLE des packages `@creezio/*`
 * publiés. Avant, chaque app maintenait sa propre liste en dur — friction à
 * chaque nouveau package. Le manifeste vit dans platform-core (package
 * toujours installé) et suit le cycle de release lockstep.
 *
 * Source de vérité : `packages/*\/package.json` avec `private !== true` ET
 * `publishConfig.registry` (les packages privés — factory, propagation —
 * ne sont jamais publiés).
 *
 * Usage :
 *   node scripts/generate-kit-packages.mjs          # écrit le manifeste
 *   node scripts/generate-kit-packages.mjs --check  # vérifie (exit 1 si stale)
 *
 * Régénération : automatique en fin de `build-workspaces` ; la fraîcheur est
 * garantie par la gate `test-phase-kit-packages-manifest.mjs`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KIT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const MANIFEST_REL = "packages/platform-core/kit-packages.json";

/** Noms des packages `@creezio/*` publiés (triés). */
export function listPublishedKitPackages(root = KIT_ROOT) {
  const dir = path.join(root, "packages");
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = path.join(dir, entry.name, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (pkg.private === true) continue;
    if (!pkg.publishConfig?.registry) continue;
    if (!String(pkg.name || "").startsWith("@creezio/")) continue;
    out.push(pkg.name);
  }
  return out.sort();
}

export function renderManifest(root = KIT_ROOT) {
  return (
    JSON.stringify(
      {
        $comment:
          "GÉNÉRÉ par scripts/generate-kit-packages.mjs — ne pas éditer à la main. Liste des packages @creezio/* publiés (lockstep), consommée par les gates deps-integrity des apps.",
        packages: listPublishedKitPackages(root),
      },
      null,
      2,
      null,
    ) + "\n"
  );
}

function main() {
  const check = process.argv.includes("--check");
  const manifestPath = path.join(KIT_ROOT, MANIFEST_REL);
  const expected = renderManifest();
  const current = fs.existsSync(manifestPath)
    ? fs.readFileSync(manifestPath, "utf8")
    : "";
  if (check) {
    if (current !== expected) {
      console.error(
        `${MANIFEST_REL} n'est pas à jour → node scripts/generate-kit-packages.mjs`,
      );
      process.exit(1);
    }
    console.log(`${MANIFEST_REL} à jour`);
    return;
  }
  if (current !== expected) {
    fs.writeFileSync(manifestPath, expected);
    console.log(`écrit ${MANIFEST_REL}`);
  } else {
    console.log(`${MANIFEST_REL} déjà à jour`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}