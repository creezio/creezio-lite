/**
 * Phase R0 — gel inventions + clarif lifecycle-only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("R0.1 PHASE-R0.md existe et verrouille intention", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-R0.md"), "utf8");
  assert.match(doc, /Geler les inventions/);
  assert.match(doc, /lifecycle-only/);
  assert.match(doc, /prototypes ≠ SoT|prototypes ≠ Source/i);
  assert.match(doc, /Interdiction nouvelles features plateforme/);
});

test("R0.2 VISION amendement prototypes ≠ SoT", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/VISION-V1-V3.md"), "utf8");
  assert.match(doc, /Amendement R0/);
  assert.match(doc, /Lifecycle-only/);
  assert.match(doc, /@creezio\/database/);
});

test("R0.3 @creezio/automations documenté lifecycle-only", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "packages/automations/package.json"), "utf8"),
  );
  assert.match(pkg.description, /lifecycle/i);
  assert.match(pkg.description, /@creezio\/database|Database/i);
  const idx = fs.readFileSync(
    path.join(root, "packages/automations/src/index.ts"),
    "utf8",
  );
  assert.match(idx, /lifecycle-only/);
  assert.doesNotMatch(idx, /Database admin row-level SoT/);
});

test("R0.4 matrice : automations ≠ Database", () => {
  const doc = fs.readFileSync(
    path.join(root, "docs/archive/MATRICE-NATIVE-METIER-PLUGIN.md"),
    "utf8",
  );
  assert.match(doc, /Automations lifecycle/);
  assert.match(doc, /@creezio\/database/);
  assert.match(doc, /PHASE-R0/);
});
