#!/usr/bin/env node
/**
 * Gate sécurité AUTH_SECRET serveur (fix trou : serveurs Docker headless
 * signaient les sessions avec le fallback dev public).
 *
 * - AS1 : un boot serveur (composeBrandOs — chemin commun harness Docker et
 *         desktop) exporte un AUTH_SECRET fort dans process.env et le
 *         persiste dans `{dataDir}/{brand}-config.json`.
 * - AS2 : restart même dataDir → même secret (les sessions survivent) ;
 *         deuxième serveur (autre dataDir) → secret DIFFÉRENT.
 * - AS3 : en production, signature et vérification refusent le fallback dev
 *         (JWT forgé avec `dev-insecure-secret-change-me` rejeté).
 * - AS4 : le harness compose l'OS (donc le secret) AVANT
 *         mountBrandPlatformSurface (routes auth/tasks/assistant).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import { createAppManifest } from "../packages/brand-config/dist/index.js";
import { composeBrandOs } from "../packages/app-runtime/dist/index.js";
import {
  DEV_AUTH_SECRET_FALLBACK,
  configureAuth,
  createSessionToken,
  getAuthConfig,
  verifySessionToken,
} from "../packages/auth/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const manifest = createAppManifest({
  brandId: "authsecretprobe",
  productName: "Auth Secret Probe",
  domain: "authsecretprobe.local",
  sandbox: true,
});

/** Boot composeBrandOs sandbox et retourne le AUTH_SECRET exporté. */
function bootServer(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const electronDir = path.join(dataDir, "electron");
  fs.mkdirSync(electronDir, { recursive: true });
  const handle = composeBrandOs({
    manifest,
    userDataDir: dataDir,
    isPackaged: false,
    resourcesRoot: path.join(ROOT, "packages/host-runtime/resources"),
    electronDirname: electronDir,
  });
  const secret = process.env.AUTH_SECRET || "";
  handle.close();
  return secret;
}

function findConfigFile(dataDir) {
  const hits = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith("-config.json"));
  assert.equal(hits.length, 1, `config locale attendue dans ${dataDir}`);
  return path.join(dataDir, hits[0]);
}

const saveEnv = () => ({
  AUTH_SECRET: process.env.AUTH_SECRET,
  MCP_JWT_SECRET: process.env.MCP_JWT_SECRET,
  NODE_ENV: process.env.NODE_ENV,
  AUTH_ALLOW_DEV_SECRET: process.env.AUTH_ALLOW_DEV_SECRET,
});
const restoreEnv = (saved) => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};

test("AS1 boot serveur → AUTH_SECRET fort exporté et persisté", () => {
  const saved = saveEnv();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-secret-a-"));
  try {
    delete process.env.AUTH_SECRET;
    delete process.env.MCP_JWT_SECRET;
    const secret = bootServer(dataDir);
    assert.ok(secret, "AUTH_SECRET doit être exporté au boot");
    assert.notEqual(secret, DEV_AUTH_SECRET_FALLBACK);
    assert.ok(secret.length >= 32, "secret trop court");
    assert.ok(
      process.env.MCP_JWT_SECRET &&
        process.env.MCP_JWT_SECRET !== DEV_AUTH_SECRET_FALLBACK,
      "MCP_JWT_SECRET exporté aussi",
    );
    const cfg = JSON.parse(fs.readFileSync(findConfigFile(dataDir), "utf8"));
    assert.ok(cfg.authSecret, "authSecret persisté dans la config locale");
    assert.ok(
      JSON.stringify(cfg.authSecret).includes(secret),
      "le secret exporté est celui persisté",
    );
    globalThis.__AS_DIR_A = dataDir;
    globalThis.__AS_SECRET_A = secret;
  } finally {
    restoreEnv(saved);
  }
});

