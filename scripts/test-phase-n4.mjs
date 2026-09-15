#!/usr/bin/env node
/**
 * Phase N4 — Migrations historiques plateforme → @creezio/platform-core (kit only).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const histDir = path.join(
  root,
  "packages/platform-core/src/historical-migrations",
);
const PAPERCLIP_RE = /paperclipApi|startPaperclip\b|paperclip-launcher/;

const PLATFORM_STEPS = [
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

const EXPECTED_VERSIONS = [
  17, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35,
];

function loc(file) {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

function walkTs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkTs(p));
    else if (/\.ts$/.test(ent.name)) out.push(p);
  }
  return out;
}

test("N4.1 PHASE-N4.md + PLAN-N N4", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-N4.md"), "utf8");
  assert.match(phase, /Migrations historiques plateforme/i);
  assert.match(phase, /369a7bf/);
  assert.match(phase, /platformHistoricalMigrations/);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-n4/);
  assert.match(phase, /Inventaire|step →/i);
  assert.match(phase, /migrate-legacy|sections_json|PRAGMA/i);
  assert.doesNotMatch(phase, PAPERCLIP_RE);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-N.md"), "utf8");
  assert.match(plan, /## N4 — Migrations historiques plateforme → kit/);
  assert.match(plan, /PHASE-N4\.md/);
  assert.match(plan, /Done|livr/i);
});

test("N4.2 steps plateforme présents + LOC", () => {
  for (const rel of PLATFORM_STEPS) {
    const p = path.join(histDir, "steps", rel);
    assert.ok(fs.existsSync(p), `manquant: ${rel}`);
    assert.ok(loc(p) > 10, `${rel} trop court`);
  }
  const types = path.join(histDir, "types.ts");
  const runner = path.join(histDir, "runner.ts");
  assert.ok(fs.existsSync(types));
  assert.ok(fs.existsSync(runner));
  assert.match(
    fs.readFileSync(runner, "utf8"),
    /export function runHistoricalMigrations/,
  );

  const files = walkTs(histDir);
  const total = files.reduce((n, f) => n + loc(f), 0);
  assert.ok(total > 800, `LOC historique trop bas: ${total}`);
  assert.ok(total < 2500, `LOC historique trop haut (scope creep): ${total}`);
});

test("N4.3 exports publics + versions stables", async () => {
  const idx = fs.readFileSync(
    path.join(root, "packages/platform-core/src/index.ts"),
    "utf8",
  );
  assert.match(idx, /platformHistoricalMigrations/);
  assert.match(idx, /runHistoricalMigrations/);
  assert.match(idx, /PLATFORM_HISTORICAL_STEP_VERSIONS/);

  const dist = path.join(
    root,
    "packages/platform-core/dist/historical-migrations/index.js",
  );
  assert.ok(fs.existsSync(dist), "dist historique manquant — build platform-core");
  const mod = await import(pathToFileURL(dist).href);
  assert.equal(typeof mod.platformHistoricalMigrations, "function");
  assert.equal(typeof mod.runHistoricalMigrations, "function");
  const migs = mod.platformHistoricalMigrations();
  assert.deepEqual(
    migs.map((m) => m.version),
    EXPECTED_VERSIONS,
  );
  assert.deepEqual([...mod.PLATFORM_HISTORICAL_STEP_VERSIONS], EXPECTED_VERSIONS);
  for (const m of migs) {
    assert.equal(typeof m.name, "string");
    assert.equal(typeof m.up, "function");
  }
});

test("N4.4 migrate-legacy filtre colonnes absentes", () => {
  const src = fs.readFileSync(
    path.join(root, "packages/product-hub/src/store/migrate-legacy.ts"),
    "utf8",
  );
  assert.match(src, /PRAGMA table_info/);
  assert.match(src, /colsList|present\.has/);
  assert.match(src, /sections_json|N4/);
});

test("N4.5 core-migrations documente couverture historique", () => {
  const core = fs.readFileSync(
    path.join(root, "packages/platform-core/src/core-migrations.ts"),
    "utf8",
  );
  assert.match(core, /platformHistoricalMigrations|migrateLegacy|N4/);
  assert.match(core, /028|plugin_/);
});

test("N4.6 harness upgrade fixture brand.db", async () => {
  const tfCrm = resolveBrandCrmRoot("tempoflow2");
  const reqPath = path.join(tfCrm, "package.json");
  if (!fs.existsSync(reqPath)) {
    console.log("skip N4.6 — tempoflow2/crm absent");
    return;
  }
  let Database;
  try {
    Database = createRequire(reqPath)("better-sqlite3");
  } catch {
    console.log("skip N4.6 — better-sqlite3 indisponible");
    return;
  }

  const dist = path.join(
    root,
    "packages/platform-core/dist/historical-migrations/index.js",
  );
  const mod = await import(pathToFileURL(dist).href);
  const prev = process.cwd();
  process.chdir(tfCrm);
  const dbPath = path.join(os.tmpdir(), `n4-gate-${Date.now()}.db`);
  try {
    const report = mod.runHistoricalMigrations(dbPath, { log: () => {} });
    assert.equal(report.from, 0);
    assert.equal(report.to, 35);
    assert.ok(report.applied.length >= 15);

    const db = new Database(dbPath);
    try {
      const ver = db
        .prepare(`SELECT value FROM meta WHERE key='schema_version'`)
        .get();
      assert.equal(String(ver?.value), "35");
      for (const table of [
        "api_keys",
        "users",
        "tasks",
        "emails",
        "usage_events",
        "plugin_products",
      ]) {
        const row = db
          .prepare(
            `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?`,
          )
          .get(table);
        assert.ok(Number(row?.c) > 0, `table manquante: ${table}`);
      }
      const again = mod.runHistoricalMigrations(dbPath, { log: () => {} });
      assert.equal(again.applied.length, 0);
      assert.equal(again.to, 35);
    } finally {
      db.close();
    }
  } finally {
    process.chdir(prev);
    try {
      fs.unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  }
});

test("N4.7 pas de Paperclip dans historical-migrations", () => {
  for (const f of walkTs(histDir)) {
    const src = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(src, PAPERCLIP_RE, f);
  }
});
