#!/usr/bin/env node
/**
 * Codemod H11 — purge de la compat TF2-era (ARCHITECTURE_VERSION H10 → H11).
 *
 * Usage (contrat scripts/codemods/README.md) :
 *   ROOT=<racine du clone marque> node h11-purge-tf2-compat.mjs
 *
 * Le kit ne lit plus les dual-reads / alias TF2-era :
 *
 *   1. env `TEMPOFLOW_*` dans .env / configs / sources → `${envPrefix}_*`
 *      dérivé de `server/src/electron/app-manifest.json` (ou client/crm) ;
 *      REFUSÉ (exit 1, marque intacte) si des `TEMPOFLOW_*` restent sans
 *      envPrefix littéral prouvable ;
 *   2. alias `clearTempoflowGeneratedWebuiPassword` →
 *      `clearGeneratedWebuiPassword` ;
 *   3. imports / appels `createChrCatalogMeiliFeed` : les asserts de tests
 *      sont réécrits vers `brandMeiliFeed` ; un appel runtime restant est
 *      REFUSÉ (le feed CHR est inliné par la factory depuis H7) ;
 *   4. `countKey: "sites"` / clé `sites` de `countTables` → `fournisseurs` ;
 *   5. `scripts/build-builder-config.mjs` : retrait du fallback registre
 *      kit (`getManifest` / `listBrandIds`) — SoT = app-manifest.json local ;
 *   6. imports `tempoflowManifest` / `certivanManifest` / `fiduManifest`
 *      depuis `@creezio/brand-config` : REFUSÉ s'ils restent (matérialiser
 *      le JSON local via H8, puis relancer).
 *
 * Idempotent : relancer sur une marque déjà migrée = no-op (exit 0, zéro
 * diff). Ne touche jamais node_modules/, dist/, dist-cjs/, .next/,
 * docker-data/, .git/, dist-electron-server/, win-unpacked/, release/,
 * out/ ni les lockfiles (régénérés par le runner upgrade).
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
const CONFIG_EXT_RE = /\.(ts|tsx|mts|cts|js|mjs|cjs|json|ya?ml|toml|env)$/;
const ENV_BASENAME_RE = /^\.env(\..+)?$/;
const LOCKFILE_RE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;
const TEMPOFLOW_ENV_RE = /\bTEMPOFLOW_([A-Z][A-Z0-9_]*)\b/g;
const LEGACY_MANIFEST_IMPORT_RE =
  /\b(tempoflowManifest|certivanManifest|fiduManifest)\b/;
const CREATE_CHR_CALL_RE = /\bcreateChrCatalogMeiliFeed\s*\(/;

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

function readEnvPrefix() {
  const candidates = [
    "server/src/electron/app-manifest.json",
    "client/src/electron/app-manifest.json",
    "src/electron/app-manifest.json",
    "crm/src/electron/app-manifest.json",
  ];
  for (const rel of candidates) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      const prefix = JSON.parse(fs.readFileSync(abs, "utf8")).envPrefix;
      if (typeof prefix === "string" && /^[A-Z][A-Z0-9_]*$/.test(prefix)) {
        return prefix;
      }
    } catch {
      /* next */
    }
  }
  return null;
}

const allFiles = walk(ROOT);
const rel = (abs) => path.relative(ROOT, abs);
const envPrefix = readEnvPrefix();
const writes = [];

function pendingBody(abs) {
  const pending = writes.find((w) => w.abs === abs);
  return pending ? pending.body : fs.readFileSync(abs, "utf8");
}

function queueWrite(abs, body) {
  const pending = writes.find((w) => w.abs === abs);
  if (pending) pending.body = body;
  else writes.push({ abs, rel: rel(abs), body });
}

function isRewritable(abs) {
  const r = rel(abs);
  if (LOCKFILE_RE.test(r)) return false;
  const base = path.basename(abs);
  return CONFIG_EXT_RE.test(abs) || ENV_BASENAME_RE.test(base);
}

