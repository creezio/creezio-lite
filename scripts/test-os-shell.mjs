#!/usr/bin/env node
/**
 * Agrégat test:shell kit — contrats + surfaces BYOK/recovery/updater/tunnel.
 * Équivalent partiel de la suite TF2 0.10.26 côté kit (pas marque).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createLocalSplashSteps,
  createSplashModel,
  splashHtmlDocument,
  reduceUpdateEvent,
  getUpdaterStatus,
} from "../packages/electron-shell/dist/index.js";
import { createLocalConfigStoreSync } from "../packages/host-runtime/dist/index.js";
import {
  generateRecoveryKey,
  kitOsVendorDir,
} from "../packages/platform-core/dist/index.js";
import { demobrandManifest } from "../packages/brand-config/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("shell.aggregate contracts suite", () => {
  const r = spawnSync(
    process.execPath,
    ["--test", path.join(ROOT, "scripts/test-os-shell-contracts.mjs")],
    { encoding: "utf8", cwd: ROOT },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("shell.app-kind", () => {
  const r = spawnSync(
    process.execPath,
    ["--test", path.join(ROOT, "scripts/test-os-app-kind.mjs")],
    { encoding: "utf8", cwd: ROOT },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("shell.byok+recovery local-config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "os-shell-cfg-"));
  const store = createLocalConfigStoreSync({
    configPath: path.join(dir, "local-config.json"),
    manifest: demobrandManifest,
    encryption: "plain",
  });
  const secret = store.ensureAuthSecret();
  assert.ok(secret && secret.length >= 16);
  store.setLlmKey("openai", "sk-test-byok-shell");
  const keys = store.getLlmKeys();
  assert.equal(keys.openai, "sk-test-byok-shell");

  const recoveryKey = generateRecoveryKey();
  store.applyFirstRunSetup({
    username: "shelladmin",
    password: "secret1",
    openaiKey: "sk-test-byok-shell",
    recoveryKey,
  });
  assert.equal(store.isSetupComplete(), true);
  assert.equal(store.hasRecoveryKeyConfigured(), true);
});

test("shell.updater reduce events", () => {
  const status = getUpdaterStatus();
  assert.ok(status);
  const next = reduceUpdateEvent(status, { type: "checking" });
  assert.ok(next);
  assert.equal(next.state, "checking");
});

test("shell.splash model percent", () => {
  const steps = createLocalSplashSteps({
    needIndex: false,
    needNode: true,
    needHermes: true,
    needN8n: true,
    needTunnel: true,
  });
  const model = createSplashModel(steps);
  assert.ok(model.steps.length >= 5);
  const html = splashHtmlDocument({
    productName: "ShellKit",
    bridgeName: "shellKitDesktop",
  });
  assert.match(html, /ShellKit/);
});

test("shell.vendors hermes+n8n manifests", () => {
  assert.ok(
    fs.existsSync(path.join(kitOsVendorDir("n8n"), "runtime-manifest.json")),
  );
  assert.ok(
    fs.existsSync(
      path.join(kitOsVendorDir("hermes-agent"), "runtime-manifest.json"),
    ),
  );
});

test("shell.installBrandOsDesktop exporté", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/src/install-brand-os-desktop.ts"),
    "utf8",
  );
  assert.match(src, /installBrandDesktopRuntime/);
  assert.match(src, /createLocalSplashSteps/);
});

test("shell.more platform-core helpers", () => {
  const r = spawnSync(
    process.execPath,
    ["--test", path.join(ROOT, "scripts/test-os-shell-more.mjs")],
    { encoding: "utf8", cwd: ROOT },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
