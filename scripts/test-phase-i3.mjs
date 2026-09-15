/**
 * Phase I3 — tasks/mails sqlite + file-sink provider.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createSqliteTasksStore,
  createTasksApiMount,
} from "../packages/tasks/dist/index.js";
import {
  createFileSinkMailTransport,
  createSqliteMailsStore,
  startMailOutboxWorker,
} from "../packages/mails/dist/index.js";
import { createApiKernel } from "../packages/api-kernel/dist/index.js";
import { createDemobrandSandbox } from "../apps/demobrand/build/electron/sandbox-runtime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("I3 tasks sqlite CRUD + API mount", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-i3-tasks-"));
  const store = createSqliteTasksStore({
    coreDbPath: path.join(dir, "core.db"),
  });
  const t = store.create({ userId: "u1", title: "I3 task" });
  store.update(t.id, { status: "done" }, "u1");
  assert.equal(store.get(t.id)?.status, "done");
  store.close();

  const store2 = createSqliteTasksStore({
    coreDbPath: path.join(dir, "core.db"),
  });
  assert.equal(store2.list("u1").length, 1);
  store2.close();

  const api = createApiKernel();
  const live = createSqliteTasksStore({
    coreDbPath: path.join(dir, "core2.db"),
  });
  api.registerPlatformApi("platform-tasks", createTasksApiMount(live));
  const res = await api.handle({
    method: "POST",
    path: "/api/v1/platform/platform-tasks/create",
    headers: { "x-creezio-user-id": "u1" },
    body: { title: "via-api" },
  });
  assert.equal(res.status, 201);
  live.close();
});

test("I3 mails sqlite + file-sink non-stub (outbox v2)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-i3-mails-"));
  const outDir = path.join(dir, "outbox");
  const store = createSqliteMailsStore({
    coreDbPath: path.join(dir, "core.db"),
  });
  const draft = store.createDraft({
    userId: "u1",
    to: "dest@example.com",
    subject: "I3",
    body: "hello",
  });
  const queued = store.sendDraft(draft.id, "u1");
  assert.equal(queued.status, "queued");
  const worker = startMailOutboxWorker({
    store,
    resolveTransport: () => createFileSinkMailTransport({ outDir }),
    manual: true,
  });
  await worker.drainOnce();
  worker.stop();
  assert.equal(store.get(draft.id)?.status, "sent");
  const files = fs.readdirSync(outDir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 1, "file-sink must write a file");
  store.close();
});

test("I3 demobrand tasks/mails mounts + migrations", async () => {
  const sandbox = createDemobrandSandbox();
  const migs = sandbox.runtime.getCore().listMigrations();
  assert.ok(migs.includes("i3_001_tasks"));
  assert.ok(migs.includes("i3_002_mails"));
  sandbox.tasks.create({ userId: "demo", title: "t" });
  const draft = sandbox.mails.createDraft({
    userId: "demo",
    to: "a@b.c",
    subject: "s",
  });
  const queued = sandbox.mails.sendDraft(draft.id, "demo");
  assert.equal(queued.status, "queued");

  const list = await sandbox.api.handle({
    method: "GET",
    path: "/api/v1/platform/platform-tasks/list",
    headers: { "x-creezio-user-id": "demo" },
  });
  assert.equal(list.status, 200);
  assert.ok(list.body.tasks.length >= 1);
  sandbox.close();
});