// ---------------------------------------------------------------------------
// Passe 1 (dry) : calculer toutes les écritures, échouer AVANT tout write.
// ---------------------------------------------------------------------------
for (const abs of allFiles) {
  if (!isRewritable(abs)) continue;
  let src = pendingBody(abs);
  let next = src;

  next = next.replaceAll(
    "clearTempoflowGeneratedWebuiPassword",
    "clearGeneratedWebuiPassword",
  );
  next = next.replace(/brandMeiliFeed\|createChrCatalogMeiliFeed/g, "brandMeiliFeed");
  next = next.replace(/createChrCatalogMeiliFeed\|brandMeiliFeed/g, "brandMeiliFeed");
  next = next.replace(/\bcountKey:\s*["']sites["']/g, 'countKey: "fournisseurs"');
  next = next.replace(
    /(["']?)sites\1\s*:\s*(["'])fournisseurs\2/g,
    '$1fournisseurs$1: $2fournisseurs$2',
  );

  if (CREATE_CHR_CALL_RE.test(next)) {
    console.error(
      `✗ codemod H11 : ${rel(abs)} appelle encore createChrCatalogMeiliFeed ` +
        `— le feed CHR est inliné par la factory depuis H7. Inliner le feed ` +
        `côté marque puis relancer — marque intacte.`,
    );
    process.exit(1);
  }
  next = next.replace(
    /import\s*\{[^}]*\bcreateChrCatalogMeiliFeed\b[^}]*\}\s*from\s*["'][^"']+["'];?\n?/g,
    (block) => {
      const cleaned = block
        .replace(/\bcreateChrCatalogMeiliFeed\s*,\s*/g, "")
        .replace(/,\s*createChrCatalogMeiliFeed\b/g, "")
        .replace(
          /import\s*\{\s*\}\s*from\s*["'][^"']+["'];?\n?/,
          "",
        );
      return cleaned.includes("createChrCatalogMeiliFeed") ? block : cleaned;
    },
  );

  if (LEGACY_MANIFEST_IMPORT_RE.test(next)) {
    console.error(
      `✗ codemod H11 : ${rel(abs)} importe encore tempoflowManifest / ` +
        `certivanManifest / fiduManifest depuis @creezio/brand-config — ` +
        `le kit ne publie plus ces manifests (H11). Lire ` +
        `src/electron/app-manifest.json (codemod H8) puis relancer — ` +
        `marque intacte.`,
    );
    process.exit(1);
  }

  if (TEMPOFLOW_ENV_RE.test(next)) {
    TEMPOFLOW_ENV_RE.lastIndex = 0;
    if (!envPrefix) {
      console.error(
        `✗ codemod H11 : ${rel(abs)} contient TEMPOFLOW_* sans envPrefix ` +
          `lisible dans app-manifest.json — impossible de réécrire vers ` +
          `la clé canonique. Poser envPrefix puis relancer — marque intacte.`,
      );
      process.exit(1);
    }
    if (envPrefix !== "TEMPOFLOW") {
      next = next.replace(TEMPOFLOW_ENV_RE, `${envPrefix}_$1`);
    }
  }

  if (next !== src) queueWrite(abs, next);
}

// -- build-builder-config.mjs : fallback registre kit retiré -----------------
const BUILDER_CANDIDATES = [
  "server/scripts/build-builder-config.mjs",
  "client/scripts/build-builder-config.mjs",
  "crm/scripts/build-builder-config.mjs",
  "scripts/build-builder-config.mjs",
];
const FALLBACK_RE =
  /\nif \(!manifest && listBrandIds\(\)\.includes\(brandId\)\) \{\n[\s\S]*?manifest = getManifest\(brandId\);\n\}\n/;

for (const r of BUILDER_CANDIDATES) {
  const abs = path.join(ROOT, r);
  if (!fs.existsSync(abs)) continue;
  let src = pendingBody(abs);
  if (!src.includes("getManifest") && !src.includes("listBrandIds")) continue;
  let next = src.replace(FALLBACK_RE, "\n");
  next = next.replace(
    /Manifest introuvable pour \$\{brandId\} \(app-manifest\.json \+ registre kit\)/,
    "Manifest introuvable pour ${brandId} — src/electron/app-manifest.json requis (H11)",
  );
  next = next.replace(
    /Fallback registre kit DÉPRÉCIÉ\./,
    "Plus de fallback registre kit (H11).",
  );
  next = next.replace(
    /\n\s*getManifest,\n\s*listBrandIds,/,
    "",
  );
  if (!next.includes("getManifest") && !next.includes("listBrandIds")) {
    next = next.replace(
      /import \{\n  buildElectronBuilderConfig,\n  renderNsisInstallerInclude,\n\} from "@creezio\/brand-config";/,
      `import {
  buildElectronBuilderConfig,
  renderNsisInstallerInclude,
} from "@creezio/brand-config";`,
    );
  }
  if (next.includes("let manifest = null;")) {
    next = next.replace(
      /let manifest = null;\nconst genPath = path\.join\(root, "src\/electron\/app-manifest\.json"\);\nif \(fs\.existsSync\(genPath\)\) \{\n  const local = JSON\.parse\(fs\.readFileSync\(genPath, "utf8"\)\);\n  if \(local\.brandId === brandId\) manifest = local;\n\}\nif \(!manifest\) \{\n  throw new Error\(`Manifest introuvable pour \$\{brandId\}[^`]*`\);\n\}/,
      `const genPath = path.join(root, "src/electron/app-manifest.json");
if (!fs.existsSync(genPath)) {
  throw new Error(
    \`Manifest introuvable pour \${brandId} — src/electron/app-manifest.json requis (H11)\`,
  );
}
const manifest = JSON.parse(fs.readFileSync(genPath, "utf8"));
if (manifest.brandId !== brandId) {
  throw new Error(
    \`app-manifest.json brandId=\${manifest.brandId} ≠ CREEZIO_BRAND=\${brandId}\`,
  );
}`,
    );
  }
  if (next !== src) queueWrite(abs, next);
}

// ---------------------------------------------------------------------------
// Passe 2 : écrire.
// ---------------------------------------------------------------------------
if (writes.length === 0) {
  console.log("✓ codemod H11 : rien à migrer (déjà en H11) — no-op");
} else {
  for (const { abs, body } of writes) fs.writeFileSync(abs, body, "utf8");
  console.log(`✓ codemod H11 : ${writes.length} fichier(s) migré(s)`);
  for (const { rel: r } of writes) console.log(`  ~ ${r}`);
}
