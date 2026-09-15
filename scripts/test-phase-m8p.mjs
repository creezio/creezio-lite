#!/usr/bin/env node
/**
 * Gate kit M8p — Certivan stores mince ; Fidu sans platform-stores lourds.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cvRoot = resolveBrandCrmRoot("certivan-app");
const fiduRoot = resolveBrandCrmRoot("fidu");

function locDir(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".ts") && !f.endsWith(".tsx")) continue;
    n += fs.readFileSync(path.join(dir, f), "utf8").split("\n").length;
  }
  return n;
}

test("M8p.1 PHASE-M8p.md présent", () => {
  const docPath = path.join(root, "docs/archive/PHASE-M8p.md");
  assert.ok(fs.existsSync(docPath));
  const doc = fs.readFileSync(docPath, "utf8");
  assert.match(doc, /Certivan/);
  assert.match(doc, /Fidu/);
  assert.match(doc, /@creezio\/auth/);
});

test("M8p.2 Certivan adapters lourds absents ; platform-stores ≤80 LOC", () => {
  const ps = path.join(cvRoot, "src/lib/platform-stores");
  for (const gone of [
    "auth-adapter.ts",
    "assistant-adapter.ts",
    "tasks-mails-adapters.ts",
    "paths.ts",
    "contract.ts",
  ]) {
    assert.ok(!fs.existsSync(path.join(ps, gone)), gone);
  }
  const n = locDir(ps);
  assert.ok(n <= 80, `Certivan platform-stores ${n} LOC > 80`);
});

test("M8p.3 Certivan call-sites @creezio/* directs (post-cutover mounts)", () => {
  assert.ok(fs.existsSync(cvRoot), `CV crm root manquant: ${cvRoot}`);

  const auth = fs.readFileSync(
    path.join(cvRoot, "src/server/routes/auth.ts"),
    "utf8",
  );
  assert.match(auth, /from ["']@creezio\/auth["']/);

  const tasksRoutes = fs.readFileSync(
    path.join(cvRoot, "src/server/routes/tasks.ts"),
    "utf8",
  );
  assert.match(tasksRoutes, /from ["']@creezio\/tasks["']/);
  const tasksTwin = path.join(cvRoot, "src/lib/tasks.ts");
  const configureTasks = path.join(cvRoot, "src/lib/configure-tasks.ts");
  assert.ok(
    !fs.existsSync(tasksTwin) || fs.existsSync(configureTasks),
    "CV tasks: jumeau local encore présent sans configure-tasks",
  );
  assert.ok(fs.existsSync(configureTasks), "CV configure-tasks mount");
  assert.ok(
    fs.existsSync(path.join(cvRoot, "vendor/creezio/tasks")),
    "CV vendor @creezio/tasks",
  );

  const emailRoutes = fs.readFileSync(
    path.join(cvRoot, "src/server/routes/email.ts"),
    "utf8",
  );
  assert.match(emailRoutes, /from ["']@creezio\/mails["']/);
  assert.match(emailRoutes, /createEmailInboxRoutes/);
  const emailTwin = path.join(cvRoot, "src/lib/email-queries.ts");
  const configureMails = path.join(cvRoot, "src/lib/configure-mails.ts");
  assert.ok(
    !fs.existsSync(emailTwin) || fs.existsSync(configureMails),
    "CV mails: jumeau local encore présent sans configure-mails",
  );
  assert.ok(fs.existsSync(configureMails), "CV configure-mails mount");
  assert.ok(
    fs.existsSync(path.join(cvRoot, "vendor/creezio/mails")),
    "CV vendor @creezio/mails",
  );

  assert.ok(
    !fs.existsSync(path.join(cvRoot, "src/lib/assistant/chat-db.ts")),
    "CV chat-db façade",
  );
  assert.match(
    fs.readFileSync(path.join(cvRoot, "src/server/routes/assistant.ts"), "utf8"),
    /@creezio\/assistant/,
  );
  assert.ok(
    fs.existsSync(path.join(cvRoot, "src/lib/assistant/mcp-bridge.ts")),
    "CV mcp-bridge",
  );
  assert.ok(
    !fs.existsSync(path.join(cvRoot, "src/lib/assistant/brand-chat-tools.ts")),
    "CV brand-chat-tools mort",
  );
});

test("M8p.4 Fidu sans couche platform-stores lourde", () => {
  const ps = path.join(fiduRoot, "src/lib/platform-stores");
  assert.ok(!fs.existsSync(ps) || locDir(ps) <= 80);
  const br = fs.readFileSync(
    path.join(fiduRoot, "electron/brand-runtime.ts"),
    "utf8",
  );
  assert.match(br, /@creezio\/auth/);
  assert.match(br, /@creezio\/assistant/);
  assert.match(br, /@creezio\/tasks/);
  assert.match(br, /@creezio\/mails/);
});
