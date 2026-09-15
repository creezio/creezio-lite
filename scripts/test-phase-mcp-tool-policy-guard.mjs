/**
 * Gate M1-M2 — garde d'enforcement réutilisable des policies MCP admin
 * (`packages/mcp-facade/src/admin/tool-policy-guard.ts`).
 *
 * Prouve, sur une DB réelle (node:sqlite in-memory, schéma admin kit) :
 *  - deny `tool_disabled` / `role_forbidden` / `policy_scope_forbidden` ;
 *  - audit écrit (mcp_audit_logs) sur les denies et les calls ;
 *  - rôle défaut ("collaborator") quand l'user est inconnu / non résolu ;
 *  - composition avec `denyCrossLayerToolCall` (premier deny gagne) ;
 *  - opt-in non cassant : sans `configureMcpAdmin`, la garde autorise tout ;
 *  - seed permissif (`seedMcpToolPolicies`) pour les tools hors registre ;
 *  - dé-hardcode rôles/scopes d'`updateMcpToolPolicy` via les adapters.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  checkToolPolicy,
  composeToolPolicies,
  configureMcpAdmin,
  createMcpFacade,
  createToolPolicyAuthorize,
  denyCrossLayerToolCall,
  ensureMcpAdminSchema,
  getStoredMcpToolPolicy,
  listMcpAuditLogs,
  registerGuardedMcpTool,
  resetMcpAdminAdaptersForTests,
  seedMcpToolPolicies,
  updateMcpToolPolicy,
} from "../packages/mcp-facade/dist/index.js";

const REGISTRY = [
  {
    name: "get_panier",
    category: "panier",
    access: "read",
    requiredScope: "crm:read",
  },
  {
    name: "create_ai_task",
    category: "taches",
    access: "write",
    requiredScope: "crm:write",
    defaultRoles: ["owner"],
  },
  // Parité brand-facade : op module sans opt-in publish (mcpPublishDefault
  // absent → generateModuleToolsFromOperations pose false) — seed enabled=0.
  {
    name: "module.catalog.status",
    category: "catalog",
    access: "read",
    requiredScope: "crm:read",
    mcpPublishDefault: false,
  },
  {
    name: "module.catalog.probe",
    category: "catalog",
    access: "read",
    requiredScope: "crm:read",
    mcpPublishDefault: false,
  },
];

const db = new DatabaseSync(":memory:");

function makeAdapters(extra = {}) {
  return {
    getDb: () => db,
    getWriteDb: () => db,
    tableExists: (name) =>
      Boolean(
        db
          .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
          .get(name),
      ),
    listTools: () => REGISTRY,
    mcpOauthReady: () => false,
    resolveMcpPublicUrl: () => null,
    ...extra,
  };
}

function facadeCtx(name, overrides = {}) {
  return {
    name,
    canonicalName: name,
    space: "module",
    args: {},
    isAlias: false,
    ...overrides,
  };
}

test("opt-in non cassant : sans adapters configurés, la garde autorise tout", async () => {
  resetMcpAdminAdaptersForTests();
  const authorize = createToolPolicyAuthorize();
  const decision = await authorize(facadeCtx("get_panier"));
  assert.deepEqual(decision, { allow: true });
});

test("schéma admin + seed policies depuis le registre adapters", () => {
  configureMcpAdmin(makeAdapters());
  ensureMcpAdminSchema();
  const panier = getStoredMcpToolPolicy("get_panier");
  assert.ok(panier, "policy get_panier seedée");
  assert.equal(panier.enabled, true);
  assert.deepEqual(panier.allowedRoles, ["owner", "collaborator"]);
  assert.deepEqual(panier.allowedScopes, ["crm:read"]);
  const aiTask = getStoredMcpToolPolicy("create_ai_task");
  assert.deepEqual(aiTask.allowedRoles, ["owner"], "defaultRoles respectés");
});

test("checkToolPolicy : tool_disabled / role_forbidden / policy_scope_forbidden", () => {
  // Tool inconnu (aucune policy) → tool_disabled.
  assert.equal(
    checkToolPolicy("tool_inexistant", { userId: null, scopes: "crm" }),
    "tool_disabled",
  );
  // Tool désactivé par l'admin → tool_disabled.
  updateMcpToolPolicy("get_panier", { enabled: false });
  assert.equal(
    checkToolPolicy("get_panier", { userId: "u1", scopes: "crm" }),
    "tool_disabled",
  );
  updateMcpToolPolicy("get_panier", { enabled: true });
  assert.equal(
    checkToolPolicy("get_panier", { userId: "u1", scopes: "crm" }),
    null,
  );
  // Rôle hors allowedRoles → role_forbidden (create_ai_task = owner only).
  assert.equal(
    checkToolPolicy(
      "create_ai_task",
      { userId: "u1", scopes: "crm" },
      { resolveRole: () => "collaborator" },
    ),
    "role_forbidden",
  );
  assert.equal(
    checkToolPolicy(
      "create_ai_task",
      { userId: "u1", scopes: "crm" },
      { resolveRole: () => "owner" },
    ),
    null,
  );
  // Scopes insuffisants → policy_scope_forbidden ; full access court-circuite.
  assert.equal(
    checkToolPolicy(
      "create_ai_task",
      { userId: "u1", scopes: "crm:read" },
      { resolveRole: () => "owner" },
    ),
    "policy_scope_forbidden",
  );
  assert.equal(
    checkToolPolicy(
      "create_ai_task",
      { userId: "u1", scopes: "full" },
      { resolveRole: () => "owner" },
    ),
    null,
  );
  // fullAccessScopes injectable.
  assert.equal(
    checkToolPolicy(
      "create_ai_task",
      { userId: "u1", scopes: "full" },
      { resolveRole: () => "owner", fullAccessScopes: ["super"] },
    ),
    "policy_scope_forbidden",
  );
  // scopes null/undefined = canal sans modèle de scopes → pas de vérif.
  assert.equal(
    checkToolPolicy(
      "create_ai_task",
      { userId: "u1" },
      { resolveRole: () => "owner" },
    ),
    null,
  );
});

test("rôle défaut quand user inconnu / non résolu", () => {
  // resolveRole ne trouve rien → défaut collaborator (autorisé sur get_panier).
  assert.equal(
    checkToolPolicy(
      "get_panier",
      { userId: "user-inconnu", scopes: "crm:read" },
      { resolveRole: () => undefined },
    ),
    null,
  );
  // … mais refusé sur un tool owner-only.
  assert.equal(
    checkToolPolicy(
      "create_ai_task",
      { userId: "user-inconnu", scopes: "crm" },
      { resolveRole: () => undefined },
    ),
    "role_forbidden",
  );
  // defaultRole injectable.
  assert.equal(
    checkToolPolicy(
      "create_ai_task",
      { userId: "user-inconnu", scopes: "crm" },
      { resolveRole: () => undefined, defaultRole: "owner" },
    ),
    null,
  );
});

test("composition avec denyCrossLayerToolCall (premier deny gagne)", async () => {
  const authorize = composeToolPolicies(
    denyCrossLayerToolCall,
    createToolPolicyAuthorize({ resolveRole: () => "owner" }),
  );
  // Échappement cross-layer : refusé AVANT la policy.
  const crossed = await authorize(
    facadeCtx("get_panier", { args: { path: "__cross/core/x" } }),
  );
  assert.equal(crossed.allow, false);
  assert.equal(crossed.reason, "cross_layer_denied");
  // Policy : tool inconnu → tool_disabled.
  const disabled = await authorize(
    facadeCtx("tool_inexistant", { claims: { scope: "crm" } }),
  );
  assert.equal(disabled.allow, false);
  assert.equal(disabled.reason, "tool_disabled");
  // Autorisé : policy OK et pas d'échappement.
  const ok = await authorize(
    facadeCtx("get_panier", { claims: { scope: "crm:read" } }),
  );
  assert.equal(ok.allow, true);
});

test("createToolPolicyAuthorize : fallback nom public quand le canonique n'a pas de policy", async () => {
  // Policy seedée sous le nom public (alias legacy) uniquement.
  const authorize = createToolPolicyAuthorize({ resolveRole: () => "owner" });
  const decision = await authorize(
    facadeCtx("get_panier", {
      canonicalName: "module.panier.get",
      isAlias: true,
      claims: { scope: "crm:read" },
    }),
  );
  assert.equal(decision.allow, true, "policy trouvée via le nom public");
});

test("audit écrit sur deny (authorize façade)", async () => {
  const before = listMcpAuditLogs(1000).length;
  const authorize = createToolPolicyAuthorize({ resolveRole: () => "owner" });
  const denied = await authorize(
    facadeCtx("tool_inexistant", { claims: { scope: "crm" } }),
  );
  assert.equal(denied.allow, false);
  const logs = listMcpAuditLogs(1000);
  assert.ok(logs.length > before, "une ligne d'audit ajoutée");
  const entry = logs.find(
    (log) => log.tool_name === "tool_inexistant" && log.outcome === "denied",
  );
  assert.ok(entry, "audit denied présent");
  assert.match(entry.detail_json, /tool_disabled/);
});

test("registerGuardedMcpTool : annotations + policy + scopes + audit", async () => {
  const def = {
    name: "create_ai_task",
    requiredScope: "crm:write",
    annotations: { readOnlyHint: false, destructiveHint: false },
  };
  const scopeAllows = (ctx) =>
    String(ctx.scopes || "")
      .split(/[\s,]+/)
      .some((scope) => ["crm", "crm:write"].includes(scope));

  const register = (ctx, opts) => {
    const tools = new Map();
    registerGuardedMcpTool(
      { registerTool: (name, config, handler) => tools.set(name, { config, handler }) },
      ctx,
      def,
      { description: "création tâche IA" },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
      { scopeAllows, ...opts },
    );
    return tools.get(def.name);
  };

  // Annotations posées sur la config SDK.
  const owner = register(
    { userId: "u1", clientId: "cli-1", scopes: "crm" },
    { resolveRole: () => "owner" },
  );
  assert.equal(owner.config.annotations.readOnlyHint, false);
  assert.equal(owner.config.description, "création tâche IA");

  // Succès : handler appelé, audit outcome=ok.
  const okResult = await owner.handler({});
  assert.ok(!okResult.isError);
  const okLog = listMcpAuditLogs(10).find(
    (log) => log.tool_name === def.name && log.outcome === "ok",
  );
  assert.ok(okLog, "audit ok écrit");
  assert.equal(okLog.actor, "u1");
  assert.equal(okLog.client_id, "cli-1");

  // Policy deny : rôle collaborator sur tool owner-only.
  const collab = register(
    { userId: "u2", scopes: "crm" },
    { resolveRole: () => "collaborator" },
  );
  const deniedResult = await collab.handler({});
  assert.equal(deniedResult.isError, true);
  assert.match(deniedResult.content[0].text, /role_forbidden/);
  const deniedLog = listMcpAuditLogs(10).find(
    (log) =>
      log.tool_name === def.name &&
      log.outcome === "denied" &&
      log.actor === "u2",
  );
  assert.ok(deniedLog, "audit denied écrit");

  // Scopes marque injectés : deny insufficient_scope APRÈS la policy.
  const scoped = register(
    { userId: "u1", scopes: "crm:read" },
    { resolveRole: () => "owner", fullAccessScopes: ["crm", "crm:read"] },
  );
  const scopedResult = await scoped.handler({});
  assert.equal(scopedResult.isError, true);
  assert.match(scopedResult.content[0].text, /insufficient_scope/);
  assert.match(scopedResult.content[0].text, /crm:write/);

  // Erreur handler : audit outcome=error, l'erreur remonte.
  const failing = new Map();
  registerGuardedMcpTool(
    { registerTool: (name, config, handler) => failing.set(name, handler) },
    { userId: "u1", scopes: "crm" },
    def,
    {},
    async () => {
      throw new Error("boom métier");
    },
    { resolveRole: () => "owner" },
  );
  await assert.rejects(() => failing.get(def.name)({}), /boom métier/);
  const errorLog = listMcpAuditLogs(10).find(
    (log) => log.tool_name === def.name && log.outcome === "error",
  );
  assert.ok(errorLog, "audit error écrit");
});

test("seedMcpToolPolicies : seed permissif des tools façade (INSERT OR IGNORE)", () => {
  seedMcpToolPolicies([{ name: "module.demo.ping" }]);
  const seeded = getStoredMcpToolPolicy("module.demo.ping");
  assert.ok(seeded, "policy créée");
  assert.equal(seeded.enabled, true);
  assert.deepEqual(seeded.allowedScopes, [], "aucune restriction de scope");
  // Permissif : passe quel que soit le scope présenté.
  assert.equal(
    checkToolPolicy("module.demo.ping", { userId: null, scopes: "" }),
    null,
  );
  // Ne modifie JAMAIS une policy existante.
  updateMcpToolPolicy("get_panier", { enabled: false });
  seedMcpToolPolicies([{ name: "get_panier" }]);
  assert.equal(getStoredMcpToolPolicy("get_panier").enabled, false);
  updateMcpToolPolicy("get_panier", { enabled: true });
});

test("updateMcpToolPolicy : rôles/scopes dé-hardcodés via adapters", () => {
  // Défauts historiques : un rôle exotique est filtré.
  let updated = updateMcpToolPolicy("get_panier", {
    allowedRoles: ["owner", "ai-agent"],
  });
  assert.deepEqual(updated.allowedRoles, ["owner"]);
  // Adapters marque : rôles/scopes custom acceptés.
  configureMcpAdmin(
    makeAdapters({
      policyRoleNames: ["owner", "collaborator", "ai-agent"],
      policyScopeNames: ["crm", "crm:read", "crm:write", "full", "search"],
    }),
  );
  updated = updateMcpToolPolicy("get_panier", {
    allowedRoles: ["owner", "ai-agent"],
    allowedScopes: ["crm:read", "search"],
  });
  assert.deepEqual(updated.allowedRoles, ["owner", "ai-agent"]);
  assert.deepEqual(updated.allowedScopes, ["crm:read", "search"]);
  // Restauration défauts (autres tests).
  configureMcpAdmin(makeAdapters());
  updateMcpToolPolicy("get_panier", {
    allowedRoles: ["owner", "collaborator"],
    allowedScopes: ["crm:read"],
  });
});

test("listTools masque enabled=0 ; callTool reste joignable", async () => {
  ensureMcpAdminSchema();
  seedMcpToolPolicies(REGISTRY);
  updateMcpToolPolicy("get_panier", { enabled: false });

  const mcp = createMcpFacade({
    allowUnauthenticated: true,
    aliases: { get_panier: "module.panier.get" },
    discoverToolsBySpace: async () => ({
      module: [
        {
          name: "module.panier.get",
          description: "État panier",
          space: "module",
          ownerId: "panier",
          handler: async () => ({ ok: true, content: { lignes: 1 } }),
        },
        {
          name: "module.panier.add_ligne",
          description: "Ajoute",
          space: "module",
          ownerId: "panier",
          handler: async () => ({ ok: true, content: {} }),
        },
      ],
    }),
  });

  const canon = await mcp.listTools({ publicSurface: "canonical" });
  const canonNames = canon.tools.map((t) => t.name);
  assert.ok(
    !canonNames.includes("module.panier.get"),
    "canonique masqué via alias disabled",
  );
  assert.ok(canonNames.includes("module.panier.add_ligne"));

  const both = await mcp.listTools({ publicSurface: "both" });
  const bothNames = both.tools.map((t) => t.name);
  assert.ok(!bothNames.includes("get_panier"), "alias disabled masqué");
  assert.ok(!bothNames.includes("module.panier.get"));

  const viaAlias = await mcp.callTool("get_panier", {});
  assert.equal(viaAlias.ok, true);
  assert.equal(viaAlias.content.lignes, 1);

  updateMcpToolPolicy("get_panier", { enabled: true });
});

test("listTools : seed par défaut enabled=0 ≠ désactivation admin (régression 0.17.1 TF3 catalog-import)", async () => {
  ensureMcpAdminSchema();
  seedMcpToolPolicies(REGISTRY);

  // Sémantique du seed verrouillée : mcpPublishDefault=false → enabled=0,
  // SANS admin_override (ce n'est pas une désactivation admin).
  const seeded = getStoredMcpToolPolicy("module.catalog.status");
  assert.ok(seeded, "policy seedée");
  assert.equal(seeded.enabled, false, "seed mcpPublishDefault=false → enabled=0");

  const mcp = createMcpFacade({
    allowUnauthenticated: true,
    discoverToolsBySpace: async () => ({
      module: [
        {
          name: "module.catalog.status",
          description: "Statut du catalogue distant",
          space: "module",
          ownerId: "catalog",
          mcpPublishDefault: false,
          handler: async () => ({ ok: true, content: { source_products: 42 } }),
        },
        {
          name: "module.catalog.probe",
          description: "Sonde catalogue",
          space: "module",
          ownerId: "catalog",
          mcpPublishDefault: false,
          handler: async () => ({ ok: true, content: {} }),
        },
      ],
    }),
  });

  // Régression 0.17.1 : ces tools disparaissaient de listTools/GET /mcp.
  const listed = await mcp.listTools();
  const names = listed.tools.map((t) => t.name);
  assert.ok(
    names.includes("module.catalog.status"),
    "tool à policy seedée par défaut listé",
  );
  const bySpace = await mcp.listToolsBySpace();
  assert.ok(
    bySpace.module.some((t) => t.name === "module.catalog.status"),
    "présent aussi via listToolsBySpace",
  );

  // … et exécutable au niveau façade.
  const res = await mcp.callTool("module.catalog.status", {});
  assert.equal(res.ok, true);
  assert.equal(res.content.source_products, 42);

  // Une édition rôles/scopes ne requalifie PAS le seed en désactivation admin.
  updateMcpToolPolicy("module.catalog.probe", { allowedRoles: ["owner"] });
  const afterRoles = await mcp.listTools();
  assert.ok(
    afterRoles.tools.some((t) => t.name === "module.catalog.probe"),
    "édition rôles seule → toujours listé",
  );

  // Désactivation admin EXPLICITE → masqué ; ré-activation → re-listé.
  updateMcpToolPolicy("module.catalog.status", { enabled: false });
  const afterDisable = await mcp.listTools();
  assert.ok(
    !afterDisable.tools.some((t) => t.name === "module.catalog.status"),
    "désactivation admin explicite masquée",
  );
  updateMcpToolPolicy("module.catalog.status", { enabled: true });
  const afterEnable = await mcp.listTools();
  assert.ok(
    afterEnable.tools.some((t) => t.name === "module.catalog.status"),
    "ré-activation admin re-liste",
  );
});
