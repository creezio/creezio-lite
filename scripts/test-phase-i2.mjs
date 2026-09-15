/**
 * Phase I2 — createSqliteAssistantStore (core.db) + persist after reopen.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ASSISTANT_CORE_SQL,
  createSqliteAssistantStore,
} from "../packages/assistant/dist/index.js";
import { createDemobrandSandbox } from "../apps/demobrand/build/electron/sandbox-runtime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("I2 ASSISTANT_CORE_SQL tables", () => {
  assert.match(ASSISTANT_CORE_SQL, /creezio_assistant_conversations/);
  assert.match(ASSISTANT_CORE_SQL, /creezio_assistant_messages/);
});

test("I2 createSqliteAssistantStore CRUD + reopen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-i2-asst-"));
  const dbPath = path.join(dir, "core.db");
  const s1 = createSqliteAssistantStore({ coreDbPath: dbPath });
  const c = s1.createConversation({ title: "I2" });
  s1.appendMessage(c.id, { role: "user", content: "ping" });
  s1.appendMessage(c.id, { role: "assistant", content: "pong" });
  assert.equal(s1.listMessages(c.id).length, 2);
  s1.close();

  const s2 = createSqliteAssistantStore({ coreDbPath: dbPath });
  const restored = s2.getConversation(c.id);
  assert.ok(restored);
  assert.equal(restored.title, "I2");
  const msgs = s2.listMessages(c.id);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].content, "ping");
  assert.equal(msgs[1].role, "assistant");
  s2.close();
});

test("I2 demobrand sandbox.assistant sur core", () => {
  const sandbox = createDemobrandSandbox();
  assert.equal(sandbox.assistant.dbPath, sandbox.runtime.paths.core);
  assert.ok(
    sandbox.runtime.getCore().listMigrations().includes("i2_001_assistant"),
  );
  const c = sandbox.assistant.createConversation({ title: "sandbox" });
  sandbox.assistant.appendMessage(c.id, { role: "user", content: "hi" });
  const root = sandbox.ctx.userDataRoot;
  const cid = c.id;
  sandbox.close();

  const sandbox2 = createDemobrandSandbox({ userDataRoot: root });
  assert.equal(sandbox2.assistant.listMessages(cid).length, 1);
  sandbox2.close();
});

test("I2 README fige core vs resolveAssistantDbPath", () => {
  const readme = fs.readFileSync(
    path.join(ROOT, "packages/assistant/README.md"),
    "utf8",
  );
  assert.match(readme, /resolveCoreDbPath|core/);
  assert.match(readme, /resolveAssistantDbPath|assistant_chats/);
  assert.match(readme, /Historique|legacy|Legacy/i);
});
