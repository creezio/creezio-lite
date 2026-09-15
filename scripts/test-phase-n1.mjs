#!/usr/bin/env node
/**
 * Phase N1 — Runtime plugins Electron → @creezio/electron-shell (kit only).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginsDir = path.join(
  root,
  "packages/host-runtime/src/plugins",
);
// H12 : plus de ré-export compat via electron-shell — la surface publique
// des plugins host se vérifie dans les sources SoT de host-runtime.
const hostRuntimeSrc = path.join(root, "packages/host-runtime/src");
const distPlugins = path.join(
  root,
  "packages/host-runtime/dist/plugins",
);

const REQUIRED_MODULES = [
  "brand-bindings.ts",
  "runtime.ts",
  "launcher.ts",
  "git.ts",
  "control-extras.ts",
  "control-adapters.ts",
  "crm-key.ts",
  "accept-check.ts",
  "test-runner.ts",
  "data.ts",
];

const PAPERCLIP_RE = /paperclipApi|startPaperclip|startPaperclip\b/;

test("N1.1 PHASE-N1.md + PLAN-N section N1 livrée", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-N1.md"), "utf8");
  assert.match(phase, /Runtime plugins Electron/i);
  assert.match(phase, /1aac0e2/);
  assert.match(phase, /configurePluginHost|PluginHostBindings/);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-n1/);
  assert.match(phase, /wc -l|LOC/i);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-N.md"), "utf8");
  assert.match(plan, /## N1 — Runtime plugins Electron → kit/);
  assert.match(plan, /PHASE-N1\.md/);
  assert.match(plan, /Done|livr/i);
});

test("N1.2 modules plugins présents sous host/plugins/", () => {
  for (const name of REQUIRED_MODULES) {
    const p = path.join(pluginsDir, name);
    assert.ok(fs.existsSync(p), `manquant: ${name}`);
    const loc = fs.readFileSync(p, "utf8").split("\n").length;
    assert.ok(loc > 10, `${name} trop court: ${loc}`);
  }
  const bindings = fs.readFileSync(
    path.join(pluginsDir, "brand-bindings.ts"),
    "utf8",
  );
  assert.match(bindings, /export type PluginHostBindings/);
  assert.match(bindings, /export function configurePluginHost/);
  assert.match(bindings, /export function getPluginHostBindings/);
  assert.match(bindings, /envPrefix/);
  assert.match(bindings, /ensureDesktopNode/);
  assert.match(bindings, /handleBrandExtras/);
});

test("N1.3 exports publics host-runtime + dist build", () => {
  const pluginsSrc = fs
    .readdirSync(pluginsDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => fs.readFileSync(path.join(pluginsDir, f), "utf8"))
    .join("\n");
  for (const sym of [
    "configurePluginHost",
    "scaffoldPlugin",
    "startEnabledPlugins",
    "startPluginControlApi",
    "handlePluginControlExtras",
    "buildPluginControlPlaneAdapters",
    "runPluginAcceptCheck",
    "runPluginTests",
    "ensurePluginGitRepo",
    "applyPluginDataMigrations",
  ]) {
    assert.match(
      pluginsSrc,
      new RegExp(`export (async )?(function|const|type) ${sym}\\b`),
      `export manquant côté host-runtime/src/plugins : ${sym}`,
    );
  }
  const hostIdx = fs.readFileSync(path.join(hostRuntimeSrc, "index.ts"), "utf8");
  assert.match(hostIdx, /plugins\//, "barrel host-runtime sans les plugins");

  assert.ok(
    fs.existsSync(path.join(distPlugins, "launcher.js")),
    "dist launcher.js manquant — rebuild electron-shell",
  );
  assert.ok(
    fs.existsSync(path.join(distPlugins, "brand-bindings.js")),
    "dist brand-bindings.js manquant",
  );
  assert.ok(
    fs.existsSync(path.join(distPlugins, "control-extras.js")),
    "dist control-extras.js manquant",
  );
});

test("N1.4 PLUGIN_VERTICAL_REMAINING sans modules désormais kit", () => {
  const host = fs.readFileSync(path.join(pluginsDir, "host.ts"), "utf8");
  assert.match(host, /PLUGIN_VERTICAL_REMAINING/);
  assert.doesNotMatch(host, /"plugin-git"/);
  assert.doesNotMatch(host, /"plugin-data"/);
  assert.doesNotMatch(host, /"plugin-accept-check"/);
  assert.doesNotMatch(host, /"plugin-test-runner"/);
  assert.doesNotMatch(host, /"plugin-crm-key"/);
  assert.match(host, /brand-plugin-host-bindings|admin-plugins-ui/);
});

test("N1.5 absence paperclip + gate dans npm test", () => {
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkg, /test-phase-n1\.mjs/);

  for (const name of fs.readdirSync(pluginsDir)) {
    if (!name.endsWith(".ts")) continue;
    const src = fs.readFileSync(path.join(pluginsDir, name), "utf8");
    assert.doesNotMatch(src, PAPERCLIP_RE, `paperclip dans ${name}`);
  }
  const idx = fs.readFileSync(
    path.join(hostRuntimeSrc, "index.ts"),
    "utf8",
  );
  assert.doesNotMatch(idx, PAPERCLIP_RE);
});

test("N1.6 events/grants = réexport platform-core (pas de duplication aveugle)", () => {
  const events = fs.readFileSync(path.join(pluginsDir, "events.ts"), "utf8");
  assert.match(events, /@creezio\/platform-core/);
  assert.match(events, /writePluginRuntimeState|pluginSiteId/);
  const grants = fs.readFileSync(
    path.join(pluginsDir, "execution-grant.ts"),
    "utf8",
  );
  assert.match(grants, /@creezio\/platform-core/);
  assert.match(grants, /issuePluginExecutionGrant/);
});
