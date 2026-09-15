/**
 * Phase I4 — control-plane unifié : helpers ACL + demobrand path.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { demobrandManifest } from "../packages/brand-config/dist/index.js";
import {
  PLUGIN_ACL_ORG_HEADER,
  buildPluginAclActorHeaders,
  createPluginControlPlaneAclFromStore,
  createSqliteProductHubStore,
  productHubTokensFromManifest,
  resolvePluginAclActorFromHeaders,
  startPluginControlPlane,
} from "../packages/product-hub/dist/index.js";
import { createDemobrandSandbox } from "../apps/demobrand/build/electron/sandbox-runtime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("I4 buildPluginAclActorHeaders round-trip", () => {
  const h = buildPluginAclActorHeaders({
    orgId: "org-x",
    userId: "u1",
    isOwner: true,
  });
  assert.equal(h[PLUGIN_ACL_ORG_HEADER], "org-x");
  assert.equal(h["x-creezio-user-id"], "u1");
  assert.equal(h["x-creezio-is-owner"], "1");
  const actor = resolvePluginAclActorFromHeaders(h);
  assert.equal(actor.orgId, "org-x");
  assert.equal(actor.isOwner, true);
});

test("I4 createPluginControlPlaneAclFromStore bind/clear", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-i4-acl-"));
  const store = createSqliteProductHubStore({
    coreDbPath: path.join(dir, "core.db"),
  });
  const acl = createPluginControlPlaneAclFromStore({
    store,
    fallbackOwnerOrgId: "org-fb",
  });
  acl.onInstalled?.("plug-1", { orgId: "org-a", userId: "u1" });
  assert.equal(store.getPluginOwnerOrg("plug-1"), "org-a");
  assert.deepEqual(store.getAcl("plug-1").orgIds, ["org-a"]);
  acl.onUninstalled?.("plug-1");
  assert.equal(store.getPluginOwnerOrg("plug-1"), null);
  store.close();
});

test("I4 demobrand controlPlaneAcl + E2E install owner", async () => {
  const sandbox = createDemobrandSandbox();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-i4-pc-"));
  const pluginsDir = path.join(tmp, "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });
  const secret = "demobrand_plug_i4secrettoken99";
  process.env.DEMOBRAND_PLUGIN_GRANT_BYPASS = "1";

  try {
    const plane = await startPluginControlPlane({
      tokens: productHubTokensFromManifest(demobrandManifest),
      controlToken: secret,
      pluginsDir,
      acl: sandbox.controlPlaneAcl(),
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
          if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
          return { ok: true, deleted: id };
        },
        pluginDir: (id) => path.join(pluginsDir, id),
      },
    });

    const deny = await fetch(`${plane.url}/v1/plugins`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        ...sandbox.actorHeaders({ orgId: "org-a", userId: "u1" }),
        "x-demobrand-grant-bypass": "admin-dev",
      },
      body: JSON.stringify({ id: "i4-demo", name: "I4" }),
    });
    assert.equal(deny.status, 403);

    const ok = await fetch(`${plane.url}/v1/plugins`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        ...sandbox.actorHeaders({
          orgId: "org-a",
          userId: "u1",
          isOwner: true,
        }),
        "x-demobrand-grant-bypass": "admin-dev",
      },
      body: JSON.stringify({ id: "i4-demo", name: "I4" }),
    });
    assert.equal(ok.status, 201, await ok.text());
    assert.ok(sandbox.runtime.hasPluginOpen("i4-demo"));
    assert.equal(sandbox.productHub.getAcl("i4-demo").ownerOrgId, "org-a");

    await plane.close();
  } finally {
    delete process.env.DEMOBRAND_PLUGIN_GRANT_BYPASS;
    sandbox.close();
  }
});

test("I4 docs migration présents", () => {
  assert.ok(
    fs.existsSync(path.join(ROOT, "docs/archive/CONTROL-PLANE-BRAND-MIGRATION.md")),
  );
  assert.ok(fs.existsSync(path.join(ROOT, "docs/archive/PHASE-I4.md")));
  const mig = fs.readFileSync(
    path.join(ROOT, "docs/archive/CONTROL-PLANE-BRAND-MIGRATION.md"),
    "utf8",
  );
  assert.match(mig, /startHostPluginControlPlane/);
  assert.match(mig, /createPluginControlPlaneAclFromStore/);
});
