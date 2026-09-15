#!/usr/bin/env node
/**
 * Contrats shell OS kit (splash / tray / embeds / updater / vendors).
 * Suite test:shell côté kit — les marques consomment ces APIs, ne les réécrivent pas.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createLocalSplashSteps,
  createSplashModel,
  splashHtmlDocument,
  TrayController,
  checkForUpdatesNow,
  getUpdaterStatus,
  setupAutoUpdater,
} from "../packages/electron-shell/dist/index.js";
import {
  applyOsSandboxEnv,
  kitBinaryPaths,
  ensureKitOsBinaries,
} from "../packages/host-runtime/dist/index.js";
import { kitOsVendorDir } from "../packages/platform-core/dist/index.js";
import {
  composeBrandOs,
  resolveNativeWarmFlags,
  warmBrandNativeHosts,
} from "../packages/app-runtime/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("shell.splash — steps + HTML non vides", () => {
  const steps = createLocalSplashSteps({
    needIndex: true,
    needNode: true,
    needHermes: true,
    needN8n: true,
    needTunnel: true,
    catalogLabel: "PnpShell data",
  });
  assert.ok(Array.isArray(steps) && steps.length >= 3);
  const model = createSplashModel(steps, "Démarrage PnpShell…");
  assert.ok(typeof model.overallPercent === "number");
  const html = splashHtmlDocument({
    productName: "PnpShell",
    bridgeName: "pnpShellDesktop",
  });
  assert.match(html, /PnpShell/);
  assert.match(html, /<!doctype html>/i);
});

test("shell.tray — TrayController constructible", () => {
  const tray = new TrayController({
    productName: "PnpShell",
    showWindow: () => undefined,
    quit: () => undefined,
  });
  assert.ok(tray);
  assert.equal(typeof tray.destroy, "function");
  assert.equal(tray.active, false);
});

test("shell.embed-sandbox — applyOsSandboxEnv", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "os-shell-sandbox-"));
  const env = applyOsSandboxEnv({
    env: { ...process.env },
    profileHome: path.join(tmp, "profile"),
    userData: tmp,
  });
  assert.ok(env.HOME);
  assert.ok(fs.existsSync(path.join(tmp, "profile")));
});

test("shell.updater — API surface", () => {
  assert.equal(typeof setupAutoUpdater, "function");
  assert.equal(typeof checkForUpdatesNow, "function");
  assert.equal(typeof getUpdaterStatus, "function");
  const status = getUpdaterStatus();
  assert.ok(status && typeof status === "object");
});

test("shell.vendors+bin — kit P&P", async () => {
  assert.ok(
    fs.existsSync(path.join(kitOsVendorDir("n8n"), "runtime-manifest.json")),
  );
  assert.ok(
    fs.existsSync(
      path.join(kitOsVendorDir("hermes-agent"), "runtime-manifest.json"),
    ),
  );
  const bins = await ensureKitOsBinaries();
  assert.ok(bins.meili);
  const paths = kitBinaryPaths();
  assert.ok(paths.meili);
});

test("shell.warm API exportée", () => {
  assert.equal(typeof warmBrandNativeHosts, "function");
  assert.equal(typeof resolveNativeWarmFlags, "function");
  assert.equal(typeof composeBrandOs, "function");
});

test("shell.demobrand main = startBrandDesktop", () => {
  const main = fs.readFileSync(
    path.join(ROOT, "apps/demobrand/src/electron/main.ts"),
    "utf8",
  );
  assert.match(main, /startBrandDesktop/);
  assert.match(main, /bootKernel/);
  assert.doesNotMatch(main, /prepareDesktopBoot/);
});
