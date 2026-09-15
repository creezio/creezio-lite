#!/usr/bin/env node
/**
 * Tests kit Phase E — Product Hub brand-agnostic.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAppManifest,
  demobrandManifest,
} from "../packages/brand-config/dist/index.js";
import {
  PLUGIN_ACL_LEVEL_ORG,
  PLUGIN_ACL_LEVEL_USER,
  PRODUCT_HUB_ACL_ORG_SQL,
  PRODUCT_HUB_CORE_SQL,
  PRODUCT_HUB_VERTICAL_REMAINING,
  assertPluginLifecycleTransition,
  buildPluginImpactReport,
  canActorSeePlugin,
  canTransitionPluginLifecycle,
  createMemoryProductHubStore,
  filterVisiblePluginIds,
  issueGrantFromProductDetails,
  missingPrdSections,
  pluginN8nTag,
  productHubTokensFromManifest,
  requirePluginExecutionGrant,
  startPluginControlPlane,
} from "../packages/product-hub/dist/index.js";
import {
  issuePluginExecutionGrant,
  verifyPluginExecutionGrant,
} from "../packages/platform-core/dist/index.js";
import {
  PLUGIN_VERTICAL_REMAINING,
  createPluginsHost,
  getPluginControlBridgeEnv,
  startHostPluginControlPlane,
} from "../packages/host-runtime/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("brand tokens — dérivés du manifest (envPrefix), zéro hardcode historique", () => {
  const other = productHubTokensFromManifest(
    createAppManifest({
      brandId: "acmehub",
      productName: "Acme Hub",
      domain: "acmehub.example.test",
      envPrefix: "ACME",
      sandbox: true,
    }),
  );
  const db = productHubTokensFromManifest(demobrandManifest);

  assert.equal(other.n8nTagPrefix, "acmehub-plugin:");
  assert.equal(db.n8nTagPrefix, "demobrand-plugin:");

  assert.equal(other.grantTokenPrefix, "acme_exec_");
  assert.equal(db.grantTokenPrefix, "demobrand_exec_");

  assert.equal(other.executionGrantHeader, "x-acmehub-execution-grant");
  assert.equal(db.grantBypassEnvKey, "DEMOBRAND_PLUGIN_GRANT_BYPASS");
  assert.equal(other.grantBypassEnvKey, "ACME_PLUGIN_GRANT_BYPASS");
  assert.equal(other.controlPlaneServiceName, "acmehub-plugins-api");

  assert.ok(other.pluginsApiTokenEnvKeys.includes("ACME_PLUGINS_API_TOKEN"));
  assert.ok(!other.pluginsApiTokenEnvKeys.includes("TEMPOFLOW_PLUGINS_API_TOKEN"));
  assert.ok(other.pluginsDirEnvKeys.includes("ACME_PLUGINS_DIR"));
});

test("n8n tags génériques + troncature 24 car.", () => {
  const cv = productHubTokensFromManifest(
    createAppManifest({
      brandId: "acmehub",
      productName: "Acme Hub",
      domain: "acmehub.example.test",
      sandbox: true,
    }),
  );
  const shortId = "abcd";
  const short = pluginN8nTag(shortId, cv);
  assert.equal(short, "acmehub-plugin:abcd");
  assert.ok(short.length <= 24);

  const longId = "01234567-89ab-cdef-0123-456789abcdef";
  const long = pluginN8nTag(longId, cv);
  assert.ok(long.startsWith("acmehub-plugin:"));
  assert.equal(long.length, "acmehub-plugin:".length + 7);
  assert.ok(long.length <= 24);

  const db = pluginN8nTag(longId, demobrandManifest);
  assert.ok(db.startsWith("demobrand-plugin:"));
  assert.notEqual(db, long);
});

test("lifecycle + PRD sections + impact", () => {
  assert.equal(
    canTransitionPluginLifecycle("request_received", "impact_analysis"),
    true,
  );
  assert.throws(() =>
    assertPluginLifecycleTransition("cancelled", "planning"),
  );

  const missing = missingPrdSections({});
  assert.ok(missing.includes("user_stories"));
  assert.ok(missing.includes("wireframes"));

  const impact = buildPluginImpactReport({
    name: "Facturation clients",
    description: "module facturation",
    evidence: [
      {
        type: "plugin_manifest",
        pluginId: "billing",
        name: "Facturation",
        description: "module facturation clients",
      },
    ],
  });
  assert.equal(impact.recommendation, "evolve");
  assert.equal(impact.candidatePluginId, "billing");
});

test("memory store — request → PRD → validate → grant details", () => {
  const store = createMemoryProductHubStore({ conversationPrefix: "test" });
  const impact = buildPluginImpactReport({
    name: "Demo module",
    description: "nouveau",
  });
  const { product } = store.createRequest({
    name: "Demo module",
    description: "nouveau",
    impact,
  });
  assert.equal(product.lifecycle_state, "impact_analysis");
  assert.equal(product.decision, "create");

  const sections = {
    data_inputs: [{ data: "x", sourceEndpoint: "/api/x" }],
    data_outputs: [{ data: "y", destination: "ui" }],
    db_schema: [{ table: "t", columns: [{ name: "id" }] }],
    user_stories: ["En tant qu'user je vois le module"],
    screens: [{ name: "Home", kind: "single", description: "accueil" }],
    wireframes: [{ screen: "Home", ascii: "+---+" }],
  };
  const rev = store.savePrd({
    productId: product.id,
    problem: "Manque un module",
    users: "admins",
    scope: "CRUD simple",
    acceptanceCriteria: "tests verts",
    sections,
  });
  assert.equal(rev.version, 1);
  assert.equal(missingPrdSections(rev.sections_json).length, 0);

  store.validatePrd({
    productId: product.id,
    revisionId: rev.id,
    userId: "owner-1",
  });
  const after = store.getProduct(product.id);
  assert.equal(after.lifecycle_state, "planning");
  assert.equal(store.listTasks(product.id).length, 1);

  const details = store.productDetails(product.id);
  const grant = issueGrantFromProductDetails({
    details,
    productId: product.id,
    pluginId: "demo-mod",
    secret: "super-secret-token-16",
    tokenPrefix: "demobrand_exec_",
  });
  assert.equal(grant.ok, true);
  const verified = verifyPluginExecutionGrant({
    token: grant.token,
    secret: "super-secret-token-16",
    pluginId: "demo-mod",
    action: "create",
    tokenPrefix: "demobrand_exec_",
  });
  assert.equal(verified.ok, true);
});

test("ACL L3 org + L4 user fail-closed", () => {
  assert.equal(PLUGIN_ACL_LEVEL_ORG, "L3");
  assert.equal(PLUGIN_ACL_LEVEL_USER, "L4");

  const policy = {
    pluginId: "mod-a",
    allowedOrgIds: ["org-1"],
    allowedUserIds: ["user-2"],
    failClosed: true,
  };
  assert.equal(canActorSeePlugin(policy, { isOwner: true }), true);
  assert.equal(canActorSeePlugin(policy, { isServiceKey: true }), true);
  assert.equal(canActorSeePlugin(policy, { orgId: "org-1" }), true);
  assert.equal(canActorSeePlugin(policy, { userId: "user-2" }), true);
  assert.equal(canActorSeePlugin(policy, { userId: "user-9" }), false);
  assert.equal(canActorSeePlugin(policy, { orgId: "org-9" }), false);
  assert.equal(
    canActorSeePlugin(policy, { isOwner: true, isImpersonating: true }),
    false,
  );

  const visible = filterVisiblePluginIds(
    ["mod-a", "mod-b"],
    [policy],
    { userId: "user-2" },
  );
  assert.deepEqual(visible, ["mod-a"]);
  assert.ok(PRODUCT_HUB_ACL_ORG_SQL.includes("plugin_acl_org"));
  assert.ok(PRODUCT_HUB_CORE_SQL.includes("plugin_products"));
});

test("control plane HTTP — health + grant + create with brand headers", async () => {
  const tokens = productHubTokensFromManifest(demobrandManifest);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-ph-"));
  const pluginsDir = path.join(tmp, "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });

  const store = createMemoryProductHubStore();
  const impact = buildPluginImpactReport({ name: "X", description: "y" });
  const { product } = store.createRequest({ name: "X", description: "y", impact });
  const sections = {
    data_inputs: [{ data: "a", sourceEndpoint: "/a" }],
    data_outputs: [{ data: "b", destination: "ui" }],
    db_schema: [{ table: "t", columns: [{ name: "id" }] }],
    user_stories: ["story"],
    screens: [{ name: "S", kind: "single", description: "d" }],
    wireframes: [{ screen: "S", ascii: "+" }],
  };
  const rev = store.savePrd({
    productId: product.id,
    problem: "p",
    users: "u",
    scope: "s",
    acceptanceCriteria: "c",
    sections,
  });
  store.validatePrd({
    productId: product.id,
    revisionId: rev.id,
    userId: "u1",
  });

  const secret = "demobrand_plug_testsecrettoken99";
  const plane = await startPluginControlPlane({
    tokens,
    controlToken: secret,
    pluginsDir,
    adapters: {
      listStatus: () => ({ plugins: [], running: [] }),
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
      pluginDir: (id) => path.join(pluginsDir, id),
      fetchProductDetails: async (id) => store.productDetails(id) || null,
    },
  });

  const health = await fetch(`${plane.url}/v1/health`);
  const healthBody = await health.json();
  assert.equal(healthBody.service, "demobrand-plugins-api");
  assert.equal(healthBody.brandId, "demobrand");

  const grantRes = await fetch(
    `${plane.url}/v1/products/${product.id}/grant`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ plugin_id: "x-mod" }),
    },
  );
  const grantBody = await grantRes.json();
  assert.equal(grantRes.status, 200, JSON.stringify(grantBody));
  assert.ok(String(grantBody.execution_grant).startsWith("demobrand_exec_"));

  const createDenied = await fetch(`${plane.url}/v1/plugins`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: "x-mod", name: "X" }),
  });
  assert.equal(createDenied.status, 403);

  const createOk = await fetch(`${plane.url}/v1/plugins`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      [tokens.executionGrantHeader]: grantBody.execution_grant,
    },
    body: JSON.stringify({
      id: "x-mod",
      name: "X",
      execution_grant: grantBody.execution_grant,
    }),
  });
  const created = await createOk.json();
  assert.equal(createOk.status, 201, JSON.stringify(created));
  assert.ok(fs.existsSync(path.join(pluginsDir, "x-mod", ".product-hub-managed")));

  await plane.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("electron-shell bridge env brandé (pas TEMPOFLOW_)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-ctx-"));
  const ctx = {
    manifest: demobrandManifest,
    userDataDir: tmp,
    resourcesRoot: tmp,
    isPackaged: false,
  };
  const env = getPluginControlBridgeEnv(ctx, { controlPort: 18791 });
  assert.equal(env.PLUGINS_API_TOKEN?.startsWith("demobrand_plug_"), true);
  assert.ok(env.DEMOBRAND_PLUGINS_API_TOKEN);
  assert.ok(env.DEMOBRAND_PLUGINS_API_URL?.includes("18791"));
  assert.equal(env.TEMPOFLOW_PLUGINS_API_TOKEN, undefined);
  assert.equal(env.CERTIVAN_PLUGINS_API_TOKEN, undefined);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("host control plane + plugins host integration", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-host-ph-"));
  const ctx = {
    manifest: demobrandManifest,
    userDataDir: tmp,
    resourcesRoot: tmp,
    isPackaged: false,
  };
  const pluginsHost = createPluginsHost({ ctx });
  const store = createMemoryProductHubStore();
  const plane = await startHostPluginControlPlane({
    ctx,
    pluginsHost,
    productHubStore: store,
  });
  const r = await fetch(`${plane.url}/health`);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "demobrand-plugins-api");
  await plane.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("grant bypass headers brandés", () => {
  const tokens = productHubTokensFromManifest(demobrandManifest);
  const issued = issuePluginExecutionGrant({
    secret: "secret-secret-16chars",
    productId: "p1",
    prdRevisionId: "r1",
    pluginId: "plug-a",
    tokenPrefix: tokens.grantTokenPrefix,
  });
  const ok = requirePluginExecutionGrant({
    tokens,
    secret: "secret-secret-16chars",
    pluginId: "plug-a",
    action: "write",
    headers: { [tokens.executionGrantHeader]: issued.token },
  });
  assert.equal(ok.ok, true);

  const bypass = requirePluginExecutionGrant({
    tokens,
    secret: "secret-secret-16chars",
    pluginId: "plug-a",
    action: "create",
    headers: { [tokens.grantBypassHeader]: "admin-dev" },
    env: { [tokens.grantBypassEnvKey]: "1" },
  });
  assert.equal(bypass.ok, true);
});

test("vertical remaining + demobrand stub files", () => {
  assert.ok(!PLUGIN_VERTICAL_REMAINING.includes("plugin-control-api"));
  // N1 : runtime plugins (git/data/…) dans le kit — vertical = bindings + UI
  assert.ok(!PLUGIN_VERTICAL_REMAINING.includes("plugin-git"));
  assert.ok(PLUGIN_VERTICAL_REMAINING.includes("brand-plugin-host-bindings"));
  assert.ok(PLUGIN_VERTICAL_REMAINING.includes("admin-plugins-ui"));
  // H1.8 : store sqlite core livré dans le kit
  assert.ok(!PRODUCT_HUB_VERTICAL_REMAINING.includes("sqlite-product-hub-store"));
  assert.ok(!PRODUCT_HUB_VERTICAL_REMAINING.includes("admin-ui-plugins")); // N6 → product-hub/ui

  const stub = path.join(
    ROOT,
    "apps/demobrand/src/electron/product-hub-stub.ts",
  );
  assert.ok(fs.existsSync(stub));
  const src = fs.readFileSync(stub, "utf8");
  assert.ok(src.includes("@creezio/product-hub"));
  assert.ok(src.includes("createSqliteProductHubStore") || src.includes("createMemoryProductHubStore"));
  assert.ok(!src.includes("TEMPOFLOW_"));
  assert.ok(!src.includes("CERTIVAN_"));
});

test("requirePluginExecutionGrant refuse sans token", () => {
  const tokens = productHubTokensFromManifest(demobrandManifest);
  const denied = requirePluginExecutionGrant({
    tokens,
    secret: "secret-secret-16chars",
    pluginId: "x",
    action: "create",
    headers: {},
  });
  assert.equal(denied.ok, false);
  assert.ok(denied.hint.includes("Product Hub"));
});

// silence unused import warning if any
void http;
