#!/usr/bin/env node
/**
 * D-P18 slice — createOpenExternalTabHostMcpTools SoT dans @creezio/mcp-facade.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

test("P18-oet.1 createOpenExternalTabHostMcpTools exporté (src + dist-cjs)", () => {
  const src = fs.readFileSync(
    path.join(root, "packages/mcp-facade/src/open-external-tab-host-tools.ts"),
    "utf8",
  );
  assert.match(src, /export function createOpenExternalTabHostMcpTools/);
  assert.match(src, /CREEZIO_OPEN_EXTERNAL_TAB_MCP_TOOL_NAME/);
  assert.match(src, /resolveOpenTabRequest/);
  assert.match(src, /toOpenTabParams/);
  assert.match(src, /dispatchOpenTabAction/);

  const idx = fs.readFileSync(
    path.join(root, "packages/mcp-facade/src/index.ts"),
    "utf8",
  );
  assert.match(idx, /createOpenExternalTabHostMcpTools/);
  assert.match(idx, /CREEZIO_OPEN_EXTERNAL_TAB_MCP_TOOL_NAME/);
  assert.match(idx, /CREEZIO_PLATFORM_HOST_MCP_TOOL_NAMES/);

  const cjsPath = path.join(root, "packages/mcp-facade/dist-cjs/index.js");
  assert.ok(
    fs.existsSync(cjsPath),
    "dist-cjs/index.js manquant — build:packages",
  );
  const facade = require(cjsPath);
  assert.equal(typeof facade.createOpenExternalTabHostMcpTools, "function");
  assert.equal(facade.CREEZIO_OPEN_EXTERNAL_TAB_MCP_TOOL_NAME, "open_external_tab");
  assert.ok(facade.CREEZIO_PLATFORM_HOST_MCP_TOOL_NAMES.includes("open_external_tab"));
});

test("P18-oet.2 enregistrement mock + handler resolve/dispatch", async () => {
  const facade = require(
    path.join(root, "packages/mcp-facade/dist-cjs/index.js"),
  );

  const registered = [];
  let handler = null;
  const names = facade.createOpenExternalTabHostMcpTools({
    registerTool: (name, config, h) => {
      registered.push({ name, title: config.title });
      handler = h;
    },
    getActorUserId: () => "user-1",
    resolveOpenTabRequest: (input) => ({
      ok: true,
      url: `https://${input.url || "example.com"}/`,
      fournisseurId: 0,
      title: input.title || "t",
      source: "free_url",
    }),
    toOpenTabParams: (resolved) => ({
      url: resolved.url,
      title: resolved.title,
      fournisseur_id: resolved.fournisseurId,
    }),
    dispatchOpenTabAction: async (params, opts) => ({
      ok: true,
      params,
      target: opts.targetUserId,
    }),
    getUserById: (id) => ({ id, role: "owner" }),
    getOwner: () => ({ id: "user-1" }),
    title: "Test open tab",
  });

  assert.deepEqual([...names], ["open_external_tab"]);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, "open_external_tab");
  assert.equal(registered[0].title, "Test open tab");

  const result = await handler({ url: "example.com", title: "Ex" });
  const text = result.content[0].text;
  const body = JSON.parse(text);
  assert.equal(body.ok, true);
  assert.equal(body.target_user_id, "user-1");
  assert.equal(body.resolved.url, "https://example.com/");
  assert.equal(body.params.url, "https://example.com/");
});

test("P18-oet.3 refuse token sans user_id", async () => {
  const facade = require(
    path.join(root, "packages/mcp-facade/dist-cjs/index.js"),
  );
  let handler = null;
  facade.createOpenExternalTabHostMcpTools({
    registerTool: (_n, _c, h) => {
      handler = h;
    },
    getActorUserId: () => null,
    resolveOpenTabRequest: () => ({ ok: false, error: "n/a" }),
    toOpenTabParams: () => ({}),
    dispatchOpenTabAction: async () => ({}),
    getUserById: () => null,
    getOwner: () => null,
  });
  const result = await handler({ url: "https://x.test" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /user_id/);
});
