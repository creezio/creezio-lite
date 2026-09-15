/**
 * Phase R2 — Product Hub SoT unique core.db.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PRODUCT_HUB_CORE_SQL,
  PRODUCT_HUB_RUNTIME_SQL,
  buildPluginImpactReport,
  createSqliteProductHubStore,
  issueGrantFromProductDetails,
  openNodeSqliteDatabase,
} from "../packages/product-hub/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("R2.1 package + docs PHASE-R2", () => {
  assert.ok(
    fs.existsSync(path.join(root, "packages/product-hub/package.json")),
  );
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-R2.md"), "utf8");
  assert.match(doc, /core\.db/);
  assert.match(doc, /PRODUCT_HUB_RUNTIME_SQL|split-brain|SoT/);
  assert.match(PRODUCT_HUB_CORE_SQL, /plugin_products/);
  assert.match(PRODUCT_HUB_RUNTIME_SQL, /plugin_documents/);
  assert.match(PRODUCT_HUB_RUNTIME_SQL, /plugin_test_runs/);
  assert.match(PRODUCT_HUB_RUNTIME_SQL, /plugin_changelog_entries/);
});

test("R2.2 store core : PRD + updateTask + details étendus + grant", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-r2-"));
  const corePath = path.join(tmp, "core.db");
  const store = createSqliteProductHubStore({
    coreDbPath: corePath,
    conversationPrefix: "tf2-crm",
    openDatabase: openNodeSqliteDatabase,
  });

  const impact = buildPluginImpactReport({
    name: "Générateur recettes",
    description: "recettes produits",
    evidence: [
      {
        type: "plugin_manifest",
        pluginId: "recipe-generator",
        name: "Générateur de recettes",
        description: "Génère des recettes depuis les produits",
      },
    ],
  });
  assert.equal(impact.recommendation, "evolve");

  const { product } = store.createRequest({
    name: "Générateur recettes produits",
    description: "Faire de nouvelles recettes avec les produits",
    impact,
  });
  assert.equal(product.conversation_id.startsWith("tf2-crm-"), true);
  assert.equal(product.plugin_id, "recipe-generator");

  store.transition(product.id, "prd_draft");
  store.transition(product.id, "awaiting_prd_approval");
  const revision = store.savePrd({
    productId: product.id,
    problem: "Temps perdu",
    users: "Chefs",
    scope: "Créer recettes",
    acceptanceCriteria: "Recette sauvegardée",
    sections: {
      data_inputs: [{ data: "Produits", sourceEndpoint: "GET /x" }],
      data_outputs: [{ data: "Recettes", destination: "Panel" }],
      db_schema: [{ table: "recettes", columns: [{ name: "id" }] }],
      user_stories: ["En tant que chef, je crée une recette."],
      screens: [{ name: "Recettes", kind: "single", description: "Liste" }],
      wireframes: [{ screen: "Recettes", ascii: "+" }],
    },
  });
  const validated = store.validatePrd({
    productId: product.id,
    revisionId: revision.id,
    userId: "owner-test",
  });
  assert.equal(validated.validated_by, "owner-test");

  const task = store.createTask({
    productId: product.id,
    title: "Formulaire",
    status: "ready",
  });
  const blocked = store.updateTask(product.id, task.id, {
    blocked: true,
    blockedReason: "API down",
  });
  assert.equal(blocked.blocked, 1);

  const details = store.productDetails(product.id);
  assert.ok(details);
  assert.ok(Array.isArray(details.documents));
  assert.ok(Array.isArray(details.changelog));
  assert.ok(Array.isArray(details.n8nResources));

  store.linkRuntime(product.id, "recipe-generator");
  const grant = issueGrantFromProductDetails({
    productId: product.id,
    details: store.productDetails(product.id),
    pluginId: "recipe-generator",
    secret: "test-secret-r2-not-production",
    tokenPrefix: "tf2_exec_",
  });
  assert.equal(grant.ok, true);
  if (grant.ok) assert.ok(grant.token.startsWith("tf2_exec_"));

  store.prepare(
    `INSERT INTO plugin_test_runs
     (id, plugin_product_id, status, exit_code, stdout, stderr, finished_at)
     VALUES (?, ?, 'passed', 0, '', '', datetime('now'))`,
  ).run("run-1", product.id);
  assert.equal(store.hasPassedTestRun(product.id), true);

  store.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
