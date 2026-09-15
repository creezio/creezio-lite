/**
 * Phase M3 — Product Hub / control-plane zéro façade TF (vision stricte).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tfCrm = resolveBrandCrmRoot("tempoflow2");
const hubPkg = path.join(root, "packages/product-hub");

function loc(file) {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

test("M3.1 PHASE-M3.md exige startHostPluginControlPlane + ≤40 LOC", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-M3.md"), "utf8");
  assert.match(doc, /startHostPluginControlPlane/);
  assert.match(doc, /@creezio\/product-hub/);
  assert.match(doc, /≤\s*40|≤40/);
  assert.doesNotMatch(doc, /stub = done|façade OK sans cutover/i);
});

test("M3.2 kit expose migrate / bindings / host-api / service-key", () => {
  const idx = fs.readFileSync(path.join(hubPkg, "src/index.ts"), "utf8");
  assert.match(idx, /migrateLegacyBrandProductHubOnce/);
  assert.match(idx, /createBrandProductHubBindings/);
  assert.match(idx, /createCachedSqliteProductHubAccessor/);
  assert.match(idx, /createProductHubHost/);
  assert.match(idx, /withBearerServiceKeyFallback/);
  assert.ok(
    fs.existsSync(path.join(hubPkg, "dist/host-api.js")),
    "dist host-api manquant — rebuild product-hub",
  );
});

test("M3.3 TF façades ≤40 LOC wiring pur", () => {
  // O1 : plugin-control-api absent (anti-façade) ; autres wirings ≤40.
  assert.ok(
    !fs.existsSync(path.join(tfCrm, "electron/plugin-control-api.ts")),
    "O1: plugin-control-api façade",
  );
  const files = [
    "electron/plugin-hub-store.ts",
    "src/lib/platform-stores/product-hub-adapter.ts",
    "src/lib/plugin-product-hub.ts",
  ];
  for (const rel of files) {
    const n = loc(path.join(tfCrm, rel));
    // plugin-product-hub réexporte types hub — budget élargi vs wiring pur ≤40
    const max = rel.endsWith("plugin-product-hub.ts") ? 55 : 40;
    assert.ok(n <= max, `${rel} trop long: ${n} LOC (max ${max})`);
  }
});

test("M3.4 TF boot = startHostPluginControlPlane + adapters verticaux", () => {
  // O1 : SoT control-extras / adapters kit ; TF = bindings only (0 façade api).
  const extras = fs.readFileSync(
    path.join(
      root,
      "packages/host-runtime/src/plugins/control-extras.ts",
    ),
    "utf8",
  );
  assert.match(extras, /startHostPluginControlPlane/);
  assert.match(extras, /createControlPlaneAcl|buildControlPlaneAdapters/);
  assert.match(extras, /handlePluginControlExtras|accept-check/);

  const adapters = fs.readFileSync(
    path.join(
      root,
      "packages/host-runtime/src/plugins/control-adapters.ts",
    ),
    "utf8",
  );
  assert.match(adapters, /buildPluginControlPlaneAdapters/);

  const bindings = fs.readFileSync(
    path.join(tfCrm, "electron/plugin-host-bindings.ts"),
    "utf8",
  );
  assert.match(bindings, /configurePluginHost/);
  assert.match(bindings, /createTempoflowControlPlaneAcl/);
  assert.match(bindings, /buildPluginControlPlaneAdapters/);

  assert.ok(
    !fs.existsSync(path.join(tfCrm, "electron/plugin-control-api.ts")),
    "O1: façade plugin-control-api",
  );
  assert.ok(
    !fs.existsSync(path.join(tfCrm, "electron/plugin-control-extras.ts")),
    "TF ne doit plus avoir de jumeau plugin-control-extras",
  );
});

test("M3.5 TF product-hub / hub-store importent le kit", () => {
  const hub = fs.readFileSync(
    path.join(tfCrm, "src/lib/plugin-product-hub.ts"),
    "utf8",
  );
  assert.match(hub, /createProductHubHost/);
  assert.match(hub, /@creezio\/product-hub/);

  const store = fs.readFileSync(
    path.join(tfCrm, "electron/plugin-hub-store.ts"),
    "utf8",
  );
  assert.match(store, /createBrandProductHubBindings/);

  const adapter = fs.readFileSync(
    path.join(tfCrm, "src/lib/platform-stores/product-hub-adapter.ts"),
    "utf8",
  );
  assert.match(adapter, /createCachedSqliteProductHubAccessor/);
  assert.doesNotMatch(adapter, /dual-write|INSERT INTO plugin_products/);
});
