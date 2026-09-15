#!/usr/bin/env node
/**
 * Gate resolveManifest — registre + fallback app-manifest.json (from-prd).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAppManifest,
  listBrandIds,
  listProductionBrandIds,
  resolveManifest,
  isRegisteredBrandId,
} from "../packages/brand-config/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("registre : demobrand seule (sandbox kit) — manifests prod SORTIS (H11)", () => {
  assert.deepEqual([...listBrandIds()].sort(), ["demobrand"]);
  assert.ok(!listBrandIds().includes("tempoflow"));
  assert.ok(!listBrandIds().includes("certivan"));
  assert.ok(!listBrandIds().includes("fidu"));
  assert.ok(!listProductionBrandIds().includes("demobrand"));
  assert.deepEqual(listProductionBrandIds(), []);
  assert.equal(isRegisteredBrandId("tempoflow"), false);
  assert.equal(isRegisteredBrandId("acme-future"), false);
});

test("resolveManifest registre", () => {
  const m = resolveManifest("demobrand");
  assert.equal(m.brandId, "demobrand");
  assert.ok(m.client.feedUrl.includes("demobrand"));
});

test("resolveManifest from-prd via app-manifest.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-manifest-"));
  const manifest = createAppManifest({
    brandId: "acmechr",
    productName: "Acme CHR",
    domain: "acmechr.creez.io",
    sandbox: true,
    defaultAppRoot: dir,
  });
  fs.mkdirSync(path.join(dir, "src/electron"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "src/electron/app-manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  const resolved = resolveManifest("acmechr", { appRoot: dir });
  assert.equal(resolved.brandId, "acmechr");
  assert.equal(resolved.client.productName, "Acme CHR");
  assert.ok(resolved.sandbox);
});

test("resolveManifest inconnu sans JSON → erreur", () => {
  assert.throws(
    () => resolveManifest("no-such-brand-xyz", { appRoot: ROOT }),
    /Marque inconnue/,
  );
});
