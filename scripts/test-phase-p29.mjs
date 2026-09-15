#!/usr/bin/env node
/**
 * Phase P29 — Kit sans domaine marque (ADR-no-brand-domain).
 * Vérifie SoT générique + aliases dépréciés ; ne casse pas le dual-read ops.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("P29.1 ADR documente SoT + aliases + Meili configure + ops dual-read", () => {
  const adr = read("docs/adr/ADR-no-brand-domain-in-native-packages.md");
  assert.match(adr, /OpenExternalSiteOpts/);
  assert.match(adr, /OpenSupplierSiteOpts/);
  assert.match(adr, /siteId/);
  assert.match(adr, /fournisseurId/);
  assert.match(adr, /external_\*/);
  assert.match(adr, /supplier_\*/);
  assert.match(adr, /configureMeiliCatalogSqlTables/);
  assert.match(adr, /TF2EVENT/);
  assert.match(adr, /OPS_EVENT_PREFIXES|CertivanEVENT/);
  assert.match(adr, /Hygiene P29|P29/);
});

test("P29.2 shell-ui : OpenExternalSiteOpts SoT (alias supplier purgés en H12)", () => {
  const host = read("packages/shell-ui/ui/workspace/tab-workspace-host.ts");
  assert.match(host, /export type OpenExternalSiteOpts/);
  assert.match(host, /normalizeOpenExternalSiteOpts/);
  // H12 : plus d'alias métier dans le module workspace.
  assert.doesNotMatch(host, /OpenSupplierSiteOpts|fournisseurId/);

  const ctx = read("packages/shell-ui/ui/workspace/tab-workspace-context.tsx");
  assert.match(ctx, /export type OpenExternalSiteOpts/);
  assert.match(ctx, /openExternalSite/);
  assert.doesNotMatch(ctx, /openSupplierSite|patchSupplierTab|fournisseurId/);

  const readme = read("packages/shell-ui/README.md");
  assert.match(readme, /OpenExternalSiteOpts/);
  assert.match(readme, /OpenSupplierSiteOpts|fournisseurId/);
  assert.match(readme, /ADR-no-brand-domain|P29/i);
});

test("P29.3 assistant : EXTERNAL_SITE_TOOL_NAMES + siteIdFromSurfaceHref SoT", () => {
  const ui = read("packages/assistant/src/runtime/ui-actions.ts");
  assert.match(ui, /export const EXTERNAL_SITE_TOOL_NAMES/);
  assert.match(ui, /@deprecated[\s\S]*SUPPLIER_TOOL_NAMES|SUPPLIER_TOOL_NAMES = EXTERNAL_SITE_TOOL_NAMES/);

  const surface = read("packages/assistant/src/runtime/active-surface.ts");
  assert.match(surface, /export function siteIdFromSurfaceHref/);
  assert.match(surface, /@deprecated[\s\S]*fournisseurIdFromSurfaceHref/);
  assert.match(surface, /export function parseExternalTabSummaries|export type ExternalTabSummary/);

  const index = read("packages/assistant/src/index.ts");
  assert.match(index, /siteIdFromSurfaceHref/);
  assert.match(index, /fournisseurIdFromSurfaceHref/);

  const readme = read("packages/assistant/README.md");
  assert.match(readme, /EXTERNAL_SITE_TOOL_NAMES|external_\*/);
  assert.match(readme, /siteIdFromSurfaceHref|siteId/);
});

test("P29.4 tasks : wire web_* → external_* (supplier_* alias type)", () => {
  const agent = read("packages/tasks/src/ai-task-agent.ts");
  assert.match(agent, /external_list_targets/);
  assert.match(agent, /external_click/);
  assert.match(agent, /external_screenshot/);
  // Plus d'émission SoT supplier_* dans les execute web_*
  assert.doesNotMatch(
    agent,
    /webAction\(ctx,\s*"supplier_/,
    "webAction execute doit préférer external_*",
  );
  // Alias encore typé pour compat
  assert.match(agent, /supplier_list_targets/);

  const brand = read("packages/tasks/src/brand/config.ts");
  assert.match(brand, /siteId\?/);
  assert.match(brand, /site_id\?/);
});

test("P29.5 electron-shell : Meili tables configurables + driver external_*", () => {
  const schema = read("packages/search/src/meili/index-schema.ts");
  assert.match(schema, /configureMeiliCatalogSqlTables/);
  // H11 : plus d'alias `sites` → `fournisseurs` — fingerprintCountKey est
  // l'identité de la clé déclarée par la marque.
  assert.match(schema, /fingerprintCountKey/);
  assert.doesNotMatch(schema, /"sites"\s*\?\s*"fournisseurs"/);
  assert.match(schema, /getMeiliCatalogSqlTables/);

  const coherence = read("packages/search/src/meili/coherence-db.ts");
  assert.match(coherence, /getMeiliCatalogSqlTables/);

  // H12 : configureMeiliCatalogSqlTables s'importe depuis @creezio/search
  // (plus de ré-export compat electron-shell).
  const searchIdx = read("packages/search/src/index.ts");
  assert.match(searchIdx, /configureMeiliCatalogSqlTables/);

  // Depuis l'extraction browser-host, les verbes du driver vivent dans
  // shared-driver.ts (table partagée Electron/Chromium serveur). L'invariant
  // reste : SoT external_* + alias supplier_* normalisé, verbes list_targets
  // et screenshot supportés.
  const driver = read(
    "packages/electron-shell/src/host/browser-tabs/browser-tab-driver.ts",
  );
  assert.match(driver, /replace\(\/\^supplier_\//);
  assert.match(driver, /driverVerbOf/);
  assert.match(driver, /runDriverVerb/);
  const shared = read("packages/browser-host/src/shared-driver.ts");
  assert.match(shared, /case "list_targets"/);
  assert.match(shared, /case "screenshot"/);

  const actions = read("packages/host-runtime/src/ai-workspace/actions.ts");
  assert.match(actions, /external_/);
  assert.match(actions, /supplier_/);
});

test("P29.6 observability : TF2EVENT dual-read non cassé", () => {
  const types = read("packages/observability/src/ops/types.ts");
  assert.match(types, /TF2EVENT_PREFIX\s*=\s*"TF2EVENT "/);
  assert.match(types, /OPS_EVENT_PREFIX\s*=\s*TF2EVENT_PREFIX/);
  assert.match(types, /OPS_EVENT_PREFIXES/);
  assert.match(types, /CertivanEVENT /);
  assert.match(types, /dual-read|P29/);

  const readme = read("packages/observability/README.md");
  assert.match(readme, /TF2EVENT/);
  assert.match(readme, /CertivanEVENT|dual-read/);
});
