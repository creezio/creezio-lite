/**
 * Phase V1 — fabrique plugins conversationnelle (demobrand E2E).
 * intention → analyse → PRD → scaffold → openPlugin → MCP → itération
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  PLUGIN_ACL_ORG_HEADER,
  createConversationalPluginFactory,
  createFsPluginScaffoldAdapters,
  createMemoryProductHubStore,
  decidePluginAccess,
  derivePluginIdentity,
  draftPrdFromIntention,
  needsClarification,
  slugifyPluginId,
} from "../packages/product-hub/dist/index.js";
import {
  createDenyUnauthorizedPluginToolPolicy,
  createMcpFacade,
  signMcpJwt,
} from "../packages/mcp-facade/dist/index.js";
import { createDemobrandSandbox } from "../apps/demobrand/build/electron/sandbox-runtime.js";

test("V1.1 slugify + draft PRD sections complètes", () => {
  const id = slugifyPluginId("Météo Cuisine!");
  assert.match(id, /^[a-z][a-z0-9-]{1,62}$/);
  const identity = derivePluginIdentity(
    "Je veux un plugin météo pour adapter mon menu du jour",
  );
  assert.ok(identity.name.length > 0);
  assert.ok(needsClarification("trop court"));
  assert.equal(
    needsClarification(
      "Je souhaite un générateur de recettes selon le stock frigo",
    ),
    false,
  );
  const draft = draftPrdFromIntention({
    name: "Meteo Menu",
    intention: "Adapter le menu selon la météo locale",
  });
  assert.ok(draft.sections?.user_stories?.length);
  assert.ok(draft.sections?.db_schema?.length);
});

test("V1.2 factory mémoire : intention → approve → materialize", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-v1-mem-"));
  const pluginsDir = path.join(tmp, "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });
  const store = createMemoryProductHubStore();
  const fsAdapters = createFsPluginScaffoldAdapters(pluginsDir);
  const factory = createConversationalPluginFactory({
    store,
    scaffoldPlugin: (i) => fsAdapters.scaffoldPlugin(i),
    writePluginFiles: (id, files) => fsAdapters.writePluginFiles(id, files),
    installRuntime: () => ({ dbOpened: true }),
  });

  let session = await factory.submitIntention({
    text: "Créer un plugin inventaire frigo pour suivre les denrées périssables",
    pluginId: "inventaire-frigo",
  });
  assert.equal(session.phase, "awaiting_approval");

  session = factory.approvePrd({
    productId: session.productId,
    userId: "u-test",
  });
  assert.equal(session.phase, "ready_to_materialize");

  const mat = await factory.materialize({
    productId: session.productId,
    actor: { isOwner: true, orgId: "org-a", userId: "u-test" },
    pluginId: "inventaire-frigo",
  });
  assert.equal(mat.ok, true);
  assert.equal(mat.pluginId, "inventaire-frigo");
  assert.ok(fs.existsSync(path.join(pluginsDir, "inventaire-frigo", "PRD.md")));
  assert.ok(
    fs.existsSync(path.join(pluginsDir, "inventaire-frigo", "manifest.json")),
  );
  assert.equal(mat.session.phase, "materialized");
  assert.equal(mat.session.product.lifecycle_state, "released");
});

test("V1.3 E2E demobrand : chat → DB plugin → MCP ACL → itération", async () => {
  const sandbox = createDemobrandSandbox();
  try {
    const factory = sandbox.pluginFactory;

    let session = await factory.submitIntention({
      text: "Je veux un module météo cuisine pour proposer des plats selon la météo",
      pluginId: "meteo-cuisine",
      name: "Météo Cuisine",
    });
    assert.equal(session.phase, "awaiting_approval", session.message);

    session = factory.approvePrd({
      productId: session.productId,
      userId: "demo-user",
    });

    const mat = await factory.materialize({
      productId: session.productId,
      actor: { isOwner: true, orgId: "org-a", userId: "demo-user" },
      pluginId: "meteo-cuisine",
    });
    assert.equal(mat.ok, true, mat.ok === false ? mat.error : "");
    assert.ok(sandbox.runtime.hasPluginOpen("meteo-cuisine"));
    assert.ok(sandbox.runtime.pluginFileExists("meteo-cuisine"));
    assert.ok(
      fs.existsSync(path.join(sandbox.pluginsDir, "meteo-cuisine", "index.js")),
    );

    const acl = sandbox.productHub.getAcl("meteo-cuisine");
    assert.equal(acl.ownerOrgId, "org-a");

    const kv = await sandbox.api.handle({
      method: "POST",
      path: "/api/v1/plugins/meteo-cuisine/kv",
      headers: {
        [PLUGIN_ACL_ORG_HEADER]: "org-a",
        "x-creezio-is-owner": "1",
      },
      body: { key: "city", value: "Lyon" },
    });
    assert.equal(kv.status, 201, JSON.stringify(kv.body));

    const secret = "v1-e2e-mcp";
    const mcp = createMcpFacade({
      jwtSecret: secret,
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

    const jwtA = signMcpJwt(secret, {
      sub: "u-a",
      orgId: "org-a",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const jwtB = signMcpJwt(secret, {
      sub: "u-b",
      orgId: "org-b",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const listedA = await mcp.listTools({
      bearerToken: jwtA,
      space: "plugin",
    });
    assert.ok(
      listedA.tools.some((t) => t.name === "plugin.meteo-cuisine.kv_list"),
    );

    const listedB = await mcp.listTools({
      bearerToken: jwtB,
      space: "plugin",
    });
    assert.ok(
      !listedB.tools.some((t) => t.name === "plugin.meteo-cuisine.kv_list"),
    );

    const apiSessions = await sandbox.api.handle({
      method: "GET",
      path: "/api/v1/modules/plugin-factory/sessions",
    });
    assert.equal(apiSessions.status, 200);
    assert.ok(Array.isArray(apiSessions.body.sessions));
    assert.ok(apiSessions.body.sessions.length >= 1);

    const iter = await factory.iterate({
      pluginId: "meteo-cuisine",
      text: "Ajouter aussi les alertes orage pour fermer la terrasse",
    });
    assert.equal(iter.phase, "awaiting_approval");
    assert.equal(iter.pluginId, "meteo-cuisine");
    assert.equal(iter.product.decision, "evolve");

    const mat2 = await factory.materialize({
      productId: iter.productId,
      actor: { isOwner: true, orgId: "org-a", userId: "demo-user" },
    });
    assert.equal(mat2.ok, true);
    assert.ok(mat2.filesWritten.includes("PRD.md"));

    const modTools = await sandbox.mcp.listTools({ space: "module" });
    assert.ok(
      modTools.tools.some((t) => t.name === "module.plugin-factory.submit"),
    );
  } finally {
    sandbox.close();
  }
});

test("V1.4 clarification path puis materialize", async () => {
  const sandbox = createDemobrandSandbox();
  try {
    let session = await sandbox.pluginFactory.submitIntention({
      text: "plugin stock",
      forceClarification: true,
      pluginId: "stock-rapide",
    });
    assert.equal(session.phase, "clarification_required");
    assert.ok(session.openClarification);

    session = await sandbox.pluginFactory.answerClarifications({
      productId: session.productId,
      clarificationId: session.openClarification.id,
      answers: {
        users: "cuisine",
        data_source: "notes brand",
        ui_kind: "tab",
      },
    });
    assert.equal(session.phase, "awaiting_approval");

    const mat = await sandbox.pluginFactory.materialize({
      productId: session.productId,
      actor: { isOwner: true, orgId: "org-sandbox", userId: "u1" },
      pluginId: "stock-rapide",
    });
    assert.equal(mat.ok, true);
    assert.ok(sandbox.runtime.hasPluginOpen("stock-rapide"));
  } finally {
    sandbox.close();
  }
});
