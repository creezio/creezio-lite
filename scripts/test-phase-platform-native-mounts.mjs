#!/usr/bin/env node
/**
 * Gate — montages natifs kit manquants (Tasks autoconfig, Analytics admin, OpenAPI).
 *
 * Prouve au niveau source + runtime (dist) :
 *  1. mountBrandPlatformSurface auto-configureTasksBrand (comme assistant) ;
 *  2. mountBrandMcpSurface monte createUsageAnalyticsAdminRoutes + openapi.json ;
 *  3. runtime : GET /api/v1/tasks sans 500 configureTasksBrand ;
 *  4. runtime : GET /api/v1/admin/analytics/overview + /api/v1/openapi.json ≠ 404.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("PNM.1 source — tasks autoconfig + analytics + openapi", () => {
  const platform = fs.readFileSync(
    path.join(root, "packages/app-runtime/src/mount-brand-platform-surface.ts"),
    "utf8",
  );
  assert.match(platform, /configureTasksBrand/);
  assert.match(platform, /getTasksBrandConfig/);
  assert.match(platform, /createPlatformTasksBrandAdapters\(\)/);
  assert.match(
    platform,
    /config kit par défaut \(marque sans configureTasksBrand\)/,
  );

  const mcp = fs.readFileSync(
    path.join(root, "packages/app-runtime/src/mount-brand-mcp-surface.ts"),
    "utf8",
  );
  assert.match(mcp, /configureUsageAnalytics/);
  assert.match(mcp, /createUsageAnalyticsAdminRoutes/);
  assert.match(mcp, /ensureUsageAnalyticsSchema/);
  assert.match(mcp, /buildOpenApiDocumentFromRegistry/);
  assert.match(mcp, /\/api\/v1\/openapi\.json/);
  assert.match(mcp, /admin\/analytics/);
  assert.match(mcp, /pathname\.startsWith\("\/api\/v1\/admin\/analytics"\)/);

  const registry = fs.readFileSync(
    path.join(root, "packages/observability/src/api-endpoints/registry.ts"),
    "utf8",
  );
  assert.match(registry, /export function buildOpenApiDocumentFromRegistry/);
});

test("PNM.2 runtime — tasks autoconfig (plus de 500)", async () => {
  const rtDist = path.join(root, "packages/app-runtime/dist/index.js");
  assert.ok(fs.existsSync(rtDist), "build @creezio/app-runtime manquant");

  process.env.AUTH_SECRET = process.env.AUTH_SECRET || "gate-pnm-secret";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-pnm-"));
  process.env.CREEZIO_CORE_DB_PATH = path.join(tmp, "core.db");

  const { mountBrandPlatformSurface } = await import(rtDist);
  const tasksPkg = await import(
    path.join(root, "packages/tasks/dist/index.js")
  );
  tasksPkg.resetTasksBrandForTests?.();

  let baseUrl = "";
  const surface = mountBrandPlatformSurface({
    brandId: "pnmbrand",
    coreDbPath: process.env.CREEZIO_CORE_DB_PATH,
    baseUrl: () => baseUrl,
  });
  assert.ok(
    tasksPkg.getTasksBrandConfig(),
    "configureTasksBrand auto doit être posé",
  );

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url || "/", baseUrl || "http://127.0.0.1");
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v == null) continue;
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else headers.set(k, v);
    }
    const request = new Request(url.toString(), {
      method: req.method || "GET",
      headers,
      body:
        ["GET", "HEAD"].includes(req.method || "GET") || !body.length
          ? undefined
          : body,
    });
    const response = await surface.app.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(res);
    else res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const tasksRes = await fetch(`${baseUrl}/api/v1/tasks`);
  const tasksBody = await tasksRes.text();
  assert.notEqual(
    tasksRes.status,
    500,
    `tasks ne doit plus 500 configureTasksBrand: ${tasksBody.slice(0, 200)}`,
  );
  assert.doesNotMatch(
    tasksBody,
    /configureTasksBrand/,
    `corps ne doit pas citer configureTasksBrand: ${tasksBody.slice(0, 200)}`,
  );
  assert.equal(tasksRes.status, 401);

  surface.close();
  server.close();
  tasksPkg.resetTasksBrandForTests?.();
});

test("PNM.3 runtime — analytics admin + openapi stub", async () => {
  const rtDist = path.join(
    root,
    "packages/app-runtime/dist/mount-brand-mcp-surface.js",
  );
  const obsDist = path.join(root, "packages/observability/dist/index.js");
  const pcDist = path.join(root, "packages/platform-core/dist/index.js");
  const bcDist = path.join(root, "packages/brand-config/dist/index.js");
  assert.ok(fs.existsSync(rtDist), "build mount-brand-mcp-surface manquant");
  assert.ok(fs.existsSync(obsDist), "build @creezio/observability manquant");

  process.env.AUTH_SECRET = process.env.AUTH_SECRET || "gate-pnm-secret";
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-pnm-mcp-"));

  const { createSqliteRuntime } = await import(pcDist);
  const { demobrandManifest } = await import(bcDist);
  const { mountBrandMcpSurface, mcpSurfaceHandlesPath } = await import(rtDist);

  const runtime = createSqliteRuntime({
    ctx: {
      manifest: demobrandManifest,
      userDataRoot,
      isPackaged: true,
      env: {},
    },
  });

  const jwtSecret = "pnm-mcp-jwt-secret-32chars-minimum!!";
  const osStub = {
    store: {
      ensureMcpJwtSecret: () => jwtSecret,
      getLocalAuth: () => null,
    },
  };

  const mcp = mountBrandMcpSurface({
    manifest: demobrandManifest,
    runtime,
    os: osStub,
    mcp: { listTools: async () => ({ tools: [] }) },
    publicBaseUrl: () => "http://127.0.0.1:9",
  });

  assert.ok(mcpSurfaceHandlesPath("/api/v1/admin/analytics/overview"));
  assert.ok(mcpSurfaceHandlesPath("/api/v1/openapi.json"));
  assert.ok(mcpSurfaceHandlesPath("/api/v1/analytics/events"));

  const analyticsRes = await mcp.app.request(
    "http://local/api/v1/admin/analytics/overview",
  );
  assert.notEqual(
    analyticsRes.status,
    404,
    "analytics overview ne doit plus 404",
  );
  assert.equal(analyticsRes.status, 200);
  const analyticsBody = await analyticsRes.json();
  assert.ok(analyticsBody.periodKey || analyticsBody.ok !== false);

  const openapiRes = await mcp.app.request("http://local/api/v1/openapi.json");
  assert.equal(openapiRes.status, 200);
  const openapi = await openapiRes.json();
  assert.equal(openapi.openapi, "3.0.3");
  assert.ok(openapi.info?.title);
  assert.ok(openapi.paths);
  assert.ok(
    Object.keys(openapi.paths).some((p) => p.includes("/analytics/")),
    "OpenAPI doit documenter au moins une route analytics",
  );

  runtime.close?.();
});
