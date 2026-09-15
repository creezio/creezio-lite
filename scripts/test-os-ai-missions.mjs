#!/usr/bin/env node
/**
 * Gate OS — surface missions IA (tasks kit) :
 * exports ai-task / Hermes, configureTasksBrand, SSE activity stream.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Hono } from "hono";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE_TMP = path.join(ROOT, ".tmp-gates");
fs.mkdirSync(GATE_TMP, { recursive: true });
const require = createRequire(import.meta.url);
const tasks = require(path.join(ROOT, "packages/tasks/dist-cjs/index.js"));

function makeBrandDbAdapter(db) {
  return {
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
  };
}

function configureProbeBrand(db) {
  tasks.resetTasksBrandForTests();
  tasks.configureTasksBrand({
    productName: "ProbeOS",
    productDomain: "probe os kit",
    hermesSourceLabel: "Probe OS",
    hermesSkill: "probe-os",
    envPrefix: "PROBE_AI",
    idempotencyPrefix: "crm",
    assistantIdempotencyPrefix: "asst",
    taskHref: "/taches",
    examplePaths: ["/taches"],
    db: makeBrandDbAdapter(db),
    users: {
      getById: (id) => {
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
      },
      list: () => [],
      getOwner: () => {
        const row = db.prepare(`SELECT * FROM users WHERE role = 'owner' LIMIT 1`).get();
        if (!row) return null;
        return {
          id: row.id,
          username: row.username,
          role: row.role,
          kind: row.kind,
          active: true,
          permissions: [],
        };
      },
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
    navigation: {
      permissionForPath: () => null,
      hasPermission: () => true,
    },
    externalTabs: {
      resolve: () => ({ ok: false, error: "n/a" }),
      toWorkspaceParams: () => ({}),
    },
    screencast: { viewerCount: () => 0, subscribe: () => () => {} },
    auth: {
      getSessionFromContext: async (c) => {
        const cookie = c.req.header("cookie") || "";
        const m = cookie.match(/(?:^|;\s*)probe_session=([^;]+)/);
        if (!m) return null;
        const userId = decodeURIComponent(m[1]);
        const u = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
        if (!u) return null;
        return {
          sub: u.id,
          email: u.username,
          role: u.role,
        };
      },
      sessionActorIsOwner: () => true,
      sessionIsImpersonating: () => false,
    },
  });
}

test("missions.exports — surface tasks + MCP host", () => {
  assert.equal(typeof tasks.configureTasksBrand, "function");
  assert.equal(typeof tasks.resetTasksBrandForTests, "function");
  assert.equal(typeof tasks.createAiTaskHostMcpTools, "function");
  assert.equal(typeof tasks.createTasksHonoRoutes, "function");
  assert.equal(typeof tasks.enqueueTaskRun, "function");
  assert.equal(typeof tasks.enqueueAiRunForTask, "function");
  assert.equal(typeof tasks.getAiActivityForUser, "function");
  assert.equal(typeof tasks.syncHermesTasks, "function");
  assert.equal(typeof tasks.runAiTaskAgent, "function");
  assert.ok(Array.isArray(tasks.CREEZIO_AI_TASK_HOST_MCP_TOOL_NAMES));
  assert.ok(tasks.CREEZIO_AI_TASK_HOST_MCP_TOOL_NAMES.includes("create_ai_task"));

  const ui = fs.readFileSync(
    path.join(ROOT, "packages/tasks/ui/ai-activity-panel.tsx"),
    "utf8",
  );
  assert.match(ui, /tasks\/activity\//);
  assert.match(ui, /addEventListener\("run"/);
});

test("missions.configureTasksBrand — requis avant runtime", () => {
  tasks.resetTasksBrandForTests();
  assert.throws(() => tasks.requireTasksBrand(), /configureTasksBrand/);
});

test("missions.sse — événement run sur activity stream", async () => {
  const Database = createRequire(
    path.join(ROOT, "packages/assistant/package.json"),
  )("better-sqlite3");
  const hist = await import(
    pathToFileURL(
      path.join(
        ROOT,
        "packages/platform-core/dist/historical-migrations/index.js",
      ),
    ).href,
  );

  const tmpDir = fs.mkdtempSync(path.join(GATE_TMP, "os-ai-missions-"));
  const dbPath = path.join(tmpDir, "brand.db");
  try {
    hist.runHistoricalMigrations(dbPath, { log: () => {} });
    const db = new Database(dbPath);
    try {
      db.prepare(
        `INSERT INTO users (id, username, password_hash, role, kind, permissions_json)
         VALUES
         ('owner-1', 'boss', 'x', 'owner', 'human', '[]'),
         ('ai-1', 'nova', 'x', 'collaborator', 'ai', '["nav.taches"]')`,
      ).run();
      configureProbeBrand(db);

      const { task } = await tasks.createTask({
        title: "Mission probe kit",
        executorKind: "ai",
        assigneeUserId: "ai-1",
      });
      assert.ok(task?.id);

      const app = new Hono().basePath("/api/v1");
      app.route("/tasks", tasks.createTasksHonoRoutes());

      const res = await app.request("/api/v1/tasks/activity/ai-1/stream", {
        headers: { cookie: "probe_session=owner-1" },
      });
      assert.equal(res.status, 200);
      assert.match(String(res.headers.get("content-type")), /text\/event-stream/);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const readUntil = async (predicate, timeoutMs = 6000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (predicate(buffer)) return true;
          const chunk = await Promise.race([
            reader.read(),
            new Promise((r) => setTimeout(() => r(null), 200)),
          ]);
          if (!chunk) continue;
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
        }
        return predicate(buffer);
      };

      assert.ok(await readUntil((b) => b.includes("event: snapshot")));

      const run = tasks.enqueueTaskRun({
        taskId: task.id,
        assigneeUserId: "ai-1",
      });
      assert.equal(run.status, "queued");

      const gotRun = await readUntil(
        (b) => b.includes("event: run") && b.includes(run.id),
      );
      assert.ok(gotRun, buffer.slice(-500));
      assert.match(buffer, /Mission probe kit/);
      await reader.cancel().catch(() => {});
    } finally {
      db.close();
    }
  } finally {
    tasks.resetTasksBrandForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
