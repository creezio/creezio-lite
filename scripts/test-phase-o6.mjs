#!/usr/bin/env node
/**
 * Phase O6 — Certivan dé-TF (migrations / queries catering).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dockerRoot = path.resolve(root, "..");
const cv = path.join(dockerRoot, "certivan-app");
const PAPERCLIP_RE = /paperclipApi|startPaperclip\b|paperclip-launcher/;

const TOMBSTONE_STEPS = [
  "001_base.ts",
  "006_agregateurs.ts",
  "007_drop_statut_scrape.ts",
  "008_catalogue_enrichi.ts",
  "009_commandes.ts",
  "010_category_images.ts",
  "013_conditions_fournisseur.ts",
  "014_sku_coverage.ts",
  "015_commande_versions_sku_mapping.ts",
  "019_panier_sku_default.ts",
  "021_hermes.ts",
];

const DELETED_LIBS = [
  "crm/src/lib/queries.ts",
  "crm/src/lib/commande-queries.ts",
  "crm/src/lib/catalog-queries.ts",
  "crm/src/lib/version-queries.ts",
  "crm/src/lib/version-types.ts",
  "crm/src/lib/rayons.ts",
  "crm/src/lib/statut.ts",
];

test("O6.1 PHASE-O6.md + PLAN-O O6", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-O6.md"), "utf8");
  assert.match(phase, /dé-TF|drop-tempoflow-catering|tombstone/i);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-o6/);
  assert.doesNotMatch(phase, PAPERCLIP_RE);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-O.md"), "utf8");
  assert.match(plan, /## O6 — Certivan dé-TF/);
  assert.match(plan, /PHASE-O6\.md/);
  assert.match(plan, /O6 — Certivan dé-TF.*✅|## O6 —[\s\S]*?✅/);
});

test("O6.2 tombstones catering + step 043 drop", () => {
  const stepsDir = path.join(cv, "crm/electron/migrations/steps");
  for (const rel of TOMBSTONE_STEPS) {
    const body = fs.readFileSync(path.join(stepsDir, rel), "utf8");
    assert.match(body, /tombstone/i, `${rel} doit être tombstone`);
    assert.doesNotMatch(
      body,
      /CREATE TABLE IF NOT EXISTS (produits|fournisseurs|skus|commandes)\b/,
      `${rel} ne doit plus créer de tables catering`,
    );
  }

  const drop = fs.readFileSync(
    path.join(stepsDir, "043_drop_tempoflow_catering.ts"),
    "utf8",
  );
  assert.match(drop, /version:\s*43/);
  assert.match(drop, /TEMPOFLOW_CATERING_TABLES/);
  assert.match(drop, /DROP TABLE IF EXISTS/);
  assert.match(drop, /produits/);
  assert.match(drop, /fournisseurs/);
  assert.match(drop, /commandes/);

  const index = fs.readFileSync(path.join(stepsDir, "index.ts"), "utf8");
  assert.match(index, /043_drop_tempoflow_catering/);
  assert.match(index, /dropTempoflowCatering|drop-tempoflow-catering/);
  assert.match(index, /FRESH_MIGRATIONS/);
});

test("O6.3 libs catering absentes + queries métier", () => {
  for (const rel of DELETED_LIBS) {
    assert.ok(
      !fs.existsSync(path.join(cv, rel)),
      `encore présent : ${rel}`,
    );
  }

  const searchFb = path.join(cv, "crm/src/lib/search-sql-fallback.ts");
  assert.ok(fs.existsSync(searchFb), "search-sql-fallback.ts manquant");
  const fb = fs.readFileSync(searchFb, "utf8");
  assert.match(fb, /dossiers_vasp/);
  assert.match(fb, /vehicules/);
  assert.doesNotMatch(fb, /\bFROM skus\b|\bFROM produits\b|\bFROM fournisseurs\b/);

  const host = fs.readFileSync(
    path.join(cv, "crm/src/lib/brand-host.ts"),
    "utf8",
  );
  assert.match(host, /CERTIVAN_CRUD_WHITELIST/);
  assert.match(host, /dossiers_vasp/);
  assert.doesNotMatch(host, /crudAllowlist:\s*TEMPOFLOW_CRUD_WHITELIST/);
  assert.match(host, /configureCertivanDatabaseHost/);

  // O4r2+ : tools métier dans modules/mcp-tools (bridge = façade mince)
  const tools = fs.readFileSync(
    path.join(cv, "crm/modules/mcp-tools.ts"),
    "utf8",
  );
  assert.match(tools, /module\.rti\./);
  assert.doesNotMatch(tools, /getOrCreatePanier|commande-queries|module\.panier/);
  assert.doesNotMatch(tools, /add_to_cart/);
  const bridge = fs.readFileSync(
    path.join(cv, "crm/src/lib/assistant/mcp-bridge.ts"),
    "utf8",
  );
  assert.match(bridge, /createCertivanBrandMcp/);
  assert.doesNotMatch(bridge, /add_to_cart|getOrCreatePanier/);

  const openTab = fs.readFileSync(
    path.join(cv, "crm/src/lib/open-external-tab.ts"),
    "utf8",
  );
  assert.doesNotMatch(openTab, /getFournisseur|@\/lib\/queries/);

  const ctx = fs.readFileSync(
    path.join(cv, "crm/src/server/routes/context.ts"),
    "utf8",
  );
  assert.match(ctx, /listDossiersVasp|dossier-queries/);
  assert.doesNotMatch(ctx, /listProduits|getOrCreatePanier|@\/lib\/queries/);
});

test("O6.4 Paperclip mort + gate npm test", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-O6.md"), "utf8");
  assert.doesNotMatch(phase, PAPERCLIP_RE);
  const drop = fs.readFileSync(
    path.join(cv, "crm/electron/migrations/steps/043_drop_tempoflow_catering.ts"),
    "utf8",
  );
  assert.doesNotMatch(drop, PAPERCLIP_RE);

  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkg, /test-phase-o6\.mjs/);
});
