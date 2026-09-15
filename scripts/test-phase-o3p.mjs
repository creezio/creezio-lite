#!/usr/bin/env node
/**
 * Phase O3p — Cutover jumeaux Electron TF → CV → Fidu.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TF_ELECTRON = path.join(resolveBrandCrmRoot("tempoflow2"), "electron");
const CV_ELECTRON = path.join(resolveBrandCrmRoot("certivan-app"), "electron");
const FIDU_ELECTRON = path.join(resolveBrandCrmRoot("fidu"), "electron");

const TWINS_ALL = [
  "n8n-api-key.ts",
  "agent-isolation.ts",
  "oauth-loopback.ts",
  "assistant-chrome.ts",
  "profile-picker-html.ts",
  "factory-reset.ts",
  "licensing.ts",
  "installer-prefs.ts",
  "error-page-html.ts",
  "hermes-crm-key.ts",
  "ensure-hermes-crm-key-db.ts",
];

const PAPERCLIP_RE = /paperclipApi|startPaperclip\b|paperclip-launcher/;

const EXPECTED_SHAS = {
  tempoflow2: "c8fb984",
  "certivan-app": "3499243",
  fidu: "69f0a5b",
};

function assertAbsent(dir, names, label) {
  assert.ok(fs.existsSync(dir), `${label} electron/ introuvable: ${dir}`);
  for (const name of names) {
    assert.ok(
      !fs.existsSync(path.join(dir, name)),
      `${label}: jumeau encore présent: ${name}`,
    );
  }
}

function gitHead(repoDir) {
  return execSync("git rev-parse --short=7 HEAD", {
    cwd: repoDir,
    encoding: "utf8",
  }).trim();
}

test("O3p.1 PHASE-O3p.md + PLAN-O O3p livré", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-O3p.md"), "utf8");
  assert.match(phase, /Cutover jumeaux Electron/i);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-o3p/);
  assert.match(phase, /c8fb984|TempoFlow/i);
  assert.match(phase, /3499243|Certivan/i);
  assert.match(phase, /69f0a5b|Fidu/i);
  assert.match(phase, /NON done|façades/i);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-O.md"), "utf8");
  assert.match(plan, /## O3p — Cutover jumeaux Electron/);
  assert.match(plan, /PHASE-O3p\.md/);
  assert.match(plan, /O3p — Cutover.*✅|PHASE-O3p/);
});

test("O3p.2 jumeaux O3 absents ×3", () => {
  for (const [label, dir] of [
    ["TempoFlow", TF_ELECTRON],
    ["Certivan", CV_ELECTRON],
    ["Fidu", FIDU_ELECTRON],
  ]) {
    assertAbsent(dir, TWINS_ALL, label);
  }
});

test("O3p.3 wiring kit + brand opts (main / host-runtime-ctx)", () => {
  for (const [label, dir, brandConst] of [
    ["TempoFlow", TF_ELECTRON, "TF_N8N_API_KEY_BRAND"],
    ["Certivan", CV_ELECTRON, "CV_N8N_API_KEY_BRAND"],
    ["Fidu", FIDU_ELECTRON, "FIDU_HERMES_CRM_BRAND"],
  ]) {
    const main = fs.readFileSync(path.join(dir, "main.ts"), "utf8");
    assert.match(main, /@creezio\/electron-shell/);
    assert.match(main, /AssistantChromeOverlay/);
    assert.match(main, /kitProfilePickerHtml|profilePickerHtml as kit/);
    assert.match(main, /@creezio\/platform-core/);
    assert.match(main, /kitCheckLicense|checkLicense as kit/);
    assert.ok(
      fs.existsSync(path.join(dir, "host-runtime-ctx.ts")),
      `${label}: host-runtime-ctx`,
    );
    const ctx = fs.readFileSync(path.join(dir, "host-runtime-ctx.ts"), "utf8");
    assert.match(ctx, new RegExp(brandConst));
    assert.doesNotMatch(main, PAPERCLIP_RE);
    assert.doesNotMatch(ctx, PAPERCLIP_RE);
  }
});

test("O3p.4 SHAs marques gold (documentés PHASE-O3p)", () => {
  // HEAD avance après O3p (O4p+) — le pin historique reste dans PHASE-O3p.md.
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-O3p.md"), "utf8");
  for (const [repo, sha] of Object.entries(EXPECTED_SHAS)) {
    assert.match(phase, new RegExp(sha), `${repo}: SHA ${sha} absent de PHASE-O3p`);
  }
});

test("O3p.5 gate enregistrée npm test", () => {
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkg, /test-phase-o3p\.mjs/);
});
