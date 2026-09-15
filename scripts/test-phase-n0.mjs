#!/usr/bin/env node
/**
 * Phase N0 — Purge artefacts Paperclip (vision stricte post-M16).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brands = [
  { id: "tempoflow", crm: resolveBrandCrmRoot("tempoflow2") },
  { id: "certivan", crm: resolveBrandCrmRoot("certivan-app") },
  { id: "fidu", crm: resolveBrandCrmRoot("fidu") },
];

const PAPERCLIP_SRC = [
  "electron/paperclip-launcher.ts",
  "electron/paperclip-embed.ts",
  "electron/paperclip-config.ts",
  "electron/paperclip-runtime-bootstrap.ts",
];

const PAPERCLIP_BUILD = [
  "build/electron/paperclip-launcher.js",
  "build/electron/paperclip-embed.js",
  "build/electron/paperclip-config.js",
  "build/electron/paperclip-runtime-bootstrap.js",
];

const RUNTIME_RE = /paperclipApi|startPaperclip|paperclip-launcher/;

function walkTsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTsFiles(p, out);
    else if (ent.isFile() && /\.tsx?$/.test(ent.name)) out.push(p);
  }
  return out;
}

test("N0.1 PHASE-N0.md + PLAN-N.md", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-N0.md"), "utf8");
  assert.match(phase, /Purge artefacts|Paperclip/i);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-n0/);
  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-N.md"), "utf8");
  assert.match(plan, /## N0 — Purge artefacts/);
  assert.match(plan, /## N1 — Runtime plugins/);
  assert.match(plan, /## N9 — Freeze vision/);
  assert.match(plan, /Pas de N\(n\+1\) si gate N\(n\) rouge/);
  assert.match(plan, /Paperclip = mort/);
});

test("N0.2 Paperclip src + build absents (3 marques)", () => {
  for (const { id, crm } of brands) {
    assert.ok(fs.existsSync(crm), `crm manquant: ${id}`);
    for (const rel of PAPERCLIP_SRC) {
      assert.equal(
        fs.existsSync(path.join(crm, rel)),
        false,
        `${id}: src ${rel}`,
      );
    }
    for (const rel of PAPERCLIP_BUILD) {
      assert.equal(
        fs.existsSync(path.join(crm, rel)),
        false,
        `${id}: build ${rel}`,
      );
    }
    const gitignore = fs.readFileSync(path.join(crm, ".gitignore"), "utf8");
    assert.match(gitignore, /^\/build$/m, `${id}: .gitignore /build`);
  }
});

test("N0.3 aucun runtime paperclipApi/startPaperclip dans electron/", () => {
  for (const { id, crm } of brands) {
    const electronDir = path.join(crm, "electron");
    for (const file of walkTsFiles(electronDir)) {
      const src = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(
        src,
        RUNTIME_RE,
        `${id}: ${path.relative(crm, file)}`,
      );
    }
  }
});

test("N0.4 gate enregistrée dans npm test + kit sans paperclip runtime", () => {
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkg, /test-phase-n0\.mjs/);
  const brandRt = path.join(
    root,
    "packages/electron-shell/src/desktop/brand-desktop-runtime.ts",
  );
  if (fs.existsSync(brandRt)) {
    const src = fs.readFileSync(brandRt, "utf8");
    assert.doesNotMatch(src, /paperclipApi|startPaperclip/);
  }
});
