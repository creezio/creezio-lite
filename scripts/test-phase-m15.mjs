#!/usr/bin/env node
/**
 * Phase M15 — Fidu gold (vision stricte).
 * Allowlist GED/CRM + core = platformCoreMigrations ; Paperclip absent.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fiduRoot = resolveBrandCrmRoot("fidu");

const METIER_MODULES = ["dossiers", "contacts", "ged"];

const FORBIDDEN_PLATFORM = [
  "electron/local-config.ts",
  "electron/hermes-runtime-bootstrap.ts",
  "electron/n8n-runtime-bootstrap.ts",
  "electron/meili-launcher.ts",
  "electron/hermes-launcher.ts",
  "electron/n8n-launcher.ts",
  "electron/fleet-agent.ts",
  "electron/ops-journal.ts",
  "electron/node-runtime.ts",
  "electron/tunnel.ts",
  "electron/updater.ts",
  "electron/logger.ts",
  "electron/core-migrations.ts",
  "electron/modules/core-migrations.ts",
  "src/lib/database",
  "electron/modules/mcp-runtime.ts",
  "electron/modules/mcp-hono-proxy.ts",
  "electron/paperclip-launcher.ts",
  "electron/paperclip-embed.ts",
  "electron/paperclip-config.ts",
];

test("M15.1 PHASE-M15.md", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-M15.md"), "utf8");
  assert.match(doc, /Allowlist|allowlist/i);
  assert.match(doc, /GED|ged/);
  assert.match(doc, /platformCoreMigrations/);
  assert.match(doc, /Paperclip/);
  assert.doesNotMatch(doc, /stub OK/i);
});

test("M15.2 modules métier allowlist", () => {
  const index = fs.readFileSync(
    path.join(fiduRoot, "electron/modules/index.ts"),
    "utf8",
  );
  for (const id of METIER_MODULES) {
    assert.match(index, new RegExp(`["']${id}["']`));
    assert.ok(fs.existsSync(path.join(fiduRoot, "electron/modules", id)));
  }
  assert.ok(fs.lstatSync(path.join(fiduRoot, "modules")).isSymbolicLink());
});

test("M15.3 jumeaux plateforme absents + core kit", () => {
  for (const rel of FORBIDDEN_PLATFORM) {
    assert.equal(
      fs.existsSync(path.join(fiduRoot, rel)),
      false,
      `interdit: ${rel}`,
    );
  }
  const br = fs.readFileSync(
    path.join(fiduRoot, "electron/brand-runtime.ts"),
    "utf8",
  );
  assert.match(br, /platformCoreMigrations\(\)/);
  assert.doesNotMatch(br, /fiduCoreMigrations\(\)/);
});

test("M15.4 main slim + Paperclip absent", () => {
  const main = fs.readFileSync(path.join(fiduRoot, "electron/main.ts"), "utf8");
  assert.ok(main.split("\n").length <= 800);
  assert.match(main, /installBrandDesktopRuntime/);
  assert.doesNotMatch(main, /startPaperclip|paperclipApi/);
});

test("M15.5 PLAN-M.md section M15", () => {
  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-M.md"), "utf8");
  assert.match(plan, /## M15 — Fidu gold/);
  assert.match(plan, /platformCoreMigrations|GED|allowlist/i);
});
