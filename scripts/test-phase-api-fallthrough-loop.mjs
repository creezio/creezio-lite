#!/usr/bin/env node
/**
 * Gate : un 404 API kernel ne doit pas boucler kernel→Next→kernel
 * (rewrite next.config /api/v1 → metier). Symptôme WinHub : page Admin
 * API/MCP « crash » (ECONNRESET, next-server 90 % CPU).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const listenSrc = path.join(
  ROOT,
  "packages/app-runtime/src/listen-brand-os-http.ts",
);
const mcpSrc = path.join(
  ROOT,
  "packages/app-runtime/src/mount-brand-mcp-surface.ts",
);
const registrySrc = path.join(
  ROOT,
  "packages/observability/src/api-endpoints/registry.ts",
);

const listen = fs.readFileSync(listenSrc, "utf8");
assert.match(
  listen,
  /x-creezio-kernel-fallthrough/,
  "listen-brand-os-http doit marquer le hop fallthrough",
);
assert.match(
  listen,
  /inflightApiFallthrough/,
  "listen-brand-os-http doit garder un Set anti-reentrée",
);
assert.match(
  listen,
  /hasKernelFallthroughHop/,
  "coupe-circuit hop manquant",
);

const mcp = fs.readFileSync(mcpSrc, "utf8");
assert.match(
  mcp,
  /createApiEndpointsRoutes/,
  "surface MCP doit monter le registre /admin/endpoints",
);
assert.match(
  mcp,
  /\/api\/v1\/admin\/endpoints/,
  "mcpSurfaceHandlesPath doit router /admin/endpoints",
);
assert.match(
  mcp,
  /createRequestLogsRoutes/,
  "surface MCP doit monter request-logs (sinon même boucle)",
);

assert.ok(
  fs.existsSync(registrySrc),
  "buildApiEndpointsRegistry SoT observability manquant",
);

console.log("OK test-phase-api-fallthrough-loop");
