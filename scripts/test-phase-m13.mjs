#!/usr/bin/env node
/**
 * Phase M13 — Audit TF métier-only (vision stricte).
 * Allowlist métier + absence jumeaux plateforme ; pas de stubs fantômes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tfRoot = resolveBrandCrmRoot("tempoflow2");

const METIER_MODULES = [
  "panier",
  "dispatch",
  "releves",
  "catalogue",
  "stack",
  "scan",
];

/** Jumeaux / stubs plateforme — doivent rester absents (M1–M12). */
const FORBIDDEN_PLATFORM = [
  "electron/local-config.ts",
  "electron/hermes-runtime-bootstrap.ts",
  "electron/n8n-runtime-bootstrap.ts",
  "electron/meili-launcher.ts",
  "electron/hermes-launcher.ts",
  "electron/n8n-launcher.ts",
  "electron/fleet-agent.ts",
  "electron/ops-journal.ts",
  "electron/ops-rules.ts",
  "electron/ops-types.ts",
  "electron/node-runtime.ts",
  "electron/tunnel.ts",
  "electron/updater.ts",
  "electron/logger.ts",
  "electron/npm-cli.ts",
  "electron/window-chrome.ts",
  "electron/core-migrations.ts",
  "electron/migrations/core.ts",
  "electron/splash.ts",
  "electron/tray.ts",
  "src/lib/database",
  "src/lib/database.ts",
  "electron/modules/mcp-runtime.ts",
  "electron/modules/mcp-hono-proxy.ts",
  "electron/paperclip-launcher.ts",
  "electron/paperclip-embed.ts",
  "electron/paperclip-config.ts",
];

test("M13.1 PHASE-M13.md allowlist + audit", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-M13.md"), "utf8");
  assert.match(doc, /Allowlist|allowlist/i);
  assert.match(doc, /panier/);
  assert.match(doc, /host-runtime-ctx/);
  assert.match(doc, /brand-runtime/);
  assert.doesNotMatch(doc, /stub OK/i);
});

test("M13.2 modules métier allowlist montés", () => {
  const index = fs.readFileSync(
    path.join(tfRoot, "electron/modules/index.ts"),
    "utf8",
  );
  for (const id of METIER_MODULES) {
    assert.match(index, new RegExp(`["']${id}["']`));
    assert.ok(
      fs.existsSync(path.join(tfRoot, "electron/modules", id)),
      `module ${id}`,
    );
  }
  const modulesLink = path.join(tfRoot, "modules");
  assert.ok(fs.lstatSync(modulesLink).isSymbolicLink(), "crm/modules symlink");
});

test("M13.3 jumeaux plateforme absents", () => {
  for (const rel of FORBIDDEN_PLATFORM) {
    assert.equal(
      fs.existsSync(path.join(tfRoot, rel)),
      false,
      `interdit présent: ${rel}`,
    );
  }
});

test("M13.4 wiring marque mince présent", () => {
  for (const rel of [
    "electron/host-runtime-ctx.ts",
    "electron/host-stack.ts",
    "electron/brand-runtime.ts",
    "electron/main.ts",
  ]) {
    assert.ok(fs.existsSync(path.join(tfRoot, rel)), rel);
  }
  const main = fs.readFileSync(path.join(tfRoot, "electron/main.ts"), "utf8");
  assert.match(main, /installBrandDesktopRuntime/);
  assert.ok(main.split("\n").length <= 800);
  assert.doesNotMatch(main, /startPaperclip|paperclipApi/);
});

test("M13.5 PLAN-M.md section M13", () => {
  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-M.md"), "utf8");
  assert.match(plan, /## M13 — Audit TF métier-only/);
  assert.match(plan, /Allowlist|allowlist|métier-only/i);
});
