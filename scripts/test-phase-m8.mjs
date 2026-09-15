#!/usr/bin/env node
/**
 * Gate kit M8 — helpers auth/assistant/tasks/mails SoT ; TF adapters lourds absents.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tfRoot = resolveBrandCrmRoot("tempoflow2");

function locDir(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".ts") && !f.endsWith(".tsx")) continue;
    n += fs.readFileSync(path.join(dir, f), "utf8").split("\n").length;
  }
  return n;
}

test("M8.1 PHASE-M8.md présent", () => {
  const docPath = path.join(root, "docs/archive/PHASE-M8.md");
  assert.ok(fs.existsSync(docPath));
  const doc = fs.readFileSync(docPath, "utf8");
  assert.match(doc, /@creezio\/auth/);
  assert.match(doc, /platform-stores/);
  assert.match(doc, /≤\s*80|≤80/);
});

test("M8.2 kit expose env helpers + contrat", () => {
  const core = require(path.join(root, "packages/platform-core/dist-cjs/index.js"));
  assert.equal(typeof core.resolveCoreDbPathFromEnv, "function");
  assert.equal(typeof core.ensureCoreDbParent, "function");
  assert.ok(Array.isArray(core.PLATFORM_STORES_CONTRACT));
  assert.equal(core.PLATFORM_STORES_CONTRACT.length, 4);

  const auth = require(path.join(root, "packages/auth/dist-cjs/index.js"));
  assert.equal(typeof auth.getKitAuthStore, "function");
  assert.equal(typeof auth.authenticateViaKit, "function");
  assert.equal(typeof auth.migrateBrandCredentialsToKit, "function");

  const assistant = require(path.join(root, "packages/assistant/dist-cjs/index.js"));
  assert.equal(typeof assistant.getKitAssistantStore, "function");

  const tasks = require(path.join(root, "packages/tasks/dist-cjs/index.js"));
  assert.equal(typeof tasks.upsertKitPlatformTask, "function");

  const mails = require(path.join(root, "packages/mails/dist-cjs/index.js"));
  assert.equal(typeof mails.indexKitInboundMail, "function");
  assert.equal(typeof mails.createEmailInboxRoutes, "function");
  assert.equal(typeof mails.configureMails, "function");
  assert.equal(typeof mails.getKitMailsStore, "function");
  assert.equal(typeof mails.migrateBrandEmailsToKit, "function");
  assert.ok(
    fs.existsSync(path.join(root, "packages/mails/ui/mail-workspace.tsx")),
    "MailWorkspace UI",
  );
  assert.ok(
    fs.existsSync(path.join(root, "packages/mails/email-worker/worker.js")),
    "email-worker kit",
  );
});

test("M8.3 TF adapters lourds absents ; platform-stores ≤80 LOC", () => {
  const ps = path.join(tfRoot, "src/lib/platform-stores");
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
  assert.ok(n <= 80, `platform-stores ${n} LOC > 80`);
  assert.ok(fs.existsSync(path.join(ps, "product-hub-adapter.ts")));
});

test("M8.4 TF call-sites importent @creezio/* directs (post-cutover mounts)", () => {
  assert.ok(fs.existsSync(tfRoot), `TF crm root manquant: ${tfRoot}`);

  const auth = fs.readFileSync(
    path.join(tfRoot, "src/server/routes/auth.ts"),
    "utf8",
  );
  assert.match(auth, /from ["']@creezio\/auth["']/);
  assert.doesNotMatch(auth, /platform-stores/);

  // Tasks cutover : routes kit + jumeau local absent OU configure-tasks présent
  const tasksRoutes = fs.readFileSync(
    path.join(tfRoot, "src/server/routes/tasks.ts"),
    "utf8",
  );
  assert.match(tasksRoutes, /from ["']@creezio\/tasks["']/);
  const tasksTwin = path.join(tfRoot, "src/lib/tasks.ts");
  const configureTasks = path.join(tfRoot, "src/lib/configure-tasks.ts");
  assert.ok(
    !fs.existsSync(tasksTwin) || fs.existsSync(configureTasks),
    "TF tasks: jumeau local encore présent sans configure-tasks",
  );
  assert.ok(
    fs.existsSync(configureTasks),
    "TF configure-tasks mount",
  );
  assert.ok(
    fs.existsSync(path.join(tfRoot, "vendor/creezio/tasks")),
    "TF vendor @creezio/tasks",
  );

  // Mails cutover : routes kit + jumeau local absent OU configure-mails présent
  const emailRoutes = fs.readFileSync(
    path.join(tfRoot, "src/server/routes/email.ts"),
    "utf8",
  );
  assert.match(emailRoutes, /from ["']@creezio\/mails["']/);
  assert.match(emailRoutes, /createEmailInboxRoutes/);
  const emailTwin = path.join(tfRoot, "src/lib/email-queries.ts");
  const configureMails = path.join(tfRoot, "src/lib/configure-mails.ts");
  assert.ok(
    !fs.existsSync(emailTwin) || fs.existsSync(configureMails),
    "TF mails: jumeau local encore présent sans configure-mails",
  );
  assert.ok(fs.existsSync(configureMails), "TF configure-mails mount");
  assert.ok(
    fs.existsSync(path.join(tfRoot, "vendor/creezio/mails")),
    "TF vendor @creezio/mails",
  );
  assert.ok(
    !fs.existsSync(path.join(tfRoot, "src/components/mail/mail-inbox.tsx")),
    "TF mail-inbox twin",
  );

  // O2 : chat-db façade absente — SoT kit direct
  assert.ok(
    !fs.existsSync(path.join(tfRoot, "src/lib/assistant/chat-db.ts")),
    "TF chat-db façade",
  );
  // O4r : assistant-chat jumeau supprimé — mount kit + mcp-bridge
  const assistantRoutes = fs.readFileSync(
    path.join(tfRoot, "src/server/routes/assistant.ts"),
    "utf8",
  );
  assert.match(assistantRoutes, /@creezio\/assistant/);
  assert.ok(
    fs.existsSync(path.join(tfRoot, "src/lib/assistant/mcp-bridge.ts")),
    "TF mcp-bridge",
  );
  assert.ok(
    !fs.existsSync(path.join(tfRoot, "src/lib/assistant/brand-chat-tools.ts")),
    "TF brand-chat-tools mort",
  );
});
