#!/usr/bin/env node
/**
 * Codemod H8 — extraction des manifests marque du kit (P1.d).
 *
 * Usage (contrat scripts/codemods/README.md) :
 *   ROOT=<racine du clone marque> node h8-materialize-brand-manifest.mjs
 *
 * Le kit ne publie plus les manifests de ses marques (« le kit ne connaît
 * pas ses consommateurs », docs/PROPAGATION.md) : le manifest vit dans le
 * repo marque (`src/electron/app-manifest.ts` + `.json`). Ce codemod :
 *
 *   1. bascule les `scripts/build-builder-config.mjs` générés par la factory
 *      de « registre kit d'abord » vers « manifest local d'abord » (le
 *      fallback registre kit reste UNE version, déprécié) ;
 *   2. matérialise `src/electron/app-manifest.json` depuis le registre kit
 *      déprécié (`node_modules/@creezio/brand-config`) quand le repo a un
 *      `app-manifest.ts` sans `.json` — best-effort : si le registre ne
 *      connaît pas la marque ou que le module n'est pas installé, no-op.
 *
 * Idempotent : relancer sur une marque déjà migrée = no-op (exit 0, zéro
 * diff). Ne touche jamais node_modules/, dist/, .next/, docker-data/.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(process.env.ROOT || ".");
if (!fs.existsSync(ROOT)) {
  console.error(`ROOT introuvable : ${ROOT}`);
  process.exit(1);
}

const changed = [];

function rewriteFile(rel, fn) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return;
  const before = fs.readFileSync(abs, "utf8");
  const after = fn(before);
  if (after !== before) {
    fs.writeFileSync(abs, after);
    changed.push(rel);
  }
}

// ---------------------------------------------------------------------------
// 1. build-builder-config.mjs : manifest local d'abord, registre kit en
//    fallback déprécié (forme canonique factory H8).
// ---------------------------------------------------------------------------
const OLD_RESOLUTION_RE =
  /let manifest;\nif \(listBrandIds\(\)\.includes\(brandId\)\) \{\n  manifest = getManifest\(brandId\);\n\} else \{\n  const genPath = path\.join\(root, "src\/electron\/app-manifest\.json"\);\n  if \(!fs\.existsSync\(genPath\)\) \{\n    throw new Error\([^\n]*\);\n  \}\n  manifest = JSON\.parse\(fs\.readFileSync\(genPath, "utf8"\)\);\n\}/;

const NEW_RESOLUTION = `let manifest = null;
const genPath = path.join(root, "src/electron/app-manifest.json");
if (fs.existsSync(genPath)) {
  const local = JSON.parse(fs.readFileSync(genPath, "utf8"));
  if (local.brandId === brandId) manifest = local;
}
if (!manifest && listBrandIds().includes(brandId)) {
  // Fallback déprécié (P1.d) : matérialiser src/electron/app-manifest.json.
  console.warn(\`[deprecated] manifest \${brandId} résolu via le registre kit — retrait au prochain bump d'architecture\`);
  manifest = getManifest(brandId);
}
if (!manifest) {
  throw new Error(\`Manifest introuvable pour \${brandId} (app-manifest.json + registre kit)\`);
}`;

const OLD_DOC_LINE =
  " * Préfère le registre kit ; sinon lit src/electron/app-manifest.ts via JSON export.";
const NEW_DOC_LINES =
  " * SoT manifest = repo marque (src/electron/app-manifest.json) — le kit ne\n" +
  " * connaît pas ses consommateurs (P1.d). Fallback registre kit DÉPRÉCIÉ.";

/** Répertoires candidats des layouts connus (monorepo marque + legacy). */
const APP_DIRS = ["server", "client", "crm", "."];

for (const dir of APP_DIRS) {
  rewriteFile(path.join(dir, "scripts/build-builder-config.mjs"), (src) => {
    if (src.includes("let manifest = null;")) return src; // déjà migré
    let out = src.replace(OLD_RESOLUTION_RE, NEW_RESOLUTION);
    out = out.replace(OLD_DOC_LINE, NEW_DOC_LINES);
    return out;
  });
}

// ---------------------------------------------------------------------------
// 2. Matérialisation app-manifest.json depuis le registre kit déprécié.
// ---------------------------------------------------------------------------
function readBrandIdFromTs(absTs) {
  const src = fs.readFileSync(absTs, "utf8");
  const m = /["']?brandId["']?\s*:\s*["']([a-z][a-z0-9-]*)["']/.exec(src);
  return m ? m[1] : null;
}

async function loadDeprecatedRegistry() {
  const entry = path.join(
    ROOT,
    "node_modules/@creezio/brand-config/dist/index.js",
  );
  if (!fs.existsSync(entry)) return null;
  try {
    const mod = await import(pathToFileURL(entry).href);
    return typeof mod.getManifest === "function" &&
      typeof mod.isRegisteredBrandId === "function"
      ? mod
      : null;
  } catch {
    return null;
  }
}

let registry = undefined; // lazy — chargé seulement si nécessaire
for (const dir of APP_DIRS) {
  const electronDir = path.join(ROOT, dir, "src/electron");
  const tsPath = path.join(electronDir, "app-manifest.ts");
  const jsonPath = path.join(electronDir, "app-manifest.json");
  if (!fs.existsSync(tsPath) || fs.existsSync(jsonPath)) continue;
  const brandId = readBrandIdFromTs(tsPath);
  if (!brandId) continue;
  if (registry === undefined) registry = await loadDeprecatedRegistry();
  if (!registry || !registry.isRegisteredBrandId(brandId)) continue;
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(registry.getManifest(brandId), null, 2) + "\n",
  );
  changed.push(path.relative(ROOT, jsonPath));
}

// ---------------------------------------------------------------------------
if (changed.length === 0) {
  console.log("✓ codemod H8 : rien à migrer (déjà en H8) — no-op");
} else {
  console.log(`✓ codemod H8 : ${changed.length} fichier(s) migré(s)`);
  for (const rel of changed) console.log(`  ~ ${rel}`);
}
