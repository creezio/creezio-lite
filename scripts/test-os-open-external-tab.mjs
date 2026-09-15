#!/usr/bin/env node
/**
 * Gate OS — onglets externes + tool MCP `open_external_tab`.
 * Unit-style (tab-url, preload path, contrats MCP) — pas de GUI Electron.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  isSameTabDocument,
  isSameTabOrigin,
  normalizeTabDocumentUrl,
} from "../packages/electron-shell/dist/host/browser-tabs/tab-url.js";
import { reduceTabNativeLoadState } from "../packages/electron-shell/dist/host/browser-tabs/tab-load-state.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

test("oet.tab-url — normalisation http(s) sans Electron", () => {
  assert.equal(
    normalizeTabDocumentUrl("https://example.com"),
    "https://example.com:443/",
  );
  assert.equal(
    normalizeTabDocumentUrl("http://localhost:3000/path/"),
    "http://127.0.0.1:3000/path",
  );
  assert.equal(normalizeTabDocumentUrl("javascript:alert(1)"), null);
  assert.equal(normalizeTabDocumentUrl("about:blank"), null);
  assert.equal(
    isSameTabDocument("https://example.com/", "https://example.com"),
    true,
  );
  assert.equal(
    isSameTabOrigin("http://localhost:8080", "http://127.0.0.1:8080"),
    true,
  );
});

test("oet.tab-load-state — reducer pur", () => {
  const next = reduceTabNativeLoadState("ready", { type: "intent-load" });
  assert.equal(next, "loading");
  const stay = reduceTabNativeLoadState("ready", {
    type: "main-nav-start",
    isMainFrame: true,
    isInPlace: false,
    url: "https://x.test",
  });
  assert.equal(stay, "ready");
});

test("oet.browser-tabs — exports kit (src statique)", () => {
  const mgr = fs.readFileSync(
    path.join(
      ROOT,
      "packages/electron-shell/src/host/browser-tabs/browser-tab-manager.ts",
    ),
    "utf8",
  );
  assert.match(mgr, /export function configureBrowserTabs/);
  assert.match(mgr, /export \{ SupplierTabManager as BrowserTabManager \}/);
  assert.match(mgr, /partition persistante/);

  const idx = fs.readFileSync(
    path.join(ROOT, "packages/electron-shell/src/host/browser-tabs/index.ts"),
    "utf8",
  );
  assert.match(idx, /BrowserTabManager/);
  assert.match(idx, /configureBrowserTabs/);
  assert.match(idx, /normalizeTabDocumentUrl/);

  const preload = path.join(
    ROOT,
    "packages/electron-shell/dist/host/browser-tabs/browser-tab-preload.js",
  );
  assert.ok(fs.existsSync(preload), `preload manquant: ${preload}`);
});

test("oet.mcp — createOpenExternalTabHostMcpTools contrat", async () => {
  const facade = require(
    path.join(ROOT, "packages/mcp-facade/dist-cjs/index.js"),
  );
  assert.equal(typeof facade.createOpenExternalTabHostMcpTools, "function");
  assert.equal(facade.CREEZIO_OPEN_EXTERNAL_TAB_MCP_TOOL_NAME, "open_external_tab");
  assert.ok(
    facade.CREEZIO_PLATFORM_HOST_MCP_TOOL_NAMES.includes("open_external_tab"),
  );

  let handler = null;
  const names = facade.createOpenExternalTabHostMcpTools({
    registerTool: (_name, _cfg, h) => {
      handler = h;
    },
    getActorUserId: () => "actor-1",
    resolveOpenTabRequest: (input) => ({
      ok: true,
      url: `https://${input.url || "example.test"}/`,
      fournisseurId: 0,
      title: input.title || "Tab",
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
    getOwner: () => ({ id: "actor-1" }),
  });
  assert.deepEqual([...names], ["open_external_tab"]);
  assert.equal(typeof handler, "function");

  const ok = await handler({ url: "example.test", title: "Ex" });
  const body = JSON.parse(ok.content[0].text);
  assert.equal(body.ok, true);
  assert.equal(body.target_user_id, "actor-1");
  assert.match(body.resolved.url, /^https:\/\/example\.test\//);

  const denied = await handler({ url: "https://blocked.test" });
  let handlerNoActor = null;
  facade.createOpenExternalTabHostMcpTools({
    registerTool: (_n, _c, h) => {
      handlerNoActor = h;
    },
    getActorUserId: () => null,
    resolveOpenTabRequest: () => ({ ok: false, error: "n/a" }),
    toOpenTabParams: () => ({}),
    dispatchOpenTabAction: async () => ({}),
    getUserById: () => null,
    getOwner: () => null,
  });
  const noUser = await handlerNoActor({ url: "https://blocked.test" });
  assert.equal(noUser.isError, true);
  assert.match(noUser.content[0].text, /user_id/);
});
