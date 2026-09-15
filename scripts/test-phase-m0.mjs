/**
 * Phase M0 — baseline vision stricte : inventaire + freeze anti-stub.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("M0.1 PHASE-M0.md existe et fige freeze anti-stub", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-M0.md"), "utf8");
  assert.match(doc, /Baseline anti-demi-mesure|vision stricte/i);
  assert.match(doc, /stub ≠ done|stubs? \/ façades? \/ jumeaux/i);
  assert.match(doc, /src\/lib\/database/);
  assert.match(doc, /Une seule étape à la fois/);
  assert.match(doc, /liste complète/);
});

test("M0.2 PLAN-M.md couvre M0→M16 et engagement gate", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/PLAN-M.md"), "utf8");
  assert.match(doc, /M0 → M1 → M1p/);
  assert.match(doc, /\bM16\b/);
  assert.match(doc, /pas de M\(n\+1\) tant que[\s\S]*gate M\(n\) rouge/);
  assert.match(doc, /Stubs \/ façades \/ jumeaux/);
  assert.match(doc, /sync-creezio-vendor/);
});

test("M0.3 inventaire M0 contient dettes mesurables (LOC / chemins)", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-M0.md"), "utf8");
  assert.match(doc, /local-config\.ts/);
  assert.match(doc, /plugin-control-api\.ts/);
  assert.match(doc, /main\.ts/);
  assert.match(doc, /4026|≤800/);
  // « stub = done » n’apparaît que comme INTERDICTION (pas comme critère ✅).
  assert.match(doc, /sign-off « stub = done »/);
  assert.match(doc, /stub ≠ done/);
  assert.doesNotMatch(doc, /\|\s*✅\s*.*stub\s*=\s*done/i);
});

test("M0.4 matrice référence vision stricte M*", () => {
  const doc = fs.readFileSync(
    path.join(root, "docs/archive/MATRICE-NATIVE-METIER-PLUGIN.md"),
    "utf8",
  );
  assert.match(doc, /PHASE-M0|PLAN-M|vision stricte/i);
  assert.match(doc, /stub ≠ done|stubs? = NON done|NON done/i);
});
