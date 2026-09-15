#!/usr/bin/env node
/**
 * Phase R3 — smoke kit `@creezio/electron-shell` (logger / splash / tray / updater exports).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const shellCjs = path.join(
  root,
  "packages/electron-shell/dist-cjs/index.js",
);
const hostCjs = path.join(root, "packages/host-runtime/dist-cjs/index.js");
const searchCjs = path.join(root, "packages/search/dist-cjs/index.js");

function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}:`, e.message || e);
    process.exitCode = 1;
  }
}

check("dist-cjs electron-shell + host-runtime + search présents", () => {
  assert.ok(fs.existsSync(shellCjs), shellCjs);
  assert.ok(fs.existsSync(hostCjs), hostCjs);
  assert.ok(fs.existsSync(searchCjs), searchCjs);
});

const shell = require(shellCjs);
const host = require(hostCjs);
const search = require(searchCjs);

check("logger API (scoped / recentLines / logFileTail / early)", () => {
  assert.equal(typeof host.initLogger, "function");
  assert.equal(typeof host.initEarlyBootLogger, "function");
  assert.equal(typeof host.ensureLogsDir, "function");
  assert.equal(typeof host.scoped, "function");
  assert.equal(typeof host.recentLines, "function");
  assert.equal(typeof host.logFileTail, "function");
  assert.equal(typeof host.setOpsLineHandler, "function");
});

check("splash riche + cssPrefix", () => {
  const html = shell.splashHtmlDocument({
    productName: "TempoFlow",
    bridgeName: "tempoflowDesktop",
    windowChrome: true,
    cssPrefix: "tf",
  });
  assert.ok(html.includes("__setBoot"));
  assert.ok(html.includes("tf-titlebar"));
  assert.ok(html.includes("tfBtnMin"));
  assert.ok(html.includes("tf-upd"));
  assert.ok(html.includes('data-tf-chrome-force="1"'));
  assert.ok(html.includes("pre-wrap"));
});

check("createLocalSplashSteps includeRuntime", () => {
  const steps = shell.createLocalSplashSteps({
    needIndex: false,
    needNode: false,
    needHermes: false,
    needN8n: false,
    needTunnel: false,
    includeRuntime: true,
    catalogLabel: "Catalogue fournisseurs",
  });
  assert.ok(steps.some((s) => s.id === "runtime"));
  assert.ok(steps.find((s) => s.id === "catalog").label.includes("Catalogue"));
});

check("updater / tray / host façades exportées", () => {
  assert.equal(typeof shell.setupAutoUpdater, "function");
  assert.equal(typeof shell.TrayController, "function");
  assert.equal(typeof shell.createHostRuntime, "function");
  assert.equal(typeof host.createHostStack, "function");
  assert.equal(typeof search.startMeili, "function");
  assert.equal(typeof host.createHermesHost, "function");
  assert.equal(typeof host.createN8nHost, "function");
});

check("PHASE-R3.md présent", () => {
  assert.ok(fs.existsSync(path.join(root, "docs/archive/PHASE-R3.md")));
});

if (process.exitCode) {
  console.error("\nÉchecs test-phase-r3");
  process.exit(1);
}
console.log("\nOK test-phase-r3");
