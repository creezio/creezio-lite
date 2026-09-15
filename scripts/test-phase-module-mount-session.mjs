#!/usr/bin/env node
/**
 * Gate — session HTTP sur `/api/v1/modules/*` (BACKLOG F3 / DASH-5)
 * et `/api/v1/admin/*` (foove2#78 — supervision sans session).
 *
 * Prouve la garde à la bordure `listenBrandOsHttp` :
 *  1. GET module anonyme → 401 ;
 *  2. GET module avec Bearer JWT session → 200 ;
 *  3. chemin allowlisté (landing/public) sans session → pas bloqué par la garde ;
 *  4. `api.handle` in-process reste libre (pollers / gates unitaires) ;
 *  5. clé API machine brand (Bearer opaque, table api_keys) → 200 en lecture,
 *     clé inconnue → 401 (auth machine Hermes/plugins/n8n) ;
 *  6. GET `/api/v1/admin/*` anonyme → 401 (avant proxy Hono) ; JWT → 200 ;
 *     clé machine métier ne déverrouille pas l'admin ; `/health` reste 200.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  configureAuth,
  createSessionToken,
  resetAuthConfigForTests,
} from "../packages/auth/dist/index.js";
import { createApiKernel } from "../packages/api-kernel/dist/index.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertModuleMountSession,
  CATALOG_INTERNAL_HEADER,
  CATALOG_INTERNAL_SECRET_ENV,
  catalogInternalHeaderAllows,
  createBrandApiKeyModuleVerifier,
  ensureCatalogInternalSecret,
  isAdminApiPath,
  isCatalogInternalBootPath,
  isPublicModulePath,
  listenBrandOsHttp,
} from "../packages/app-runtime/dist/index.js";

const KIT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const prevAuthDisabled = process.env.AUTH_DISABLED;
const prevAuthSecret = process.env.AUTH_SECRET;
const prevAllowDev = process.env.AUTH_ALLOW_DEV_SECRET;
const prevCatalogSecret = process.env[CATALOG_INTERNAL_SECRET_ENV];

function restoreEnv() {
  if (prevAuthDisabled === undefined) delete process.env.AUTH_DISABLED;
  else process.env.AUTH_DISABLED = prevAuthDisabled;
  if (prevAuthSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = prevAuthSecret;
  if (prevAllowDev === undefined) delete process.env.AUTH_ALLOW_DEV_SECRET;
  else process.env.AUTH_ALLOW_DEV_SECRET = prevAllowDev;
  if (prevCatalogSecret === undefined) {
    delete process.env[CATALOG_INTERNAL_SECRET_ENV];
  } else process.env[CATALOG_INTERNAL_SECRET_ENV] = prevCatalogSecret;
  resetAuthConfigForTests();
}

test("module-mount-session : listenBrandOsHttp garde admin avant proxy Hono", () => {
  const src = fs.readFileSync(
    path.join(KIT_ROOT, "packages/app-runtime/src/listen-brand-os-http.ts"),
    "utf8",
  );
  const adminIdx = src.indexOf("isAdminApiPath(pathname)");
  const proxyIdx = src.indexOf("opts.mcpSurfaceFetch");
  assert.ok(adminIdx > 0, "isAdminApiPath doit être appelé à la bordure");
  assert.ok(
    proxyIdx > adminIdx,
    "la garde admin doit précéder le proxy Hono MCP",
  );
});

test("module-mount-session : allowlist + décision pure", async () => {
  assert.equal(isAdminApiPath("/api/v1/admin/mcp/status"), true);
  assert.equal(isAdminApiPath("/api/v1/admin/database/dbs"), true);
  assert.equal(isAdminApiPath("/health"), false);
  assert.equal(isAdminApiPath("/login"), false);
  assert.equal(isAdminApiPath("/api/v1/os/setup"), false);
  assert.equal(isAdminApiPath("/api/v1/modules/widgets"), false);

  assert.equal(
    isPublicModulePath("GET", "/api/v1/modules/landing/public"),
    true,
  );
  assert.equal(
    isPublicModulePath("POST", "/api/v1/modules/fleet-registry/register"),
    true,
  );
  assert.equal(
    isPublicModulePath("GET", "/api/v1/modules/widgets"),
    false,
  );

  delete process.env.AUTH_DISABLED;
  const denied = await assertModuleMountSession({
    method: "GET",
    pathname: "/api/v1/modules/widgets",
    headers: {},
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 401);

  const adminDenied = await assertModuleMountSession({
    method: "GET",
    pathname: "/api/v1/admin/mcp/status",
    headers: {},
  });
  assert.equal(adminDenied.ok, false);
  if (!adminDenied.ok) assert.equal(adminDenied.status, 401);

  const healthPass = await assertModuleMountSession({
    method: "GET",
    pathname: "/health",
    headers: {},
  });
  assert.equal(healthPass.ok, true);

  const pub = await assertModuleMountSession({
    method: "GET",
    pathname: "/api/v1/modules/landing/public",
    headers: {},
  });
  assert.equal(pub.ok, true);
  assert.equal(pub.public, true);

  // Boot catalogue : header = secret par processus + path ensure/import.
  // Fail-closed sans secret env (P0 : plus de constante `1`).
  delete process.env[CATALOG_INTERNAL_SECRET_ENV];
  assert.equal(
    isCatalogInternalBootPath("POST", "/api/v1/modules/catalog/import", {
      [CATALOG_INTERNAL_HEADER]: "1",
    }),
    false,
    "sans secret env, tout header est refusé",
  );
  const secret = ensureCatalogInternalSecret();
  assert.ok(secret.length >= 32, "secret généré assez long");
  assert.equal(
    isCatalogInternalBootPath("POST", "/api/v1/modules/catalog/import", {
      [CATALOG_INTERNAL_HEADER]: "1",
    }),
    false,
    "legacy `1` refusé (bypass P0 fermé)",
  );
  assert.equal(
    isCatalogInternalBootPath("POST", "/api/v1/modules/catalog/import", {
      [CATALOG_INTERNAL_HEADER]: secret,
    }),
    true,
  );
  assert.equal(
    catalogInternalHeaderAllows({ [CATALOG_INTERNAL_HEADER]: secret }),
    true,
  );
  assert.equal(
    catalogInternalHeaderAllows({ [CATALOG_INTERNAL_HEADER]: "wrong" }),
    false,
  );
  assert.equal(
    isCatalogInternalBootPath("POST", "/api/v1/modules/catalog/import", {}),
    false,
  );
  assert.equal(
    isCatalogInternalBootPath("GET", "/api/v1/modules/catalog/status", {
      [CATALOG_INTERNAL_HEADER]: secret,
    }),
    false,
  );
  const catalogDenied = await assertModuleMountSession({
    method: "POST",
    pathname: "/api/v1/modules/catalog/import",
    headers: { "content-type": "application/json" },
  });
  assert.equal(catalogDenied.ok, false);
  if (!catalogDenied.ok) assert.equal(catalogDenied.status, 401);
  const catalogBoot = await assertModuleMountSession({
    method: "POST",
    pathname: "/api/v1/modules/catalog/import",
    headers: { [CATALOG_INTERNAL_HEADER]: secret },
  });
  assert.equal(catalogBoot.ok, true);
  assert.equal(catalogBoot.public, true);
  const catalogEnsure = await assertModuleMountSession({
    method: "POST",
    pathname: "/api/v1/modules/catalog/ensure",
    headers: { [CATALOG_INTERNAL_HEADER]: secret },
  });
  assert.equal(catalogEnsure.ok, true);
  restoreEnv();
});

test("module-mount-session : listenBrandOsHttp exige une session", async () => {
  delete process.env.AUTH_DISABLED;
  process.env.AUTH_SECRET = "gate-module-mount-session-secret";
  process.env.AUTH_ALLOW_DEV_SECRET = "1";
  configureAuth({ cookieName: "gate_module_session" });

  const api = createApiKernel({ brandId: "demobrand", appVersion: "0.0.0" });
  api.registerModuleApi("widgets", {
    dbLayer: "brand",
    handle: async () => ({ status: 200, body: { ok: true, items: [] } }),
  });
  api.registerModuleApi("landing", {
    dbLayer: "brand",
    handle: async ({ subPath }) => {
      if (subPath === "public" || subPath.startsWith("public/")) {
        return { status: 200, body: { ok: true, public: true } };
      }
      return { status: 401, body: { error: "need_session_in_mount" } };
    },
  });

  // In-process : pas de garde HTTP.
  const direct = await api.handle({
    method: "GET",
    path: "/api/v1/modules/widgets",
  });
  assert.equal(direct.status, 200);

  const mcp = {
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({ ok: false, error: "unused" }),
  };

  // Table api_keys brand.db simulée (SqliteHandle minimal) : une clé
  // machine valide scopée crm:read — contrat clé service Hermes/plugins.
  const machineKey = "svc-key-gate-module-mount";
  const machineHash = createHash("sha256")
    .update(machineKey, "utf8")
    .digest("hex");
  const fakeBrandDb = {
    prepare: () => ({
      get: (hash) =>
        hash === machineHash ? { scopes: "crm:read" } : undefined,
    }),
  };

  let mcpSurfaceHits = 0;
  const http = await listenBrandOsHttp({
    api,
    mcp,
    host: "127.0.0.1",
    port: 0,
    moduleMountMachineKey: createBrandApiKeyModuleVerifier(() => fakeBrandDb),
    mcpSurfaceHandlesPath: (p) => p.startsWith("/api/v1/admin/"),
    mcpSurfaceFetch: async () => {
      mcpSurfaceHits += 1;
      return new Response(JSON.stringify({ ready: true, toolCount: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  try {
    const anon = await fetch(`${http.baseUrl}/api/v1/modules/widgets`);
    assert.equal(anon.status, 401);
    const anonBody = await anon.json();
    assert.equal(anonBody.error, "unauthorized");

    const adminAnon = await fetch(`${http.baseUrl}/api/v1/admin/mcp/status`);
    assert.equal(adminAnon.status, 401);
    assert.equal((await adminAnon.json()).error, "unauthorized");
    const adminDbs = await fetch(`${http.baseUrl}/api/v1/admin/database/dbs`);
    assert.equal(adminDbs.status, 401);
    const health = await fetch(`${http.baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    assert.equal(mcpSurfaceHits, 0, "Hono admin ne doit pas être atteint sans session");

    // Clé machine métier : modules OK, admin toujours 401.
    const adminMachine = await fetch(`${http.baseUrl}/api/v1/admin/mcp/status`, {
      headers: { Authorization: `Bearer ${machineKey}` },
    });
    assert.equal(adminMachine.status, 401);

    // Clé machine valide (Bearer opaque) → passe la garde en lecture.
    const machine = await fetch(`${http.baseUrl}/api/v1/modules/widgets`, {
      headers: { Authorization: `Bearer ${machineKey}` },
    });
    assert.equal(machine.status, 200);

    // Clé machine valide mais scope lecture seule → mutation refusée.
    const machineWrite = await fetch(
      `${http.baseUrl}/api/v1/modules/widgets`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${machineKey}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    assert.equal(machineWrite.status, 401);

    // Clé opaque inconnue → 401.
    const badKey = await fetch(`${http.baseUrl}/api/v1/modules/widgets`, {
      headers: { Authorization: "Bearer svc-key-unknown" },
    });
    assert.equal(badKey.status, 401);

    const token = await createSessionToken({
      user: {
        id: "u1",
        username: "owner-gate",
        role: "owner",
        permissions: [],
      },
    });
    const authed = await fetch(`${http.baseUrl}/api/v1/modules/widgets`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(authed.status, 200);
    assert.equal((await authed.json()).ok, true);

    const adminAuthed = await fetch(`${http.baseUrl}/api/v1/admin/mcp/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(adminAuthed.status, 200);
    assert.equal((await adminAuthed.json()).ready, true);
    assert.ok(mcpSurfaceHits >= 1);

    const landing = await fetch(
      `${http.baseUrl}/api/v1/modules/landing/public`,
    );
    assert.equal(landing.status, 200);
    assert.equal((await landing.json()).public, true);

    // Mount catalogue minimal — prouve le header interne (secret processus)
    // traverse la garde HTTP (repro du 401 boot headless) sans AUTH_DISABLED,
    // et que le legacy `1` reste bloqué.
    const bootSecret = ensureCatalogInternalSecret();
    api.registerModuleApi("catalog", {
      dbLayer: "brand",
      handle: async ({ req, subPath }) => {
        const parts = String(subPath || "")
          .split("/")
          .filter(Boolean);
        const internal = catalogInternalHeaderAllows(req.headers || {});
        if (parts[0] === "import" && req.method === "POST") {
          if (!internal) {
            return { status: 403, body: { error: "catalog_mutate_forbidden" } };
          }
          return { status: 200, body: { ok: true, boot: true } };
        }
        return { status: 404, body: { error: "not_found" } };
      },
    });
    const catalogAnon = await fetch(
      `${http.baseUrl}/api/v1/modules/catalog/import`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(catalogAnon.status, 401);
    const catalogLegacy = await fetch(
      `${http.baseUrl}/api/v1/modules/catalog/import`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CATALOG_INTERNAL_HEADER]: "1",
        },
        body: "{}",
      },
    );
    assert.equal(
      catalogLegacy.status,
      401,
      "legacy `1` ne passe plus la garde (bypass P0 fermé)",
    );
    const catalogInternal = await fetch(
      `${http.baseUrl}/api/v1/modules/catalog/import`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CATALOG_INTERNAL_HEADER]: bootSecret,
        },
        body: "{}",
      },
    );
    assert.equal(catalogInternal.status, 200);
    assert.equal((await catalogInternal.json()).boot, true);
  } finally {
    await http.close();
    restoreEnv();
  }
});
