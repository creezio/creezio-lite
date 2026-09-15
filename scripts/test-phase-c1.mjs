/**
 * Phase C1 — schéma kit rich + docs cutover TF.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createSqliteAssistantStore } from "../packages/assistant/dist/sqlite-store.js";
import { createSqliteTasksStore } from "../packages/tasks/dist/sqlite-store.js";
import { createSqliteMailsStore } from "../packages/mails/dist/sqlite-store.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("C1 docs PHASE-C1 présents", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "docs/archive/PHASE-C1.md")));
  const c1 = fs.readFileSync(path.join(ROOT, "docs/archive/PHASE-C1.md"), "utf8");
  assert.match(c1, /kit-core/);
  assert.match(c1, /cutover/);
  assert.match(c1, /dual-write/);
});

test("C1 assistant rich schema + upsert", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c1-asst-"));
  const db = path.join(dir, "core.db");
  const store = createSqliteAssistantStore({ coreDbPath: db });
  const c = store.createConversation({
    title: "t",
    model: "m1",
    mode: "work",
    userId: "u1",
  });
  assert.equal(c.model, "m1");
  assert.equal(c.userId, "u1");
  store.appendMessage(c.id, {
    role: "user",
    content: "hi",
    sourcesJson: "[]",
  });
  assert.ok(store.listMessages(c.id)[0].sourcesJson !== undefined);
  store.close();
});

test("C1 tasks upsertWithId + mails inbound", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c1-tm-"));
  const db = path.join(dir, "core.db");
  const tasks = createSqliteTasksStore({ coreDbPath: db });
  const id = "fixed-id-c1";
  tasks.upsertWithId({
    id,
    userId: "u",
    title: "T",
    body: "b",
  });
  assert.equal(tasks.get(id)?.title, "T");
  tasks.close();

  const mails = createSqliteMailsStore({ coreDbPath: db });
  const inbound = mails.insertInbound({
    userId: "u",
    from: "a@x",
    to: "b@x",
    subject: "s",
    messageId: "<1>",
  });
  assert.equal(inbound.status, "inbound");
  mails.close();
});
