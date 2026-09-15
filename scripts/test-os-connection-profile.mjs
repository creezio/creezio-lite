#!/usr/bin/env node
/**
 * Connection profile Héberger / Rejoindre via HTTP OS.
 * Harness optionnel si probe brand (tempoflow3) résolu hors monorepo.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  defaultLocalProfile,
  defaultProfileForAppKind,
  sanitizeConnectionProfile,
  resolveBootProfile,
  unwrapBootProfileResult,
} from "../packages/platform-core/dist/index.js";
import { startBrandKernelHarness } from "../packages/app-runtime/dist/index.js";
import { resolveProbeBrandServerDir } from "./lib/resolve-probe-brand.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TF3 = resolveProbeBrandServerDir(ROOT);

test("connection-profile pure sanitize + resolveBoot", () => {
  const local = defaultLocalProfile();
  assert.equal(local.mode, "local");
  const remote = sanitizeConnectionProfile({
    mode: "remote",
    remoteUrl: "example.com:9999",
    chosen: true,
  });
  assert.equal(remote.mode, "remote");
  assert.match(String(remote.remoteUrl), /^http/);
  const boot = resolveBootProfile(null);
  assert.equal(boot.showPicker, true);
});

test("unwrapBootProfileResult — stubs nu / undefined ne cassent jamais .mode", () => {
  // Ancien stub OS : profil nu (pas {profile,showPicker}) → mode défini.
  const bare = unwrapBootProfileResult({ mode: "local", chosen: true }, "client");
  assert.equal(bare.profile.mode, "local");
  assert.equal(bare.showPicker, true);

  // Destructuration historique `{ profile } = bare` → profile undefined.
  const brokenStub = unwrapBootProfileResult(undefined, "client");
  assert.equal(brokenStub.profile.mode, "remote");
  assert.ok(brokenStub.profile.mode);

  const serverDefault = unwrapBootProfileResult(null, "server");
  assert.equal(serverDefault.profile.mode, "local");

  const nestedEmpty = unwrapBootProfileResult(
    { profile: undefined, showPicker: true },
    "server",
  );
  assert.equal(nestedEmpty.profile.mode, "local");

  const canon = unwrapBootProfileResult(resolveBootProfile(null), "legacy");
  assert.equal(canon.profile.mode, "local");
  assert.equal(canon.showPicker, true);

  assert.equal(defaultProfileForAppKind("client").mode, "remote");
  assert.equal(defaultProfileForAppKind("server").mode, "local");
});

test("connection + setup HTTP sur harness probe brand", async () => {
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
        CREEZIO_NATIVE_WARM: "0",
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

  process.env.CREEZIO_NATIVE_WARM = "0";
  process.env.CREEZIO_ALLOW_NO_MEILI = "1";
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "os-conn-"));
  const handle = await startBrandKernelHarness({
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

  try {
    const get0 = await (
      await fetch(`${handle.baseUrl}/api/v1/os/connection`)
    ).json();
    assert.equal(get0.ok, true);
    assert.equal(get0.profile.mode, "local");

    const setRemote = await fetch(`${handle.baseUrl}/api/v1/os/connection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "remote",
        remoteUrl: "http://127.0.0.1:9",
        chosen: true,
      }),
    });
    const setBody = await setRemote.json();
    assert.equal(setRemote.status, 200, JSON.stringify(setBody));
    assert.equal(setBody.profile.mode, "remote");

    const setup0 = await (
      await fetch(`${handle.baseUrl}/api/v1/os/setup`)
    ).json();
    assert.equal(setup0.ok, true);
    assert.equal(setup0.setupComplete, false);

    const setupPost = await fetch(`${handle.baseUrl}/api/v1/os/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "ops",
        password: "secret1",
        openaiKey: "sk-test-conn-profile",
      }),
    });
    const setupBody = await setupPost.json();
    assert.equal(setupPost.status, 200, JSON.stringify(setupBody));
    assert.equal(setupBody.setupComplete, true);
    assert.ok(setupBody.recoveryKey);

    const setup1 = await (
      await fetch(`${handle.baseUrl}/api/v1/os/setup`)
    ).json();
    assert.equal(setup1.setupComplete, true);
    assert.equal(setup1.username, "ops");
    assert.equal(setup1.hasOpenai, true);
    // applyStoredLlmEnv post-setup : l'assistant lit process.env, pas le store.
    assert.equal(process.env.OPENAI_API_KEY, "sk-test-conn-profile");
  } finally {
    await handle.close();
  }
});
