#!/usr/bin/env node
/**
 * Phase M14 — Certivan gold (vision stricte).
 * Allowlist métier RTI + core = platformCoreMigrations ; pas de jumeaux.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cvRoot = resolveBrandCrmRoot("certivan-app");

const METIER_MODULES = ["dossiers", "pieces", "rti"];

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
];

test("M14.1 PHASE-M14.md", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-M14.md"), "utf8");
  assert.match(doc, /Allowlist|allowlist/i);
  assert.match(doc, /rti|RTI/);
  assert.match(doc, /platformCoreMigrations/);
  assert.doesNotMatch(doc, /stub OK/i);
});

test("M14.2 modules métier allowlist", () => {
  const index = fs.readFileSync(
    path.join(cvRoot, "electron/modules/index.ts"),
    "utf8",
  );
  for (const id of METIER_MODULES) {
    assert.match(index, new RegExp(`["']${id}["']`));
    assert.ok(fs.existsSync(path.join(cvRoot, "electron/modules", id)));
  }
  assert.ok(fs.lstatSync(path.join(cvRoot, "modules")).isSymbolicLink());
});

test("M14.3 jumeaux plateforme absents + core kit", () => {
  for (const rel of FORBIDDEN_PLATFORM) {
    assert.equal(
      fs.existsSync(path.join(cvRoot, rel)),
      false,
      `interdit: ${rel}`,
    );
  }
  const br = fs.readFileSync(
    path.join(cvRoot, "electron/brand-runtime.ts"),
    "utf8",
  );
  assert.match(br, /platformCoreMigrations\(\)/);
  assert.doesNotMatch(br, /certivanCoreMigrations\(\)/);
});

test("M14.4 main slim + Paperclip absent", () => {
  const main = fs.readFileSync(path.join(cvRoot, "electron/main.ts"), "utf8");
  assert.ok(main.split("\n").length <= 800);
  assert.match(main, /installBrandDesktopRuntime/);
  assert.doesNotMatch(main, /startPaperclip|paperclipApi/);
});

test("M14.5 PLAN-M.md section M14", () => {
  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-M.md"), "utf8");
  assert.match(plan, /## M14 — Certivan gold/);
  assert.match(plan, /platformCoreMigrations|RTI|allowlist/i);
});
