/**
 * Phase I5 — Admin Plugins L3 : upsert caps + deny cross-org (API = UI).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PLUGIN_ACL_ORG_HEADER,
  upsertPluginAclAdmin,
  previewPluginAclAccess,
} from "../packages/product-hub/dist/index.js";
import { createDemobrandSandbox } from "../apps/demobrand/build/electron/sandbox-runtime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("I5 upsertPluginAclAdmin + preview deny cross-org", () => {
  const sandbox = createDemobrandSandbox();
  try {
    upsertPluginAclAdmin(sandbox.productHub, {
      pluginId: "weather-demo",
      ownerOrgId: "org-a",
      orgIds: ["org-a"],
      orgCapabilities: [
        { orgId: "org-a", capabilities: ["see", "execute"] },
      ],
    });
    const deny = previewPluginAclAccess(
      sandbox.productHub,
      "weather-demo",
      { orgId: "org-b", userId: "u-b" },
      "see",
    );
    assert.equal(deny.allow, false);
    assert.match(String(deny.reason || ""), /cross_org|denied|org/i);

    const allow = previewPluginAclAccess(
      sandbox.productHub,
      "weather-demo",
      { orgId: "org-a", userId: "u-a" },
      "see",
    );
    assert.equal(allow.allow, true);
  } finally {
    sandbox.close();
  }
});

test("I5 admin-plugins API mount E2E (parcours UI)", async () => {
  const sandbox = createDemobrandSandbox();
  try {
    const upsert = await sandbox.api.handle({
      method: "POST",
      path: "/api/v1/modules/admin-plugins/upsert",
      headers: { "x-creezio-is-owner": "1" },
      body: {
        pluginId: "wx-admin",
        ownerOrgId: "org-a",
        orgIds: ["org-a"],
        orgCapabilities: [
          { orgId: "org-a", capabilities: ["see", "install", "execute"] },
        ],
      },
    });
    assert.equal(upsert.status, 200, JSON.stringify(upsert.body));

    const list = await sandbox.api.handle({
      method: "GET",
      path: "/api/v1/modules/admin-plugins/list",
    });
    assert.ok(list.body.plugins.some((p) => p.pluginId === "wx-admin"));

    const deny = await sandbox.api.handle({
      method: "POST",
      path: "/api/v1/modules/admin-plugins/preview",
      headers: { [PLUGIN_ACL_ORG_HEADER]: "org-b" },
      body: { pluginId: "wx-admin", action: "execute" },
    });
    assert.equal(deny.body.decision.allow, false);

    const allow = await sandbox.api.handle({
      method: "POST",
      path: "/api/v1/modules/admin-plugins/preview",
      headers: { [PLUGIN_ACL_ORG_HEADER]: "org-a" },
      body: { pluginId: "wx-admin", action: "execute" },
    });
    assert.equal(allow.body.decision.allow, true);

    const forbidden = await sandbox.api.handle({
      method: "POST",
      path: "/api/v1/modules/admin-plugins/upsert",
      headers: { [PLUGIN_ACL_ORG_HEADER]: "org-a" },
      body: { pluginId: "x", ownerOrgId: "org-a" },
    });
    assert.equal(forbidden.status, 403);
  } finally {
    sandbox.close();
  }
});

test("I5 UI files présents", () => {
  for (const p of [
    "apps/demobrand/resources/renderer/admin-plugins.html",
    "apps/demobrand/resources/renderer/admin-plugins.js",
    "docs/archive/PHASE-I5.md",
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), p);
  }
  const html = fs.readFileSync(
    path.join(ROOT, "apps/demobrand/resources/renderer/admin-plugins.html"),
    "utf8",
  );
  assert.match(html, /see/);
  assert.match(html, /install/);
  assert.match(html, /execute/);
});
