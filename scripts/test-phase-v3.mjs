/**
 * Phase V3 — automations data-driven (triggers lifecycle / données).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  createAutomationEngine,
  defaultDemobrandAutomationRules,
  ruleMatches,
} from "../packages/automations/dist/index.js";
import { createDemobrandSandbox } from "../apps/demobrand/build/electron/sandbox-runtime.js";
import { PLUGIN_ACL_ORG_HEADER } from "../packages/product-hub/dist/index.js";

test("V3.1 ruleMatches filtres plugin/org/layer", () => {
  const rule = {
    id: "r1",
    name: "t",
    enabled: true,
    trigger: "org.data_changed",
    filter: { dataLayer: "plugin", orgId: "org-a" },
    actions: [{ type: "log" }],
    createdAt: new Date().toISOString(),
  };
  assert.equal(
    ruleMatches(rule, {
      type: "org.data_changed",
      orgId: "org-a",
      dataLayer: "plugin",
    }),
    true,
  );
  assert.equal(
    ruleMatches(rule, {
      type: "org.data_changed",
      orgId: "org-b",
      dataLayer: "plugin",
    }),
    false,
  );
  assert.equal(
    ruleMatches({ ...rule, enabled: false }, {
      type: "org.data_changed",
      orgId: "org-a",
      dataLayer: "plugin",
    }),
    false,
  );
});

test("V3.2 engine : install → emit_obs + n8n_tag_hint ; webhook skip sans URL", async () => {
  const emitted = [];
  const engine = createAutomationEngine({
    n8nTagPrefix: "demobrand-plugin:",
    emitObservability: (i) => emitted.push(i),
  });
  for (const r of defaultDemobrandAutomationRules()) engine.addRule(r);

  const runs = await engine.dispatch({
    type: "plugin.installed",
    orgId: "org-a",
    pluginId: "wx",
    brandId: "demobrand",
  });
  assert.ok(runs.length >= 1);
  assert.ok(runs[0].ok);
  const tagAction = runs[0].actions.find((a) => a.type === "n8n_tag_hint");
  assert.ok(tagAction?.ok);
  assert.match(String(tagAction.detail?.tag || ""), /^demobrand-plugin:/);
  assert.ok(emitted.some((e) => e.action === "automation.plugin_installed"));

  const dataRuns = await engine.dispatch({
    type: "org.data_changed",
    orgId: "org-a",
    pluginId: "wx",
    dataLayer: "plugin",
    payload: { key: "k", value: "v" },
  });
  assert.ok(dataRuns.length >= 1);
  const wh = dataRuns[0].actions.find((a) => a.type === "webhook");
  assert.equal(wh?.ok, true);
  assert.equal(wh?.detail?.skipped, true);
});

test("V3.3 E2E demobrand : factory + KV → automations + obs", async () => {
  const sandbox = createDemobrandSandbox();
  try {
    assert.ok(sandbox.automations.listRules().length >= 3);

    const session = await sandbox.pluginFactory.submitIntention({
      text: "Créer un plugin recettes express pour valoriser les restes",
      pluginId: "recettes-express",
    });
    const mat = await sandbox.pluginFactory.materialize({
      productId: session.productId,
      actor: { isOwner: true, orgId: "org-a", userId: "u-v3" },
      pluginId: "recettes-express",
    });
    assert.equal(mat.ok, true);

    const kv = await sandbox.api.handle({
      method: "POST",
      path: "/api/v1/plugins/recettes-express/kv",
      headers: {
        [PLUGIN_ACL_ORG_HEADER]: "org-a",
        "x-creezio-is-owner": "1",
      },
      body: { key: "restes", value: "tomates" },
    });
    assert.equal(kv.status, 201);

    // laisser les dispatches async void se terminer
    await new Promise((r) => setTimeout(r, 20));

    const runs = sandbox.automations.listRuns(20);
    assert.ok(runs.some((r) => r.trigger === "plugin.installed"));
    assert.ok(runs.some((r) => r.trigger === "factory.materialized"));
    assert.ok(runs.some((r) => r.trigger === "org.data_changed"));

    const autoObs = sandbox.observability.list({
      action: "automation.data_changed",
      limit: 10,
    });
    assert.ok(autoObs.length >= 1);

    const apiRules = await sandbox.api.handle({
      method: "GET",
      path: "/api/v1/platform/automations/rules",
    });
    assert.equal(apiRules.status, 200);
    assert.ok(apiRules.body.rules.length >= 3);

    const apiRuns = await sandbox.api.handle({
      method: "GET",
      path: "/api/v1/platform/automations/runs",
    });
    assert.equal(apiRuns.status, 200);
    assert.ok(apiRuns.body.runs.length >= 1);
  } finally {
    sandbox.close();
  }
});

test("V3.4 docs vision V1–V3 présents", () => {
  const root = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
  );
  assert.ok(fs.existsSync(path.join(root, "docs/archive/PHASE-V3.md")));
  assert.ok(fs.existsSync(path.join(root, "docs/archive/VISION-V1-V3.md")));
  assert.ok(
    fs.existsSync(path.join(root, "packages/automations/package.json")),
  );
});
