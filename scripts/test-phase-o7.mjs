#!/usr/bin/env node
/**
 * Phase O7 — Host wirings mince (host-stack / ctx / preload) + brand-host fusion.
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

const CEILINGS = {
  "electron/host-stack.ts": 80,
  "electron/host-runtime-ctx.ts": 100,
  "electron/preload-app.ts": 120,
};

const OLD_HOSTS = [
  "src/lib/brand-database-host.ts",
  "src/lib/brand-mcp-admin-host.ts",
  "src/lib/brand-usage-analytics-host.ts",
  "src/lib/brand-product-hub-ui-host.ts",
];

function loc(file) {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

test("O7.1 PHASE-O7.md + PLAN-O O7 livré", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-O7.md"), "utf8");
  assert.match(phase, /Host wirings mince/i);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-o7/);
  assert.match(phase, /≤80|≤100|≤120/);
  assert.match(phase, /createBrandHostStack|wireCrmHostPreload|createBrandHostRuntime/);
  assert.match(phase, /brand-host/);
  assert.match(phase, /NON done|façades/i);
  assert.doesNotMatch(phase, PAPERCLIP_RE);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-O.md"), "utf8");
  assert.match(plan, /## O7 — Host wirings mince/);
  assert.match(plan, /PHASE-O7\.md/);
});

test("O7.2 plafonds LOC host-stack / ctx / preload ×3", () => {
  for (const b of BRANDS) {
    for (const [rel, max] of Object.entries(CEILINGS)) {
      const file = path.join(b.dir, rel);
      assert.ok(fs.existsSync(file), `${b.name}: manquant ${rel}`);
      const n = loc(file);
      assert.ok(n <= max, `${b.name}: ${rel} ${n} > ${max}`);
      assert.ok(n > 5, `${b.name}: ${rel} trop court`);
    }
  }
});

test("O7.3 wirings consomment kit (pas de jumeau spawn/fleet inline)", () => {
  for (const b of BRANDS) {
    const stack = fs.readFileSync(
      path.join(b.dir, "electron/host-stack.ts"),
      "utf8",
    );
    assert.match(stack, /createBrandHostStack/);
    assert.match(stack, /@creezio\/electron-shell/);
    assert.doesNotMatch(stack, /function lazy\s*</);
    assert.doesNotMatch(stack, PAPERCLIP_RE);

    const ctx = fs.readFileSync(
      path.join(b.dir, "electron/host-runtime-ctx.ts"),
      "utf8",
    );
    assert.match(ctx, /createBrandHostRuntime/);
    assert.doesNotMatch(ctx, PAPERCLIP_RE);

    const preload = fs.readFileSync(
      path.join(b.dir, "electron/preload-app.ts"),
      "utf8",
    );
    assert.match(preload, /wireCrmHostPreload|@creezio\/shell/);
    assert.doesNotMatch(preload, /function fleetClickLabel/);
    assert.doesNotMatch(preload, PAPERCLIP_RE);
  }
});

test("O7.4 kit exports O7 + shell preload CRM", () => {
  // H12 : createBrandHostStack / createBrandHostRuntime s'importent depuis
  // leur SoT @creezio/host-runtime (plus de ré-export compat electron-shell).
  const hostIdx = fs.readFileSync(
    path.join(root, "packages/host-runtime/src/index.ts"),
    "utf8",
  );
  assert.match(hostIdx, /createBrandHostStack/);
  assert.match(hostIdx, /createBrandHostRuntime/);
  assert.ok(
    fs.existsSync(
      path.join(root, "packages/host-runtime/src/brand-host-stack.ts"),
    ),
  );
  assert.ok(
    fs.existsSync(
      path.join(root, "packages/host-runtime/src/brand-host-runtime.ts"),
    ),
  );

  const shellPkg = fs.readFileSync(
    path.join(root, "packages/shell/src/index.ts"),
    "utf8",
  );
  assert.match(shellPkg, /wireCrmHostPreload/);
  assert.ok(
    fs.existsSync(
      path.join(root, "packages/shell/src/create-crm-host-preload.ts"),
    ),
  );
});

test("O7.5 fusion brand-*-host → brand-host.ts ×3", () => {
  for (const b of BRANDS) {
    assert.ok(
      fs.existsSync(path.join(b.dir, "src/lib/brand-host.ts")),
      `${b.name}: brand-host.ts manquant`,
    );
    for (const rel of OLD_HOSTS) {
      assert.ok(
        !fs.existsSync(path.join(b.dir, rel)),
        `${b.name}: ancien host encore présent ${rel}`,
      );
    }
    const host = fs.readFileSync(
      path.join(b.dir, "src/lib/brand-host.ts"),
      "utf8",
    );
    assert.match(host, /installDatabaseHost|configureFiduDatabaseHost|configureCertivanDatabaseHost/);
    assert.doesNotMatch(host, PAPERCLIP_RE);
  }
  // TF/CV : Product Hub client pointe brand-host
  for (const b of ["tempoflow2", "certivan-app"]) {
    const client = fs.readFileSync(
      path.join(dockerRoot, b, "crm/src/lib/brand-product-hub-ui-host-client.ts"),
      "utf8",
    );
    assert.match(client, /brand-host/);
    assert.doesNotMatch(client, /brand-product-hub-ui-host["']/);
  }
});

test("O7.6 gate enregistrée npm test", () => {
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkg, /test-phase-o7\.mjs/);
});
