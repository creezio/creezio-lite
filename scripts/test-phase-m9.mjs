#!/usr/bin/env node
/**
 * Gate kit M9 — MCP/API anti-jumeau : runtime/proxy/core-tools SoT kit ;
 * TF/Certivan sans mcp-runtime / mcp-hono-proxy plateforme.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tfRoot = resolveBrandCrmRoot("tempoflow2");
const cvRoot = resolveBrandCrmRoot("certivan-app");

test("M9.1 PHASE-M9.md présent", () => {
  const docPath = path.join(root, "docs/archive/PHASE-M9.md");
  assert.ok(fs.existsSync(docPath));
  const doc = fs.readFileSync(docPath, "utf8");
  assert.match(doc, /@creezio\/mcp-facade/);
  assert.match(doc, /wrapMcpFacadeWithHonoProxy/);
  assert.match(doc, /CREEZIO_CORE_MCP_TOOL_NAMES|createCoreMcpTools/);
});

test("M9.2 kit expose runtime + proxy + core tools", () => {
  const mcp = require(
    path.join(root, "packages/mcp-facade/dist-cjs/index.js"),
  );
  assert.equal(mcp.MCP_PRODUCT_EXECUTOR, "hono");
  assert.equal(typeof mcp.resolveMcpFacadeRole, "function");
  assert.equal(typeof mcp.wrapMcpFacadeWithHonoProxy, "function");
  assert.equal(typeof mcp.createCoreMcpTools, "function");
  assert.ok(Array.isArray(mcp.CREEZIO_CORE_MCP_TOOL_NAMES));
  assert.ok(mcp.CREEZIO_CORE_MCP_TOOL_NAMES.includes("creezio.health"));
  assert.equal(mcp.resolveMcpFacadeRole("hono-preferred", null), "local-brand-adapter");
  assert.equal(
    mcp.resolveMcpFacadeRole("hono-preferred", "http://127.0.0.1:1"),
    "hono-proxy",
  );
  const core = mcp.createCoreMcpTools({ brandId: "m9" });
  assert.ok(core.some((t) => t.name === "creezio.health"));
});

test("M9.3 TF sans jumeaux plateforme mcp-runtime/hono-proxy", () => {
  for (const f of ["mcp-runtime.ts", "mcp-hono-proxy.ts"]) {
    assert.ok(
      !fs.existsSync(path.join(tfRoot, "electron/modules", f)),
      `TF encore ${f}`,
    );
  }
  assert.ok(
    fs.existsSync(path.join(tfRoot, "electron/modules/mcp-aliases.ts")),
  );
  assert.ok(fs.existsSync(path.join(tfRoot, "electron/modules/mcp-tools.ts")));
  const br = fs.readFileSync(
    path.join(tfRoot, "electron/brand-runtime.ts"),
    "utf8",
  );
  assert.match(br, /wrapMcpFacadeWithHonoProxy/);
  assert.match(br, /from ["']@creezio\/mcp-facade["']/);
  const modImport = br.match(
    /import\s*\{([^}]*)\}\s*from\s*["']\.\/modules["']/,
  );
  assert.ok(modImport, "import ./modules");
  assert.doesNotMatch(modImport[1], /wrapMcpFacadeWithHonoProxy/);
  assert.doesNotMatch(modImport[1], /TEMPOFLOW_MCP_PRODUCT_EXECUTOR/);
  assert.doesNotMatch(modImport[1], /mcp-runtime|mcp-hono-proxy/);
});

test("M9.4 Certivan sans jumeaux plateforme mcp-runtime/hono-proxy", () => {
  for (const f of ["mcp-runtime.ts", "mcp-hono-proxy.ts"]) {
    assert.ok(
      !fs.existsSync(path.join(cvRoot, "electron/modules", f)),
      `Certivan encore ${f}`,
    );
  }
  const br = fs.readFileSync(
    path.join(cvRoot, "electron/brand-runtime.ts"),
    "utf8",
  );
  assert.match(br, /from ["']@creezio\/mcp-facade["']/);
  assert.match(br, /wrapMcpFacadeWithHonoProxy/);
});

test("M9.5 TF tool-registry importe noms cœur kit", () => {
  const reg = fs.readFileSync(
    path.join(tfRoot, "src/server/mcp/tool-registry.ts"),
    "utf8",
  );
  assert.match(reg, /CREEZIO_CORE_MCP_TOOL_NAMES/);
  assert.match(reg, /@creezio\/mcp-facade/);
});
