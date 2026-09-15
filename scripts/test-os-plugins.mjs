#!/usr/bin/env node
/**
 * Plugins control plane via compose OS — actifs par défaut,
 * kill-switch CREEZIO_PLUGINS=0 (l'ancien opt-in =1 reste un no-op).
 * Harness si probe brand résolu hors monorepo kit.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startBrandKernelHarness } from "../packages/app-runtime/dist/index.js";
import { linkKitNodeModules } from "./lib/link-kit-node-modules.mjs";
import { resolveProbeBrandServerDir } from "./lib/resolve-probe-brand.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TF3 = resolveProbeBrandServerDir(ROOT);

async function bootProbe(envExtra = {}) {
  const electron = path.join(TF3, "build/electron");
  const manifestMod = await import(
    pathToFileURL(path.join(electron, "app-manifest.js")).href,
  );
  const migMod = await import(
    pathToFileURL(path.join(electron, "brand-migrations.js")).href,
  );
  const apiMod = await import(
    pathToFileURL(path.join(electron, "brand-module-api.js")).href,
  );
  const feedMod = await import(
    pathToFileURL(path.join(electron, "meili-feed.js")).href,
  );
  const manifestKey = Object.keys(manifestMod).find((k) =>
    k.endsWith("Manifest"),
  );
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "os-plugins-"));
  // Hors-browse : Meili volontairement absent (download kit bloqué / offline).
  process.env.CREEZIO_ALLOW_NO_MEILI = "1";
  for (const [k, v] of Object.entries(envExtra)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return startBrandKernelHarness({
    brandId: "tempoflow3",
    appRoot: TF3,
    dataDir,
    manifest: manifestMod[manifestKey],
    brandMigrations: migMod.brandMigrations(),
    registerModuleApi: apiMod.registerBrandModuleApi,
    beforeBoot: feedMod.applyBrandMeiliConfig,
    meiliFeed: feedMod.brandMeiliFeed,
    skipIndex: true,
  });
}

function ensureBuilt() {
  if (!TF3 || !fs.existsSync(path.join(TF3, "src/electron/brand-migrations.ts"))) {
    return false;
  }
  if (fs.existsSync(path.join(ROOT, "node_modules"))) {
    linkKitNodeModules(TF3, ROOT);
  }
  const build = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "node_modules/typescript/bin/tsc"),
      "-p",
      "tsconfig.electron.json",
    ],
    {
      encoding: "utf8",
      cwd: TF3,
      env: {
        ...process.env,
        CREEZIO_KIT_ROOT: ROOT,
        CREEZIO_ROOT: ROOT, // legacy compat (Q8)
        NODE_PATH: path.join(ROOT, "node_modules"),
      },
    },
  );
  assert.equal(build.status, 0, build.stderr);
  return true;
}

test("plugins feature-off via kill-switch CREEZIO_PLUGINS=0 + endpoint", async () => {
  if (!ensureBuilt()) {
    console.log(
      "skip: probe brand absent (CREEZIO_TEMPOFLOW3_ROOT / ../tempoflow3)",
    );
    return;
  }
  const prevWarm = process.env.CREEZIO_NATIVE_WARM;
  const prevPlugins = process.env.CREEZIO_PLUGINS;
  process.env.CREEZIO_NATIVE_WARM = "0";
  process.env.CREEZIO_PLUGINS = "0";

  const handle = await bootProbe();
  try {
    const status = await (
      await fetch(`${handle.baseUrl}/api/v1/os/status`)
    ).json();
    assert.equal(status.hosts.plugins, "feature-off");
    const plugins = await (
      await fetch(`${handle.baseUrl}/api/v1/os/plugins`)
    ).json();
    assert.equal(plugins.mode, "feature-off");
    assert.ok(Array.isArray(plugins.plugins));
  } finally {
    await handle.close();
    if (prevWarm === undefined) delete process.env.CREEZIO_NATIVE_WARM;
    else process.env.CREEZIO_NATIVE_WARM = prevWarm;
    if (prevPlugins === undefined) delete process.env.CREEZIO_PLUGINS;
    else process.env.CREEZIO_PLUGINS = prevPlugins;
  }
});

test("plugins enabled avec CREEZIO_PLUGINS=1 (no-op, déjà défaut) + listPlugins HTTP", async () => {
  if (!TF3 || !fs.existsSync(path.join(TF3, "src/electron/brand-migrations.ts"))) {
    console.log(
      "skip: probe brand absent (CREEZIO_TEMPOFLOW3_ROOT / ../tempoflow3)",
    );
    return;
  }
  const prevWarm = process.env.CREEZIO_NATIVE_WARM;
  const prevPlugins = process.env.CREEZIO_PLUGINS;
  process.env.CREEZIO_NATIVE_WARM = "0";
  process.env.CREEZIO_PLUGINS = "1";

  const handle = await bootProbe();
  try {
    const status = await (
      await fetch(`${handle.baseUrl}/api/v1/os/status`)
    ).json();
    assert.equal(
      status.hosts.plugins,
      "enabled",
      JSON.stringify(status.hosts),
    );
    const plugins = await (
      await fetch(`${handle.baseUrl}/api/v1/os/plugins`)
    ).json();
    assert.equal(plugins.ok, true, JSON.stringify(plugins));
    assert.equal(plugins.mode, "enabled");
    assert.ok(Array.isArray(plugins.plugins));
    assert.equal(typeof plugins.count, "number");
  } finally {
    await handle.close();
    if (prevWarm === undefined) delete process.env.CREEZIO_NATIVE_WARM;
    else process.env.CREEZIO_NATIVE_WARM = prevWarm;
    if (prevPlugins === undefined) delete process.env.CREEZIO_PLUGINS;
    else process.env.CREEZIO_PLUGINS = prevPlugins;
  }
});
