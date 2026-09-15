#!/usr/bin/env node
/**
 * Codemod H12 (2/2) — dé-brandage du module workspace de @creezio/shell-ui
 * (ARCHITECTURE_VERSION H11 → H12).
 *
 * Usage (contrat scripts/codemods/README.md) :
 *   ROOT=<racine du clone marque> node h12-workspace-debrand.mjs
 *
 * Le kit n'exporte plus le domaine métier TF du workspace. Réécritures :
 *
 *   1. renommages 1:1 vers les noms neutres (déjà SoT depuis O9) :
 *      `isSupplierHref` → `isExternalSiteHref`,
 *      `fournisseurIdFromHref` → `siteIdFromHref`,
 *      `supplierHref` → `externalSiteHref`,
 *      `SupplierTabMeta` → `ExternalSiteTabMeta`,
 *      `createSupplierTab` → `createExternalSiteTab`,
 *      `OpenSupplierSiteOpts` → `OpenExternalSiteOpts`,
 *      `TabWorkspaceOpenSupplierSiteOpts` → `TabWorkspaceOpenExternalSiteOpts`,
 *      `openSupplierSite` → `openExternalSite`,
 *      `patchSupplierTab` → `patchExternalSiteTab`,
 *      `isOptimiserCanvasHref` → `isCanvasHref` ;
 *      + clé `fournisseurId:` → `siteId:` dans les appels renommés ;
 *   2. `configureFullscreenPaths({ panierPath, optimiserPath })` →
 *      `configureWorkspacePaths({ fullscreenPaths, canvases })` (le canvas
 *      hérite du query param historique `commande` — iso-comportement) ;
 *   3. `TF_LEGACY_PANIER_PATH` / `TF_LEGACY_OPTIMISER_PATH` : retirés des
 *      imports/ré-exports kit ; usages restants remplacés par les littéraux
 *      historiques `"/panier"` / `"/optimiser"` ;
 *   4. `PANIER_PATH` / `OPTIMISER_PATH` importés (ou ré-exportés) depuis le
 *      kit : deviennent des constantes DE MARQUE (valeurs lues dans l'appel
 *      `configureFullscreenPaths` du repo ; REFUS exit 1 si introuvables).
 *
 * Idempotent : relancer sur une marque déjà migrée = no-op (exit 0, zéro
 * ligne `~`). Ne touche jamais node_modules/, dist/, dist-cjs/, .next/,
 * docker-data/, .git/ ni les lockfiles.
 */
import fs from "node:fs";
import path from "node:path";
import { shouldSkipDir } from "../lib/skip-dirs.mjs";

const ROOT = path.resolve(process.env.ROOT || ".");
if (!fs.existsSync(ROOT)) {
  console.error(`ROOT introuvable : ${ROOT}`);
  process.exit(1);
}

const CODE_EXT_RE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

const RENAMES = [
  ["isSupplierHref", "isExternalSiteHref"],
  ["fournisseurIdFromHref", "siteIdFromHref"],
  ["supplierHref", "externalSiteHref"],
  ["SupplierTabMeta", "ExternalSiteTabMeta"],
  ["createSupplierTab", "createExternalSiteTab"],
  ["TabWorkspaceOpenSupplierSiteOpts", "TabWorkspaceOpenExternalSiteOpts"],
  ["OpenSupplierSiteOpts", "OpenExternalSiteOpts"],
  ["openSupplierSite", "openExternalSite"],
  ["patchSupplierTab", "patchExternalSiteTab"],
  ["isOptimiserCanvasHref", "isCanvasHref"],
];

const LEGACY_CONST_LITERALS = {
  TF_LEGACY_PANIER_PATH: '"/panier"',
  TF_LEGACY_OPTIMISER_PATH: '"/optimiser"',
};

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (shouldSkipDir(name)) continue;
      walk(p, acc);
    } else {
      acc.push(p);
    }
  }
  return acc;
}

const rel = (abs) => path.relative(ROOT, abs);
const allFiles = walk(ROOT).filter((p) => CODE_EXT_RE.test(p));

// ---------------------------------------------------------------------------
// Pré-passe : valeurs de marque des chemins workspace (configureFullscreenPaths).
// ---------------------------------------------------------------------------
const CONFIGURE_CALL_RE =
  /configureFullscreenPaths\(\s*\{([\s\S]*?)\}\s*,?\s*\)/;
let panierValue = null;
let optimiserValue = null;
for (const abs of allFiles) {
  const m = CONFIGURE_CALL_RE.exec(fs.readFileSync(abs, "utf8"));
  if (!m) continue;
  const pm = /panierPath\s*:\s*(["'][^"']*["'])/.exec(m[1]);
  const om = /optimiserPath\s*:\s*(["'][^"']*["'])/.exec(m[1]);
  if (pm) panierValue = pm[1];
  if (om) optimiserValue = om[1];
}