test("AS2 restart → même secret ; second serveur → secret différent", () => {
  const saved = saveEnv();
  const dirA = globalThis.__AS_DIR_A;
  const secretA = globalThis.__AS_SECRET_A;
  assert.ok(dirA && secretA, "AS1 doit précéder AS2");
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "auth-secret-b-"));
  try {
    // Restart (même dataDir) : le secret persistant est réutilisé.
    delete process.env.AUTH_SECRET;
    const secretARestart = bootServer(dirA);
    assert.equal(
      secretARestart,
      secretA,
      "restart : le secret doit survivre (sessions conservées)",
    );
    // Deuxième serveur (autre dataDir) : secret propre, jamais partagé.
    delete process.env.AUTH_SECRET;
    const secretB = bootServer(dirB);
    assert.ok(secretB && secretB !== DEV_AUTH_SECRET_FALLBACK);
    assert.notEqual(
      secretB,
      secretA,
      "deux serveurs ne doivent JAMAIS partager un secret",
    );
    // Un env AUTH_SECRET explicite (non-fallback) reste prioritaire.
    process.env.AUTH_SECRET = "operator-injected-secret-0123456789abcdef";
    bootServer(fs.mkdtempSync(path.join(os.tmpdir(), "auth-secret-c-")));
    assert.equal(
      process.env.AUTH_SECRET,
      "operator-injected-secret-0123456789abcdef",
      "un secret injecté par l'opérateur n'est pas écrasé",
    );
  } finally {
    restoreEnv(saved);
  }
});

test("AS3 production : fallback dev refusé (signature + JWT forgé)", async () => {
  const saved = saveEnv();
  try {
    if (!getAuthConfig().cookieName) {
      configureAuth({ cookieName: "authsecretprobe_session" });
    }
    process.env.NODE_ENV = "production";
    delete process.env.AUTH_SECRET;
    delete process.env.AUTH_ALLOW_DEV_SECRET;

    const user = {
      id: "u1",
      username: "owner@probe",
      role: "owner",
      permissions: [],
    };
    // Sans secret : refus de signer.
    await assert.rejects(
      () => createSessionToken({ user }),
      /AUTH_SECRET/,
      "production sans AUTH_SECRET : signature refusée",
    );
    // JWT forgé avec le fallback public : rejeté.
    const forged = await new SignJWT({
      sub: "u1",
      email: "owner@probe",
      role: "owner",
      permissions: [],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(new TextEncoder().encode(DEV_AUTH_SECRET_FALLBACK));
    assert.equal(await verifySessionToken(forged), null);
    // AUTH_SECRET posé au fallback littéral : traité comme absent.
    process.env.AUTH_SECRET = DEV_AUTH_SECRET_FALLBACK;
    assert.equal(await verifySessionToken(forged), null);
    await assert.rejects(() => createSessionToken({ user }));
    // Secret sain : round-trip OK, le forgé fallback reste rejeté.
    process.env.AUTH_SECRET = "strong-gate-secret-0123456789abcdef";
    const token = await createSessionToken({ user });
    const session = await verifySessionToken(token);
    assert.equal(session?.sub, "u1");
    assert.equal(await verifySessionToken(forged), null);
  } finally {
    restoreEnv(saved);
  }
});

test("AS4 harness : secret garanti AVANT mountBrandPlatformSurface", () => {
  const harness = fs.readFileSync(
    path.join(
      ROOT,
      "packages/app-runtime/src/start-brand-kernel-harness.ts",
    ),
    "utf8",
  );
  const composeAt = harness.indexOf("composeBrandOs({");
  const mountAt = harness.indexOf("mountBrandPlatformSurface({");
  assert.ok(composeAt > 0 && mountAt > 0);
  assert.ok(
    composeAt < mountAt,
    "composeBrandOs (ensureAuthSecret) doit précéder mountBrandPlatformSurface",
  );
  const compose = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/src/compose-brand-os.ts"),
    "utf8",
  );
  assert.match(
    compose,
    /process\.env\.AUTH_SECRET = store\.ensureAuthSecret\(\)/,
  );
  const session = fs.readFileSync(
    path.join(ROOT, "packages/auth/src/session.ts"),
    "utf8",
  );
  assert.match(session, /DEV_AUTH_SECRET_FALLBACK/);
  assert.doesNotMatch(
    session,
    /process\.env\.AUTH_SECRET \|\| "dev-insecure-secret-change-me"/,
  );
});
