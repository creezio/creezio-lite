#!/usr/bin/env node
/**
 * Phase N2p — Cutover hosts TF → Certivan → Fidu.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { resolveBrandCrmRoot, resolveBrandRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TF_ELECTRON = path.join(resolveBrandCrmRoot("tempoflow2"), "electron");
const CV_ELECTRON = path.join(resolveBrandCrmRoot("certivan-app"), "electron");
const FIDU_ELECTRON = path.join(resolveBrandCrmRoot("fidu"), "electron");

const TWINS_ABSENT = [
  "hermes-embed.ts",
  "n8n-embed.ts",
  "embed-env-catalog.ts",
  "embed-sandbox.ts",
  "embed-stack-hooks.ts",
  "os-sandbox.ts",
  "crash-reporter.ts",
  "web-telemetry.ts",
  "bridge-client.ts",
  "server-launcher.ts",
  "ai-workspace-manager.ts",
  "ai-workspace-actions.ts",
  "ai-screencast.ts",
  "disk-space.ts",
];

const PAPERCLIP_RE = /paperclipApi|startPaperclip\b|paperclip-launcher/;

const EXPECTED_SHAS = {
  tempoflow2: "b602b08",
  "certivan-app": "7e5bfa6",
  fidu: "393bb98",
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

function loc(file) {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

test("N2p.1 PHASE-N2p.md + PLAN-N N2p livré", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-N2p.md"), "utf8");
  assert.match(phase, /Cutover hosts/i);
  assert.match(phase, /9f44eb6/);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-n2p/);
  assert.match(phase, /b602b08|TempoFlow/i);
  assert.match(phase, /7e5bfa6|Certivan/i);
  assert.match(phase, /393bb98|Fidu/i);
  assert.match(phase, /≤260|<=260|260 LOC/i);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-N.md"), "utf8");
  assert.match(plan, /## N2p — Cutover hosts/);
  assert.match(plan, /PHASE-N2p\.md/);
  assert.match(plan, /Done|livr/i);
});

test("N2p.2 jumeaux plateforme absents ×3 + host-n2-bindings", () => {
  for (const [label, dir] of [
    ["TempoFlow", TF_ELECTRON],
    ["Certivan", CV_ELECTRON],
    ["Fidu", FIDU_ELECTRON],
  ]) {
    assertAbsent(dir, TWINS_ABSENT, label);
    assert.ok(
      fs.existsSync(path.join(dir, "host-n2-bindings.ts")),
      `${label}: host-n2-bindings manquant`,
    );
    const bind = fs.readFileSync(path.join(dir, "host-n2-bindings.ts"), "utf8");
    assert.match(bind, /configureCrashReporter|configureAiWorkspaceHost/);
    assert.doesNotMatch(bind, PAPERCLIP_RE);
  }
});

test("N2p.3 preload mince ≤260 LOC + createDesktopApi", () => {
  for (const [label, dir] of [
    ["TempoFlow", TF_ELECTRON],
    ["Certivan", CV_ELECTRON],
    ["Fidu", FIDU_ELECTRON],
  ]) {
    const pre = path.join(dir, "preload-app.ts");
    assert.ok(fs.existsSync(pre), `${label}: preload-app.ts manquant`);
    const n = loc(pre);
    assert.ok(n <= 260, `${label} preload-app.ts >260 LOC (${n})`);
    const src = fs.readFileSync(pre, "utf8");
    assert.match(src, /@creezio\/shell/);
    // O7 : wireCrmHostPreload (compose createDesktopApi + extensions)
    assert.match(src, /wireCrmHostPreload|createDesktopApi/);
    assert.doesNotMatch(src, PAPERCLIP_RE);
  }
});

test("N2p.4 Meili : TF hooks kit ; CV/Fidu métier", () => {
  const tfIdx = path.join(TF_ELECTRON, "meili-indexer.ts");
  assert.ok(fs.existsSync(tfIdx));
  assert.ok(loc(tfIdx) <= 40, `TF meili-indexer hook trop gros: ${loc(tfIdx)}`);
  assert.match(
    fs.readFileSync(tfIdx, "utf8"),
    /runIndexation|@creezio\/electron-shell/,
  );

  for (const [label, dir] of [
    ["Certivan", CV_ELECTRON],
    ["Fidu", FIDU_ELECTRON],
  ]) {
    assert.ok(
      fs.existsSync(path.join(dir, "meili-indexer.ts")),
      `${label}: meili-indexer métier manquant`,
    );
    assert.ok(
      loc(path.join(dir, "meili-indexer.ts")) > 100,
      `${label}: meili-indexer trop mince (attendu métier)`,
    );
    assert.ok(
      fs.existsSync(path.join(dir, "meili-index-schema.ts")) ||
        fs.existsSync(path.join(dir, "meili-coherence.ts")),
      `${label}: schéma/cohérence meili métier manquant`,
    );
  }
});

test("N2p.5 SHAs marques HEAD ⊇ sign-off N2p (ancêtre)", () => {
  const repos = {
    tempoflow2: resolveBrandRoot("tempoflow2"),
    "certivan-app": resolveBrandRoot("certivan-app"),
    fidu: resolveBrandRoot("fidu"),
  };
  for (const [name, dir] of Object.entries(repos)) {
    const expected = EXPECTED_SHAS[name];
    const head = gitHead(dir);
    // HEAD peut avancer (N3p…) tant que le sign-off N2p reste ancêtre.
    try {
      execSync(`git merge-base --is-ancestor ${expected} HEAD`, {
        cwd: dir,
        stdio: "ignore",
      });
    } catch {
      assert.fail(
        `${name}: sign-off N2p ${expected} n'est pas ancêtre de HEAD ${head}`,
      );
    }
  }
});

test("N2p.6 kit shell aiWorkspace + sessionCookieName BridgeClient", () => {
  const api = fs.readFileSync(
    path.join(root, "packages/shell/src/create-desktop-api.ts"),
    "utf8",
  );
  assert.match(api, /getAiWorkspaceIdentity|ensureAiWorkspace/);
  const runtime = fs.readFileSync(
    path.join(
      root,
      "packages/electron-shell/src/desktop/brand-desktop-runtime.ts",
    ),
    "utf8",
  );
  assert.match(runtime, /sessionCookieName:\s*deps\.sessionCookieName/);
  assert.doesNotMatch(runtime, PAPERCLIP_RE);
});
