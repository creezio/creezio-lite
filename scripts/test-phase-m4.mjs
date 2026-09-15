/**
 * Phase M4 — Delete local-config TF (vision stricte).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { demobrandManifest } from "../packages/brand-config/dist/index.js";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

import {
  createLocalConfigStoreSync,
} from "../packages/host-runtime/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tfCrm = resolveBrandCrmRoot("tempoflow2");

function loc(file) {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

test("M4.1 PHASE-M4.md exige jumeau mort + createLocalConfigStore", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-M4.md"), "utf8");
  assert.match(doc, /local-config\.ts/);
  assert.match(doc, /createLocalConfigStore/);
  assert.match(doc, /jumeau|absent/i);
  assert.doesNotMatch(doc, /stub = done|jumeau OK/i);
});

test("M4.2 kit : fleetTelemetry + configPath getter + electron sync", () => {
  const schema = fs.readFileSync(
    path.join(root, "packages/platform-core/src/local-config-schema.ts"),
    "utf8",
  );
  assert.match(schema, /fleetTelemetry/);
  const fleet = fs.readFileSync(
    path.join(root, "packages/platform-core/src/fleet-telemetry.ts"),
    "utf8",
  );
  assert.match(fleet, /sanitizeFleetTelemetry/);
  assert.match(fleet, /applyFleetTelemetryPatch/);

  const lc = fs.readFileSync(
    path.join(root, "packages/host-runtime/src/local-config.ts"),
    "utf8",
  );
  assert.match(lc, /getFleetTelemetry/);
  assert.match(lc, /LocalConfigPath/);
  assert.match(lc, /encryption: "plain" \| "inject" \| "electron"/);
  assert.match(lc, /loadElectronSafeStorageSync/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-m4-"));
  let active = dir;
  const store = createLocalConfigStoreSync({
    configPath: () => path.join(active, "tempoflow-config.json"),
    manifest: demobrandManifest,
    encryption: "plain",
  });
  store.setFleetTelemetry({ preset: "basic" });
  assert.equal(store.getFleetTelemetry().enabled, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("M4.3 TF : local-config.ts absent ; wiring ≤40 LOC kit", () => {
  assert.equal(
    fs.existsSync(path.join(tfCrm, "electron/local-config.ts")),
    false,
    "jumeau electron/local-config.ts encore présent",
  );
  const wiring = path.join(tfCrm, "electron/local-config-store.ts");
  assert.ok(fs.existsSync(wiring), "local-config-store.ts manquant");
  const n = loc(wiring);
  assert.ok(n <= 40, `wiring trop long: ${n} LOC`);
  const src = fs.readFileSync(wiring, "utf8");
  assert.match(src, /@creezio\/electron-shell/);
  assert.match(src, /createLocalConfigStoreSync/);
  assert.doesNotMatch(src, /from "\.\/local-config"/);
});

test("M4.4 TF call sites n'importent plus ./local-config", () => {
  const electronDir = path.join(tfCrm, "electron");
  for (const name of fs.readdirSync(electronDir)) {
    if (!name.endsWith(".ts")) continue;
    if (name === "local-config.ts") continue;
    const src = fs.readFileSync(path.join(electronDir, name), "utf8");
    assert.doesNotMatch(
      src,
      /from ["']\.\/local-config["']/,
      `${name} importe encore ./local-config`,
    );
  }
});
