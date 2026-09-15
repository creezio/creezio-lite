#!/usr/bin/env node
/**
 * Phase O9 — Jumeaux lib/UI plateforme → kit (extract only).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dockerRoot = path.resolve(root, "..");
const PAPERCLIP_RE = /paperclipApi|startPaperclip\b|paperclip-launcher/;

const SHELL_SRC = [
  "packages/shell-ui/src/brand.ts",
  "packages/shell-ui/src/lib/api-scopes.ts",
  "packages/shell-ui/src/lib/utils.ts",
  "packages/shell-ui/src/lib/public-origin.ts",
  "packages/shell-ui/src/lib/page-trails.ts",
  "packages/shell-ui/src/lib/ops-track.ts",
  "packages/shell-ui/ui/index.ts",
  "packages/shell-ui/ui/primitives/button.tsx",
  "packages/shell-ui/ui/settings/desktop-n8n-settings.tsx",
  "packages/shell-ui/ui/workspace/workspace-tab-bar.tsx",
  "packages/shell-ui/ui/workspace/tab-workspace-host.ts",
  "packages/shell-ui/ui/workspace/tab-workspace-context.tsx",
  "packages/shell-ui/ui/workspace/workspace-shell.tsx",
  "packages/shell-ui/ui/workspace/workspace-root.tsx",
  "packages/shell-ui/ui/layout/sidebar.tsx",
  "packages/shell-ui/ui/search/global-search-provider.tsx",
  "packages/shell-ui/ui/desktop/external-site-slot.tsx",
  "packages/shell-ui/ui/lib/desktop-host.ts",
  "packages/tasks/ui/index.ts",
  "packages/tasks/ui/tasks-kanban-client.tsx",
  "packages/tasks/ui/task-detail-sheet.tsx",
  "packages/tasks/ui/ai-activity-panel.tsx",
];

/** Jumeaux plateforme — absents après O9p. */
const BRAND_TWINS = [
  "src/lib/api-scopes.ts",
  "src/lib/utils.ts",
  "src/components/ui/button.tsx",
  "src/components/settings/desktop-n8n-settings.tsx",
  "src/components/tasks/tasks-kanban-client.tsx",
];

const BRANDS = [
  { name: "tempoflow2", dir: "tempoflow2/crm" },
  { name: "certivan-app", dir: "certivan-app/crm" },
];

function walkTs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist") continue;
      out.push(...walkTs(p));
    } else if (/\.(ts|tsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

test("O9.1 PHASE-O9.md + PLAN-O O9", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-O9.md"), "utf8");
  assert.match(phase, /shell-ui|tasks\/ui|Sign-off|gates verts/i);
  assert.match(phase, /test-phase-o9/);
  assert.match(phase, /configureShellUiBrand|api-scopes/);
  assert.doesNotMatch(phase, PAPERCLIP_RE);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-O.md"), "utf8");
  assert.match(plan, /## O9 — Jumeaux lib\/UI/);
  assert.match(plan, /O9 — Jumeaux lib\/UI.*✅|PHASE-O9/);
});

test("O9.2 modules kit présents + exports", () => {
  for (const rel of SHELL_SRC) {
    assert.ok(fs.existsSync(path.join(root, rel)), rel);
  }
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "packages/shell-ui/package.json"), "utf8"),
  );
  assert.ok(pkg.exports["./ui"], "shell-ui exports ./ui");
  const tasksPkg = JSON.parse(
    fs.readFileSync(path.join(root, "packages/tasks/package.json"), "utf8"),
  );
  assert.ok(tasksPkg.exports["./ui"], "tasks exports ./ui");

  const index = fs.readFileSync(
    path.join(root, "packages/shell-ui/src/index.ts"),
    "utf8",
  );
  assert.match(index, /configureShellUiBrand/);
  assert.match(index, /normalizeApiScopes/);
  assert.match(index, /trailForRequestLogs/);
  assert.match(index, /resolvePublicOrigin/);
});

test("O9.3 pas de @/ ni Paperclip ni hardcode TF desktop API", () => {
  const dirs = [
    path.join(root, "packages/shell-ui/src/lib"),
    path.join(root, "packages/shell-ui/ui"),
    path.join(root, "packages/tasks/ui"),
  ];
  for (const dir of dirs) {
    for (const f of walkTs(dir)) {
      const body = fs.readFileSync(f, "utf8");
      assert.doesNotMatch(body, PAPERCLIP_RE, f);
      assert.doesNotMatch(body, /from ["']@\//, `@/ interdit: ${f}`);
      assert.doesNotMatch(
        body,
        /window\.tempoflowDesktop/,
        `desktop API hardcode: ${f}`,
      );
      // Labels métier TF interdits dans UI kit (ADR-no-brand-domain)
      assert.doesNotMatch(
        body,
        /Site fournisseur/,
        `label TF interdit: ${f}`,
      );
    }
  }
  const bridge = fs.readFileSync(
    path.join(root, "packages/shell-ui/ui/desktop/desktop-bridge.tsx"),
    "utf8",
  );
  assert.match(bridge, /Site externe/);
  assert.match(bridge, /OpenExternalSiteOpts|onExternalTabOpened/);
  const brand = fs.readFileSync(
    path.join(root, "packages/shell-ui/src/brand.ts"),
    "utf8",
  );
  assert.match(brand, /configureShellUiBrand/);
  assert.match(brand, /desktopApiGlobal/);
  assert.match(brand, /publicHostSuffix/);
  assert.match(brand, /productName/);
});

test("O9.4 jumeaux marques absents (cutover O9p)", () => {
  for (const b of BRANDS) {
    const base = path.join(dockerRoot, b.dir);
    for (const rel of BRAND_TWINS) {
      const p = path.join(base, rel);
      assert.ok(!fs.existsSync(p), `${b.name}: jumeau encore présent: ${rel}`);
    }
  }
  const fiduBtn = path.join(
    dockerRoot,
    "fidu/crm/src/components/ui/button.tsx",
  );
  assert.ok(!fs.existsSync(fiduBtn), "fidu button twin encore présent");
});

test("O9.5 smoke configureShellUiBrand + api-scopes", async () => {
  const {
    configureShellUiBrand,
    getShellUiBrand,
    resetShellUiBrandForTests,
    normalizeApiScopes,
    API_SCOPE_FULL,
    trailForRequestLogs,
  } = await import("../packages/shell-ui/dist/index.js");

  resetShellUiBrandForTests();
  configureShellUiBrand({
    desktopApiGlobal: "tempoflowDesktop",
    publicHostSuffix: "tempoflow.fr",
    productName: "TempoFlow",
  });
  const b = getShellUiBrand();
  assert.equal(b.desktopApiGlobal, "tempoflowDesktop");
  assert.equal(b.publicHostSuffix, "tempoflow.fr");
  assert.equal(normalizeApiScopes("crm:write"), "crm:read,crm:write");
  assert.equal(normalizeApiScopes(null), API_SCOPE_FULL);
  assert.ok(trailForRequestLogs().length >= 2);
  resetShellUiBrandForTests();
});
