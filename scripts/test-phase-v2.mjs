/**
 * Phase V2 — observabilité native (activité, usages plugins, control-plane).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createMemoryObservabilityStore,
  createSqliteObservabilityStore,
  recordActivity,
  recordControlPlaneEvent,
  recordPluginUsage,
} from "../packages/observability/dist/index.js";
import { createDemobrandSandbox } from "../apps/demobrand/build/electron/sandbox-runtime.js";
import { PLUGIN_ACL_ORG_HEADER } from "../packages/product-hub/dist/index.js";

test("V2.1 memory store + agrégats multi-org", () => {
  const store = createMemoryObservabilityStore();
  recordActivity(store, "login", { orgId: "org-a", userId: "u1" });
  recordActivity(store, "navigate", { orgId: "org-a", userId: "u1" });
  recordActivity(store, "login", { orgId: "org-b", userId: "u2" });
  recordPluginUsage(store, {
    pluginId: "meteo",
    actor: { orgId: "org-a" },
    action: "api.post",
  });
  recordPluginUsage(store, {
    pluginId: "meteo",
    actor: { orgId: "org-a" },
  });
  recordPluginUsage(store, {
    pluginId: "stock",
    actor: { orgId: "org-b" },
  });
  recordControlPlaneEvent(store, "install", {
    pluginId: "meteo",
    actor: { orgId: "org-a" },
  });

  assert.equal(store.count({ kind: "activity" }), 3);
  assert.equal(store.count({ orgId: "org-a" }), 5); // 2 act + 2 usage + 1 cp
  const orgs = store.aggregateOrgActivity();
  assert.ok(orgs.find((o) => o.orgId === "org-a" && o.count === 2));
  const usage = store.aggregatePluginUsage({ orgId: "org-a" });
  assert.equal(usage[0]?.pluginId, "meteo");
  assert.equal(usage[0]?.count, 2);
});

test("V2.2 sqlite store survit au reopen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-v2-obs-"));
  const dbPath = path.join(dir, "core.db");
  const a = createSqliteObservabilityStore({ coreDbPath: dbPath });
  recordControlPlaneEvent(a, "grant", {
    pluginId: "p1",
    actor: { orgId: "org-x" },
  });
  a.close();
  const b = createSqliteObservabilityStore({ coreDbPath: dbPath });
  assert.equal(b.count({ kind: "control_plane" }), 1);
  assert.equal(b.list({ pluginId: "p1" })[0]?.action, "grant");
  b.close();
});

test("V2.3 E2E demobrand : factory + API plugin → événements", async () => {
  const sandbox = createDemobrandSandbox();
  try {
    const session = await sandbox.pluginFactory.submitIntention({
      text: "Créer un plugin alertes stock pour la cuisine du restaurant",
      pluginId: "alertes-stock",
    });
    await sandbox.pluginFactory.materialize({
      productId: session.productId,
      actor: { isOwner: true, orgId: "org-a", userId: "u-obs" },
      pluginId: "alertes-stock",
    });

    const kv = await sandbox.api.handle({
      method: "POST",
      path: "/api/v1/plugins/alertes-stock/kv",
      headers: {
        [PLUGIN_ACL_ORG_HEADER]: "org-a",
        "x-creezio-is-owner": "1",
      },
      body: { key: "min", value: "5" },
    });
    assert.equal(kv.status, 201);

    const summary = await sandbox.api.handle({
      method: "GET",
      path: "/api/v1/platform/observability/summary",
    });
    assert.equal(summary.status, 200);
    assert.ok(summary.body.summary.activity >= 2);
    assert.ok(summary.body.summary.control_plane >= 1);
    assert.ok(summary.body.summary.plugin_usage >= 1);

    const usage = await sandbox.api.handle({
      method: "GET",
      path: "/api/v1/platform/observability/usage",
      query: { orgId: "org-a" },
    });
    assert.equal(usage.status, 200);
    assert.ok(
      usage.body.usage.some(
        (u) => u.pluginId === "alertes-stock" && u.count >= 1,
      ),
    );

    const orgs = await sandbox.api.handle({
      method: "GET",
      path: "/api/v1/platform/observability/orgs",
    });
    assert.equal(orgs.status, 200);
    assert.ok(orgs.body.orgs.some((o) => o.orgId === "org-a" || o.orgId === "org-sandbox"));

    const events = sandbox.observability.list({
      kind: "control_plane",
      pluginId: "alertes-stock",
    });
    assert.ok(events.some((e) => e.action === "install"));
  } finally {
    sandbox.close();
  }
});

test("V2.4 package + console sources présents", () => {
  const root = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
  );
  assert.ok(
    fs.existsSync(path.join(root, "packages/observability/package.json")),
  );
  assert.ok(
    fs.existsSync(
      path.join(root, "apps/console/src/app/api/observability/route.ts"),
    ),
  );
  assert.ok(
    fs.existsSync(
      path.join(root, "apps/console/src/components/ObservabilityPanel.tsx"),
    ),
  );
  assert.ok(fs.existsSync(path.join(root, "docs/archive/PHASE-V2.md")));
});
