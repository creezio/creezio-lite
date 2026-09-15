/**
 * Phase I1 — createSqliteAuthStore (core.db) + session après restart.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createSqliteAuthStore,
  AUTH_CORE_SQL,
} from "../packages/auth/dist/index.js";
import { createDemobrandSandbox } from "../apps/demobrand/build/electron/sandbox-runtime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("I1 AUTH_CORE_SQL expose creezio_users / creezio_sessions", () => {
  assert.match(AUTH_CORE_SQL, /creezio_users/);
  assert.match(AUTH_CORE_SQL, /creezio_sessions/);
});

test("I1 createSqliteAuthStore register/login/logout", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-i1-auth-"));
  const dbPath = path.join(dir, "core.db");
  const store = createSqliteAuthStore({ coreDbPath: dbPath });
  const user = await store.register({
    email: "I1@Demo.io",
    password: "secret-i1",
    displayName: "I1",
  });
  assert.equal(user.email, "i1@demo.io");
  await assert.rejects(
    () => store.register({ email: "i1@demo.io", password: "x" }),
    /email_taken/,
  );
  const session = await store.login({
    email: "i1@demo.io",
    password: "secret-i1",
    stayLoggedIn: true,
  });
  assert.ok(session.token);
  assert.equal(session.user.displayName, "I1");
  const again = await store.getSession(session.token);
  assert.ok(again);
  assert.equal(again.userId, user.id);
  const account = await store.getAccount(session.token);
  assert.equal(account?.email, "i1@demo.io");
  assert.equal(await store.logout(session.token), true);
  assert.equal(await store.getSession(session.token), null);
  store.close();
});

test("I1 session survit au restart process (nouvelle ouverture DB)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-i1-persist-"));
  const dbPath = path.join(dir, "core.db");
  const store1 = createSqliteAuthStore({ coreDbPath: dbPath });
  await store1.register({ email: "persist@demo.io", password: "p1" });
  const session = await store1.login({
    email: "persist@demo.io",
    password: "p1",
    stayLoggedIn: true,
  });
  const token = session.token;
  store1.close();

  const store2 = createSqliteAuthStore({ coreDbPath: dbPath });
  const restored = await store2.getSession(token);
  assert.ok(restored, "session must persist after reopen");
  assert.equal(restored.user.email, "persist@demo.io");
  store2.close();
});

test("I1 demobrand sandbox expose auth sqlite sur core", async () => {
  const sandbox = createDemobrandSandbox();
  assert.ok(sandbox.auth);
  assert.equal(sandbox.auth.dbPath, sandbox.runtime.paths.core);
  await sandbox.auth.register({
    email: "sandbox@demobrand.test",
    password: "sb",
    displayName: "Sandbox",
  });
  const s = await sandbox.auth.login({
    email: "sandbox@demobrand.test",
    password: "sb",
    stayLoggedIn: true,
  });
  const token = s.token;
  sandbox.close();

  // Re-open même userData → session toujours là
  const sandbox2 = createDemobrandSandbox({
    userDataRoot: sandbox.ctx.userDataRoot,
  });
  const restored = await sandbox2.auth.getSession(token);
  assert.ok(restored);
  assert.equal(restored.user.displayName, "Sandbox");
  sandbox2.close();
});

test("I1 package exports documentés", () => {
  const idx = fs.readFileSync(
    path.join(ROOT, "packages/auth/src/index.ts"),
    "utf8",
  );
  assert.match(idx, /createSqliteAuthStore/);
  const readme = fs.readFileSync(
    path.join(ROOT, "packages/auth/README.md"),
    "utf8",
  );
  assert.match(readme, /createSqliteAuthStore/);
  assert.match(readme, /configureAuth/);
});