// ---------------------------------------------------------------------------
// Passe 1 (dry) : calculer toutes les écritures, échouer AVANT tout write.
// ---------------------------------------------------------------------------
const KIT_IMPORT_RE =
  /(import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*(["'])@creezio\/shell-ui(?:\/ui)?\4\s*;?/g;
const REMOVED_PATH_CONSTS = ["PANIER_PATH", "OPTIMISER_PATH"];
const writes = [];

for (const abs of allFiles) {
  const src = fs.readFileSync(abs, "utf8");
  let next = src;

  // 1. Renommages 1:1.
  for (const [from, to] of RENAMES) {
    next = next.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  }
  // Clé métier dans les appels renommés (options des sites externes).
  next = next.replace(
    /\b(createExternalSiteTab|openExternalSite)(\?\.)?\(\s*\{([^}]*)\}/g,
    (full, fn, chain, inner) =>
      `${fn}${chain || ""}({${inner.replace(/\bfournisseurId(\s*:)/g, "siteId$1")}}`,
  );

  // 2. configureFullscreenPaths → configureWorkspacePaths.
  next = next.replace(CONFIGURE_CALL_RE, (full, inner) => {
    const pm = /panierPath\s*:\s*(["'][^"']*["'])/.exec(inner);
    const om = /optimiserPath\s*:\s*(["'][^"']*["'])/.exec(inner);
    if ((!pm && /panierPath/.test(inner)) || (!om && /optimiserPath/.test(inner))) {
      console.error(
        `✗ codemod H12 (workspace) : ${rel(abs)} appelle ` +
          `configureFullscreenPaths avec des valeurs non littérales — ` +
          `migrer manuellement vers configureWorkspacePaths puis relancer — ` +
          `marque intacte.`,
      );
      process.exit(1);
    }
    const parts = [];
    if (pm) parts.push(`  fullscreenPaths: [${pm[1]}],`);
    if (om) parts.push(`  canvases: [{ path: ${om[1]}, requiredQuery: "commande" }],`);
    return `configureWorkspacePaths({\n${parts.join("\n")}\n})`;
  });

  // 3+4. Spécificateurs disparus des imports/ré-exports kit.
  const localConsts = [];
  next = next.replace(KIT_IMPORT_RE, (full, kind, typeOnly, inner, quote) => {
    const specs = inner
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const kept = [];
    for (const spec of specs) {
      const name = spec.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      // TF_LEGACY_* : alias dépréciés, jamais recréés — les usages restants
      // sont remplacés par les littéraux historiques (étape 3bis).
      if (name in LEGACY_CONST_LITERALS) continue;
      if (REMOVED_PATH_CONSTS.includes(name)) {
        const value = name === "PANIER_PATH" ? panierValue : optimiserValue;
        if (!value) {
          console.error(
            `✗ codemod H12 (workspace) : ${rel(abs)} importe ${name} depuis ` +
              `le kit mais aucun appel configureFullscreenPaths littéral ne ` +
              `fournit sa valeur — définir la constante côté marque puis ` +
              `relancer — marque intacte.`,
          );
          process.exit(1);
        }
        localConsts.push(
          `${kind === "export" ? "export " : ""}const ${name} = ${value};`,
        );
        continue;
      }
      if (name === "configureFullscreenPaths") {
        kept.push(spec.replace("configureFullscreenPaths", "configureWorkspacePaths"));
        continue;
      }
      kept.push(spec);
    }
    // Dédoublonne (renommage vers un nom déjà importé).
    const seen = new Set();
    const deduped = kept.filter((s) => {
      const key = s.replace(/^type\s+/, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!deduped.length) return "";
    const keyword = `${kind}${typeOnly ? " type" : ""}`;
    const body =
      deduped.length === 1
        ? `{ ${deduped[0]} }`
        : `{\n  ${deduped.join(",\n  ")},\n}`;
    return `${keyword} ${body} from ${quote}@creezio/shell-ui${full.includes("/ui") ? "/ui" : ""}${quote};`;
  });

  // 3bis. Usages restants des constantes TF_LEGACY_* → littéraux (AVANT
  // l'ajout des constantes de marque, pour ne pas réécrire leurs noms).
  for (const [name, literal] of Object.entries(LEGACY_CONST_LITERALS)) {
    next = next.replace(new RegExp(`\\b${name}\\b`, "g"), literal);
  }
  if (localConsts.length) {
    next = `${next.trimEnd()}\n\n${localConsts.join("\n")}\n`;
  }

  // Références résiduelles (commentaires / docs inline) — l'appel runtime a
  // déjà été réécrit plus haut, sinon exit 1.
  next = next.replace(/\bconfigureFullscreenPaths\b/g, "configureWorkspacePaths");

  if (next !== src) writes.push({ abs, rel: rel(abs), body: next });
}

// ---------------------------------------------------------------------------
// Passe 2 : écrire.
// ---------------------------------------------------------------------------
if (writes.length === 0) {
  console.log("✓ codemod H12 (workspace) : rien à migrer — no-op");
} else {
  for (const { abs, body } of writes) fs.writeFileSync(abs, body, "utf8");
  console.log(`✓ codemod H12 (workspace) : ${writes.length} fichier(s) migré(s)`);
  for (const { rel: r } of writes) console.log(`  ~ ${r}`);
}
