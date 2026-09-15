#!/usr/bin/env node
/**
 * MCP OAuth + admin — prouvable en local (sans Cloudflare).
 * Harness si probe brand résolu hors monorepo kit.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startBrandKernelHarness } from "../packages/app-runtime/dist/index.js";
import { resolveProbeBrandServerDir } from "./lib/resolve-probe-brand.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TF3 = resolveProbeBrandServerDir(ROOT);

test("mcp oauth session bridge n'est plus un stub local-auth", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/src/mount-brand-mcp-surface.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    src,
    /getSessionFromContext:\s*async\s*\(\)\s*=>\s*null/,
  );
  assert.match(src, /authenticateViaKit/);
  assert.match(src, /verifySessionToken/);
  assert.match(src, /authorization/);
});

test("oauth authorize réutilise cookie/Bearer et accepte le login kit", async () => {
  process.env.AUTH_SECRET = "mcp-oauth-session-gate-secret";
  process.env.AUTH_ALLOW_DEV_SECRET = "1";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-oauth-session-"));
  const dbPath = path.join(tmp, "core.db");
  const { openNodeSqliteDatabase, configureAuth, createSessionToken } =
    await import(
      pathToFileURL(path.join(ROOT, "packages/auth/dist/index.js")).href
    );
  const {
    configureMcpOAuth,
    createMcpOAuthRoutes,
    resetMcpOAuthAdaptersForTests,
  } = await import(
    pathToFileURL(path.join(ROOT, "packages/mcp-facade/dist/index.js")).href
  );

  configureAuth({
    cookieName: "gate_mcp_session",
    ownerPermissions: ["nav.dashboard"],
  });

  const db = openNodeSqliteDatabase(dbPath);
  db.exec(`
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret_hash TEXT,
  client_name TEXT,
  redirect_uris TEXT NOT NULL,
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'client_secret_post',
  grant_types TEXT NOT NULL DEFAULT 'authorization_code,refresh_token',
  scope TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  enabled INTEGER NOT NULL DEFAULT 1,
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT,
  expires_at INTEGER NOT NULL,
  rotated_at INTEGER,
  revoked_at INTEGER,
  user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

  const publicUrl = "http://127.0.0.1:18999";
  configureMcpOAuth({
    getWriteDb: () => db,
    tableExists: (n) =>
      Boolean(
        db
          .prepare(
            `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`,
          )
          .get(n),
      ),
    getJwtSecret: () => "mcp-oauth-session-jwt",
    resolvePublicUrl: () => publicUrl,
  });

  const users = new Map([["owner-marseille", "TfDemo-Mars-Owner-5c7cf8f1"]]);
  const app = createMcpOAuthRoutes({
    productName: "TempoFlow",
    session: {
      getSessionFromContext: async (c) => {
        let token = "";
        const cookie = c.req.header("cookie") || "";
        const m = cookie.match(/(?:^|;\s*)gate_mcp_session=([^;]+)/);
        if (m) token = decodeURIComponent(m[1]);
        if (!token) {
          const authz = c.req.header("authorization") || "";
          if (authz.toLowerCase().startsWith("bearer ")) {
            token = authz.slice(7).trim();
          }
        }
        if (!token) return null;
        const { verifySessionToken } = await import(
          pathToFileURL(path.join(ROOT, "packages/auth/dist/index.js")).href
        );
        const session = await verifySessionToken(token);
        if (!session) return null;
        return { email: session.email, sub: session.sub };
      },
      authenticateUser: async (username, password) => {
        await Promise.resolve();
        const expected = users.get(username.trim().toLowerCase());
        if (!expected || expected !== password) return null;
        return { id: "owner-1", username: username.trim() };
      },
      getOwnerId: () => "owner-1",
    },
  });

  const redirectUri = `${publicUrl}/oauth/callback`;
  const reg = await app.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "ChatGPT",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
    }),
  });
  const regBody = await reg.json();
  assert.equal(reg.status, 201, JSON.stringify(regBody));

  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const qs = new URLSearchParams({
    client_id: regBody.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    state: "st",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const authorizePath = `/oauth/authorize?${qs}`;

  const anon = await app.request(authorizePath);
  const anonHtml = await anon.text();
  assert.equal(anon.status, 200);
  assert.match(anonHtml, /Identifiant CRM/);
  assert.doesNotMatch(anonHtml, /data-auth="session"/);

  const jwt = await createSessionToken({
    user: {
      id: "owner-1",
      username: "owner-marseille",
      role: "owner",
      permissions: ["nav.dashboard"],
    },
  });

  const withCookie = await app.request(authorizePath, {
    headers: { cookie: `gate_mcp_session=${jwt}` },
  });
  const cookieHtml = await withCookie.text();
  assert.equal(withCookie.status, 200, cookieHtml.slice(0, 300));
  assert.match(cookieHtml, /data-auth="session"/);
  assert.match(cookieHtml, /owner-marseille/);
  assert.doesNotMatch(cookieHtml, /Identifiant CRM/);

  const withBearer = await app.request(authorizePath, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  const bearerHtml = await withBearer.text();
  assert.match(bearerHtml, /data-auth="session"/);

  const approve = await app.request("/oauth/authorize", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `gate_mcp_session=${jwt}`,
    },
    body: new URLSearchParams({
      ...Object.fromEntries(qs),
      decision: "approve",
    }),
  });
  assert.equal(approve.status, 302, await approve.text());
  assert.match(approve.headers.get("location") || "", /[?&]code=/);

  const bad = await app.request("/oauth/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...Object.fromEntries(qs),
      decision: "approve",
      email: "owner-marseille",
      password: "wrong",
    }),
  });
  assert.match(await bad.text(), /Identifiants invalides/);

  const good = await app.request("/oauth/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...Object.fromEntries(qs),
      decision: "approve",
      email: "owner-marseille",
      password: "TfDemo-Mars-Owner-5c7cf8f1",
    }),
  });
  assert.equal(good.status, 302, await good.text());
  assert.match(good.headers.get("location") || "", /[?&]code=/);

  resetMcpOAuthAdaptersForTests();
  db.close?.();
});

test("mcp oauth well-known + DCR + admin status", async () => {
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "os-mcp-oauth-"));
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
    const status = await (
      await fetch(`${handle.baseUrl}/api/v1/os/mcp-oauth/status`)
    ).json();
    assert.equal(status.ok, true, JSON.stringify(status));
    assert.equal(status.oauthReady, true, JSON.stringify(status));
    assert.ok(status.publicUrl);

    const wellKnown = await fetch(
      `${handle.baseUrl}/.well-known/oauth-authorization-server`,
    );
    const meta = await wellKnown.json();
    assert.equal(wellKnown.status, 200, JSON.stringify(meta));
    assert.ok(meta.authorization_endpoint || meta.issuer, JSON.stringify(meta));

    const reg = await fetch(`${handle.baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "proof-local",
        redirect_uris: [`${handle.baseUrl}/oauth/callback`],
        token_endpoint_auth_method: "none",
      }),
    });
    const regBody = await reg.json();
    assert.ok(
      reg.status === 201 || reg.status === 200,
      JSON.stringify(regBody),
    );
    assert.ok(
      regBody.client_id || regBody.client?.client_id,
      JSON.stringify(regBody),
    );

    const admin = await fetch(`${handle.baseUrl}/api/v1/admin/mcp/status`);
    const adminBody = await admin.json();
    assert.equal(
      admin.status,
      401,
      JSON.stringify(adminBody),
    );
    assert.equal(adminBody.error, "unauthorized");

    const clientId = String(regBody.client_id || regBody.client?.client_id);
    const redirectUri = `${handle.baseUrl}/oauth/callback`;
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
    const authorizeQs = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state: "st-mcp",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const authorizeUrl = `${handle.baseUrl}/oauth/authorize?${authorizeQs}`;

    const anonPage = await fetch(authorizeUrl);
    const anonHtml = await anonPage.text();
    assert.equal(anonPage.status, 200, anonHtml.slice(0, 400));
    assert.match(anonHtml, /Identifiant CRM/);
    assert.doesNotMatch(anonHtml, /data-auth="session"/);

    process.env.CREEZIO_CORE_DB_PATH = handle.runtime.paths.core;
    const { migrateBrandCredentialsToKit } = await import(
      pathToFileURL(path.join(ROOT, "packages/auth/dist/index.js")).href
    );
    const seeded = await migrateBrandCredentialsToKit({
      username: "owner-mcp",
      password: "Mcp-OAuth-Test-9f3a",
      displayName: "Owner MCP",
    });
    assert.equal(seeded.ok, true, JSON.stringify(seeded));

    const login = await fetch(`${handle.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "owner-mcp",
        password: "Mcp-OAuth-Test-9f3a",
      }),
    });
    const loginBody = await login.json().catch(() => ({}));
    assert.equal(login.status, 200, JSON.stringify(loginBody));
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    assert.ok(cookie.includes("="), "cookie session CRM");

    const sessionPage = await fetch(authorizeUrl, {
      headers: { cookie },
    });
    const sessionHtml = await sessionPage.text();
    assert.equal(sessionPage.status, 200, sessionHtml.slice(0, 400));
    assert.match(sessionHtml, /data-auth="session"/);
    assert.match(sessionHtml, /owner-mcp/i);
    assert.doesNotMatch(sessionHtml, /Identifiant CRM/);

    const approveSession = await fetch(`${handle.baseUrl}/oauth/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie,
      },
      body: new URLSearchParams({
        ...Object.fromEntries(authorizeQs),
        decision: "approve",
      }),
    });
    assert.equal(approveSession.status, 302, await approveSession.text());
    const sessionLoc = approveSession.headers.get("location") || "";
    assert.match(sessionLoc, /[?&]code=/);

    const badCreds = await fetch(`${handle.baseUrl}/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...Object.fromEntries(authorizeQs),
        decision: "approve",
        email: "owner-mcp",
        password: "wrong-password",
      }),
    });
    const badHtml = await badCreds.text();
    assert.match(badHtml, /Identifiants invalides/);

    const goodCreds = await fetch(`${handle.baseUrl}/oauth/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...Object.fromEntries(authorizeQs),
        decision: "approve",
        email: "owner-mcp",
        password: "Mcp-OAuth-Test-9f3a",
      }),
    });
    assert.equal(goodCreds.status, 302, await goodCreds.text());
    assert.match(goodCreds.headers.get("location") || "", /[?&]code=/);
  } finally {
    await handle.close();
  }
});
