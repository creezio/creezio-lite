#!/usr/bin/env node
/**
 * Gate P2/P3 plugins natifs — tools MCP plugins + mounts API kernel.
 *
 * - PT1 : plugin running ⇒ listTools contient plugin.<id>.status/call/<tool>
 *         (manifest.mcpTools), tool déclaré appelable (proxy loopback réel).
 * - PT2 : ACL fail-closed — acteur JWT sans grant : tools invisibles au
 *         listing ET callTool refusé ; owner OK ; grant L4 explicite OK.
 * - PT3 : manifest.mcpTools invalide ⇒ plugin rejeté à la découverte
 *         (error visible, aucun tool exposé, sidecar non démarré).
 * - PT4 : registerPluginApi — mount /api/v1/plugins/<id>/* proxifié quand
 *         le sidecar tourne, 403 acteur sans grant (authorizePluginAccess),
 *         plugin_not_mounted après stop.
 *
 * Hermétique : marque synthétique + plugin echo local, zéro réseau externe.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createAppManifest } from "../packages/brand-config/dist/index.js";
import { startBrandKernelHarness } from "../packages/app-runtime/dist/index.js";
import { signMcpJwt } from "../packages/mcp-facade/dist/index.js";
import { createSqliteProductHubStore } from "../packages/product-hub/dist/index.js";

const ENV_KEYS = [
  "CREEZIO_PLUGINS",
  "CREEZIO_NATIVE_WARM",
  "CREEZIO_SKIP_KIT_BINARIES",
  "MCP_JWT_SECRET",
  "AUTH_SECRET",
];
const saveEnv = () =>
  Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const restoreEnv = (saved) => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};

const ECHO_SIDECAR = `
const http = require("node:http");
const port = Number(process.env.PORT || 0);
const server = http.createServer((req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.url.startsWith("/health")) return send(200, { ok: true, plugin: process.env.PLUGIN_ID });
  if (req.url.startsWith("/api/echo") && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch {}
      send(200, { ok: true, echoed: body });
    });
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><body>echo panel</body></html>");
});
server.listen(port, "127.0.0.1", () => {
  console.log(JSON.stringify({ event: "ready", port: server.address().port }));
});
`;

function writePlugin(pluginsRoot, id, manifest, { enabled = true } = {}) {
  const dir = path.join(pluginsRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  fs.writeFileSync(path.join(dir, "index.js"), ECHO_SIDECAR);
  if (enabled) fs.writeFileSync(path.join(dir, ".enabled"), "1\n");
  return dir;
}

async function bootProbe() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-tools-"));
  const dataDir = path.join(tmp, "data");
  const pluginsRoot = path.join(dataDir, "plugins");
  fs.mkdirSync(pluginsRoot, { recursive: true });

  writePlugin(pluginsRoot, "echoprobe", {
    id: "echoprobe",
    name: "Echo Probe",
    version: "1.0.0",
    main: "index.js",
    permissions: ["net:loopback", "ui:panel"],
    panel: { title: "Echo", path: "/" },
    mcpTools: [
      {
        name: "echo",
        description: "Echo JSON via sidecar",
        method: "POST",
        path: "/api/echo",
        inputSchema: { type: "object" },
      },
    ],
  });
  // mcpTools invalide (method inconnu) ⇒ rejeté à la découverte.
  writePlugin(pluginsRoot, "badtools", {
    id: "badtools",
    name: "Bad Tools",
    version: "1.0.0",
    main: "index.js",
    permissions: ["net:loopback"],
    mcpTools: [{ name: "boom", method: "TELEPORT", path: "/api/x" }],
  });

  const manifest = createAppManifest({
    brandId: "plugintools",
    productName: "Plugin Tools Probe",
    domain: "plugintools.local",
    sandbox: true,
  });
  const handle = await startBrandKernelHarness({
    brandId: "plugintools",
    appRoot: tmp,
    dataDir,
    manifest,
    brandMigrations: [],
    registerModuleApi: () => {},
    skipIndex: true,
  });
  return {
    handle,
    close: async () => {
      await handle.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

async function mcpList(baseUrl, bearer) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({ method: "tools/list" }),
  });
  return res.json();
}

async function mcpCall(baseUrl, name, args, bearer) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({ method: "tools/call", params: { name, arguments: args } }),
  });
  return res.json();
}

async function waitFor(fn, { tries = 50, delayMs = 100 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

test("PT1..PT4 tools MCP plugins + ACL + mounts API kernel", async () => {
  const saved = saveEnv();
  let probe = null;
  try {
    process.env.CREEZIO_SKIP_KIT_BINARIES = "1";
    process.env.CREEZIO_NATIVE_WARM = "0";
    delete process.env.CREEZIO_PLUGINS;
    delete process.env.MCP_JWT_SECRET;

    probe = await bootProbe();
    const { baseUrl, runtime } = probe.handle;

    // Sidecar prêt (annonce {event:"ready"} → /health proxifié).
    const healthy = await waitFor(async () => {
      const r = await fetch(`${baseUrl}/api/v1/plugins/echoprobe/health`);
      if (r.status !== 200) return null;
      const j = await r.json();
      return j.ok === true ? j : null;
    });
    assert.ok(healthy, "PT4 mount /api/v1/plugins/echoprobe/health répond 200");
    assert.equal(healthy.plugin, "echoprobe");

    // PT4b — panel HTML via proxy : corps brut (pas JSON-stringifié), URL web.
    const panelRes = await fetch(`${baseUrl}/api/v1/plugins/echoprobe/`);
    assert.equal(panelRes.status, 200, "panel proxy 200");
    const panelCt = panelRes.headers.get("content-type") || "";
    assert.match(panelCt, /text\/html/i, `content-type HTML: ${panelCt}`);
    const panelText = await panelRes.text();
    assert.ok(
      panelText.startsWith("<html") || panelText.startsWith("<!"),
      `panel HTML brut attendu, reçu: ${panelText.slice(0, 80)}`,
    );
    const osListed = await (await fetch(`${baseUrl}/api/v1/os/plugins`)).json();
    assert.ok(osListed.status?.running?.length >= 1, "status.running peuplé");
    const echoRun = (osListed.status.running || []).find(
      (r) => r.id === "echoprobe",
    );
    assert.ok(echoRun?.panelUrl, "panelUrl web proxy");
    assert.match(
      String(echoRun.panelUrl),
      /^\/api\/v1\/plugins\/echoprobe\//,
      `panelUrl même origine: ${echoRun.panelUrl}`,
    );

    // PT1 — listing service (sans bearer = clé service locale) : tools présents.
    const listed = await mcpList(baseUrl);
    const names = (listed.tools || []).map((t) => t.name);
    assert.ok(names.includes("plugin.echoprobe.status"), JSON.stringify(names));
    assert.ok(names.includes("plugin.echoprobe.call"), "tool call proxy");
    assert.ok(names.includes("plugin.echoprobe.echo"), "tool manifest mcpTools");
    const echoDef = listed.tools.find((t) => t.name === "plugin.echoprobe.echo");
    assert.equal(echoDef.ownerId, "echoprobe", "ownerId namespace");
    assert.equal(echoDef.space, "plugin");

    // PT3 — mcpTools invalide : AUCUN tool badtools, erreur à la découverte.
    assert.ok(
      !names.some((n) => n.startsWith("plugin.badtools.")),
      "manifest mcpTools invalide ⇒ aucun tool exposé",
    );
    const osPlugins = await (
      await fetch(`${baseUrl}/api/v1/os/plugins`)
    ).json();
    const bad = (osPlugins.plugins || []).find((p) =>
      String(p.dir || "").endsWith("badtools"),
    );
    assert.ok(bad, "badtools présent dans la découverte");
    assert.match(
      String(bad.error || ""),
      /mcpTools/,
      `erreur manifest attendue: ${JSON.stringify(bad)}`,
    );
    const badRunning = (osPlugins.status?.running || []).some(
      (r) => r.id === "badtools",
    );
    assert.equal(badRunning, false, "badtools jamais démarré");

    // PT1 — tool déclaré appelable (proxy loopback réel).
    const echoRes = await mcpCall(baseUrl, "plugin.echoprobe.echo", {
      hello: "monde",
    });
    assert.equal(echoRes.ok, true, JSON.stringify(echoRes));
    assert.equal(echoRes.content.status, 200);
    assert.deepEqual(echoRes.content.body.echoed, { hello: "monde" });

    // Proxy générique whitelisté.
    const statusRes = await mcpCall(baseUrl, "plugin.echoprobe.status", {});
    assert.equal(statusRes.ok, true);
    assert.equal(statusRes.content.running, true);
    const deniedPath = await mcpCall(baseUrl, "plugin.echoprobe.call", {
      method: "GET",
      path: "/etc/passwd",
    });
    assert.equal(deniedPath.ok, false);
    assert.equal(deniedPath.error, "plugin_call_path_denied");

    // PT2 — ACL fail-closed avec acteurs JWT réels.
    const secret = (process.env.MCP_JWT_SECRET || "").trim();
    assert.ok(secret, "MCP_JWT_SECRET posé par composeBrandOs");
    const noGrant = signMcpJwt(secret, { sub: "user-nogrant" });
    const ownerJwt = signMcpJwt(secret, { sub: "owner-1", isOwner: true });

    const listedNoGrant = await mcpList(baseUrl, noGrant);
    assert.ok(
      !(listedNoGrant.tools || []).some((t) => t.space === "plugin"),
      "acteur sans grant : aucun tool plugin listé",
    );
    const callNoGrant = await mcpCall(
      baseUrl,
      "plugin.echoprobe.echo",
      { hello: "x" },
      noGrant,
    );
    assert.equal(callNoGrant.ok, false, JSON.stringify(callNoGrant));
    assert.match(
      String(callNoGrant.error || ""),
      /acl_fail_closed|acl_execute_denied/,
      "refus ACL attendu",
    );

    const listedOwner = await mcpList(baseUrl, ownerJwt);
    assert.ok(
      (listedOwner.tools || []).some(
        (t) => t.name === "plugin.echoprobe.echo",
      ),
      "owner voit les tools plugin",
    );
    const callOwner = await mcpCall(
      baseUrl,
      "plugin.echoprobe.echo",
      { hello: "owner" },
      ownerJwt,
    );
    assert.equal(callOwner.ok, true, JSON.stringify(callOwner));

    // Grant L4 explicite → visible + appelable (défaut see+execute).
    const hub = createSqliteProductHubStore({
      coreDbPath: runtime.paths.core,
    });
    hub.upsertAcl({
      pluginId: "echoprobe",
      orgIds: [],
      userIds: ["user-grant"],
    });
    hub.close();
    const granted = signMcpJwt(secret, { sub: "user-grant" });
    const listedGrant = await mcpList(baseUrl, granted);
    assert.ok(
      (listedGrant.tools || []).some(
        (t) => t.name === "plugin.echoprobe.echo",
      ),
      "grant L4 : tool visible",
    );
    const callGrant = await mcpCall(
      baseUrl,
      "plugin.echoprobe.echo",
      { hello: "grant" },
      granted,
    );
    assert.equal(callGrant.ok, true, JSON.stringify(callGrant));
    // user-nogrant reste refusé après le grant d'un AUTRE user.
    const stillDenied = await mcpCall(
      baseUrl,
      "plugin.echoprobe.echo",
      {},
      noGrant,
    );
    assert.equal(stillDenied.ok, false);

    // PT4 — authorizePluginAccess sur le mount API kernel (403 sans grant).
    const apiDenied = await fetch(
      `${baseUrl}/api/v1/plugins/echoprobe/health`,
      { headers: { "x-creezio-user-id": "user-nogrant" } },
    );
    assert.equal(apiDenied.status, 403, "API kernel : 403 acteur sans grant");
    const apiDeniedBody = await apiDenied.json();
    assert.match(String(apiDeniedBody.error || ""), /acl/);
    const apiGranted = await fetch(
      `${baseUrl}/api/v1/plugins/echoprobe/health`,
      { headers: { "x-creezio-user-id": "user-grant" } },
    );
    assert.equal(apiGranted.status, 200, "API kernel : grant L4 passe");

    // PT4 — stop ⇒ unregisterPluginApi ⇒ plugin_not_mounted.
    const pluginsHost = probe.handle.os.hostStack.hostPlugins();
    pluginsHost.stopAllPlugins();
    const afterStop = await waitFor(async () => {
      const r = await fetch(`${baseUrl}/api/v1/plugins/echoprobe/health`);
      if (r.status !== 404) return null;
      return r.json();
    });
    assert.ok(afterStop, "mount retiré après stop");
    assert.equal(afterStop.error, "plugin_not_mounted");
    // Tools retirés de la surface (plugin plus running).
    const listedAfterStop = await mcpList(baseUrl);
    assert.ok(
      !(listedAfterStop.tools || []).some((t) =>
        t.name.startsWith("plugin.echoprobe."),
      ),
      "tools retirés après stop",
    );
  } finally {
    await probe?.close();
    restoreEnv(saved);
  }
});
