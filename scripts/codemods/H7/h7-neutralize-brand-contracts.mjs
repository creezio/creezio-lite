#!/usr/bin/env node
/**
 * Codemod H7 — neutralisation des contrats marque dans le kit (P1.c).
 *
 * Usage (contrat scripts/codemods/README.md) :
 *   ROOT=<racine du clone marque> node h7-neutralize-brand-contracts.mjs
 *
 * Réécrit chez la marque les usages des anciens contrats H6 :
 *   1. brand-spec : `feedPreset: <vertical>-catalog` → `feedPreset: <vertical>`
 *      (id du registre de presets factory — le contrat OS n'énumère plus de
 *      preset vertical) ;
 *   2. brand-spec/interview.schema.json : `vertical` enum → champ string libre ;
 *   3. code marque : alias dépréciés H7 du kit —
 *      `clearTempoflowGeneratedWebuiPassword` → `clearGeneratedWebuiPassword`,
 *      `countGedSql` → `countCatalogSql`, référence résiduelle à
 *      `createChrCatalogMeiliFeed` dans les asserts de tests (le feed est
 *      inliné par la factory depuis H7) ;
 *   4. env bridge Hermes legacy première marque (`TEMPOFLOW_API_KEY`,
 *      `TEMPOFLOW_API_URL`, `TEMPOFLOW_PLUGINS_API_TOKEN`,
 *      `TEMPOFLOW_PLUGINS_DIR`) → `${envPrefix}_…` dérivé du manifest marque
 *      (server/src/electron/app-manifest.json).
 *
 * Idempotent : relancer sur une marque déjà migrée = no-op (exit 0, zéro diff).
 * Ne touche jamais node_modules/, dist/, .next/, docker-data/.
 */
import fs from "node:fs";
import path from "node:path";
import { shouldSkipDir } from "../lib/skip-dirs.mjs";

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
// 1. brand-spec : feedPreset `<vertical>-catalog` → id de preset factory.
// ---------------------------------------------------------------------------
const FEED_PRESET_RE = /^(\s*feedPreset:\s*)([a-z][a-z0-9-]*)-catalog(\s*)$/gm;
for (const rel of ["brand-spec/brand.yaml", "brand-spec/platform/meili.yaml"]) {
  rewriteFile(rel, (s) => s.replace(FEED_PRESET_RE, "$1$2$3"));
}

// ---------------------------------------------------------------------------
// 2. interview.schema.json : vertical enum fermé → string libre.
// ---------------------------------------------------------------------------
rewriteFile("brand-spec/interview.schema.json", (s) =>
  s.replace(
    /"vertical"\s*:\s*\{\s*"enum"\s*:\s*\[[^\]]*\]\s*\}/,
    '"vertical": { "type": "string" }',
  ),
);

// ---------------------------------------------------------------------------
// 3 + 4. Code marque : alias dépréciés + env bridge legacy.
// ---------------------------------------------------------------------------
function readEnvPrefix() {
  const manifestPath = path.join(ROOT, "server/src/electron/app-manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const prefix = JSON.parse(fs.readFileSync(manifestPath, "utf8")).envPrefix;
    return typeof prefix === "string" && /^[A-Z][A-Z0-9_]*$/.test(prefix)
      ? prefix
      : null;
  } catch {
    return null;
  }
}

const envPrefix = readEnvPrefix();
const LEGACY_BRIDGE_ENV_RE =
  /\bTEMPOFLOW_(API_KEY|API_URL|PLUGINS_API_TOKEN|PLUGINS_DIR)\b/g;

function transformCode(src) {
  let out = src;
  // Alias dépréciés H7 (mêmes signatures — remplacement mécanique sûr).
  out = out.replaceAll(
    "clearTempoflowGeneratedWebuiPassword",
    "clearGeneratedWebuiPassword",
  );
  out = out.replaceAll("countGedSql", "countCatalogSql");
  // Asserts de tests acceptant l'ancien créateur runtime (feed inliné H7).
  out = out.replace(/brandMeiliFeed\|createChrCatalogMeiliFeed/g, "brandMeiliFeed");
  out = out.replace(/createChrCatalogMeiliFeed\|brandMeiliFeed/g, "brandMeiliFeed");
  // Env bridge legacy première marque → env dérivé du manifest.
  if (envPrefix && envPrefix !== "TEMPOFLOW") {
    out = out.replace(LEGACY_BRIDGE_ENV_RE, `${envPrefix}_$1`);
  }
  return out;
}

const CODE_DIRS = [
  "server/src",
  "server/ui",
  "server/scripts",
  "server/tests",
  "client/src",
  "client/scripts",
  "scripts",
];
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function walk(relDir) {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      walk(path.join(relDir, entry.name));
    } else if (CODE_EXT.has(path.extname(entry.name))) {
      rewriteFile(path.join(relDir, entry.name), transformCode);
    }
  }
}

for (const dir of CODE_DIRS) walk(dir);

// ---------------------------------------------------------------------------
if (changed.length === 0) {
  console.log("✓ codemod H7 : rien à migrer (déjà en H7) — no-op");
} else {
  console.log(`✓ codemod H7 : ${changed.length} fichier(s) migré(s)`);
  for (const rel of changed) console.log(`  ~ ${rel}`);
}
