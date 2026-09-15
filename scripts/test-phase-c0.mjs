/**
 * Phase C0 — docs/archive/gates/matrice = état réel + backlog C*.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

test("C0 livrables docs présents", () => {
  for (const p of [
    "docs/archive/PHASE-C0.md",
    "docs/archive/MATRICE-NATIVE-METIER-PLUGIN.md",
    "docs/archive/REPUBLISH-POLICY.md",
    "docs/archive/gates/POST-H5.md",
    "docs/archive/VISION-V1-V3.md",
  ]) {
    assert.ok(exists(p), `missing ${p}`);
  }
});

test("C0 POST-H5 versions marques réelles", () => {
  const post = read("docs/archive/gates/POST-H5.md");
  assert.match(post, /0\.10\.31/);
  assert.match(post, /0\.1\.56/);
  assert.match(post, /0\.1\.14/);
  assert.match(post, /PHASE-C0|Correction C\*|backlog C\*/i);
});

test("C0 matrice marque dual-write / demi-mesures 🟡", () => {
  const m = read("docs/archive/MATRICE-NATIVE-METIER-PLUGIN.md");
  assert.match(m, /PHASE-C0|Correction C\*|C1–C8|C1-C8/i);
  assert.match(m, /dual-write/);
  assert.match(m, /🟡/);
  // Plus de faux « tout ✅ » sur vision sans backlog C*
  assert.match(m, /brand-retained|rétention brand|kit SoT|cutover/i);
});

test("C0 PHASE-C0 backlog C1–C8", () => {
  const c0 = read("docs/archive/PHASE-C0.md");
  for (const phase of ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]) {
    assert.match(c0, new RegExp(`\\*\\*${phase}\\*\\*`));
  }
  assert.match(c0, /zéro dual-write|zero dual-write|SoT kit/i);
  assert.match(c0, /startHostPluginControlPlane/);
  assert.match(c0, /auto-promotion|univers perso|cloud registry/i);
});

test("C0 REPUBLISH-POLICY lignes C*", () => {
  const pol = read("docs/archive/REPUBLISH-POLICY.md");
  assert.match(pol, /\*\*C0\*\*|\bC0\b.*Non/s);
  assert.match(pol, /\bC8\b/);
  assert.match(pol, /C1|C7/);
});

test("C0 VISION addendum correction C*", () => {
  const v = read("docs/archive/VISION-V1-V3.md");
  assert.match(v, /PHASE-C0|Correction C\*|demi-mesure|🟡/i);
});

test("C0 package.json test inclut test-phase-c0", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.match(String(pkg.scripts.test), /test-phase-c0\.mjs/);
});
