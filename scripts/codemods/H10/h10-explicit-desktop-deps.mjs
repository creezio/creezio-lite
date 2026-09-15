#!/usr/bin/env node
/**
 * Codemod H10 — retrait de la compat desktop legacy (P2.a clôturé, T9).
 *
 * Usage (contrat scripts/codemods/README.md) :
 *   ROOT=<racine du clone marque> node h10-explicit-desktop-deps.mjs
 *
 * `@creezio/electron-shell` ne fournit plus les défauts legacy du moteur
 * desktop (`desktop/legacy-brand-compat.ts` supprimé, ADR
 * docs/adr/ADR-p2a-desktop-legacy-freeze.md) :
 *
 *   - un envPrefix historique n'implique plus les valeurs d'env legacy du
 *     dossier plugins / du query param SiteLink / de la clé API CRM —
 *     défauts génériques `<PREFIX>_PLUGINS_DIR`, `<brandId>fid`,
 *     `<PREFIX>_API_KEY` ;
 *   - le basename preload historique des clients legacy n'est plus sondé —
 *     `preload.js` unique ;
 *   - l'alias legacy du contrat host nodeRuntime n'est plus consulté —
 *     `ensureDesktopNode` requis.
 *
 * Les marques modernes (`startBrandDesktop`, deps explicites injectées par
 * le kit) ne sont PAS concernées : no-op. Pour les clients desktop legacy
 * appelant `installBrandDesktopRuntime` directement, ce codemod :
 *
 *   1. injecte les 3 deps explicites avec leurs valeurs legacy au point
 *      d'appel `installBrandDesktopRuntime({ … })` quand elles manquent et
 *      que l'envPrefix littéral est celui des clients historiques —
 *      REFUSÉ (exit 1, marque intacte) si des deps manquent sans envPrefix
 *      littéral (impossible de prouver que les défauts legacy
 *      s'appliquaient — arbitrer à la main puis relancer) ;
 *   2. renomme `ensureTempoflowNode` → `ensureDesktopNode` (alias kit de
 *      la même fonction — renommage sans effet runtime) ;
 *   3. rebascule le preload historique vers `preload.js` : littéraux
 *      `preload-app.js` dans les sources/configs + renommage du fichier
 *      source `preload-app.*` (REFUSÉ si la cible existe déjà).
 *
 * Idempotent : relancer sur une marque déjà migrée = no-op (exit 0, zéro
 * diff). Ne touche jamais node_modules/, dist/, dist-cjs/, .next/,
 * docker-data/, .git/ ni les lockfiles (régénérés par le runner upgrade).
 */
import fs from "node:fs";
import path from "node:path";
import { shouldSkipDir } from "../lib/skip-dirs.mjs";

const ROOT = path.resolve(process.env.ROOT || ".");
if (!fs.existsSync(ROOT)) {
  console.error(`ROOT introuvable : ${ROOT}`);
  process.exit(1);
}

/** envPrefix historique dont les défauts legacy divergent des génériques. */
const LEGACY_ENV_PREFIX = "TF2";
const LEGACY_DEP_DEFAULTS = [
  ["pluginsDirEnvKey", "TEMPOFLOW_PLUGINS_DIR"],
  ["supplierFidQueryParam", "tf2fid"],
  ["apiKeyEnvName", "TEMPOFLOW_API_KEY"],
];

const CODE_EXT_RE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const CONFIG_EXT_RE = /\.(ts|tsx|mts|cts|js|mjs|cjs|json|ya?ml|toml)$/;
const LOCKFILE_RE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;

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

const allFiles = walk(ROOT);
const rel = (abs) => path.relative(ROOT, abs);

// ---------------------------------------------------------------------------
// Passe 1 (dry) : calculer toutes les écritures, échouer AVANT tout write.
// ---------------------------------------------------------------------------
const writes = []; // { abs, rel, body }
const renames = []; // { from, to }

