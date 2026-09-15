#!/usr/bin/env node
/**
 * Phase N1p — Cutover plugins runtime TF → Certivan → Fidu.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TF_ELECTRON = path.join(resolveBrandCrmRoot("tempoflow2"), "electron");
const CV_ELECTRON = path.join(resolveBrandCrmRoot("certivan-app"), "electron");
const FIDU_ELECTRON = path.join(resolveBrandCrmRoot("fidu"), "electron");

const TWINS_ABSENT_TF_CV = [
  "plugin-runtime.ts",
  "plugin-launcher.ts",
  "plugin-git.ts",
  "plugin-control-extras.ts",
  "plugin-control-adapters.ts",
  "plugin-crm-key.ts",
  "plugin-data.ts",
  "plugin-accept-check.ts",
  "plugin-test-runner.ts",
  "plugin-events.ts",
  "plugin-execution-grant.ts",
];

const TWINS_ABSENT_FIDU = [
  "plugin-runtime.ts",
  "plugin-launcher.ts",
  "plugin-git.ts",
  "plugin-control-extras.ts",
];

const PAPERCLIP_RE = /paperclipApi|startPaperclip\b|paperclip-launcher/;

function assertAbsent(dir, names, label) {
  assert.ok(fs.existsSync(dir), `${label} electron/ introuvable: ${dir}`);
  for (const name of names) {
    assert.ok(
      !fs.existsSync(path.join(dir, name)),
      `${label}: jumeau encore présent: ${name}`,
    );
  }
}

function assertControlApiBudget(dir, label) {
  const p = path.join(dir, "plugin-control-api.ts");
  if (!fs.existsSync(p)) return;
  const loc = fs.readFileSync(p, "utf8").split("\n").length;
  assert.ok(loc <= 40, `${label} plugin-control-api.ts >40 LOC (${loc})`);
  const src = fs.readFileSync(p, "utf8");
  assert.match(src, /@creezio\/electron-shell|plugin-control-boot/);
}

test("N1p.1 PHASE-N1p.md + PLAN-N N1p livré", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-N1p.md"), "utf8");
  assert.match(phase, /Cutover plugins runtime/i);
  assert.match(phase, /fadb3e4|configurePluginHost/);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-n1p/);
  assert.match(phase, /063ac3c|TempoFlow/i);
  assert.match(phase, /Certivan/i);
  assert.match(phase, /Fidu/i);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-N.md"), "utf8");
  assert.match(plan, /## N1p — Cutover plugins runtime/);
  assert.match(plan, /PHASE-N1p\.md/);
  assert.match(plan, /Done|livr/i);
});

test("N1p.2 TF + Certivan : jumeaux runtime absents + control-api ≤40", () => {
  assertAbsent(TF_ELECTRON, TWINS_ABSENT_TF_CV, "TempoFlow");
  assertAbsent(CV_ELECTRON, TWINS_ABSENT_TF_CV, "Certivan");
  assertControlApiBudget(TF_ELECTRON, "TempoFlow");
  assertControlApiBudget(CV_ELECTRON, "Certivan");

  assert.ok(
    fs.existsSync(path.join(TF_ELECTRON, "plugin-host-bindings.ts")),
    "TF plugin-host-bindings manquant",
  );
  assert.ok(
    fs.existsSync(path.join(CV_ELECTRON, "plugin-host-bindings.ts")),
    "CV plugin-host-bindings manquant",
  );
  const tfBind = fs.readFileSync(
    path.join(TF_ELECTRON, "plugin-host-bindings.ts"),
    "utf8",
  );
  assert.match(tfBind, /configurePluginHost/);
  assert.match(tfBind, /ensureTfPluginHostConfigured/);
  const cvBind = fs.readFileSync(
    path.join(CV_ELECTRON, "plugin-host-bindings.ts"),
    "utf8",
  );
  assert.match(cvBind, /configurePluginHost/);
  assert.match(cvBind, /ensureCvPluginHostConfigured/);
});

test("N1p.3 Fidu : pas de jumeaux runtime complets", () => {
  assertAbsent(FIDU_ELECTRON, TWINS_ABSENT_FIDU, "Fidu");
  assert.ok(
    !fs.existsSync(path.join(FIDU_ELECTRON, "plugin-host-bindings.ts")) ||
      fs
        .readFileSync(path.join(FIDU_ELECTRON, "plugin-host-bindings.ts"), "utf8")
        .split("\n").length <= 120,
    "Fidu ne doit pas réintroduire un runtime plugins volumineux",
  );
});

test("N1p.4 host-stack marques pointe kit / configure", () => {
  const tfStack = fs.readFileSync(
    path.join(TF_ELECTRON, "host-stack.ts"),
    "utf8",
  );
  assert.match(tfStack, /@creezio\/electron-shell/);
  assert.match(tfStack, /ensureTfPluginHostConfigured/);
  assert.doesNotMatch(tfStack, /require\(["']\.\/plugin-launcher["']\)/);

  const cvStack = fs.readFileSync(
    path.join(CV_ELECTRON, "host-stack.ts"),
    "utf8",
  );
  assert.match(cvStack, /@creezio\/electron-shell/);
  assert.match(cvStack, /ensureCvPluginHostConfigured/);
  assert.doesNotMatch(cvStack, /require\(["']\.\/plugin-launcher["']\)/);
});

test("N1p.5 grant prefix marque dans kit control-extras", () => {
  const extras = fs.readFileSync(
    path.join(
      root,
      "packages/host-runtime/src/plugins/control-extras.ts",
    ),
    "utf8",
  );
  assert.match(extras, /productHubTokensFromManifest/);
  assert.match(extras, /grantTokenPrefix/);
  assert.match(extras, /tokenPrefix:\s*grantTokenPrefix/);
});

test("N1p.6 paperclip mort + gate dans npm test", () => {
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkg, /test-phase-n1p\.mjs/);

  for (const dir of [TF_ELECTRON, CV_ELECTRON, FIDU_ELECTRON]) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".ts")) continue;
      if (!name.includes("plugin") && !name.includes("paperclip")) continue;
      const src = fs.readFileSync(path.join(dir, name), "utf8");
      assert.doesNotMatch(src, PAPERCLIP_RE, `paperclip dans ${dir}/${name}`);
    }
  }
  const pluginsDir = path.join(
    root,
    "packages/host-runtime/src/plugins",
  );
  for (const name of fs.readdirSync(pluginsDir)) {
    if (!name.endsWith(".ts")) continue;
    const src = fs.readFileSync(path.join(pluginsDir, name), "utf8");
    assert.doesNotMatch(src, PAPERCLIP_RE, `paperclip kit ${name}`);
  }
});
