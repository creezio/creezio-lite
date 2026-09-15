#!/usr/bin/env node
/**
 * Phase N5 — Feature-off Fidu (`host-na-stubs` → createFeatureOffHost kit).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAPERCLIP_RE = /paperclipApi|startPaperclip\b|paperclip-launcher/;
const fiduElectron = path.join(resolveBrandCrmRoot("fidu"), "electron");
const require = createRequire(import.meta.url);

test("N5.1 PHASE-N5.md + PLAN-N N5", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-N5.md"), "utf8");
  assert.match(phase, /Feature-off Fidu|createFeatureOffHost/i);
  assert.match(phase, /host-na-stubs/);
  assert.match(phase, /features\.plugins\s*=\s*false|plugins:\s*false/i);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-n5/);
  assert.doesNotMatch(phase, PAPERCLIP_RE);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-N.md"), "utf8");
  assert.match(plan, /## N5 — Feature-off Fidu/);
  assert.match(plan, /PHASE-N5\.md/);
  assert.match(plan, /Done|livr/i);
});

test("N5.2 createFeatureOffHost exporté + signatures", async () => {
  const src = path.join(
    root,
    "packages/host-runtime/src/feature-off-host.ts",
  );
  assert.ok(fs.existsSync(src), "feature-off-host.ts manquant");
  const body = fs.readFileSync(src, "utf8");
  assert.match(body, /export function createFeatureOffHost/);
  assert.match(body, /pluginsStatusPayloadWithGit/);
  assert.match(body, /startFleetAgent/);
  assert.match(body, /sampleAssistantChats/);
  assert.match(body, /validatePluginExecutionGrant/);
  assert.doesNotMatch(body, PAPERCLIP_RE);

  // H12 : createFeatureOffHost s'importe depuis @creezio/host-runtime
  // (plus de ré-export compat electron-shell).
  const idx = fs.readFileSync(
    path.join(root, "packages/host-runtime/src/index.ts"),
    "utf8",
  );
  assert.match(idx, /createFeatureOffHost/);

  const dist = path.join(
    root,
    "packages/host-runtime/dist/feature-off-host.js",
  );
  assert.ok(fs.existsSync(dist), "dist feature-off-host manquant — build?");
  const mod = await import(pathToFileURL(dist).href);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "n5-feature-off-"));
  const host = mod.createFeatureOffHost({
    brandLabel: "Fidu",
    userDataDir: () => tmp,
    features: { plugins: false, fleet: false },
  });
  const st = host.plugins.pluginsStatusPayload();
  assert.equal(st.plugins.length, 0);
  assert.match(st.detail, /N\/A Fidu/);
  const en = host.plugins.enablePlugin("x", true);
  assert.equal(en.ok, false);
  assert.equal(await host.fleetAgent.sendFleetHeartbeat(), false);
  assert.equal(host.fleetSamples.sampleUsers().length, 0);
  assert.throws(
    () =>
      mod.createFeatureOffHost({
        brandLabel: "X",
        userDataDir: () => tmp,
        features: { plugins: true },
      }),
    /interdit|features\.plugins/i,
  );
});

test("N5.3 brand-config features.plugins=false via createAppManifest", async () => {
  const bcDist = path.join(root, "packages/brand-config/dist/index.js");
  assert.ok(fs.existsSync(bcDist), "brand-config dist manquant — build?");
  const bc = await import(pathToFileURL(bcDist).href);
  const off = bc.createAppManifest({
    brandId: "offbrand",
    productName: "OffBrand",
    domain: "offbrand.example.test",
    sandbox: true,
    features: { plugins: false, fleet: false },
  });
  assert.equal(off.features?.plugins, false);
  assert.equal(off.features?.fleet, false);
  assert.equal(bc.isFeatureEnabled(off, "plugins"), false);
  assert.equal(bc.isFeatureEnabled(off, "fleet"), false);
  assert.equal(bc.isFeatureEnabled(bc.demobrandManifest, "plugins"), true);
});

test("N5.4 Fidu : host-na-stubs absent + host-stack kit", () => {
  const stubs = path.join(fiduElectron, "host-na-stubs.ts");
  assert.ok(!fs.existsSync(stubs), "host-na-stubs.ts doit être absent");
  const stack = path.join(fiduElectron, "host-stack.ts");
  assert.ok(fs.existsSync(stack), "host-stack.ts manquant");
  const body = fs.readFileSync(stack, "utf8");
  assert.match(body, /createFeatureOffHost/);
  assert.doesNotMatch(body, /host-na-stubs/);
  assert.doesNotMatch(body, /require\(["']\.\/host-na-stubs["']\)/);
  assert.doesNotMatch(body, PAPERCLIP_RE);
});

test("N5.5 0 require host-na-stubs dans Fidu electron", () => {
  const hits = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(ent.name)) {
        const s = fs.readFileSync(p, "utf8");
        if (/host-na-stubs/.test(s)) hits.push(p);
      }
    }
  }
  walk(fiduElectron);
  assert.equal(hits.length, 0, `refs host-na-stubs: ${hits.join(", ")}`);
});
