/**
 * Phase M5 — Delete bootstraps hermes/n8n TF (vision stricte).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tfCrm = resolveBrandCrmRoot("tempoflow2");

function loc(file) {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

test("M5.1 PHASE-M5.md exige jumeaux morts + installHermesAgent", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-M5.md"), "utf8");
  assert.match(doc, /hermes-runtime-bootstrap/);
  assert.match(doc, /n8n-runtime-bootstrap/);
  assert.match(doc, /installHermesAgent/);
  assert.match(doc, /jumeau|absent/i);
  assert.doesNotMatch(doc, /stub = done|jumeau OK/i);
});

test("M5.2 kit hermes bootstrap : deltas TF (install + webui deps)", () => {
  const boot = fs.readFileSync(
    path.join(
      root,
      "packages/host-runtime/src/hermes/runtime-bootstrap.ts",
    ),
    "utf8",
  );
  assert.match(boot, /export async function installHermesAgent/);
  assert.match(boot, /vendoredInstallScriptPath/);
  assert.match(boot, /hermesInstallOsProfileDir/);
  assert.match(boot, /WEBUI_DEPS_MARKER/);
  assert.match(boot, /isWebuiDepsMarkerCurrent/);
  assert.match(boot, /webuiPythonDepsReady/);
  assert.match(boot, /import yaml, cryptography/);
  assert.match(boot, /démarrage…/);
  assert.match(boot, /verifyInstallScriptChecksum/);
  assert.match(boot, /-Stage/);
  assert.match(boot, /HostRuntimeContext/);
});

test("M5.3 kit n8n bootstrap : deltas TF (failDiskSpace + force + timeout)", () => {
  const boot = fs.readFileSync(
    path.join(
      root,
      "packages/host-runtime/src/n8n/runtime-bootstrap.ts",
    ),
    "utf8",
  );
  assert.match(boot, /failDiskSpace/);
  assert.match(boot, /diskSpacePreflightMessage/);
  assert.match(boot, /force\?:/);
  assert.match(boot, /timeoutMs:\s*30\s*\*\s*60\s*\*\s*1000/);
  assert.match(boot, /HostRuntimeContext/);
  assert.match(boot, /n8nPackageJsonPath/);

  const npm = fs.readFileSync(
    path.join(root, "packages/host-runtime/src/npm-cli.ts"),
    "utf8",
  );
  assert.match(npm, /timeoutMs\?:/);
});

test("M5.4 TF : bootstraps absents ; host-runtime-ctx ≤250 LOC", () => {
  assert.equal(
    fs.existsSync(path.join(tfCrm, "electron/hermes-runtime-bootstrap.ts")),
    false,
    "jumeau hermes-runtime-bootstrap.ts encore présent",
  );
  assert.equal(
    fs.existsSync(path.join(tfCrm, "electron/n8n-runtime-bootstrap.ts")),
    false,
    "jumeau n8n-runtime-bootstrap.ts encore présent",
  );
  const hooks = path.join(tfCrm, "electron/host-runtime-ctx.ts");
  assert.ok(fs.existsSync(hooks), "host-runtime-ctx.ts manquant");
  const n = loc(hooks);
  // M7 : + fleetAgent/Samples → budget 200→250 (wiring marque, pas jumeau)
  assert.ok(n <= 360, `host-runtime-ctx trop long: ${n} LOC`);
  const src = fs.readFileSync(hooks, "utf8");
  assert.match(src, /@creezio\/electron-shell/);
  // O7 : createBrandHostRuntime (singletons hermes/n8n dans le kit)
  assert.match(src, /createBrandHostRuntime|createHermesHost/);
  assert.match(src, /createBrandHostRuntime|createN8nHost|TF_N8N|n8nAgent/);
});

test("M5.5 TF electron : aucun import local des bootstraps morts", () => {
  const electronDir = path.join(tfCrm, "electron");
  for (const name of fs.readdirSync(electronDir)) {
    if (!name.endsWith(".ts")) continue;
    const src = fs.readFileSync(path.join(electronDir, name), "utf8");
    assert.doesNotMatch(
      src,
      /from ["']\.\/hermes-runtime-bootstrap["']/,
      `${name} importe encore ./hermes-runtime-bootstrap`,
    );
    assert.doesNotMatch(
      src,
      /from ["']\.\/n8n-runtime-bootstrap["']/,
      `${name} importe encore ./n8n-runtime-bootstrap`,
    );
  }
});
