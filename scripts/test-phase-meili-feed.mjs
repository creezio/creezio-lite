#!/usr/bin/env node
/**
 * Gate Phase C — BrandMeiliFeed générique (pas de tf2_* dans le chemin feed).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("C1 feed.ts expose BrandMeiliFeed (plus de createChrCatalogMeiliFeed)", () => {
  const feed = fs.readFileSync(
    path.join(ROOT, "packages/search/src/meili/feed.ts"),
    "utf8",
  );
  assert.match(feed, /export type BrandMeiliFeed/);
  assert.match(feed, /export function configureMeiliBrandFeed/);
  assert.doesNotMatch(feed, /createChrCatalogMeiliFeed/);
  assert.match(feed, /catalog_products/);
  assert.match(feed, /catalog_sites/);
  assert.doesNotMatch(feed, /tf2_produits/);
});

test("C2 generic-indexer + runIndexation accepte feed", () => {
  const gen = fs.readFileSync(
    path.join(ROOT, "packages/search/src/meili/generic-indexer.ts"),
    "utf8",
  );
  assert.match(gen, /export async function runFeedIndexation/);
  assert.match(gen, /export async function searchMeiliIndexes/);
  const browse = fs.readFileSync(
    path.join(ROOT, "packages/search/src/meili/browse.ts"),
    "utf8",
  );
  assert.match(browse, /export async function browseMeiliIndex/);

  const idx = fs.readFileSync(
    path.join(ROOT, "packages/search/src/meili/indexer.ts"),
    "utf8",
  );
  assert.match(idx, /opts\?\.feed|getMeiliBrandFeed/);
  assert.match(idx, /runFeedIndexation/);
});

test("C3 plus de subpath ./meili côté electron-shell (H12 — SoT @creezio/search)", () => {
  const pkg = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "packages/electron-shell/package.json"),
      "utf8",
    ),
  );
  assert.equal(
    pkg.exports["./meili"],
    undefined,
    "le shim ./meili a été purgé en H12 — importer @creezio/search",
  );
  const searchPkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "packages/search/package.json"), "utf8"),
  );
  assert.ok(searchPkg.exports?.["."], "export racine @creezio/search requis");
});

test("C4 factory génère meili-feed hors tf2_* (registre de presets, H7)", () => {
  const native = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/generators/native-runtime.ts"),
    "utf8",
  );
  assert.match(native, /renderMeiliFeedTs/);
  // H7 : le preset catalogue CHR est INLINÉ dans le code marque généré via
  // le registre factory — plus de référence au créateur runtime déprécié.
  assert.doesNotMatch(native, /createChrCatalogMeiliFeed/);
  assert.match(native, /getMeiliFeedPreset/);
  assert.match(native, /createSearchMount/);
  const presets = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/generators/meili-feed-presets.ts"),
    "utf8",
  );
  assert.doesNotMatch(presets, /createChrCatalogMeiliFeed/);
  assert.match(presets, /registerMeiliFeedPreset\("chr"/);
  assert.match(presets, /countTables: \{ produits: "produits", fournisseurs: "fournisseurs" \}/);
  assert.match(presets, /uid: "catalog_sites"/);
});

test("C5 ADR documente BrandMeiliFeed", () => {
  const adr = fs.readFileSync(
    path.join(ROOT, "docs/adr/ADR-no-brand-domain-in-native-packages.md"),
    "utf8",
  );
  assert.match(adr, /BrandMeiliFeed|configureMeiliBrandFeed/);
});

test("D1 kit expose listenBrandKernelHttp + maybeBootBrandMeili", () => {
  const httpSrc = fs.readFileSync(
    path.join(ROOT, "packages/host-runtime/src/brand-kernel-http.ts"),
    "utf8",
  );
  assert.match(httpSrc, /export async function listenBrandKernelHttp/);
  const bootSrc = fs.readFileSync(
    path.join(ROOT, "packages/search/src/brand-meili-boot.ts"),
    "utf8",
  );
  assert.match(bootSrc, /export async function maybeBootBrandMeili/);
  // H12 : plus de ré-export compat via electron-shell — les SoT sont
  // host-runtime (listenBrandKernelHttp) et search (maybeBootBrandMeili),
  // vérifiées ci-dessus dans leurs sources.
});

test("D2 boot Meili saute la réindexation quand le fingerprint est à jour", () => {
  // Régression prod : le harness serveur réindexait 85k+ docs à CHAQUE boot
  // de container (~7 min de CPU/IO → recherche dégradée), alors que le
  // desktop sautait déjà via decideMeiliReady. Le skip doit être câblé.
  const bootSrc = fs.readFileSync(
    path.join(ROOT, "packages/search/src/brand-meili-boot.ts"),
    "utf8",
  );
  assert.match(bootSrc, /skipIfCoherent\?: boolean/);
  assert.match(bootSrc, /decideMeiliReady\(meili, opts\.dbPath, \{\s*strictCounts: true/);
  assert.match(bootSrc, /indexSkipped: true/);

  const coherenceSrc = fs.readFileSync(
    path.join(ROOT, "packages/search/src/meili/coherence.ts"),
    "utf8",
  );
  // Compteurs stricts côté serveur : une dérive (import hors indexation
  // incrémentale) doit invalider le fingerprint, sinon l'index se fige.
  assert.match(coherenceSrc, /strictCounts\?: boolean/);
  assert.match(coherenceSrc, /count-drift:/);
  assert.match(coherenceSrc, /export function meiliCoherenceScriptPath/);

  // La sonde SQL doit lire la version de schéma avec la MÊME convention que
  // l'indexeur (meta.schema_version). PRAGMA user_version n'est jamais écrit
  // par les migrations marque → mismatch systématique → réindexation à
  // chaque boot (régression prod serveur).
  const probeSrc = fs.readFileSync(
    path.join(
      ROOT,
      "packages/host-runtime/resources/scripts/meili-coherence-query.cjs",
    ),
    "utf8",
  );
  assert.match(probeSrc, /meta.*schema_version|key='schema_version'/);
  assert.doesNotMatch(probeSrc, /PRAGMA user_version/);

  const harnessSrc = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/src/start-brand-kernel-harness.ts"),
    "utf8",
  );
  assert.match(harnessSrc, /skipIfCoherent: true/);
  assert.match(harnessSrc, /meiliCoherenceScriptPath/);
  assert.match(harnessSrc, /indexSkipped/);

  const meiliBarrel = fs.readFileSync(
    path.join(ROOT, "packages/search/src/meili/index.ts"),
    "utf8",
  );
  assert.match(meiliBarrel, /meiliCoherenceScriptPath/);
});

test("D3 réindexation post-import catalogue (race boot index ∥ import)", () => {
  // Régression prod : l'indexation Meili du boot est parallèle (avant le
  // listen, pour ne pas retarder les healthchecks) MAIS l'import catalogue
  // projeté tourne APRÈS le listen — l'index était construit sur l'état
  // pré-import (base vide au premier boot → index vide → recherche dégradée
  // jusqu'au redémarrage suivant). Le harness doit réindexer après un import
  // effectif, en attendant l'indexation de boot encore en vol.
  const harnessSrc = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/src/start-brand-kernel-harness.ts"),
    "utf8",
  );
  // Réindexation mutualisée (bridge HTTP + post-import), jamais deux en vol.
  assert.match(harnessSrc, /const triggerMeiliReindex = /);
  assert.match(harnessSrc, /reindex: async \(\) => triggerMeiliReindex\(\)/);
  // L'indexation de boot est trackée pour que le post-import l'attende.
  assert.match(harnessSrc, /meiliReindexInFlight = meiliBoot\.indexation\.finally/);
  // Déclencheur post-import : uniquement sur import EFFECTIF + Meili prêt.
  assert.match(harnessSrc, /catalogState === "imported" && meiliRuntime && config\.meiliFeed/);
  assert.match(harnessSrc, /await meiliReindexInFlight/);
  assert.match(harnessSrc, /Réindexation post-import catalogue/);

  const phaseSrc = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/src/harness-server-phases.ts"),
    "utf8",
  );
  // La phase remonte l'état d'import au harness (décision de réindexation).
  assert.match(phaseSrc, /\}\): Promise<string>/);
  assert.match(phaseSrc, /return typeof state === "string" \? state : "unknown"/);
});
