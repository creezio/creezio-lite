#!/usr/bin/env node
/**
 * Phase O3 — Jumeaux Electron plateforme → kit (extract only).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dockerRoot = path.resolve(root, "..");

const KIT_FILES = [
  "packages/platform-core/src/installer-prefs.ts",
  "packages/platform-core/src/licensing.ts",
  "packages/host-runtime/src/n8n/api-key.ts",
  "packages/host-runtime/src/n8n/agent-isolation.ts",
  "packages/electron-shell/src/desktop/assistant-chrome.ts",
  "packages/electron-shell/src/desktop/oauth-loopback.ts",
  "packages/electron-shell/src/desktop/profile-picker-html.ts",
  "packages/electron-shell/src/desktop/error-page-html.ts",
  "packages/host-runtime/src/hermes/crm-key.ts",
  "packages/host-runtime/src/hermes/ensure-crm-key-db.ts",
];

const BRAND_TWINS = [
  "n8n-api-key.ts",
  "agent-isolation.ts",
  "oauth-loopback.ts",
  "assistant-chrome.ts",
  "profile-picker-html.ts",
  "factory-reset.ts",
  "licensing.ts",
];

test("O3.1 PHASE-O3.md + PLAN-O O3", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-O3.md"), "utf8");
  assert.match(phase, /Jumeaux Electron|extract only|api-key/i);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-o3/);
  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-O.md"), "utf8");
  assert.match(plan, /## O3 — Jumeaux Electron/);
  assert.match(plan, /O3 — Jumeaux Electron.*✅|PHASE-O3/);
});

test("O3.2 modules kit présents", () => {
  for (const rel of KIT_FILES) {
    assert.ok(fs.existsSync(path.join(root, rel)), rel);
  }
});

test("O3.3 exports barrels", () => {
  const core = fs.readFileSync(
    path.join(root, "packages/platform-core/src/index.ts"),
    "utf8",
  );
  assert.match(core, /installer-prefs/);
  assert.match(core, /licensing/);
  const shell = fs.readFileSync(
    path.join(root, "packages/electron-shell/src/index.ts"),
    "utf8",
  );
  assert.match(shell, /assistant-chrome/);
  assert.match(shell, /oauth-loopback/);
  assert.match(shell, /profile-picker-html/);
  assert.match(shell, /error-page-html/);
  // P1.b/H12 : les modules host n8n/hermes vivent dans @creezio/host-runtime
  // (plus de ré-export compat via electron-shell).
  for (const relHost of ["n8n/api-key.ts", "hermes/crm-key.ts", "n8n/agent-isolation.ts"]) {
    assert.ok(
      fs.existsSync(path.join(root, "packages/host-runtime/src", relHost)),
      `host-runtime/src/${relHost} manquant`,
    );
  }
  const tabs = fs.readFileSync(
    path.join(root, "packages/electron-shell/src/host/browser-tabs/index.ts"),
    "utf8",
  );
  assert.match(tabs, /installUserAgent/);
  assert.match(tabs, /FAKE_CURSOR_INJECT/);
});

test("O3.4 paramétrage marque (pas hardcode unique TF dans API)", () => {
  const api = fs.readFileSync(
    path.join(root, "packages/host-runtime/src/n8n/api-key.ts"),
    "utf8",
  );
  assert.match(api, /N8nApiKeyBrand/);
  assert.match(api, /brand:\s*N8nApiKeyBrand/);
  assert.doesNotMatch(api, /export const N8N_API_KEY_LABEL = "TempoFlow/);
  const lic = fs.readFileSync(
    path.join(root, "packages/platform-core/src/licensing.ts"),
    "utf8",
  );
  assert.match(lic, /LicensingOptions/);
  assert.match(lic, /keyPrefix/);
});

test("O3.5 smoke Node installer-prefs + licensing", async () => {
  const {
    parseInstallerPrefs,
    consumeInstallerPrefsFile,
    checkLicense,
    storeLicenseKey,
  } = await import("../packages/platform-core/dist/index.js");
  assert.deepEqual(parseInstallerPrefs('{"launchAtStartup":true}'), {
    launchAtStartup: true,
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "o3-prefs-"));
  fs.writeFileSync(
    path.join(tmp, "installer-prefs.json"),
    JSON.stringify({ launchAtStartup: false }),
  );
  const prefs = consumeInstallerPrefsFile(tmp);
  assert.equal(prefs?.launchAtStartup, false);
  assert.ok(!fs.existsSync(path.join(tmp, "installer-prefs.json")));
  const status = checkLicense({
    userDataRoot: tmp,
    keyPrefix: "TF2",
    publicKeyPem: "",
  });
  assert.equal(status.state, "unlicensed");
  storeLicenseKey(
    { userDataRoot: tmp, keyPrefix: "TF2" },
    "TF2-not-a-real-key",
  );
  assert.ok(fs.existsSync(path.join(tmp, "license.key")));
});

test("O3.6 cutover délégué O3p (jumeaux absents post-cutover)", () => {
  // O3 extract-only ; O3p a supprimé les jumeaux — assert absences.
  for (const brand of ["tempoflow2", "certivan-app", "fidu"]) {
    for (const name of BRAND_TWINS) {
      const p = path.join(dockerRoot, brand, "crm/electron", name);
      assert.ok(!fs.existsSync(p), `${brand}: jumeau encore présent: ${name}`);
    }
  }
});

test("O3.7 gate enregistrée npm test", () => {
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkg, /test-phase-o3\.mjs/);
});
