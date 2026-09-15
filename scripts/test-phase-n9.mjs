#!/usr/bin/env node
/**
 * Phase N9 — Freeze vision 100 % (N0→N9).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("N9.1 PHASE-N9.md freeze", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-N9.md"), "utf8");
  assert.match(doc, /Freeze|freeze/);
  assert.match(doc, /dry-run|DRY_RUN/i);
  assert.match(doc, /N8|N6p|N7/);
  assert.match(doc, /Plan N\* fermé|vision 100|Sign-off/i);
  assert.match(doc, /c85bb0f|336739d|8ec21d2/);
  assert.match(doc, /0\.1\.63/);
});

test("N9.2 matrice freeze N9 + versions", () => {
  const mat = fs.readFileSync(
    path.join(root, "docs/archive/MATRICE-NATIVE-METIER-PLUGIN.md"),
    "utf8",
  );
  assert.match(mat, /N0→N9|PHASE-N9/);
  assert.match(mat, /0\.1\.63/);
  assert.match(mat, /0\.10\.32/);
  assert.match(mat, /browser-tabs|N6p|supplier-tabs/);
  assert.doesNotMatch(mat, /\|\s*stub OK\s*\|/i);
  assert.match(mat, /Paperclip/);
});

test("N9.3 PLAN-N N0→N9 documentés Done", () => {
  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-N.md"), "utf8");
  for (const h of [
    "## N0 —",
    "## N1 —",
    "## N1p —",
    "## N2 —",
    "## N2p —",
    "## N3 —",
    "## N3p —",
    "## N4 —",
    "## N4p —",
    "## N5 —",
    "## N6 —",
    "## N6p —",
    "## N7 —",
    "## N8 —",
    "## N9 —",
  ]) {
    assert.match(plan, new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(plan, /PHASE-N9/);
  assert.match(plan, /## N9 — Freeze vision 100 % ✅|Done|livr|Sign-off/i);
});

test("N9.4 gates N0–N9 présents dans package.json", () => {
  for (const n of [
    "n0",
    "n1",
    "n1p",
    "n2",
    "n2p",
    "n3",
    "n3p",
    "n4",
    "n4p",
    "n5",
    "n6",
    "n6p",
    "n7",
    "n8",
    "n9",
  ]) {
    assert.ok(
      fs.existsSync(path.join(root, `scripts/test-phase-${n}.mjs`)),
      `test-phase-${n}`,
    );
  }
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkg, /test-phase-n9\.mjs/);
});

test("N9.5 Paperclip absent runtime kit", () => {
  const src = fs.readFileSync(
    path.join(
      root,
      "packages/electron-shell/src/desktop/brand-desktop-runtime.ts",
    ),
    "utf8",
  );
  assert.doesNotMatch(src, /paperclipApi|startPaperclip/);
});
