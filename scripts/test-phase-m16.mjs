#!/usr/bin/env node
/**
 * Phase M16 — Freeze vision + matrice (vision stricte).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("M16.1 PHASE-M16.md freeze", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-M16.md"), "utf8");
  assert.match(doc, /Freeze|freeze/);
  assert.match(doc, /dry-run|DRY_RUN/i);
  assert.match(doc, /M14|M15/);
  // Interdiction documentée (la phrase peut apparaître niée : « sans stub OK »)
  assert.match(doc, /sans\s*[«"']?\s*stub OK|Plan M\* fermé|dry-run sync/i);
});

test("M16.2 matrice freeze + gold M*", () => {
  const mat = fs.readFileSync(
    path.join(root, "docs/archive/MATRICE-NATIVE-METIER-PLUGIN.md"),
    "utf8",
  );
  assert.match(mat, /jamais\s*[«"']?\s*stub OK|NON done|stub\s*\/\s*jumeau/i);
  assert.doesNotMatch(mat, /\|\s*stub OK\s*\|/i);
  assert.match(mat, /M14 gold|M15 gold|PHASE-M16/);
  assert.match(mat, /Paperclip/);
  assert.match(mat, /0\.1\.60/);
});

test("M16.3 PLAN-M M13–M16 documentés", () => {
  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-M.md"), "utf8");
  assert.match(plan, /## M13 — Audit TF métier-only/);
  assert.match(plan, /## M14 — Certivan gold/);
  assert.match(plan, /## M15 — Fidu gold/);
  assert.match(plan, /## M16 — Freeze vision/);
  assert.match(plan, /PHASE-M16/);
});

test("M16.4 gates M13–M15 présents", () => {
  for (const n of [13, 14, 15, 16]) {
    assert.ok(
      fs.existsSync(path.join(root, `scripts/test-phase-m${n}.mjs`)),
      `test-phase-m${n}`,
    );
    assert.ok(
      fs.existsSync(path.join(root, `docs/archive/PHASE-M${n}.md`)),
      `PHASE-M${n}`,
    );
  }
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkg, /test-phase-m16\.mjs/);
});

test("M16.5 Paperclip absent runtime kit", () => {
  const src = fs.readFileSync(
    path.join(
      root,
      "packages/electron-shell/src/desktop/brand-desktop-runtime.ts",
    ),
    "utf8",
  );
  assert.doesNotMatch(src, /paperclipApi|startPaperclip/);
});
