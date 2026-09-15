#!/usr/bin/env node
/**
 * Phase N6 — Admin Plugins / MCP / analytics génériques → kit.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAPERCLIP_RE = /paperclipApi|startPaperclip\b|paperclip-launcher/;
const METIER_RE =
  /agregateur|data-mapping|panier|fournisseur|tf2_|TEMPOFLOW_|paperclip/i;

function loc(file) {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

function walkTs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkTs(p));
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

const REQUIRED = {
  "packages/mcp-facade/src/admin/mcp-admin.ts": 300,
  "packages/mcp-facade/src/admin/http-routes.ts": 80,
  "packages/mcp-facade/ui/mcp-admin-client.tsx": 200,
  "packages/observability/src/usage/usage-analytics.ts": 400,
  "packages/observability/ui/usage-analytics-client.ts": 400,
  "packages/observability/src/usage/usage-analytics-productivity.ts": 350,
  "packages/observability/src/usage/http-routes.ts": 150,
  "packages/observability/ui/analytics-client.tsx": 700,
  "packages/observability/ui/analytics-productivity-panel.tsx": 400,
  "packages/observability/ui/usage-analytics-provider.tsx": 50,
  "packages/product-hub/src/plugin-ui/helpers.ts": 100,
  "packages/product-hub/ui/plugins-list.tsx": 500,
  "packages/product-hub/ui/plugin-detail.tsx": 900,
};

test("N6.1 PHASE-N6.md + PLAN-N", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-N6.md"), "utf8");
  assert.match(phase, /Admin Plugins|MCP|analytics/i);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-n6/);
  assert.match(phase, /product-hub\/ui|mcp-facade|observability/);
  assert.match(phase, /Paperclip = mort/);
  assert.match(phase, /Exclu/);
  assert.doesNotMatch(phase, PAPERCLIP_RE);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-N.md"), "utf8");
  assert.match(plan, /## N6 — Admin Plugins \/ MCP \/ analytics/);
  assert.match(plan, /PHASE-N6\.md/);
  assert.match(plan, /Done|livr|Sign-off/i);
});

test("N6.2 modules requis + LOC floors", () => {
  for (const [rel, min] of Object.entries(REQUIRED)) {
    const p = path.join(root, rel);
    assert.ok(fs.existsSync(p), `manquant: ${rel}`);
    assert.ok(loc(p) >= min, `${rel} trop court: ${loc(p)} < ${min}`);
  }
});

test("N6.3 exports publics + ./ui", () => {
  for (const pkg of ["mcp-facade", "observability", "product-hub"]) {
    const pkgJson = JSON.parse(
      fs.readFileSync(
        path.join(root, `packages/${pkg}/package.json`),
        "utf8",
      ),
    );
    assert.ok(pkgJson.exports?.["./ui"], `${pkg} exports ./ui manquant`);
    const idx = fs.readFileSync(
      path.join(root, `packages/${pkg}/ui/index.ts`),
      "utf8",
    );
    assert.ok(idx.length > 40, `${pkg}/ui/index.ts vide`);
  }

  const mcpIdx = fs.readFileSync(
    path.join(root, "packages/mcp-facade/src/index.ts"),
    "utf8",
  );
  for (const sym of [
    "configureMcpAdmin",
    "createMcpAdminRoutes",
    "ensureMcpAdminSchema",
    "listMcpToolPolicies",
  ]) {
    assert.match(mcpIdx, new RegExp(sym), `mcp-facade export ${sym}`);
  }

  const obsIdx = fs.readFileSync(
    path.join(root, "packages/observability/src/index.ts"),
    "utf8",
  );
  for (const sym of [
    "configureUsageAnalytics",
    "createUsageAnalyticsIngestRoutes",
    "createUsageAnalyticsAdminRoutes",
    "recordUsageEvent",
    "getProductivityReport",
  ]) {
    assert.match(obsIdx, new RegExp(sym), `observability export ${sym}`);
  }

  const uiObsIdx = fs.readFileSync(
    path.join(root, "packages/observability/ui/index.ts"),
    "utf8",
  );
  for (const sym of [
    "flushUsageAnalytics",
    "setUsageAnalyticsSession",
    "trackUsagePageView",
    "ensureUsageAnalyticsDom",
  ]) {
    assert.match(uiObsIdx, new RegExp(sym), `observability/ui export ${sym}`);
  }

  const phIdx = fs.readFileSync(
    path.join(root, "packages/product-hub/src/index.ts"),
    "utf8",
  );
  assert.match(phIdx, /configureProductHubUiBrand/);
  assert.match(phIdx, /pluginSidebarItems/);
  assert.doesNotMatch(phIdx, /"admin-ui-plugins"/);

  const uiPh = fs.readFileSync(
    path.join(root, "packages/product-hub/ui/index.ts"),
    "utf8",
  );
  assert.match(uiPh, /AdminPluginsList/);
  assert.match(uiPh, /AdminPluginDetail/);

  const uiMcp = fs.readFileSync(
    path.join(root, "packages/mcp-facade/ui/index.ts"),
    "utf8",
  );
  assert.match(uiMcp, /McpAdminClient/);

  const mcpAdminPages = [
    "packages/os-ui/routes/admin/mcp/page.tsx",
    "packages/os-ui/routes/mcp/page.tsx",
    "packages/os-ui/routes/developers/page.tsx",
  ];
  for (const rel of mcpAdminPages) {
    const page = fs.readFileSync(path.join(root, rel), "utf8");
    assert.match(page, /RequestLogsClient/);
    assert.match(page, /logsSlot=\{<RequestLogsClient \/>\}/);
  }
  const factoryOsUi = fs.readFileSync(
    path.join(root, "packages/factory/src/generators/os-ui.ts"),
    "utf8",
  );
  assert.match(factoryOsUi, /logsSlot=\{<RequestLogsClient \/>\}/);

  const uiObs = fs.readFileSync(
    path.join(root, "packages/observability/ui/index.ts"),
    "utf8",
  );
  assert.match(uiObs, /AnalyticsClient/);
  assert.match(uiObs, /UsageAnalyticsProvider/);
});

test("N6.4 budget LOC extract N6 (floor + ceiling)", () => {
  const dirs = [
    "packages/mcp-facade/src/admin",
    "packages/mcp-facade/ui",
    "packages/observability/src/usage",
    "packages/observability/ui",
    "packages/product-hub/src/plugin-ui",
    "packages/product-hub/ui",
  ];
  let total = 0;
  for (const d of dirs) {
    for (const f of walkTs(path.join(root, d))) total += loc(f);
  }
  assert.ok(total > 4500, `LOC N6 trop bas: ${total}`);
  assert.ok(total < 12000, `LOC N6 trop haut (scope creep): ${total}`);
});

test("N6.5 pas de métier agregateurs/data-mapping/Paperclip", () => {
  const dirs = [
    "packages/mcp-facade/src/admin",
    "packages/mcp-facade/ui",
    "packages/observability/src/usage",
    "packages/observability/ui",
    "packages/product-hub/src/plugin-ui",
    "packages/product-hub/ui",
  ];
  for (const d of dirs) {
    for (const f of walkTs(path.join(root, d))) {
      const body = fs.readFileSync(f, "utf8");
      assert.doesNotMatch(
        body,
        /agregateur|data-mapping|paperclipApi|startPaperclip/i,
        `métier/paperclip dans ${path.relative(root, f)}`,
      );
      assert.doesNotMatch(body, /from ["']@\//, `@/ marque dans ${f}`);
    }
  }
});

test("N6.6 adapters injectables + demobrand I5 inchangé", () => {
  const mcpAd = fs.readFileSync(
    path.join(root, "packages/mcp-facade/src/admin/adapters.ts"),
    "utf8",
  );
  assert.match(mcpAd, /configureMcpAdmin/);

  const uaAd = fs.readFileSync(
    path.join(root, "packages/observability/src/usage/adapters.ts"),
    "utf8",
  );
  assert.match(uaAd, /configureUsageAnalytics/);

  const brand = fs.readFileSync(
    path.join(root, "packages/product-hub/src/plugin-ui/brand.ts"),
    "utf8",
  );
  assert.match(brand, /desktopApiGlobal/);
  assert.match(brand, /configureProductHubUiBrand/);

  // demobrand ACL I5 reste (surface distincte Product Hub React)
  assert.ok(
    fs.existsSync(
      path.join(root, "apps/demobrand/resources/renderer/admin-plugins.html"),
    ),
  );
  assert.ok(
    fs.existsSync(
      path.join(root, "apps/demobrand/src/electron/admin-plugins-api.ts"),
    ),
  );
});
