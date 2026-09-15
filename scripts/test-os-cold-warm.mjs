#!/usr/bin/env node
/**
 * Cold-start OS : userData vide + warm n8n réel + /os/ready.
 * Hermes skip par défaut (install lourde) — CREEZIO_COLD_WARM_HERMES=1 pour inclure.
 * Probe brand = CREEZIO_TEMPOFLOW3_ROOT / sibling tempoflow3 (pas apps/ dans le kit).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startBrandKernelHarness } from "../packages/app-runtime/dist/index.js";
import { resolveProbeBrandServerDir } from "./lib/resolve-probe-brand.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TF3 = resolveProbeBrandServerDir(ROOT);

/* Hygiène /tmp : chaque run crée un userData de plusieurs Go sous
 * os.tmpdir()/os-cold-warm-*. On balaye au démarrage les restes de plus
 * d'une heure (runs tués), et on purge NOTRE dossier à la sortie. */
const TMP_PREFIX = "os-cold-warm-";

function sweepStaleTmpDirs() {
  const tmp = os.tmpdir();
  const cutoff = Date.now() - 3600_000;
  let entries = [];
  try {
    entries = fs.readdirSync(tmp);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith(TMP_PREFIX)) continue;
    const full = path.join(tmp, name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.rmSync(full, { recursive: true, force: true });
        console.log(`[tmp] reste précédent purgé: ${full}`);
      }
    } catch {
      /* best-effort */
    }
  }
}

let currentDataDir = null;

function cleanupCurrentDataDir() {
  if (!currentDataDir) return;
  try {
    fs.rmSync(currentDataDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  currentDataDir = null;
}

sweepStaleTmpDirs();
process.on("exit", cleanupCurrentDataDir);
process.on("SIGTERM", () => {
  cleanupCurrentDataDir();
  process.exit(143);
});
process.on("SIGINT", () => {
  cleanupCurrentDataDir();
  process.exit(130);
});

/** Poll healthz n8n avec budget court — null si pas joignable dans le budget. */
async function pollN8nHealthz(budgetMs = 30_000) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const res = await fetch("http://127.0.0.1:15678/healthz").catch(() => null);
    if (res && res.status >= 200 && res.status < 500) return res;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return null;
}

test("cold-warm n8n + os/ready sur probe brand (userData neuf)", async () => {
  if (!TF3 || !fs.existsSync(path.join(TF3, "src/electron/brand-migrations.ts"))) {
    console.log(
      "skip: probe brand absent (CREEZIO_TEMPOFLOW3_ROOT / ../tempoflow3)",
    );
    return;
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

  try {
    const lsof = spawnSync("lsof", ["-tiTCP:15678", "-sTCP:LISTEN"], {
      encoding: "utf8",
    });
    for (const pid of String(lsof.stdout || "")
      .split(/\s+/)
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* */
      }
    }
  } catch {
    /* */
  }
  try {
    spawnSync("fuser", ["-k", "15678/tcp"], { encoding: "utf8" });
  } catch {
    /* */
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
  currentDataDir = dataDir;
  const prevWarm = process.env.CREEZIO_NATIVE_WARM;
  const prevHermes = process.env.CREEZIO_NATIVE_WARM_HERMES;
  const prevStart = process.env.CREEZIO_NATIVE_START;
  process.env.CREEZIO_NATIVE_WARM = "1";
  process.env.CREEZIO_NATIVE_START = "1";
  process.env.CREEZIO_NATIVE_WARM_HERMES =
    process.env.CREEZIO_COLD_WARM_HERMES === "1" ? "1" : "0";
  process.env.CREEZIO_TUNNEL_LOCAL = "1";

  let handle;
  try {
    handle = await startBrandKernelHarness({
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

    const ready = await fetch(`${handle.baseUrl}/api/v1/os/ready`);
    const readyBody = await ready.json();
    assert.equal(ready.status, 200, JSON.stringify(readyBody));
    assert.equal(readyBody.ready, true, JSON.stringify(readyBody));
    assert.equal(readyBody.checks.kitN8nVendor, true);
    assert.equal(readyBody.checks.tunnelMcpSurface, true);

    const n8n = await fetch(`${handle.baseUrl}/api/v1/os/n8n/status`);
    const n8nBody = await n8n.json();
    assert.equal(n8n.status, 200);
    assert.ok(
      n8nBody.nativeReady || n8nBody.entry,
      `n8n entry attendu: ${JSON.stringify(n8nBody)}`,
    );
    assert.ok(
      readyBody.soft?.n8nEntry === true || n8nBody.entry,
      "n8n soft entry",
    );
    if (n8nBody.running === true || n8nBody.uiUrl) {
      // n8n déjà annoncé démarré par le status OS — pas besoin de healthz.
    } else {
      // Budget court : 30 s de poll healthz au lieu de laisser le timeout
      // global (600 s) absorber un n8n qui ne démarrera pas (réseau filtré).
      const health = await pollN8nHealthz(30_000);
      if (!health) {
        console.log(
          "skip: n8n healthz pas joignable en 30s (bootstrap embeds réseau requis) — " +
            `entry=${JSON.stringify(n8nBody.entry ?? null)}`,
        );
      }
    }
  } finally {
    await handle?.close();
    cleanupCurrentDataDir();
    if (prevWarm === undefined) delete process.env.CREEZIO_NATIVE_WARM;
    else process.env.CREEZIO_NATIVE_WARM = prevWarm;
    if (prevHermes === undefined) delete process.env.CREEZIO_NATIVE_WARM_HERMES;
    else process.env.CREEZIO_NATIVE_WARM_HERMES = prevHermes;
    if (prevStart === undefined) delete process.env.CREEZIO_NATIVE_START;
    else process.env.CREEZIO_NATIVE_START = prevStart;
  }
}, { timeout: 600_000 });
