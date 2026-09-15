#!/usr/bin/env node
/**
 * Phase N4p — Cutover migrations TF → Certivan → Fidu.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAPERCLIP_RE = /paperclipApi|startPaperclip\b|paperclip-launcher/;

const TF = resolveBrandCrmRoot("tempoflow2");
const CV = resolveBrandCrmRoot("certivan-app");
const FIDU = resolveBrandCrmRoot("fidu");

const PLATFORM_GONE_TF_CV = [
  "017_agent_todos.ts",
  "020_api_keys.ts",
  "022_mcp_oauth.ts",
  "023_users.ts",
  "024_users_kind.ts",
  "025_desktop_presence.ts",
  "026_collab_ia_kanban.ts",
  "027_mcp_admin.ts",
  "028_plugin_product_hub.ts",
  "029_unified_tasks.ts",
  "030_plugin_prd_sections.ts",
  "031_ai_recurrence_quotas.ts",
  "032_plugin_acl.ts",
  "033_database_automations.ts",
  "034_emails.ts",
  "035_usage_analytics.ts",
];

const FIDU_ORPHANS_GONE = [
  "001_base.ts",
  "006_agregateurs.ts",
  "009_commandes.ts",
  "020_api_keys.ts",
  "021_hermes.ts",
  "022_mcp_oauth.ts",
];

function loc(file) {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

function assertAbsent(dir, files) {
  for (const f of files) {
    assert.ok(!fs.existsSync(path.join(dir, f)), `encore présent: ${dir}/${f}`);
  }
}

test("N4p.1 PHASE-N4p.md + PLAN-N", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-N4p.md"), "utf8");
  assert.match(phase, /Cutover migrations/i);
  assert.match(phase, /b2234b9|37ea6e6|da7e356|1763332/);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-n4p/);
  assert.match(phase, /≤\s*150|runner/i);
  assert.doesNotMatch(phase, PAPERCLIP_RE);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-N.md"), "utf8");
  assert.match(plan, /## N4p — Cutover migrations/);
  assert.match(plan, /PHASE-N4p\.md/);
  assert.match(plan, /Done|livr/i);
});

test("N4p.2 TF — plateforme absente + runner mince + kit", () => {
  assertAbsent(path.join(TF, "electron/migrations/steps"), PLATFORM_GONE_TF_CV);
  const runner = path.join(TF, "electron/migrations/runner.ts");
  assert.ok(loc(runner) <= 150, `TF runner trop long: ${loc(runner)}`);
  const src = fs.readFileSync(runner, "utf8");
  assert.match(src, /runHistoricalMigrations/);
  const idx = fs.readFileSync(
    path.join(TF, "electron/migrations/steps/index.ts"),
    "utf8",
  );
  assert.match(idx, /platformHistoricalMigrations/);
  assert.ok(fs.existsSync(path.join(TF, "electron/migrations/steps/021_hermes.ts")));
  assert.ok(fs.existsSync(path.join(TF, "electron/migrations/steps/001_base.ts")));
});

test("N4p.3 CV — plateforme absente + baseline kit + runner", () => {
  assertAbsent(path.join(CV, "electron/migrations/steps"), PLATFORM_GONE_TF_CV);
  const runner = path.join(CV, "electron/migrations/runner.ts");
  assert.ok(loc(runner) <= 150, `CV runner trop long: ${loc(runner)}`);
  assert.match(fs.readFileSync(runner, "utf8"), /runHistoricalMigrations|FRESH_MIGRATIONS/);
  const baseline = fs.readFileSync(
    path.join(CV, "electron/migrations/steps/036_certivan_baseline.ts"),
    "utf8",
  );
  assert.match(baseline, /platformHistoricalMigrations/);
  assert.doesNotMatch(baseline, /from "\.\/020_api_keys"/);
  assert.ok(fs.existsSync(path.join(CV, "electron/migrations/steps/037_certivan_base.ts")));
});

test("N4p.4 Fidu — orphelins absents + compose kit (O2) + runner", () => {
  assertAbsent(path.join(FIDU, "electron/migrations/steps"), FIDU_ORPHANS_GONE);
  const runner = path.join(FIDU, "electron/migrations/runner.ts");
  assert.ok(loc(runner) <= 150, `Fidu runner trop long: ${loc(runner)}`);
  assert.match(fs.readFileSync(runner, "utf8"), /runHistoricalMigrations/);
  // O2 : wraps steps/ absents — compose dans platform-compose.ts
  for (const wrap of [
    "002_api_keys.ts",
    "003_mcp_oauth.ts",
    "012_users.ts",
    "017_desktop_presence_user_tokens.ts",
    "023_database_automations.ts",
  ]) {
    assert.ok(
      !fs.existsSync(path.join(FIDU, "electron/migrations/steps", wrap)),
      `wrap encore présent: ${wrap}`,
    );
  }
  const compose = path.join(FIDU, "electron/migrations/platform-compose.ts");
  assert.ok(fs.existsSync(compose));
  assert.match(
    fs.readFileSync(compose, "utf8"),
    /platformHistoricalMigrationByName/,
  );
  assert.ok(
    fs.existsSync(path.join(FIDU, "electron/migrations/steps/004_ged_metier.ts")),
  );
  assert.ok(
    fs.existsSync(path.join(FIDU, "electron/migrations/steps/018_collab_ia_kanban.ts")),
  );
});

test("N4p.5 kit historical-migrations toujours SoT", () => {
  const hist = path.join(
    root,
    "packages/platform-core/src/historical-migrations/steps/index.ts",
  );
  assert.ok(fs.existsSync(hist));
  assert.match(
    fs.readFileSync(hist, "utf8"),
    /platformHistoricalMigrations/,
  );
});
