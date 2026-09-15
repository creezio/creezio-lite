/**
 * Phase C4 — V2/V3 prod-ready : SQLite obs/automations + console + docs.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAutomationEngine,
  createSqliteAutomationPersist,
  defaultDemobrandAutomationRules,
} from "../packages/automations/dist/index.js";
import { createSqliteObservabilityStore } from "../packages/observability/dist/index.js";
import { createDemobrandSandbox } from "../apps/demobrand/build/electron/sandbox-runtime.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("C4.1 automations SQLite — rules/runs survivent au reopen", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-c4-auto-"));
  const coreDbPath = path.join(tmp, "core.db");
  const persist1 = createSqliteAutomationPersist({ coreDbPath });
  const eng1 = createAutomationEngine({ persist: persist1 });
  for (const r of defaultDemobrandAutomationRules()) eng1.addRule(r);
  const runs = await eng1.dispatch({
    type: "factory.materialized",
    orgId: "org-a",
    pluginId: "p1",
  });
  assert.ok(runs.length >= 1);
  persist1.close();

  const persist2 = createSqliteAutomationPersist({ coreDbPath });
  const eng2 = createAutomationEngine({ persist: persist2 });
  assert.ok(eng2.listRules().length >= 3);
  assert.ok(eng2.listRuns(10).length >= 1);
  persist2.close();
});

test("C4.2 console sources SQLite (plus mémoire JSON seule)", () => {
  const obs = fs.readFileSync(
    path.join(root, "apps/console/src/lib/observability-console.ts"),
    "utf8",
  );
  assert.match(obs, /createSqliteObservabilityStore/);
  assert.doesNotMatch(obs, /createMemoryObservabilityStore/);
  const auto = fs.readFileSync(
    path.join(root, "apps/console/src/lib/automations-console.ts"),
    "utf8",
  );
  assert.match(auto, /createSqliteAutomationPersist/);
  assert.ok(
    fs.existsSync(path.join(root, "apps/console/src/app/api/automations/route.ts")),
  );
});

test("C4.3 demobrand automations persist + obs sqlite", async () => {
  const sandbox = createDemobrandSandbox();
  try {
    const before = sandbox.automations.listRules().length;
    assert.ok(before >= 1);
    await sandbox.automations.dispatch({
      type: "plugin.installed",
      orgId: "org-a",
      pluginId: "c4-demo",
    });
    assert.ok(sandbox.automations.listRuns(5).length >= 1);
    assert.ok(sandbox.observability.list({ limit: 20 }).length >= 1);
  } finally {
    sandbox.close();
  }
});

test("C4.4 docs PHASE-C4 + matrice V2/V3", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-C4.md"), "utf8");
  assert.match(phase, /Sign-off|TERMINÉE/i);
  assert.match(phase, /SQLite|vendor|TempoFlow|console/i);
  const matrice = fs.readFileSync(
    path.join(root, "docs/archive/MATRICE-NATIVE-METIER-PLUGIN.md"),
    "utf8",
  );
  assert.match(matrice, /C4/);
});

test("C4.5 observability sqlite reopen", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-c4-obs-"));
  const coreDbPath = path.join(tmp, "core.db");
  const a = createSqliteObservabilityStore({ coreDbPath });
  a.record({ kind: "activity", action: "c4", orgId: "o1", brandId: "x" });
  a.close();
  const b = createSqliteObservabilityStore({ coreDbPath });
  assert.ok(b.list({ limit: 10 }).some((e) => e.action === "c4"));
  b.close();
});
