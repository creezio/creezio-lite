#!/usr/bin/env node
/**
 * Phase O1 — Anti-façades Electron mince (supplier + plugin-control-api).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dockerRoot = path.resolve(root, "..");

function loc(file) {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

test("O1.1 PHASE-O1.md + PLAN-O O1", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-O1.md"), "utf8");
  assert.match(phase, /Anti-façades Electron|plugin-control-api/i);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-o1/);
  assert.match(phase, /NON done|façade/i);
  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-O.md"), "utf8");
  assert.match(plan, /## O1 — Anti-façades Electron/);
  assert.match(plan, /PHASE-O1|O1 — Anti-façades Electron mince.*✅/);
});

test("O1.2 kit browser-tabs : preload + typesVersions + export", () => {
  const preload = path.join(
    root,
    "packages/electron-shell/src/host/browser-tabs/browser-tab-preload.ts",
  );
  assert.ok(fs.existsSync(preload));
  const pathHelper = path.join(
    root,
    "packages/electron-shell/src/host/browser-tabs/browser-tab-preload-path.ts",
  );
  assert.ok(fs.existsSync(pathHelper));
  assert.match(
    fs.readFileSync(pathHelper, "utf8"),
    /browserTabPreloadPath/,
  );
  const idx = fs.readFileSync(
    path.join(root, "packages/electron-shell/src/host/browser-tabs/index.ts"),
    "utf8",
  );
  assert.match(idx, /browserTabPreloadPath/);
  const pkg = JSON.parse(
    fs.readFileSync(
      path.join(root, "packages/electron-shell/package.json"),
      "utf8",
    ),
  );
  assert.ok(pkg.exports?.["./browser-tabs"]);
  assert.ok(pkg.typesVersions?.["*"]?.["browser-tabs"]);
  const mgr = fs.readFileSync(
    path.join(
      root,
      "packages/electron-shell/src/host/browser-tabs/browser-tab-manager.ts",
    ),
    "utf8",
  );
  assert.match(mgr, /browserTabPreloadPath/);
});

test("O1.3 plugin-control-api absent ×3 ; Fidu boot conservé", () => {
  for (const brand of ["tempoflow2", "certivan-app", "fidu"]) {
    assert.ok(
      !fs.existsSync(
        path.join(dockerRoot, brand, "crm/electron/plugin-control-api.ts"),
      ),
      `${brand}: plugin-control-api façade`,
    );
  }
  assert.ok(
    fs.existsSync(
      path.join(dockerRoot, "fidu/crm/electron/plugin-control-boot.ts"),
    ),
    "Fidu plugin-control-boot (wiring métier) manquant",
  );
});

test("O1.4 supplier façades absentes ×3 ; SoT kit browser-tabs ≥400", () => {
  const kitMgr = path.join(
    root,
    "packages/electron-shell/src/host/browser-tabs/browser-tab-manager.ts",
  );
  assert.ok(loc(kitMgr) >= 400);
  assert.match(fs.readFileSync(kitMgr, "utf8"), /class SupplierTabManager/);

  for (const brand of ["tempoflow2", "certivan-app", "fidu"]) {
    for (const rel of [
      "supplier-tabs.ts",
      "supplier-driver.ts",
      "preload-supplier.ts",
    ]) {
      assert.ok(
        !fs.existsSync(path.join(dockerRoot, brand, "crm/electron", rel)),
        `${brand}: ${rel}`,
      );
    }
    const main = fs.readFileSync(
      path.join(dockerRoot, brand, "crm/electron/main.ts"),
      "utf8",
    );
    assert.match(main, /@creezio\/electron-shell\/browser-tabs/);
    assert.doesNotMatch(main, /from ["']\.\/supplier-tabs["']/);
    const bindings = fs.readFileSync(
      path.join(dockerRoot, brand, "crm/electron/host-n2-bindings.ts"),
      "utf8",
    );
    assert.match(bindings, /@creezio\/electron-shell\/browser-tabs/);
    assert.match(bindings, /browserTabPreloadPath|configureBrowserTabs/);
  }
});

test("O1.5 gate enregistrée npm test", () => {
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkg, /test-phase-o1\.mjs/);
});
