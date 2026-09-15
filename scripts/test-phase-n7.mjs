#!/usr/bin/env node
/**
 * Phase N7 — supplier-tabs hors métier Certivan / Fidu.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dockerRoot = path.resolve(root, "..");
const PAPERCLIP_RE = /paperclipApi|startPaperclip\b|paperclip-launcher/;

function loc(file) {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

test("N7.1 PHASE-N7.md + PLAN-N N7 livré", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-N7.md"), "utf8");
  assert.match(phase, /supplier-tabs/i);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-n7/);
  assert.match(phase, /browser-tabs/);
  assert.match(phase, /Paperclip = mort/);
  assert.doesNotMatch(phase, PAPERCLIP_RE);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-N.md"), "utf8");
  assert.match(plan, /## N7 —/);
  assert.match(plan, /PHASE-N7\.md/);
  assert.match(plan, /Done|livr|Sign-off/i);
});

test("N7.2 kit browser-tabs + exports", () => {
  const mgr = path.join(
    root,
    "packages/electron-shell/src/host/browser-tabs/browser-tab-manager.ts",
  );
  assert.ok(fs.existsSync(mgr));
  assert.ok(loc(mgr) > 400);
  const idx = fs.readFileSync(
    path.join(root, "packages/electron-shell/src/host/browser-tabs/index.ts"),
    "utf8",
  );
  assert.match(idx, /configureBrowserTabs/);
  assert.match(idx, /SupplierTabManager|BrowserTabManager/);
  const pkg = JSON.parse(
    fs.readFileSync(
      path.join(root, "packages/electron-shell/package.json"),
      "utf8",
    ),
  );
  assert.ok(pkg.exports?.["./browser-tabs"], "exports ./browser-tabs");
  const shellIdx = fs.readFileSync(
    path.join(root, "packages/electron-shell/src/index.ts"),
    "utf8",
  );
  assert.match(shellIdx, /browser-tabs/);
  // Pas d'export barrel (évite electron dans les tests Node).
  assert.doesNotMatch(shellIdx, /export \{[^}]*configureBrowserTabs/);
});

test("N7.3 supplier-tabs SoT kit ; jumeaux locaux absents ×3", () => {
  const kitMgr = path.join(
    root,
    "packages/electron-shell/src/host/browser-tabs/browser-tab-manager.ts",
  );
  assert.ok(fs.existsSync(kitMgr), "kit SupplierTabManager");
  assert.ok(loc(kitMgr) > 400, `kit browser-tab-manager trop court: ${loc(kitMgr)}`);
  assert.match(fs.readFileSync(kitMgr, "utf8"), /class SupplierTabManager/);

  for (const brand of ["tempoflow2", "certivan-app", "fidu"]) {
    for (const rel of [
      "supplier-tabs.ts",
      "supplier-driver.ts",
      "preload-supplier.ts",
    ]) {
      assert.ok(
        !fs.existsSync(path.join(dockerRoot, brand, "crm/electron", rel)),
        `${brand}: façade encore présente: ${rel}`,
      );
    }
    assert.ok(
      !fs.existsSync(path.join(dockerRoot, brand, "crm/electron/tab-url.ts")),
      `${brand}: tab-url local encore présent`,
    );
    const bindings = fs.readFileSync(
      path.join(dockerRoot, brand, "crm/electron/host-n2-bindings.ts"),
      "utf8",
    );
    assert.match(
      bindings,
      /@creezio\/electron-shell\/browser-tabs/,
      `${brand}: host-n2 sans import browser-tabs kit`,
    );
  }
});

test("N7.4 Paperclip mort", () => {
  const dirs = [
    path.join(root, "packages/electron-shell/src/host/browser-tabs"),
  ];
  for (const d of dirs) {
    for (const name of fs.readdirSync(d)) {
      if (!/\.ts$/.test(name)) continue;
      const body = fs.readFileSync(path.join(d, name), "utf8");
      assert.doesNotMatch(body, PAPERCLIP_RE);
    }
  }
});
