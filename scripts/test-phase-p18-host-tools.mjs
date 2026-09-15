#!/usr/bin/env node
/**
 * D-P18 slice — createAiTaskHostMcpTools SoT dans @creezio/tasks.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

test("P18-ht.1 createAiTaskHostMcpTools exporté (src + dist-cjs)", () => {
  const src = fs.readFileSync(
    path.join(root, "packages/tasks/src/mcp-host-tools.ts"),
    "utf8",
  );
  assert.match(src, /export function createAiTaskHostMcpTools/);
  assert.match(src, /CREEZIO_AI_TASK_HOST_MCP_TOOL_NAMES/);
  assert.match(src, /list_ai_collaborators/);
  assert.match(src, /create_ai_task/);
  assert.match(src, /answer_ai_question/);

  const idx = fs.readFileSync(
    path.join(root, "packages/tasks/src/index.ts"),
    "utf8",
  );
  assert.match(idx, /createAiTaskHostMcpTools/);
  assert.match(idx, /CREEZIO_AI_TASK_HOST_MCP_TOOL_NAMES/);

  const cjsPath = path.join(root, "packages/tasks/dist-cjs/index.js");
  assert.ok(fs.existsSync(cjsPath), "dist-cjs/index.js manquant — build:packages");
  const tasks = require(cjsPath);
  assert.equal(typeof tasks.createAiTaskHostMcpTools, "function");
  assert.ok(Array.isArray(tasks.CREEZIO_AI_TASK_HOST_MCP_TOOL_NAMES));
  assert.deepEqual(
    [...tasks.CREEZIO_AI_TASK_HOST_MCP_TOOL_NAMES],
    [
      "list_ai_collaborators",
      "create_ai_task",
      "get_ai_task",
      "get_ai_run_logs",
      "answer_ai_question",
    ],
  );
});

test("P18-ht.2 enregistrement mock enregistre les 5 (+ list_tasks optionnel)", () => {
  const tasks = require(path.join(root, "packages/tasks/dist-cjs/index.js"));
  tasks.resetTasksBrandForTests();
  tasks.configureTasksBrand({
    productName: "Test",
    productDomain: "test",
    hermesSourceLabel: "Test",
    hermesSkill: "test",
    envPrefix: "TEST_AI",
    idempotencyPrefix: "crm",
    assistantIdempotencyPrefix: "asst",
    taskHref: "/taches",
    examplePaths: [],
    db: {
      getWriteDb: () => {
        throw new Error("no db");
      },
      queryAll: () => [],
      queryOne: () => null,
      tableExists: () => false,
    },
    users: {
      getById: () => null,
      list: () => [],
      getOwner: () => null,
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
      getSessionFromContext: async () => null,
      sessionActorIsOwner: () => false,
      sessionIsImpersonating: () => false,
    },
  });

  const names = [];
  const base = tasks.createAiTaskHostMcpTools({
    registerTool: (name) => {
      names.push(name);
    },
    getActorUserId: () => null,
  });
  assert.deepEqual([...base], [
    "list_ai_collaborators",
    "create_ai_task",
    "get_ai_task",
    "get_ai_run_logs",
    "answer_ai_question",
  ]);
  assert.deepEqual(names, [...base]);

  const withList = [];
  tasks.createAiTaskHostMcpTools({
    registerTool: (name) => {
      withList.push(name);
    },
    getActorUserId: () => null,
    includeListTasks: true,
  });
  assert.equal(withList[0], "list_tasks");
  assert.ok(withList.includes("create_ai_task"));
  tasks.resetTasksBrandForTests();
});
