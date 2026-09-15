#!/usr/bin/env node
/**
 * H1 « Hermes cerveau unique » — Hermes pilote le runner de tâches.
 *
 * - `upsertHermesMcpConfig` (electron-shell embed-sandbox) : bloc
 *   `mcp_servers.<brandId>` idempotent, config utilisateur préservée ;
 * - tools host tasks (`create_ai_task`…) branchés sur la façade MCP kit
 *   (`registerHermesHostMcpTools`, app-runtime) : listés, refusés sans
 *   acteur autorisé, acceptés avec la clé service Hermes (Bearer opaque
 *   résolu par `createApiKeyBearerActorResolver` → owner) ;
 * - pont JSON-RPC 2.0 `/mcp` (client MCP natif Hermes) ;
 * - câblage launcher/desktop/harness + skill seedé `creezio-computer-use`.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE_TMP = path.join(ROOT, ".tmp-gates");
fs.mkdirSync(GATE_TMP, { recursive: true });
const require = createRequire(import.meta.url);

/* ── HM.1 — bloc mcp_servers dans config.yaml Hermes ── */

test("HM.1 upsertHermesMcpConfig — idempotent, config user préservée", () => {
  const sandbox = require(
    path.join(
      ROOT,
      "packages/host-runtime/dist-cjs/sandbox/embed-sandbox.js",
    ),
  );
  const cfg = {
    serverName: "tempoflow3",
    url: "http://127.0.0.1:18791/mcp",
    bearerToken: "tf3_live_gatekey",
  };

  // Fichier vide → bloc complet.
  const fresh = sandbox.upsertHermesMcpConfig("", cfg);
  assert.match(fresh, /# BEGIN CREEZIO-MCP\n/);
  assert.match(fresh, /mcp_servers:/);
  assert.match(fresh, /tempoflow3:/);
  assert.match(fresh, /url: "http:\/\/127\.0\.0\.1:18791\/mcp"/);
  assert.match(fresh, /Authorization: "Bearer tf3_live_gatekey"/);
  assert.match(fresh, /skip_preflight: true/);
  assert.match(fresh, /# END CREEZIO-MCP\n/);

  // Idempotent : ré-appliquer ne duplique rien.
  const twice = sandbox.upsertHermesMcpConfig(fresh, cfg);
  assert.equal(twice, fresh);
  assert.equal((twice.match(/# BEGIN CREEZIO-MCP\n/g) || []).length, 1);

  // Rotation de clé : l'ancien Bearer disparaît.
  const rotated = sandbox.upsertHermesMcpConfig(fresh, {
    ...cfg,
    bearerToken: "tf3_live_rotated",
  });
  assert.match(rotated, /Bearer tf3_live_rotated/);
  assert.doesNotMatch(rotated, /Bearer tf3_live_gatekey/);

  // Config utilisateur hors bloc préservée (y compris son mcp_servers).
  const userYaml = [
    "model: hermes-4",
    "mcp_servers:",
    "  perso:",
    '    url: "http://exemple.test/mcp"',
    "",
  ].join("\n");
  const merged = sandbox.upsertHermesMcpConfig(userYaml, cfg);
  assert.match(merged, /model: hermes-4/);
  assert.match(merged, /perso:/);
  assert.match(merged, /http:\/\/exemple\.test\/mcp/);
  // Une seule clé racine mcp_servers (YAML valide) : entrée injectée DEDANS.
  assert.equal((merged.match(/^mcp_servers:/gm) || []).length, 1);
  assert.match(merged, /# BEGIN CREEZIO-MCP-ENTRY/);
  assert.match(merged, /tempoflow3:/);

  // cfg null → retrait propre (bloc + entrée), config user intacte.
  const cleaned = sandbox.upsertHermesMcpConfig(merged, null);
  assert.doesNotMatch(cleaned, /CREEZIO-MCP/);
  assert.doesNotMatch(cleaned, /tempoflow3:/);
  assert.match(cleaned, /perso:/);

  // Nom yaml-safe.
  assert.equal(sandbox.sanitizeHermesMcpServerName("Brand X!"), "brand_x");
  assert.equal(sandbox.sanitizeHermesMcpServerName(""), "crm");
});

/* ── HM.2/HM.3 — façade MCP + acteur + JSON-RPC ── */

async function setupFacadeWithBrandDb() {
  const tasks = await import(
    pathToFileURL(path.join(ROOT, "packages/tasks/dist/index.js")).href
  );
  const appRuntime = await import(
    pathToFileURL(path.join(ROOT, "packages/app-runtime/dist/index.js")).href
  );
  const mcpFacade = await import(
    pathToFileURL(path.join(ROOT, "packages/mcp-facade/dist/index.js")).href
  );
  const hist = await import(
    pathToFileURL(
      path.join(
        ROOT,
        "packages/platform-core/dist/historical-migrations/index.js",
      ),
    ).href
  );
  const Database = createRequire(
    path.join(ROOT, "packages/assistant/package.json"),
  )("better-sqlite3");

  const tmpDir = fs.mkdtempSync(path.join(GATE_TMP, "hermes-mcp-"));
  const dbPath = path.join(tmpDir, "brand.db");
  hist.runHistoricalMigrations(dbPath, { log: () => {} });
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, kind, permissions_json)
     VALUES
     ('owner-1', 'boss', 'x', 'owner', 'human', '[]'),
     ('ai-1', 'nova', 'x', 'collaborator', 'ai', '["nav.taches"]')`,
  ).run();

  // Clé CRM service Hermes (parité ensure-crm-key-db : user_id NULL, full).
  const hermesKey = "tf3_live_hermes_gate";
  db.prepare(
    `INSERT INTO api_keys (name, key_hash, prefix, scopes, user_id)
     VALUES ('Hermes (service)', ?, 'tf3_live_herme', 'full', NULL)`,
  ).run(crypto.createHash("sha256").update(hermesKey, "utf8").digest("hex"));
  // Clé restreinte (PAS mappée owner — fail-closed).
  const restrictedKey = "tf3_live_restricted_gate";
  db.prepare(
    `INSERT INTO api_keys (name, key_hash, prefix, scopes, user_id)
     VALUES ('Zapier', ?, 'tf3_live_restr', 'crm:read', NULL)`,
  ).run(
    crypto.createHash("sha256").update(restrictedKey, "utf8").digest("hex"),
  );

  const userRow = (id) => {
    const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    if (!row) return null;
    let permissions = [];
    try {
      permissions = JSON.parse(row.permissions_json || "[]");
    } catch {
      permissions = [];
    }
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      kind: row.kind,
      active: true,
      permissions,
    };
  };

  tasks.resetTasksBrandForTests();
  tasks.configureTasksBrand({
    productName: "HermesGate",
    productDomain: "hermes gate",
    hermesSourceLabel: "HermesGate",
    hermesSkill: "hermes-gate",
    envPrefix: "HGATE_AI",
    idempotencyPrefix: "crm",
    assistantIdempotencyPrefix: "asst",
    taskHref: "/taches",
    examplePaths: ["/taches"],
    db: {
      getWriteDb: () => db,
      queryAll: (sql, params = []) => db.prepare(sql).all(...params),
      queryOne: (sql, params = []) => db.prepare(sql).get(...params) ?? null,
      tableExists: (name) => {
        const row = db
          .prepare(
            `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?`,
          )
          .get(name);
        return Number(row?.c) > 0;
      },
    },
    users: {
      getById: (id) => userRow(id),
      list: () => ["owner-1", "ai-1"].map(userRow).filter(Boolean),
      getOwner: () => userRow("owner-1"),
      ready: () => true,
    },
    presence: { isDesktopOnline: () => false, listOnlineBridges: () => [] },
    workspace: {
      ensureOnHost: async () => ({}),
      navigate: async () => ({}),
      openTab: async () => ({}),
      listTabs: async () => ({}),
      webAction: async () => ({}),
      startScreencast: async () => ({}),
      stopScreencast: async () => ({}),
    },
    navigation: { permissionForPath: () => null, hasPermission: () => true },
    externalTabs: {
      resolve: () => ({ ok: false, error: "n/a" }),
      toWorkspaceParams: () => ({}),
    },
    screencast: { viewerCount: () => 0, subscribe: () => () => {} },
    auth: {
      getSessionFromContext: async () => null,
      sessionActorIsOwner: () => false,
      sessionIsImpersonating: () => false,
    },
  });

  const resolveBearerActor = appRuntime.createApiKeyBearerActorResolver({
    getBrandDb: () => db,
    getOwnerId: () => "owner-1",
  });
  const mcp = mcpFacade.createMcpFacade({
    allowUnauthenticated: true,
    brandId: "hermes-gate",
    resolveBearerActor,
  });
  const { registered } = appRuntime.registerHermesHostMcpTools({ mcp });

  const cleanup = () => {
    tasks.resetTasksBrandForTests();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };
  return { tasks, appRuntime, mcp, registered, hermesKey, restrictedKey, db, cleanup };
}

test("HM.2 façade MCP — tools host listés, gate acteur clé service", async () => {
  const ctx = await setupFacadeWithBrandDb();
  try {
    // Les tools H1 + H4 sont enregistrés (alias legacy-preferred → noms courts).
    const listed = await ctx.mcp.listTools();
    const names = listed.tools.map((t) => t.name);
    for (const expected of [
      "list_ai_collaborators",
      "create_ai_task",
      "get_ai_task",
      "get_ai_run_logs",
      "answer_ai_question",
      "workspace.open_tab",
      "workspace.web_read",
      "platform.ask_human",
      "platform.get_human_answer",
    ]) {
      assert.ok(names.includes(expected), `${expected} absent: ${names}`);
    }
    // Chaque tool expose un inputSchema objet (client MCP natif).
    const createDef = listed.tools.find((t) => t.name === "create_ai_task");
    assert.equal(createDef?.inputSchema?.type, "object");
    assert.ok(createDef?.inputSchema?.properties?.title);

    // Sans acteur → refus (façade allowUnauthenticated, gate owner du tool).
    const anon = await ctx.mcp.callTool("create_ai_task", {
      title: "Mission gate",
      launch: false,
    });
    assert.equal(anon.ok, false, JSON.stringify(anon));
    assert.match(String(anon.error), /Réservé au compte principal/);

    // Clé restreinte (crm:read, sans user) → PAS mappée owner (fail-closed).
    const restricted = await ctx.mcp.callTool(
      "create_ai_task",
      { title: "Mission gate", launch: false },
      { bearerToken: `Bearer ${ctx.restrictedKey}` },
    );
    assert.equal(restricted.ok, false, JSON.stringify(restricted));
    assert.match(String(restricted.error), /Réservé au compte principal/);

    // Clé CRM Hermes (full, sans user) → mappée owner → accepté.
    const accepted = await ctx.mcp.callTool(
      "create_ai_task",
      { title: "Mission gate Hermes", brief: "brief", launch: false },
      { bearerToken: `Bearer ${ctx.hermesKey}` },
    );
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    assert.equal(accepted.content?.ok, true);
    assert.ok(accepted.content?.task_id);
    const task = ctx.tasks.getTask(accepted.content.task_id);
    assert.ok(task);
    assert.equal(task.created_by, "owner-1");
    assert.equal(task.assignee_user_id, "ai-1");

    // Arguments invalides → erreur zod claire (pas de crash handler).
    const bad = await ctx.mcp.callTool(
      "create_ai_task",
      { launch: false },
      { bearerToken: `Bearer ${ctx.hermesKey}` },
    );
    assert.equal(bad.ok, false);
    assert.match(String(bad.error), /invalid_arguments/);
  } finally {
    ctx.cleanup();
  }
});

test("HM.3 pont JSON-RPC 2.0 /mcp — initialize, tools/list, tools/call", async () => {
  const ctx = await setupFacadeWithBrandDb();
  try {
    const { handleMcpJsonRpcRequest, isJsonRpcBody } = ctx.appRuntime;
    assert.equal(isJsonRpcBody({ jsonrpc: "2.0", id: 1, method: "ping" }), true);
    assert.equal(isJsonRpcBody({ name: "create_ai_task" }), false);

    const init = await handleMcpJsonRpcRequest({
      mcp: ctx.mcp,
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      },
    });
    assert.equal(init.status, 200);
    assert.equal(init.body.result.protocolVersion, "2025-03-26");
    assert.ok(init.body.result.serverInfo.name);

    // Notification (pas d'id) → 202 sans corps.
    const notif = await handleMcpJsonRpcRequest({
      mcp: ctx.mcp,
      body: { jsonrpc: "2.0", method: "notifications/initialized" },
    });
    assert.equal(notif.status, 202);
    assert.equal(notif.body, null);

    const list = await handleMcpJsonRpcRequest({
      mcp: ctx.mcp,
      body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
      bearerToken: `Bearer ${ctx.hermesKey}`,
    });
    assert.equal(list.status, 200);
    const names = list.body.result.tools.map((t) => t.name);
    assert.ok(names.includes("create_ai_task"), String(names));
    assert.ok(names.includes("workspace.open_tab"), String(names));

    const call = await handleMcpJsonRpcRequest({
      mcp: ctx.mcp,
      body: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "create_ai_task",
          arguments: { title: "Mission RPC", launch: false },
        },
      },
      bearerToken: `Bearer ${ctx.hermesKey}`,
    });
    assert.equal(call.status, 200);
    assert.equal(call.body.result.isError, false, JSON.stringify(call.body));
    assert.match(call.body.result.content[0].text, /task_id/);

    // Sans Bearer : tools/call retourne isError true (gate owner), pas de throw.
    const denied = await handleMcpJsonRpcRequest({
      mcp: ctx.mcp,
      body: {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "create_ai_task",
          arguments: { title: "x", launch: false },
        },
      },
    });
    assert.equal(denied.body.result.isError, true);

    const unknown = await handleMcpJsonRpcRequest({
      mcp: ctx.mcp,
      body: { jsonrpc: "2.0", id: 5, method: "resources/list" },
    });
    assert.equal(unknown.body.error.code, -32601);
  } finally {
    ctx.cleanup();
  }
});

/* ── HM.4 — câblage runtime + skill seedé ── */

test("HM.4 câblage launcher/desktop/harness + skill creezio-computer-use", () => {
  // Launcher Electron : écrit le bloc au boot + restart si bloc absent/périmé.
  const launcher = fs.readFileSync(
    path.join(ROOT, "packages/host-runtime/src/hermes/launcher.ts"),
    "utf8",
  );
  assert.match(launcher, /upsertHermesMcpConfig/);
  assert.match(launcher, /getHermesMcpServerConfig/);
  assert.match(launcher, /MCP_SERVERS/);

  // Config par défaut brand-host-runtime (clé CRM Hermes + URL loopback).
  const hostRuntime = fs.readFileSync(
    path.join(ROOT, "packages/host-runtime/src/brand-host-runtime.ts"),
    "utf8",
  );
  assert.match(hostRuntime, /getHermesMcpServerConfig/);
  assert.match(hostRuntime, /\/mcp/);

  // Harness serveur ET desktop : tools host + résolveur Bearer branchés.
  for (const file of [
    "packages/app-runtime/src/start-brand-kernel-harness.ts",
    "packages/app-runtime/src/start-brand-desktop.ts",
  ]) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(src, /registerHermesHostMcpTools/, file);
    assert.match(src, /createApiKeyBearerActorResolver/, file);
  }

  // /mcp parle JSON-RPC 2.0 (client MCP natif Hermes) sans casser le legacy.
  const http = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/src/listen-brand-os-http.ts"),
    "utf8",
  );
  assert.match(http, /isJsonRpcBody/);
  assert.match(http, /handleMcpJsonRpcRequest/);
  assert.match(http, /tool_name_required/); // transport legacy conservé

  // Skill kit seedé : routage missions clics → create_ai_task + suivi.
  const skill = fs.readFileSync(
    path.join(
      ROOT,
      "packages/host-runtime/resources/vendor/hermes-skills/creezio-computer-use/SKILL.md",
    ),
    "utf8",
  );
  assert.match(skill, /^name: creezio-computer-use$/m);
  assert.match(skill, /create_ai_task/);
  assert.match(skill, /get_ai_task/);
  assert.match(skill, /get_ai_run_logs/);
  assert.match(skill, /answer_ai_question/);
  assert.match(skill, /workspace\.open_tab/);
  assert.match(skill, /platform\.ask_human/);
  assert.match(skill, /creezio-site-skills/);
});
