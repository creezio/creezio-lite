#!/usr/bin/env node
/**
 * Tests Phase H5 — harden plugins / ACL Product Hub L3
 * (see / install / execute, deny cross-org, E2E plugin-control).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ARCHITECTURE_VERSION } from "@creezio/platform-core";
import {
  PLUGIN_ACL_DEFAULT_CAPABILITIES,
  PLUGIN_ACL_LEVEL_ORG,
  PLUGIN_ACL_ORG_HEADER,
  aclEntryToPolicy,
  canActorExecutePlugin,
  canActorInstallPlugin,
  canActorSeePlugin,
  decidePluginAccess,
  isCrossOrgDenied,
  productHubTokensFromManifest,
  resolvePluginAclActorFromHeaders,
  startPluginControlPlane,
  PRODUCT_HUB_ACL_H5_SQL,
} from "../packages/product-hub/dist/index.js";
import {
  createDenyUnauthorizedPluginToolPolicy,
  createMcpFacade,
  signMcpJwt,
} from "../packages/mcp-facade/dist/index.js";
import { demobrandManifest } from "../packages/brand-config/dist/index.js";
import { createDemobrandSandbox } from "../apps/demobrand/build/electron/sandbox-runtime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("H5.0 ARCHITECTURE_VERSION >= H5", () => {
  // H5 = ACL ; H6 = freeze I* (I8) — les tests H5 restent valides.
  assert.match(ARCHITECTURE_VERSION, /^H([5-9]|\d{2,})$/);
});

test("H5 docs BACKLOG + PHASE présents", () => {
  for (const f of ["docs/archive/BACKLOG-H5.md", "docs/archive/PHASE-H5.md"]) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  }
});

test("H5.1 ACL capabilities see/install/execute + défaut", () => {
  assert.equal(PLUGIN_ACL_LEVEL_ORG, "L3");
  assert.deepEqual([...PLUGIN_ACL_DEFAULT_CAPABILITIES], ["see", "execute"]);

  const policy = aclEntryToPolicy({
    pluginId: "meteo",
    orgIds: ["org-a"],
    userIds: [],
    ownerOrgId: "org-a",
  });

  assert.equal(canActorSeePlugin(policy, { orgId: "org-a" }), true);
  assert.equal(canActorExecutePlugin(policy, { orgId: "org-a" }), true);
  // install n'est PAS dans le défaut
  assert.equal(canActorInstallPlugin(policy, { orgId: "org-a" }), false);
  assert.equal(canActorInstallPlugin(policy, { isOwner: true }), true);

  const withInstall = aclEntryToPolicy({
    pluginId: "meteo",
    orgIds: ["org-a"],
    userIds: [],
    ownerOrgId: "org-a",
    capabilities: [
      { subjectKind: "org", subjectId: "org-a", capability: "see" },
      { subjectKind: "org", subjectId: "org-a", capability: "install" },
      { subjectKind: "org", subjectId: "org-a", capability: "execute" },
    ],
  });
  assert.equal(canActorInstallPlugin(withInstall, { orgId: "org-a" }), true);
});

test("H5.2 deny cross-org", () => {
  const policy = aclEntryToPolicy({
    pluginId: "meteo",
    orgIds: ["org-a"],
    userIds: [],
    ownerOrgId: "org-a",
  });
  assert.equal(isCrossOrgDenied(policy, { orgId: "org-b" }), true);
  assert.equal(isCrossOrgDenied(policy, { orgId: "org-a" }), false);
  assert.equal(isCrossOrgDenied(policy, { isOwner: true, orgId: "org-b" }), false);

  assert.equal(
    decidePluginAccess(policy, { orgId: "org-b" }, "see").reason,
    "cross_org_denied",
  );
  assert.equal(
    decidePluginAccess(policy, { orgId: "org-b" }, "execute").allow,
    false,
  );
  assert.equal(
    decidePluginAccess(policy, { orgId: "org-a" }, "see").allow,
    true,
  );
});

test("H5.2 schema SQL H5 binding + capabilities", () => {
  assert.ok(PRODUCT_HUB_ACL_H5_SQL.includes("plugin_org_binding"));
  assert.ok(PRODUCT_HUB_ACL_H5_SQL.includes("plugin_acl_capability"));
  assert.ok(PRODUCT_HUB_ACL_H5_SQL.includes("'see'"));
  assert.ok(PRODUCT_HUB_ACL_H5_SQL.includes("'install'"));
  assert.ok(PRODUCT_HUB_ACL_H5_SQL.includes("'execute'"));
});

test("H5.3 MCP + API même décision d'accès", async () => {
  const sandbox = createDemobrandSandbox();
  try {
    sandbox.installPlugin("acl-demo", { ownerOrgId: "org-a" });

    const secret = "h5-mcp-secret";
    const mcp = createMcpFacade({
      jwtSecret: secret,
      brandId: "demobrand",
      authorizeToolCall: createDenyUnauthorizedPluginToolPolicy({
        getPolicy: (id) => sandbox.productHub.getAclPolicy(id),
        decide: decidePluginAccess,
      }),
      discoverToolsBySpace: async () => ({
        plugin: [
          {
            name: "plugin.acl-demo.kv_list",
            description: "kv",
            space: "plugin",
            ownerId: "acl-demo",
            handler: async () => ({ ok: true, content: { kv: [] } }),
          },
        ],
      }),
    });

    const tokenA = signMcpJwt(secret, {
      sub: "user-a",
      orgId: "org-a",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const tokenB = signMcpJwt(secret, {
      sub: "user-b",
      orgId: "org-b",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const okA = await mcp.callTool(
      "plugin.acl-demo.kv_list",
      {},
      { bearerToken: tokenA },
    );
    assert.equal(okA.ok, true);

    const denyB = await mcp.callTool(
      "plugin.acl-demo.kv_list",
      {},
      { bearerToken: tokenB },
    );
    assert.equal(denyB.ok, false);
    assert.equal(denyB.error, "cross_org_denied");

    // API — mêmes headers
    const apiA = await sandbox.api.handle({
      method: "GET",
      path: "/api/v1/plugins/acl-demo/kv",
      headers: sandbox.actorHeaders({ orgId: "org-a", userId: "user-a" }),
    });
    assert.equal(apiA.status, 200);

    const apiB = await sandbox.api.handle({
      method: "GET",
      path: "/api/v1/plugins/acl-demo/kv",
      headers: sandbox.actorHeaders({ orgId: "org-b", userId: "user-b" }),
    });
    assert.equal(apiB.status, 403);
    assert.equal(apiB.body.error, "cross_org_denied");
  } finally {
    sandbox.close();
  }
});

test("H5.4 E2E plugin-control : install → openPlugin → MCP → revoke", async () => {
  const sandbox = createDemobrandSandbox();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-h5-pc-"));
  const pluginsDir = path.join(tmp, "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });

  try {
    const tokens = productHubTokensFromManifest(demobrandManifest);
    const secret = "demobrand_plug_h5secrettoken99";

    const plane = await startPluginControlPlane({
      tokens,
      controlToken: secret,
      pluginsDir,
      acl: {
        resolveActor: (h) => resolvePluginAclActorFromHeaders(h),
        getPolicy: (id) => sandbox.productHub.getAclPolicy(id),
        onInstalled: (pluginId, actor) => {
          const orgId = actor.orgId || "org-a";
          // Runtime DB + mount
          sandbox.installPlugin(pluginId, { ownerOrgId: orgId });
        },
        onUninstalled: (pluginId) => {
          sandbox.uninstallPlugin(pluginId);
        },
      },
      adapters: {
        listStatus: () => ({
          plugins: sandbox.runtime.listOpenPlugins().map((id) => ({ id })),
          running: [],
        }),
        createPlugin: async ({ id, name }) => {
          const dir = path.join(pluginsDir, id);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(
            path.join(dir, "manifest.json"),
            JSON.stringify({
              id,
              name: name || id,
              version: "0.1.0",
              main: "index.js",
              permissions: [],
            }),
          );
          return { ok: true, plugin: { id, dir } };
        },
        writeFiles: async () => ({ ok: true, written: [] }),
        deletePlugin: async (id) => {
          const dir = path.join(pluginsDir, id);
          if (!fs.existsSync(dir)) return { ok: false, error: "missing" };
          fs.rmSync(dir, { recursive: true, force: true });
          return { ok: true, deleted: id };
        },
        pluginDir: (id) => path.join(pluginsDir, id),
      },
    });

    // Bypass grant pour E2E ACL (focus H5)
    process.env.DEMOBRAND_PLUGIN_GRANT_BYPASS = "1";

    // Non-admin ne peut pas bootstrap install
    const denyInstall = await fetch(`${plane.url}/v1/plugins`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        [PLUGIN_ACL_ORG_HEADER]: "org-a",
        "x-demobrand-grant-bypass": "admin-dev",
      },
      body: JSON.stringify({ id: "wx-demo", name: "Weather" }),
    });
    assert.equal(denyInstall.status, 403);
    const denyBody = await denyInstall.json();
    assert.equal(denyBody.error, "acl_install_denied");

    // Owner installe
    const createRes = await fetch(`${plane.url}/v1/plugins`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        "x-creezio-is-owner": "1",
        [PLUGIN_ACL_ORG_HEADER]: "org-a",
        "x-demobrand-grant-bypass": "admin-dev",
      },
      body: JSON.stringify({ id: "wx-demo", name: "Weather" }),
    });
    assert.equal(createRes.status, 201, await createRes.text());

    // openPlugin DB créée
    assert.ok(sandbox.runtime.hasPluginOpen("wx-demo"));
    assert.ok(sandbox.runtime.pluginFileExists("wx-demo"));
    const acl = sandbox.productHub.getAcl("wx-demo");
    assert.equal(acl.ownerOrgId, "org-a");
    assert.deepEqual(acl.orgIds, ["org-a"]);

    // MCP space plugin — org-a OK, org-b deny
    const secretMcp = "h5-e2e-mcp";
    const mcp = createMcpFacade({
      jwtSecret: secretMcp,
      brandId: "demobrand",
      authorizeToolCall: createDenyUnauthorizedPluginToolPolicy({
        getPolicy: (id) => sandbox.productHub.getAclPolicy(id),
        decide: decidePluginAccess,
      }),
      discoverToolsBySpace: async () => ({
        plugin: sandbox.runtime.listOpenPlugins().map((pluginId) => ({
          name: `plugin.${pluginId}.kv_list`,
          description: "kv",
          space: "plugin",
          ownerId: pluginId,
          handler: async () => ({ ok: true, content: { pluginId } }),
        })),
      }),
      filterPluginToolsForActor: (tools, actorCtx) =>
        tools.filter((t) => {
          if (t.space !== "plugin" || !t.ownerId) return t.space !== "plugin";
          return decidePluginAccess(
            sandbox.productHub.getAclPolicy(t.ownerId),
            {
              orgId: actorCtx.orgId ?? null,
              userId: actorCtx.subject,
              isOwner: Boolean(actorCtx.claims?.isOwner),
            },
            "see",
          ).allow;
        }),
    });

    const jwtA = signMcpJwt(secretMcp, {
      sub: "u-a",
      orgId: "org-a",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const jwtB = signMcpJwt(secretMcp, {
      sub: "u-b",
      orgId: "org-b",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const listedA = await mcp.listTools({
      bearerToken: jwtA,
      space: "plugin",
    });
    assert.ok(listedA.tools.some((t) => t.name === "plugin.wx-demo.kv_list"));

    const listedB = await mcp.listTools({
      bearerToken: jwtB,
      space: "plugin",
    });
    assert.equal(
      listedB.tools.some((t) => t.name === "plugin.wx-demo.kv_list"),
      false,
    );

    const callA = await mcp.callTool(
      "plugin.wx-demo.kv_list",
      {},
      { bearerToken: jwtA },
    );
    assert.equal(callA.ok, true);

    // Revoke / uninstall
    const del = await fetch(`${plane.url}/v1/plugins/wx-demo`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${secret}`,
        "x-creezio-is-owner": "1",
        [PLUGIN_ACL_ORG_HEADER]: "org-a",
      },
    });
    assert.equal(del.status, 200);
    assert.equal(sandbox.runtime.hasPluginOpen("wx-demo"), false);
    assert.equal(sandbox.runtime.pluginFileExists("wx-demo"), false);
    assert.deepEqual(sandbox.productHub.getAcl("wx-demo").orgIds, []);

    await plane.close();
  } finally {
    delete process.env.DEMOBRAND_PLUGIN_GRANT_BYPASS;
    sandbox.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("H5.5 demobrand sandbox uninstall + headers helper", () => {
  const sandbox = createDemobrandSandbox();
  try {
    const inst = sandbox.installPlugin("tmp-plug", { ownerOrgId: "org-z" });
    assert.equal(inst.created, true);
    const h = sandbox.actorHeaders({ orgId: "org-z", userId: "u1" });
    assert.equal(h[PLUGIN_ACL_ORG_HEADER], "org-z");
    const u = sandbox.uninstallPlugin("tmp-plug");
    assert.equal(u.removed, true);
    assert.equal(sandbox.runtime.pluginFileExists("tmp-plug"), false);
  } finally {
    sandbox.close();
  }
});

test("H5.6 control plane health expose acl flag", async () => {
  const tokens = productHubTokensFromManifest(demobrandManifest);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-h5-hl-"));
  const plane = await startPluginControlPlane({
    tokens,
    controlToken: "tok",
    pluginsDir: tmp,
    adapters: {
      listStatus: () => ({ plugins: [], running: [] }),
      createPlugin: async () => ({ ok: false, error: "noop" }),
      writeFiles: async () => ({ ok: true, written: [] }),
      pluginDir: (id) => path.join(tmp, id),
    },
    acl: {
      resolveActor: () => ({ isOwner: true }),
      getPolicy: () => undefined,
    },
  });
  try {
    const res = await fetch(`${plane.url}/v1/health`);
    const body = await res.json();
    assert.equal(body.acl, true);
  } finally {
    await plane.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// silence unused import lint-ish
void http;
void os;
