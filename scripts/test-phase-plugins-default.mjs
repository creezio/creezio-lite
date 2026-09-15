#!/usr/bin/env node
/**
 * Gate P1 plugins natifs — activation par défaut.
 *
 * - PD1 : sans env ⇒ plugins ENABLED (défaut inversé, plus d'opt-in).
 * - PD2 : manifest `features.plugins = false` (Fidu) ⇒ feature-off.
 * - PD3 : kill-switch `CREEZIO_PLUGINS=0` ⇒ feature-off.
 * - PD4 : `CREEZIO_PLUGINS=1` legacy ⇒ toujours enabled (no-op).
 * - PD5 : plugins livrés par la marque (`<appRoot>/plugins/<id>/`) installés
 *         au boot (seed idempotent, jamais d'écrasement).
 *
 * Hermétique : marque synthétique via createAppManifest + harness kit,
 * zéro repo marque requis.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createAppManifest } from "../packages/brand-config/dist/index.js";
import { startBrandKernelHarness } from "../packages/app-runtime/dist/index.js";

const ENV_KEYS = [
  "CREEZIO_PLUGINS",
  "CREEZIO_NATIVE_WARM",
  "CREEZIO_SKIP_KIT_BINARIES",
];
const saveEnv = () =>
  Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const restoreEnv = (saved) => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};

async function bootProbe({ pluginsEnv, featureOff, beforeBoot } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plugins-default-"));
  process.env.CREEZIO_SKIP_KIT_BINARIES = "1";
  process.env.CREEZIO_NATIVE_WARM = "0";
  if (pluginsEnv === undefined) delete process.env.CREEZIO_PLUGINS;
  else process.env.CREEZIO_PLUGINS = pluginsEnv;
  beforeBoot?.(tmp);

  const base = createAppManifest({
    brandId: "pluginsprobe",
    productName: "Plugins Probe",
    domain: "pluginsprobe.local",
    sandbox: true,
  });
  const manifest = featureOff
    ? { ...base, features: { ...(base.features || {}), plugins: false } }
    : base;

  const handle = await startBrandKernelHarness({
    brandId: "pluginsprobe",
    appRoot: tmp,
    dataDir: path.join(tmp, "data"),
    manifest,
    brandMigrations: [],
    registerModuleApi: () => {},
    skipIndex: true,
  });
  return {
    handle,
    tmp,
    close: async () => {
      await handle.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

async function pluginsMode(handle) {
  const status = await (
    await fetch(`${handle.baseUrl}/api/v1/os/status`)
  ).json();
  const endpoint = await (
    await fetch(`${handle.baseUrl}/api/v1/os/plugins`)
  ).json();
  return { status: status.hosts.plugins, endpoint };
}

test("PD1 sans env : plugins ENABLED par défaut (endpoint + control plane)", async () => {
  const saved = saveEnv();
  let probe = null;
  try {
    probe = await bootProbe({ pluginsEnv: undefined });
    const { status, endpoint } = await pluginsMode(probe.handle);
    assert.equal(status, "enabled", "hosts.plugins enabled sans env");
    assert.equal(endpoint.ok, true, JSON.stringify(endpoint));
    assert.equal(endpoint.mode, "enabled");
    assert.ok(Array.isArray(endpoint.plugins));
    assert.equal(typeof endpoint.count, "number");
  } finally {
    await probe?.close();
    restoreEnv(saved);
  }
});

test("PD2 manifest features.plugins=false (Fidu) : feature-off", async () => {
  const saved = saveEnv();
  let probe = null;
  try {
    probe = await bootProbe({ pluginsEnv: undefined, featureOff: true });
    const { status, endpoint } = await pluginsMode(probe.handle);
    assert.equal(status, "feature-off", "features.plugins=false respecté");
    assert.equal(endpoint.mode, "feature-off");
    assert.deepEqual(endpoint.plugins, []);
  } finally {
    await probe?.close();
    restoreEnv(saved);
  }
});

test("PD3 kill-switch CREEZIO_PLUGINS=0 : feature-off", async () => {
  const saved = saveEnv();
  let probe = null;
  try {
    probe = await bootProbe({ pluginsEnv: "0" });
    const { status, endpoint } = await pluginsMode(probe.handle);
    assert.equal(status, "feature-off", "CREEZIO_PLUGINS=0 coupe les plugins");
    assert.equal(endpoint.mode, "feature-off");
  } finally {
    await probe?.close();
    restoreEnv(saved);
  }
});

test("PD4 legacy CREEZIO_PLUGINS=1 : no-op, toujours enabled", async () => {
  const saved = saveEnv();
  let probe = null;
  try {
    probe = await bootProbe({ pluginsEnv: "1" });
    const { status } = await pluginsMode(probe.handle);
    assert.equal(status, "enabled", "opt-in historique accepté (no-op)");
  } finally {
    await probe?.close();
    restoreEnv(saved);
  }
});

test("PD5 seed <appRoot>/plugins : install au boot, idempotent", async () => {
  const saved = saveEnv();
  let probe = null;
  try {
    probe = await bootProbe({
      pluginsEnv: undefined,
      beforeBoot: (tmp) => {
        // Plugin livré par la marque dans son repo (source de seed).
        const src = path.join(tmp, "plugins", "brandseed");
        fs.mkdirSync(src, { recursive: true });
        fs.writeFileSync(
          path.join(src, "manifest.json"),
          JSON.stringify({
            id: "brandseed",
            name: "Brand Seed",
            version: "1.0.0",
            main: "index.js",
            permissions: ["net:loopback"],
          }),
        );
        fs.writeFileSync(
          path.join(src, "index.js"),
          `const http=require("node:http");
const s=http.createServer((req,res)=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({ok:true}))});
s.listen(Number(process.env.PORT||0),"127.0.0.1",()=>console.log(JSON.stringify({event:"ready",port:s.address().port})));`,
        );
      },
    });
    const { endpoint } = await pluginsMode(probe.handle);
    const seeded = (endpoint.plugins || []).find(
      (p) => p.manifest?.id === "brandseed",
    );
    assert.ok(seeded, `plugin marque installé au boot: ${JSON.stringify(endpoint)}`);
    assert.equal(seeded.enabled, true, "activé à la première install");
    // Copié dans le répertoire runtime (pas exécuté depuis la source).
    assert.ok(
      String(seeded.dir).includes(path.join("data", "plugins")),
      `installé sous data/plugins: ${seeded.dir}`,
    );
    // Idempotent : la source n'écrase pas une install existante.
    fs.writeFileSync(path.join(seeded.dir, "marker.txt"), "keep\n");
    const { seedPluginsFromDirs } = await import(
      "../packages/app-runtime/dist/index.js"
    );
    const second = seedPluginsFromDirs({
      seedDirs: [path.join(probe.tmp, "plugins")],
      pluginsRoot: path.dirname(seeded.dir),
    });
    assert.deepEqual(second.seeded, [], "pas de ré-install");
    assert.deepEqual(second.skipped, ["brandseed"]);
    assert.ok(fs.existsSync(path.join(seeded.dir, "marker.txt")));
  } finally {
    await probe?.close();
    restoreEnv(saved);
  }
});
