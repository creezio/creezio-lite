#!/usr/bin/env node
/**
 * Gate kit M11 — migrations SQLite cœur SoT @creezio/platform-core ;
 * TF sans composition cœur locale ; brand-migrations = métier only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const tfRoot = resolveBrandCrmRoot("tempoflow2");

test("M11.1 PHASE-M11.md présent", () => {
  const docPath = path.join(root, "docs/archive/PHASE-M11.md");
  assert.ok(fs.existsSync(docPath));
  const doc = fs.readFileSync(docPath, "utf8");
  assert.match(doc, /platformCoreMigrations/);
  assert.match(doc, /@creezio\/platform-core/);
  assert.match(doc, /brand-migrations/);
});

test("M11.2 kit expose platformCoreMigrations + ids stables", () => {
  const core = require(
    path.join(root, "packages/platform-core/dist-cjs/index.js"),
  );
  assert.equal(typeof core.platformCoreMigrations, "function");
  assert.ok(Array.isArray(core.PLATFORM_CORE_MIGRATION_IDS));
  assert.deepEqual(
    [...core.PLATFORM_CORE_MIGRATION_IDS],
    [
      "h3_core_001_auth",
      "h3_core_002_product_hub",
      "i10_core_003_product_hub_acl_h5",
      "r2_core_004_product_hub_runtime",
    ],
  );

  const migs = core.platformCoreMigrations();
  assert.ok(Array.isArray(migs));
  const ids = migs.map((m) => m.id);
  assert.ok(ids.includes("h2_000_schema_info"));
  for (const id of core.PLATFORM_CORE_MIGRATION_IDS) {
    assert.ok(ids.includes(id), `manque migration ${id}`);
  }
  const auth = migs.find((m) => m.id === "h3_core_001_auth");
  assert.match(auth.sql, /creezio_users/);
  const hub = migs.find((m) => m.id === "h3_core_002_product_hub");
  assert.match(hub.sql, /plugin_products/);
});

test("M11.3 TF sans core-migrations local ; brand-runtime → kit", () => {
  assert.ok(
    !fs.existsSync(path.join(tfRoot, "electron/modules/core-migrations.ts")),
    "TF core-migrations.ts encore présent",
  );
  const br = fs.readFileSync(
    path.join(tfRoot, "electron/brand-runtime.ts"),
    "utf8",
  );
  assert.match(br, /platformCoreMigrations/);
  assert.match(br, /from ["']@creezio\/platform-core["']/);
  assert.doesNotMatch(br, /tempoflowCoreMigrations/);

  const idx = fs.readFileSync(
    path.join(tfRoot, "electron/modules/index.ts"),
    "utf8",
  );
  assert.match(idx, /platformCoreMigrations as tempoflowCoreMigrations/);
  assert.match(idx, /@creezio\/platform-core/);
  assert.doesNotMatch(idx, /from ["']\.\/core-migrations["']/);
});

test("M11.4 TF brand-migrations = métier only (pas auth/hub/tasks)", () => {
  const brandPath = path.join(tfRoot, "electron/modules/brand-migrations.ts");
  assert.ok(fs.existsSync(brandPath));
  const src = fs.readFileSync(brandPath, "utf8");
  assert.doesNotMatch(src, /AUTH_CORE_SQL|@creezio\/auth/);
  assert.doesNotMatch(src, /PRODUCT_HUB_|@creezio\/product-hub/);
  assert.doesNotMatch(src, /PLATFORM_TASKS_CORE_SQL|@creezio\/tasks/);
  assert.doesNotMatch(src, /PLATFORM_MAILS_CORE_SQL|@creezio\/mails/);
  assert.doesNotMatch(src, /ASSISTANT_CORE_SQL|@creezio\/assistant/);
  assert.doesNotMatch(src, /creezio_users|creezio_sessions/);
  assert.doesNotMatch(src, /plugin_products|plugin_acl/);
  assert.match(src, /h3_brand_002_panier_commandes|TF_BRAND_PANIER_SQL/);
});
