/**
 * Phase M3p — Product Hub Certivan + Fidu (vision stricte).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const certCrm = resolveBrandCrmRoot("certivan-app");
const fiduCrm = resolveBrandCrmRoot("fidu");

function loc(file) {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

test("M3p.1 PHASE-M3p.md Certivan puis Fidu", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-M3p.md"), "utf8");
  assert.match(doc, /Certivan/);
  assert.match(doc, /Fidu/);
  assert.match(doc, /startHostPluginControlPlane/);
  assert.match(doc, /≤\s*40|≤40/);
});

test("M3p.2 Certivan façades ≤40 + boot kit", () => {
  // O1 : plugin-control-api absent ; autres wirings ≤40.
  assert.ok(
    !fs.existsSync(path.join(certCrm, "electron/plugin-control-api.ts")),
  );
  assert.ok(loc(path.join(certCrm, "electron/plugin-hub-store.ts")) <= 40);
  assert.ok(
    loc(path.join(certCrm, "src/lib/platform-stores/product-hub-adapter.ts")) <=
      40,
  );
  assert.ok(
    loc(path.join(certCrm, "src/lib/plugin-product-hub.ts")) <= 55,
    "Certivan plugin-product-hub (réexports types)",
  );
  assert.ok(
    !fs.existsSync(path.join(certCrm, "electron/plugin-control-extras.ts")),
    "Certivan ne doit plus avoir de jumeau plugin-control-extras",
  );
  const kitExtras = fs.readFileSync(
    path.join(
      root,
      "packages/host-runtime/src/plugins/control-extras.ts",
    ),
    "utf8",
  );
  assert.match(kitExtras, /startHostPluginControlPlane/);
  const bindings = fs.readFileSync(
    path.join(certCrm, "electron/plugin-host-bindings.ts"),
    "utf8",
  );
  assert.match(bindings, /configurePluginHost/);
  assert.match(bindings, /createCertivanControlPlaneAcl/);
});

test("M3p.3 Fidu façades ≤40 + boot kit", () => {
  // O1 : façade api absente ; boot wiring + hub-store ≤40.
  assert.ok(!fs.existsSync(path.join(fiduCrm, "electron/plugin-control-api.ts")));
  assert.ok(loc(path.join(fiduCrm, "electron/plugin-hub-store.ts")) <= 40);
  const boot = fs.readFileSync(
    path.join(fiduCrm, "electron/plugin-control-boot.ts"),
    "utf8",
  );
  assert.match(boot, /startHostPluginControlPlane/);
  assert.match(boot, /createFiduControlPlaneAcl/);
});
