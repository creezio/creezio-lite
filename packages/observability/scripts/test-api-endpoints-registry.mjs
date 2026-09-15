#!/usr/bin/env node
/**
 * Smoke O5 — buildApiEndpointsRegistry + createApiEndpointsRoutes.
 */
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  buildApiEndpointsRegistry,
  collectHonoRoutes,
  createApiEndpointsRoutes,
} from "../dist/api-endpoints/index.js";

const openapi = {
  paths: {
    "/api/v1/health": {
      get: {
        summary: "Health",
        tags: ["core"],
      },
    },
  },
};

const registry = buildApiEndpointsRegistry({
  routes: [
    { method: "GET", path: "/api/v1/health" },
    { method: "POST", path: "/api/v1/notes" },
    { method: "GET", path: "/api/v1/health" }, // dedupe
  ],
  openApiDocument: openapi,
  source: "test",
});

assert.equal(registry.endpoints.length, 2);
assert.equal(registry.endpoints[0].path, "/api/v1/health");
assert.equal(registry.endpoints[0].documented, true);
assert.equal(registry.endpoints[0].summary, "Health");
assert.equal(registry.endpoints[1].documented, false);

const app = new Hono();
app.get("/ping", (c) => c.json({ ok: true }));
app.route(
  "/",
  createApiEndpointsRoutes({
    getRegistry: () =>
      buildApiEndpointsRegistry({
        routes: collectHonoRoutes(app, "/api/v1/admin"),
        source: "hono-test",
      }),
  }),
);

const res = await app.request("http://local/endpoints");
assert.equal(res.status, 200);
const body = await res.json();
assert.ok(Array.isArray(body.endpoints));
assert.ok(body.endpoints.some((e) => e.path.endsWith("/ping")));
assert.ok(body.endpoints.some((e) => e.path.endsWith("/endpoints")));

console.log("OK test-api-endpoints-registry");
