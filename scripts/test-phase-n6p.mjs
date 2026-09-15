#!/usr/bin/env node
/**
 * Phase N6p — Cutover admin Plugins/MCP/analytics TF → Certivan.
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
];

const FORBIDDEN = [
  "src/components/admin/analytics-client.tsx",
  "src/components/admin/mcp-admin-client.tsx",
  "src/components/admin/analytics-productivity-panel.tsx",
];

const REQUIRED = [
  "src/lib/brand-host.ts",
  "src/lib/brand-product-hub-ui-host-client.ts",
  "src/components/admin/admin-mcp-host.tsx",
];

const PAGE_MOUNTS = [
  "src/app/admin/plugins/page.tsx",
  "src/app/admin/plugins/[id]/page.tsx",
  "src/app/admin/mcp/page.tsx",
  "src/app/admin/analytics/page.tsx",
];

function loc(file) {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

test("N6p.1 PHASE-N6p.md + PLAN-N N6p livré", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-N6p.md"), "utf8");
  assert.match(phase, /Cutover admin/i);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-n6p/);
  assert.match(phase, /Paperclip = mort/);
  assert.match(phase, /Exclu/);
  assert.doesNotMatch(phase, PAPERCLIP_RE);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-N.md"), "utf8");
  assert.match(plan, /## N6p — Cutover admin/);
  assert.match(plan, /PHASE-N6p\.md/);
  assert.match(plan, /Done|livr|Sign-off/i);
});

test("N6p.2 jumeaux UI absents TF+CV ; hosts + mounts présents ≤80", () => {
  for (const b of BRANDS) {
    assert.ok(fs.existsSync(b.dir), `crm manquant: ${b.name}`);
    for (const rel of FORBIDDEN) {
      assert.ok(
        !fs.existsSync(path.join(b.dir, rel)),
        `${b.name}: encore présent ${rel}`,
      );
    }
    for (const rel of REQUIRED) {
      assert.ok(
        fs.existsSync(path.join(b.dir, rel)),
        `${b.name}: manquant ${rel}`,
      );
    }
    for (const rel of PAGE_MOUNTS) {
      const p = path.join(b.dir, rel);
      assert.ok(fs.existsSync(p), `${b.name}: manquant ${rel}`);
      const n = loc(p);
      assert.ok(n <= 80, `${b.name}: ${rel} ${n} > 80`);
      const body = fs.readFileSync(p, "utf8");
      assert.match(
        body,
        /@creezio\/(product-hub|mcp-facade|observability)\/ui|AdminMcpHost/,
        `${b.name}: ${rel} ne consomme pas le kit UI`,
      );
    }
    // O2/O7 : façades lib absentes — brand-host unique + kit.
    assert.ok(!fs.existsSync(path.join(b.dir, "src/lib/mcp-admin.ts")));
    assert.ok(!fs.existsSync(path.join(b.dir, "src/lib/usage-analytics.ts")));
    assert.ok(fs.existsSync(path.join(b.dir, "src/lib/brand-host.ts")));
    assert.ok(
      !fs.existsSync(path.join(b.dir, "src/lib/brand-mcp-admin-host.ts")),
    );
    assert.ok(
      !fs.existsSync(path.join(b.dir, "src/lib/brand-usage-analytics-host.ts")),
    );
  }
});

test("N6p.3 kit UI dist imports + AdminPluginDetail + ui-brand export", () => {
  const detail = fs.readFileSync(
    path.join(root, "packages/product-hub/ui/plugin-detail.tsx"),
    "utf8",
  );
  assert.match(detail, /export function AdminPluginDetail/);
  assert.match(detail, /from \"\.\.\/dist\/plugin-ui/);
  assert.doesNotMatch(detail, /from \"\.\.\/src\//);

  const list = fs.readFileSync(
    path.join(root, "packages/product-hub/ui/plugins-list.tsx"),
    "utf8",
  );
  assert.match(list, /from \"\.\.\/dist\/plugin-ui/);

  const obsUi = fs.readFileSync(
    path.join(root, "packages/observability/ui/index.ts"),
    "utf8",
  );
  assert.match(obsUi, /configureUsageAnalyticsUiBrand/);
  assert.match(obsUi, /AnalyticsClient/);
});

test("N6p.4 Paperclip mort sur surfaces admin cutover", () => {
  for (const b of BRANDS) {
    const files = [
      ...REQUIRED.map((r) => path.join(b.dir, r)),
      ...PAGE_MOUNTS.map((r) => path.join(b.dir, r)),
      path.join(b.dir, "src/lib/brand-host.ts"),
    ];
    const corpus = files
      .filter((f) => fs.existsSync(f))
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");
    assert.doesNotMatch(corpus, PAPERCLIP_RE);
  }
});
