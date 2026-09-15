#!/usr/bin/env node
/**
 * Phase O2 — Anti-façades lib + wraps migrations Fidu.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dockerRoot = path.resolve(root, "..");

const FAÇADES = [
  "src/lib/mcp-admin.ts",
  "src/lib/usage-analytics.ts",
  "src/lib/usage-analytics-client.ts",
  "src/lib/usage-analytics-productivity.ts",
  "src/lib/usage-analytics-shared.ts",
  "src/lib/assistant/chat-db.ts",
  "src/lib/assistant/active-surface.ts",
];

test("O2.1 PHASE-O2.md + PLAN-O O2", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-O2.md"), "utf8");
  assert.match(phase, /Anti-façades lib|chat-db|wraps/i);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-o2/);
  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-O.md"), "utf8");
  assert.match(plan, /## O2 — Anti-façades lib/);
  assert.match(plan, /O2 — Anti-façades lib.*✅|PHASE-O2/);
});

test("O2.2 kit platformHistoricalMigrationByName", () => {
  const src = fs.readFileSync(
    path.join(
      root,
      "packages/platform-core/src/historical-migrations/steps/index.ts",
    ),
    "utf8",
  );
  assert.match(src, /export function platformHistoricalMigrationByName/);
  const barrel = fs.readFileSync(
    path.join(root, "packages/platform-core/src/index.ts"),
    "utf8",
  );
  assert.match(barrel, /platformHistoricalMigrationByName/);
});

test("O2.3 façades lib absentes × marques concernées", () => {
  for (const brand of ["tempoflow2", "certivan-app", "fidu"]) {
    const crm = path.join(dockerRoot, brand, "crm");
    for (const rel of FAÇADES) {
      // Fidu n'avait pas mcp/usage façades
      if (
        brand === "fidu" &&
        (rel.includes("mcp-admin") || rel.includes("usage-analytics"))
      ) {
        continue;
      }
      assert.ok(
        !fs.existsSync(path.join(crm, rel)),
        `${brand}: façade ${rel}`,
      );
    }
  }
});

test("O2.4 imports kit directs (échantillons)", () => {
  for (const brand of ["tempoflow2", "certivan-app"]) {
    const mcp = fs.readFileSync(
      path.join(dockerRoot, brand, "crm/src/server/mcp/app.ts"),
      "utf8",
    );
    assert.match(mcp, /@creezio\/mcp-facade/);
    assert.doesNotMatch(mcp, /@\/lib\/mcp-admin/);
    assert.match(mcp, /brand-host|installMcpAdminHost/);
  }
  for (const brand of ["tempoflow2", "certivan-app", "fidu"]) {
    // O4p : jumeau assistant-chat.ts supprimé — routes + brand-chat-tools
    const routes = fs.readFileSync(
      path.join(dockerRoot, brand, "crm/src/server/routes/assistant.ts"),
      "utf8",
    );
    assert.match(routes, /@creezio\/assistant/);
    assert.doesNotMatch(routes, /@\/lib\/assistant\/chat-db/);
    assert.ok(
      !fs.existsSync(
        path.join(dockerRoot, brand, "crm/src/server/assistant-chat.ts"),
      ),
      `${brand}: jumeau assistant-chat`,
    );
  }
});

test("O2.5 Fidu : 0 wraps .find dans steps/ ; compose + runner ≤150", () => {
  const stepsDir = path.join(
    dockerRoot,
    "fidu/crm/electron/migrations/steps",
  );
  for (const name of fs.readdirSync(stepsDir)) {
    if (!name.endsWith(".ts")) continue;
    const body = fs.readFileSync(path.join(stepsDir, name), "utf8");
    assert.doesNotMatch(
      body,
      /platformHistoricalMigrations\(\)\.find/,
      `steps/${name}`,
    );
  }
  for (const wrap of [
    "002_api_keys.ts",
    "003_mcp_oauth.ts",
    "012_users.ts",
    "017_desktop_presence_user_tokens.ts",
    "023_database_automations.ts",
  ]) {
    assert.ok(!fs.existsSync(path.join(stepsDir, wrap)), wrap);
  }
  const compose = path.join(
    dockerRoot,
    "fidu/crm/electron/migrations/platform-compose.ts",
  );
  assert.ok(fs.existsSync(compose));
  assert.match(
    fs.readFileSync(compose, "utf8"),
    /platformHistoricalMigrationByName/,
  );
  const runner = path.join(
    dockerRoot,
    "fidu/crm/electron/migrations/runner.ts",
  );
  const n = fs.readFileSync(runner, "utf8").split("\n").length;
  assert.ok(n <= 150, `runner ${n}`);
});

test("O2.6 gate enregistrée npm test", () => {
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkg, /test-phase-o2\.mjs/);
});
