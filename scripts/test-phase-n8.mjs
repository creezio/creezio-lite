#!/usr/bin/env node
/**
 * Phase N8 — Gates LOC + allowlists vision (3 marques).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dockerRoot = path.resolve(root, "..");
const PAPERCLIP_RE = /paperclipApi|startPaperclip\b|paperclip-launcher/;

const BRANDS = [
  { name: "tempoflow2", dir: path.join(dockerRoot, "tempoflow2/crm") },
  { name: "certivan-app", dir: path.join(dockerRoot, "certivan-app/crm") },
  { name: "fidu", dir: path.join(dockerRoot, "fidu/crm") },
];

const FORBIDDEN = [
  "electron/meili-launcher.ts",
  "electron/local-config.ts",
  "electron/host-na-stubs.ts",
  "src/components/admin/analytics-client.tsx",
  "src/components/admin/mcp-admin-client.tsx",
  "src/components/admin/analytics-productivity-panel.tsx",
];

function loc(file) {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

function exists(dir, rel) {
  return fs.existsSync(path.join(dir, rel));
}

test("N8.1 PHASE-N8.md + PLAN-N N8 livré", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-N8.md"), "utf8");
  assert.match(phase, /Gates LOC|allowlists/i);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-n8/);
  assert.match(phase, /Paperclip = mort/);
  assert.match(phase, /≤800|≤260|≤150|≤80|≤40/);
  assert.doesNotMatch(phase, PAPERCLIP_RE);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-N.md"), "utf8");
  assert.match(plan, /## N8 — Gates LOC/);
  assert.match(plan, /PHASE-N8\.md/);
  assert.match(plan, /Done|livr|Sign-off/i);
});

test("N8.2 forbidden jumeaux / clients locaux absents ×3", () => {
  for (const b of BRANDS) {
    assert.ok(fs.existsSync(b.dir), b.name);
    for (const rel of FORBIDDEN) {
      assert.ok(
        !exists(b.dir, rel),
        `${b.name}: forbidden encore présent ${rel}`,
      );
    }
  }
});

test("N8.3 budgets LOC communs (main / preload / runner)", () => {
  for (const b of BRANDS) {
    const main = path.join(b.dir, "electron/main.ts");
    assert.ok(fs.existsSync(main));
    assert.ok(loc(main) <= 800, `${b.name}: main ${loc(main)} > 800`);
    assert.ok(loc(main) > 50, `${b.name}: main trop court`);

    const preload = path.join(b.dir, "electron/preload-app.ts");
    assert.ok(fs.existsSync(preload));
    assert.ok(loc(preload) <= 260, `${b.name}: preload ${loc(preload)} > 260`);

    const runner = path.join(b.dir, "electron/migrations/runner.ts");
    assert.ok(fs.existsSync(runner));
    assert.ok(loc(runner) <= 150, `${b.name}: runner ${loc(runner)} > 150`);
  }
});

test("N8.4 supplier-tabs SoT kit ; jumeaux absents ×3 (O1 anti-façade)", () => {
  const kitMgr = path.join(
    root,
    "packages/electron-shell/src/host/browser-tabs/browser-tab-manager.ts",
  );
  assert.ok(loc(kitMgr) >= 400);
  assert.match(fs.readFileSync(kitMgr, "utf8"), /class SupplierTabManager/);

  for (const brand of ["tempoflow2", "certivan-app", "fidu"]) {
    assert.ok(
      !fs.existsSync(
        path.join(dockerRoot, brand, "crm/electron/supplier-tabs.ts"),
      ),
      `${brand}: supplier-tabs façade`,
    );
    assert.ok(
      !fs.existsSync(
        path.join(dockerRoot, brand, "crm/electron/supplier-driver.ts"),
      ),
      `${brand}: supplier-driver façade`,
    );
    const bindings = fs.readFileSync(
      path.join(dockerRoot, brand, "crm/electron/host-n2-bindings.ts"),
      "utf8",
    );
    assert.match(bindings, /@creezio\/electron-shell\/browser-tabs/);
  }
});

test("N8.5 admin / analytics : 0 façade lib TF+CV (O2)", () => {
  for (const brand of ["tempoflow2", "certivan-app"]) {
    const dir = path.join(dockerRoot, brand, "crm");
    for (const rel of [
      "src/lib/mcp-admin.ts",
      "src/lib/usage-analytics.ts",
      "src/lib/assistant/chat-db.ts",
    ]) {
      assert.ok(!exists(dir, rel), `${brand}: façade ${rel}`);
    }
    assert.ok(exists(dir, "src/app/admin/plugins/page.tsx"), `${brand}: page`);
    assert.ok(
      loc(path.join(dir, "src/app/admin/plugins/page.tsx")) <= 80,
      `${brand}: plugins page`,
    );
  }
  // Fidu : pas de surface admin plugins
  assert.ok(
    !exists(path.join(dockerRoot, "fidu/crm"), "src/app/admin/plugins/page.tsx"),
  );
});

test("N8.6 Paperclip mort ×3 + kit runtime", () => {
  for (const b of BRANDS) {
    const main = fs.readFileSync(path.join(b.dir, "electron/main.ts"), "utf8");
    assert.doesNotMatch(main, PAPERCLIP_RE);
  }
  const runtime = fs.readFileSync(
    path.join(
      root,
      "packages/electron-shell/src/desktop/brand-desktop-runtime.ts",
    ),
    "utf8",
  );
  assert.doesNotMatch(runtime, PAPERCLIP_RE);
});
