#!/usr/bin/env node
/**
 * H3/H4 « Hermes cerveau unique » — verbes navigateur directs + HITL async
 * + skills sites auto-entretenus.
 *
 * - via la façade MCP : `workspace.open_tab` ouvre un onglet (workspace
 *   mocké comme les gates tasks), `workspace.web_read` retourne du contenu,
 *   refus hors allowlist, refus sans acteur, `ai_user_id` obligatoire ;
 * - `platform.ask_human` crée un run HITL détaché (kanban) et
 *   `platform.get_human_answer` relève la réponse posée par le canal humain
 *   existant (`answer_ai_question`) puis clôt run + tâche ;
 * - H3 : le seed refuse un skill vendor `site-*` — un skill site appris
 *   préexistant survit à un boot/seed ; skill `creezio-site-skills` présent.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE_TMP = path.join(ROOT, ".tmp-gates");
fs.mkdirSync(GATE_TMP, { recursive: true });
const require = createRequire(import.meta.url);

const ALLOWLIST_ENV = "HGCU_AI_WEB_ALLOWED_HOSTS";

async function setup() {
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

  const tmpDir = fs.mkdtempSync(path.join(GATE_TMP, "hermes-cu-"));
  const dbPath = path.join(tmpDir, "brand.db");
  hist.runHistoricalMigrations(dbPath, { log: () => {} });
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, kind, permissions_json)
     VALUES
     ('owner-1', 'boss', 'x', 'owner', 'human', '[]'),
     ('ai-1', 'nova', 'x', 'collaborator', 'ai', '["nav.taches"]')`,
  ).run();
  const hermesKey = "cu_live_hermes_gate";
  db.prepare(
    `INSERT INTO api_keys (name, key_hash, prefix, scopes, user_id)
     VALUES ('Hermes (service)', ?, 'cu_live_hermes', 'full', NULL)`,
  ).run(crypto.createHash("sha256").update(hermesKey, "utf8").digest("hex"));

  const userRow = (id) => {
    const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      kind: row.kind,
      active: true,
      permissions: [],
    };
  };

  // Workspace mocké (sidecar de test) : enregistre les appels, répond comme
  // le host (open_tab → tabId ; external_read → texte de page).
  const calls = { openTab: [], webAction: [], ensure: [] };
  const workspace = {
    ensureOnHost: async (args) => {
      calls.ensure.push(args);
      return { ok: true };
    },
    navigate: async () => ({ ok: true }),
    openTab: async (args) => {
      calls.openTab.push(args);
      return { ok: true, tab: { id: "tab-gate-1", url: args?.params?.url } };
    },
    listTabs: async () => ({
      ok: true,
      tabs: [{ id: "tab-gate-1", url: "https://www.fournisseur.fr/panier" }],
    }),
    webAction: async (args) => {
      calls.webAction.push(args);
      if (args.webType === "external_read") {
        return {
          ok: true,
          tabId: args.tabId || "tab-gate-1",
          text: "CONTENU-GATE tarif 12,50 € — panier fournisseur",
        };
      }
      return { ok: true, tabId: args.tabId || "tab-gate-1" };
    },
    startScreencast: async () => ({}),
    stopScreencast: async () => ({}),
  };

  tasks.resetTasksBrandForTests();
  tasks.configureTasksBrand({
    productName: "HermesCuGate",
    productDomain: "hermes cu gate",
    hermesSourceLabel: "HermesCuGate",
    hermesSkill: "hermes-cu-gate",
    envPrefix: "HGCU_AI",
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
    presence: {
      isDesktopOnline: (id) => id === "owner-1",
      listOnlineBridges: () => [
        { userId: "owner-1", online: true, bridgeConnected: true },
      ],
    },
    workspace,
    navigation: { permissionForPath: () => null, hasPermission: () => true },
    externalTabs: {
      resolve: (input) =>
        /^https?:\/\//i.test(String(input?.url || ""))
          ? { ok: true, url: input.url, title: input.title || null }
          : { ok: false, error: "URL invalide" },
      toWorkspaceParams: (p) => ({ url: p.url, title: p.title }),
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
    brandId: "hermes-cu-gate",
    resolveBearerActor,
  });
  appRuntime.registerHermesHostMcpTools({ mcp });

  const cleanup = () => {
    tasks.resetTasksBrandForTests();
    delete process.env[ALLOWLIST_ENV];
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };
  return { tasks, mcp, hermesKey, calls, db, cleanup };
}

const bearer = (ctx) => ({ bearerToken: `Bearer ${ctx.hermesKey}` });

test("CU.1 workspace.open_tab + web_read via façade (allowlist, acteur, ai_user_id)", async () => {
  const ctx = await setup();
  try {
    process.env[ALLOWLIST_ENV] = "fournisseur.fr";

    // Sans acteur → refus (gate owner/service).
    const anon = await ctx.mcp.callTool("workspace.open_tab", {
      ai_user_id: "ai-1",
      url: "https://www.fournisseur.fr/login",
    });
    assert.equal(anon.ok, false);
    assert.match(String(anon.error), /Réservé au compte principal/);
    assert.equal(ctx.calls.openTab.length, 0);

    // ai_user_id obligatoire (schéma zod).
    const noAi = await ctx.mcp.callTool(
      "workspace.open_tab",
      { url: "https://www.fournisseur.fr/login" },
      bearer(ctx),
    );
    assert.equal(noAi.ok, false);
    assert.match(String(noAi.error), /invalid_arguments/);

    // Hors allowlist → refus AVANT le workspace (garde runner du wrapper).
    const outside = await ctx.mcp.callTool(
      "workspace.open_tab",
      { ai_user_id: "ai-1", url: "https://evil.example/login" },
      bearer(ctx),
    );
    assert.equal(outside.ok, false, JSON.stringify(outside));
    assert.match(String(outside.error), /allowlist|evil\.example/);
    assert.equal(ctx.calls.openTab.length, 0);

    // Collaborateur IA inconnu → refus clair.
    const badAi = await ctx.mcp.callTool(
      "workspace.open_tab",
      { ai_user_id: "ai-inconnu", url: "https://www.fournisseur.fr/login" },
      bearer(ctx),
    );
    assert.equal(badAi.ok, false);
    assert.match(String(badAi.error), /introuvable ou inactif/);

    // Autorisé → onglet ouvert dans le workspace du collaborateur IA.
    const opened = await ctx.mcp.callTool(
      "workspace.open_tab",
      { ai_user_id: "ai-1", url: "https://www.fournisseur.fr/login" },
      bearer(ctx),
    );
    assert.equal(opened.ok, true, JSON.stringify(opened));
    assert.equal(opened.content?.tab?.id, "tab-gate-1");
    assert.equal(ctx.calls.openTab.length, 1);
    assert.equal(ctx.calls.openTab[0].aiUserId, "ai-1");
    assert.equal(ctx.calls.openTab[0].hostUserId, "owner-1");

    // web_read retourne le contenu de la page.
    const read = await ctx.mcp.callTool(
      "workspace.web_read",
      { ai_user_id: "ai-1", q: "tarif" },
      bearer(ctx),
    );
    assert.equal(read.ok, true, JSON.stringify(read));
    assert.match(String(read.content?.text), /CONTENU-GATE/);
    assert.equal(
      ctx.calls.webAction.at(-1)?.webType,
      "external_read",
    );

    // list_tabs liste l'onglet.
    const tabs = await ctx.mcp.callTool(
      "workspace.list_tabs",
      { ai_user_id: "ai-1" },
      bearer(ctx),
    );
    assert.equal(tabs.ok, true);
    assert.equal(tabs.content?.tabs?.[0]?.id, "tab-gate-1");

    // Verbe d'action (web_click) route le bon webType.
    const click = await ctx.mcp.callTool(
      "workspace.web_click",
      { ai_user_id: "ai-1", ref: "s1-3" },
      bearer(ctx),
    );
    assert.equal(click.ok, true);
    assert.equal(ctx.calls.webAction.at(-1)?.webType, "external_click");
    assert.equal(ctx.calls.webAction.at(-1)?.params?.ref, "s1-3");
  } finally {
    ctx.cleanup();
  }
});

test("CU.2 HITL async — platform.ask_human / get_human_answer (canal humain existant)", async () => {
  const ctx = await setup();
  try {
    const asked = await ctx.mcp.callTool(
      "platform.ask_human",
      {
        ai_user_id: "ai-1",
        question: "Quel budget max pour la commande fournisseur ?",
      },
      bearer(ctx),
    );
    assert.equal(asked.ok, true, JSON.stringify(asked));
    const runId = asked.content?.run_id;
    const taskId = asked.content?.task_id;
    assert.ok(runId && taskId);

    // Le run est visible côté kanban : running + hitl_prompt (attente humain).
    const run = ctx.tasks.getTaskRun(runId);
    assert.equal(run.status, "running");
    assert.match(String(run.hitl_prompt), /budget max/);

    // Pas encore de réponse → pending.
    const pending = await ctx.mcp.callTool(
      "platform.get_human_answer",
      { run_id: runId },
      bearer(ctx),
    );
    assert.equal(pending.ok, true);
    assert.equal(pending.content?.answered, false);
    assert.equal(pending.content?.pending, true);

    // L'humain répond par le canal EXISTANT (answer_ai_question / kanban).
    const answered = await ctx.mcp.callTool(
      "answer_ai_question",
      { run_id: runId, response: "Budget max : 450 € TTC" },
      bearer(ctx),
    );
    assert.equal(answered.ok, true, JSON.stringify(answered));

    // Le poll relève la réponse et clôt run + tâche.
    const got = await ctx.mcp.callTool(
      "platform.get_human_answer",
      { run_id: runId },
      bearer(ctx),
    );
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.equal(got.content?.answered, true);
    assert.match(String(got.content?.response), /450 €/);
    assert.equal(ctx.tasks.getTaskRun(runId).status, "succeeded");
    assert.equal(ctx.tasks.getTask(taskId).status, "done");

    // Sans acteur → refus.
    const anon = await ctx.mcp.callTool("platform.get_human_answer", {
      run_id: runId,
    });
    assert.equal(anon.ok, false);
  } finally {
    ctx.cleanup();
  }
});

test("CU.3 H3 skills — namespace site-* réservé, skill appris survit au seed", () => {
  const seed = require(
    path.join(
      ROOT,
      "packages/host-runtime/dist-cjs/hermes/skills-seed.js",
    ),
  );
  assert.equal(seed.LEARNED_SITE_SKILL_PREFIX, "site-");
  assert.equal(seed.isLearnedSiteSkillName("site-metro-fr"), true);
  assert.equal(seed.isLearnedSiteSkillName("SITE-METRO-FR"), true);
  assert.equal(seed.isLearnedSiteSkillName("creezio-plugins"), false);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-skills-gate-"));
  try {
    const home = path.join(tmp, "hermes-home");
    const vendor = path.join(tmp, "vendor-skills");
    // Vendor légitime + vendor MALVEILLANT qui tente de shipper un site-*.
    for (const [name, body] of [
      ["brand-context", "# contexte marque"],
      ["site-metro-fr", "# TENTATIVE VENDOR — ne doit jamais être seedé"],
    ]) {
      fs.mkdirSync(path.join(vendor, name), { recursive: true });
      fs.writeFileSync(path.join(vendor, name, "SKILL.md"), body);
    }
    // Skill site APPRIS préexistant (posé par Hermes lors d'un run).
    const learned = path.join(home, "skills", "site-metro-fr");
    fs.mkdirSync(learned, { recursive: true });
    fs.writeFileSync(
      path.join(learned, "SKILL.md"),
      "---\nname: site-metro-fr\n---\n# APPRIS PAR HERMES — sélecteurs vérifiés\n",
    );

    // Boot 1 + boot 2 (idempotence).
    for (let i = 0; i < 2; i += 1) {
      seed.seedHermesSkillsFromDirs({
        hermesHome: home,
        dirs: [vendor],
        log: () => {},
      });
    }

    const learnedBody = fs.readFileSync(path.join(learned, "SKILL.md"), "utf8");
    assert.match(learnedBody, /APPRIS PAR HERMES/);
    assert.doesNotMatch(learnedBody, /TENTATIVE VENDOR/);
    assert.ok(
      fs.existsSync(path.join(home, "skills", "brand-context", "SKILL.md")),
      "le skill vendor légitime doit être seedé",
    );

    // Refus tracé dans le seed (source) : assertion sur le code.
    const src = fs.readFileSync(
      path.join(ROOT, "packages/host-runtime/src/hermes/skills-seed.ts"),
      "utf8",
    );
    assert.match(src, /isLearnedSiteSkillName\(ent\.name\)/);
    assert.match(src, /refus seed/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("CU.4 skill creezio-site-skills seedé (format imposé + règle d'entretien)", () => {
  const skill = fs.readFileSync(
    path.join(
      ROOT,
      "packages/host-runtime/resources/vendor/hermes-skills/creezio-site-skills/SKILL.md",
    ),
    "utf8",
  );
  assert.match(skill, /^name: creezio-site-skills$/m);
  assert.match(skill, /site-<domaine/);
  assert.match(skill, /parcours_login/);
  assert.match(skill, /verifie_le/);
  assert.match(skill, /Sélecteurs stables/);
  assert.match(skill, /Pièges connus/);
  assert.match(skill, /get_ai_run_logs/);
  assert.match(skill, /après chaque run|Après CHAQUE run/i);
});
