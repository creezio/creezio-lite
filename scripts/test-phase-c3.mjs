/**
 * Phase C3 — fabrique V1 réelle : scaffold riche, console SQLite, PrdDrafter.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildPluginScaffoldFiles,
  createConversationalPluginFactory,
  createFsPluginScaffoldAdapters,
  createOptionalLlmPrdDrafter,
  createSqliteProductHubStore,
  draftPrdFromIntention,
} from "../packages/product-hub/dist/index.js";
import { createDemobrandSandbox } from "../apps/demobrand/build/electron/sandbox-runtime.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("C3.1 scaffold réel — schema/api/mcp/start (pas console.log-only)", () => {
  const draft = draftPrdFromIntention({
    name: "Inventaire",
    intention: "Suivre le stock frigo périssable par zone",
  });
  const files = buildPluginScaffoldFiles({
    pluginId: "inventaire-frigo",
    name: "Inventaire",
    prd: {
      id: "r1",
      plugin_product_id: "p1",
      version: 1,
      problem: draft.problem,
      users: draft.users,
      scope: draft.scope,
      out_of_scope: draft.outOfScope || "",
      acceptance_criteria: draft.acceptanceCriteria,
      sections_json: JSON.stringify(draft.sections),
      validated_at: null,
      validated_by: null,
      created_at: new Date().toISOString(),
    },
  });
  for (const f of [
    "manifest.json",
    "package.json",
    "schema.sql",
    "index.js",
    "api.js",
    "mcp-tools.js",
    "README.md",
    "PRD.md",
  ]) {
    assert.ok(files[f], `missing ${f}`);
  }
  assert.match(files["schema.sql"], /CREATE TABLE IF NOT EXISTS plugin_kv/);
  assert.match(files["index.js"], /function start\(/);
  assert.match(files["index.js"], /function kvSet\(/);
  assert.doesNotMatch(
    files["index.js"].trim(),
    /^console\.log\("plugin .+ — fabrique V1"\);\s*$/m,
  );
  assert.ok(!files["index.js"].includes("fabrique V1"));
  assert.match(files["api.js"], /createApiMount/);
  assert.match(files["mcp-tools.js"], /createMcpTools/);
  assert.match(files["mcp-tools.js"], /\.kv_list/);
  assert.match(files["mcp-tools.js"], /plugin\./);
  const mf = JSON.parse(files["manifest.json"]);
  assert.equal(mf.creezio.factory, "c3");
});

test("C3.2 PrdDrafter LLM opt. — fallback déterministe + complete injecté", async () => {
  const fallback = createOptionalLlmPrdDrafter({ apiKey: null });
  const a = await fallback({
    name: "X",
    intention: "Plugin de suivi des livraisons quotidiennes",
  });
  assert.ok(a.problem.length > 0);
  assert.ok(a.sections?.user_stories?.length);

  const llm = createOptionalLlmPrdDrafter({
    complete: async () =>
      JSON.stringify({
        problem: "Livraisons en retard",
        users: "dispatch",
        scope: "Plugin livraisons",
        acceptanceCriteria: "Liste OK",
        sections: {
          user_stories: ["US LLM"],
          db_schema: [
            {
              table: "shipments",
              columns: [{ name: "ref", type: "TEXT" }],
            },
          ],
          data_inputs: [{ data: "ops", sourceEndpoint: "api" }],
          data_outputs: [{ data: "etat", destination: "plugin" }],
          screens: [
            { name: "Main", kind: "single", description: "vue" },
          ],
          wireframes: [{ screen: "Main", ascii: "+--+" }],
        },
      }),
  });
  const b = await llm({
    name: "Livraisons",
    intention: "Suivre les livraisons",
  });
  assert.equal(b.problem, "Livraisons en retard");
  assert.equal(b.users, "dispatch");
  assert.ok(
    (b.sections?.db_schema || []).some((t) => t.table === "shipments"),
  );
});

test("C3.3 console persist SQLite — reopen conserve sessions + fichiers plugin", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-c3-console-"));
  const coreDbPath = path.join(tmp, "console-core.db");
  const pluginsDir = path.join(tmp, "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });

  const store1 = createSqliteProductHubStore({
    coreDbPath,
    conversationPrefix: "console",
  });
  const fs1 = createFsPluginScaffoldAdapters(pluginsDir);
  const f1 = createConversationalPluginFactory({
    store: store1,
    draftPrd: createOptionalLlmPrdDrafter({ apiKey: null }),
    scaffoldPlugin: (i) => fs1.scaffoldPlugin(i),
    writePluginFiles: (id, files) => fs1.writePluginFiles(id, files),
    installRuntime: () => ({ dbOpened: true }),
  });
  let session = await f1.submitIntention({
    text: "Créer un plugin planning cuisine pour les services du midi",
    pluginId: "planning-cuisine",
    name: "Planning Cuisine",
  });
  assert.equal(session.phase, "awaiting_approval");
  session = f1.approvePrd({ productId: session.productId, userId: "ops" });
  const mat = await f1.materialize({
    productId: session.productId,
    actor: { isOwner: true, orgId: "org-console", userId: "ops" },
    pluginId: "planning-cuisine",
  });
  assert.equal(mat.ok, true);
  assert.ok(fs.existsSync(path.join(pluginsDir, "planning-cuisine", "schema.sql")));
  assert.ok(fs.existsSync(path.join(pluginsDir, "planning-cuisine", "api.js")));
  store1.close();

  const store2 = createSqliteProductHubStore({
    coreDbPath,
    conversationPrefix: "console",
  });
  const f2 = createConversationalPluginFactory({
    store: store2,
    scaffoldPlugin: (i) => fs1.scaffoldPlugin(i),
    writePluginFiles: (id, files) => fs1.writePluginFiles(id, files),
    installRuntime: () => ({ dbOpened: true }),
  });
  const sessions = f2.listSessions();
  assert.ok(sessions.length >= 1);
  assert.ok(sessions.some((s) => s.pluginId === "planning-cuisine"));
  assert.ok(
    sessions.some((s) => s.phase === "materialized" || s.product.lifecycle_state === "released"),
  );
  store2.close();
});

test("C3.4 demobrand E2E — scaffold C3 + MCP ACL", async () => {
  const sandbox = createDemobrandSandbox();
  try {
    let session = await sandbox.pluginFactory.submitIntention({
      text: "Je veux un plugin météo cuisine pour proposer des plats selon la météo",
      pluginId: "meteo-c3",
      name: "Météo C3",
    });
    assert.equal(session.phase, "awaiting_approval", session.message);
    session = sandbox.pluginFactory.approvePrd({
      productId: session.productId,
      userId: "demo-user",
    });
    const mat = await sandbox.pluginFactory.materialize({
      productId: session.productId,
      actor: { isOwner: true, orgId: "org-a", userId: "demo-user" },
      pluginId: "meteo-c3",
    });
    assert.equal(mat.ok, true);
    const dir = path.join(sandbox.pluginsDir, "meteo-c3");
    assert.ok(fs.existsSync(path.join(dir, "schema.sql")));
    assert.ok(fs.existsSync(path.join(dir, "api.js")));
    assert.ok(fs.existsSync(path.join(dir, "mcp-tools.js")));
    const indexJs = fs.readFileSync(path.join(dir, "index.js"), "utf8");
    assert.match(indexJs, /module\.exports/);
    assert.match(indexJs, /start\(/);
    assert.ok(sandbox.runtime.hasPluginOpen("meteo-c3"));
  } finally {
    sandbox.close();
  }
});

test("C3.5 docs PHASE-C3 + matrice fabrique plus 🟡 toy", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-C3.md"), "utf8");
  assert.match(phase, /Sign-off|TERMINÉE/i);
  assert.match(phase, /scaffold réel|PrdDrafter|console.*persist/i);
  const matrice = fs.readFileSync(
    path.join(root, "docs/archive/MATRICE-NATIVE-METIER-PLUGIN.md"),
    "utf8",
  );
  assert.match(matrice, /C3/);
  assert.doesNotMatch(
    matrice,
    /fabrique toy \(\*\*C3\*\*\)|scaffold stub, console mémoire\) — \*\*C3\*\*/,
  );
});