// -- 1. deps explicites au point d'appel installBrandDesktopRuntime ---------
for (const abs of allFiles) {
  if (!CODE_EXT_RE.test(abs) || LOCKFILE_RE.test(rel(abs))) continue;
  const src = fs.readFileSync(abs, "utf8");
  if (!src.includes("installBrandDesktopRuntime")) continue;

  const missing = LEGACY_DEP_DEFAULTS.filter(([key]) => {
    return !new RegExp(`\\b${key}\\s*:`).test(src);
  });
  if (missing.length === 0) continue; // deps déjà explicites — migré

  const envPrefixRe = /\benvPrefix\s*:\s*["']([A-Za-z0-9_]+)["']/;
  const m = envPrefixRe.exec(src);
  if (m && m[1] !== LEGACY_ENV_PREFIX) continue; // défauts identiques — rien
  if (!m) {
    console.error(
      `✗ codemod H10 : ${rel(abs)} appelle installBrandDesktopRuntime sans ` +
        `deps explicites (${missing.map(([k]) => k).join(", ")}) et sans ` +
        `envPrefix littéral — impossible de prouver que les défauts legacy ` +
        `s'appliquaient. Poser les deps à la main (ou vérifier que les ` +
        `défauts génériques conviennent) puis relancer — marque intacte.`,
    );
    process.exit(1);
  }

  // Injection après la ligne `envPrefix: "TF2",` (indentation préservée).
  const lines = src.split("\n");
  const idx = lines.findIndex((line) => envPrefixRe.test(line));
  const indent = /^\s*/.exec(lines[idx])[0];
  const injected = missing.map(
    ([key, value]) => `${indent}${key}: ${JSON.stringify(value)},`,
  );
  lines.splice(idx + 1, 0, ...injected);
  writes.push({ abs, rel: rel(abs), body: lines.join("\n") });
}

// -- 2. alias host nodeRuntime → nom plateforme ------------------------------
for (const abs of allFiles) {
  if (!CODE_EXT_RE.test(abs) || LOCKFILE_RE.test(rel(abs))) continue;
  if (writes.some((w) => w.abs === abs)) {
    // Déjà réécrit à l'étape 1 : appliquer le renommage sur le corps neuf.
    const w = writes.find((x) => x.abs === abs);
    if (/\bensureTempoflowNode\b/.test(w.body)) {
      w.body = w.body.replace(/\bensureTempoflowNode\b/g, "ensureDesktopNode");
    }
    continue;
  }
  const src = fs.readFileSync(abs, "utf8");
  if (!/\bensureTempoflowNode\b/.test(src)) continue;
  writes.push({
    abs,
    rel: rel(abs),
    body: src.replace(/\bensureTempoflowNode\b/g, "ensureDesktopNode"),
  });
}

// -- 3. preload historique → preload.js --------------------------------------
for (const abs of allFiles) {
  const r = rel(abs);
  if (LOCKFILE_RE.test(r)) continue;
  if (CONFIG_EXT_RE.test(abs)) {
    const pending = writes.find((w) => w.abs === abs);
    const src = pending ? pending.body : fs.readFileSync(abs, "utf8");
    if (src.includes("preload-app.js")) {
      const body = src.replaceAll("preload-app.js", "preload.js");
      if (pending) pending.body = body;
      else writes.push({ abs, rel: r, body });
    }
  }
  // Fichier source du preload historique : renommé pour que le build
  // produise `preload.js` (basename piloté par le nom de fichier).
  const base = path.basename(abs);
  const m = /^preload-app\.(ts|tsx|mts|cts|js|mjs|cjs)$/.exec(base);
  if (m) {
    const to = path.join(path.dirname(abs), `preload.${m[1]}`);
    if (fs.existsSync(to) || renames.some((x) => x.to === to)) {
      console.error(
        `✗ codemod H10 : renommage ${r} → ${rel(to)} refusé (la cible ` +
          `existe déjà) — arbitrer à la main puis relancer, marque intacte.`,
      );
      process.exit(1);
    }
    renames.push({ from: abs, to });
  }
}

// ---------------------------------------------------------------------------
// Passe 2 : écrire.
// ---------------------------------------------------------------------------
if (writes.length === 0 && renames.length === 0) {
  console.log("✓ codemod H10 : rien à migrer (déjà en H10) — no-op");
} else {
  for (const { abs, body } of writes) fs.writeFileSync(abs, body, "utf8");
  for (const { from, to } of renames) fs.renameSync(from, to);
  console.log(
    `✓ codemod H10 : ${writes.length + renames.length} fichier(s) migré(s)`,
  );
  for (const { rel: r } of writes) console.log(`  ~ ${r}`);
  for (const { from, to } of renames)
    console.log(`  ~ ${rel(from)} → ${rel(to)}`);
}
