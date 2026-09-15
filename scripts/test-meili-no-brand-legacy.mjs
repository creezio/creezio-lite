#!/usr/bin/env node
/**
 * Gate — pas de vocabulaire marque legacy (`tf2_`) dans le module Meili natif.
 *
 * L'indexation est pilotée par `BrandMeiliFeed` (obligatoire) : les UIDs
 * marque vivent dans le feed de la marque, jamais dans
 * `packages/search/src/meili/`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MEILI_DIR = path.join(ROOT, "packages/search/src/meili");

test("meili natif — aucun `tf2_` (code ou commentaire)", () => {
  const files = fs
    .readdirSync(MEILI_DIR)
    .filter((f) => f.endsWith(".ts"))
    .sort();
  assert.ok(files.length >= 6, `dossier meili inattendu: ${files.join(", ")}`);
  for (const f of files) {
    const src = fs.readFileSync(path.join(MEILI_DIR, f), "utf8");
    assert.doesNotMatch(
      src,
      /tf2_/i,
      `vocabulaire legacy tf2_ interdit dans meili/${f}`,
    );
  }
});

test("runIndexation exige un BrandMeiliFeed (pas de défaut marque)", () => {
  const idx = fs.readFileSync(path.join(MEILI_DIR, "indexer.ts"), "utf8");
  assert.match(idx, /getMeiliBrandFeed/);
  assert.match(idx, /runFeedIndexation/);
  assert.match(idx, /aucun BrandMeiliFeed/);
});
