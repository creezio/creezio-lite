#!/usr/bin/env node
/**
 * Phase O4r3 — Hono `/mcp` consomme create*BrandMcp (même SoT qu'Electron + assistant).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dockerRoot = path.resolve(root, "..");

const BRANDS = [
  {
    id: "tempoflow2",
    label: "TF",
    factory: "createTempoflowBrandMcp",
  },
  {
    id: "certivan-app",
    label: "CV",
    factory: "createCertivanBrandMcp",
  },
  {
    id: "fidu",
    label: "Fidu",
    factory: "createFiduBrandMcp",
  },
];

test("O4r3.1 kit bindFacadeToolsToHono exporté", () => {
  const idx = fs.readFileSync(
    path.join(root, "packages/mcp-facade/src/index.ts"),
    "utf8",
  );
  assert.match(idx, /bindFacadeToolsToHono/);
  assert.match(idx, /mcpFacadeResultToSdk/);
  assert.ok(
    fs.existsSync(path.join(root, "packages/mcp-facade/src/hono-bind.ts")),
  );
});

test("O4r3.2 ADR + PHASE-O4r3 + PLAN-O", () => {
  const adr = fs.readFileSync(
    path.join(root, "docs/adr/ADR-assistant-tools-mcp.md"),
    "utf8",
  );
  assert.match(adr, /O4r3/);
  assert.match(adr, /bindFacadeToolsToHono|Hono.*create\*BrandMcp|même SoT/i);

  const phase = fs.readFileSync(
    path.join(root, "docs/archive/PHASE-O4r3.md"),
    "utf8",
  );
  assert.match(phase, /test-phase-o4r3/);
  assert.match(phase, /Sign-off|gates/i);
  assert.match(phase, /bindFacadeToolsToHono/);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-O.md"), "utf8");
  assert.match(plan, /## O4r3 —/);
  assert.match(plan, /PHASE-O4r3\.md/);
});

test("O4r3.3 Hono server.ts ×3 utilise factory + bind", () => {
  for (const b of BRANDS) {
    const server = fs.readFileSync(
      path.join(dockerRoot, b.id, "crm/src/server/mcp/server.ts"),
      "utf8",
    );
    assert.match(
      server,
      new RegExp(b.factory),
      `${b.label}: server sans ${b.factory}`,
    );
    assert.match(
      server,
      /bindFacadeToolsToHono/,
      `${b.label}: server sans bindFacadeToolsToHono`,
    );
    assert.match(
      server,
      /async function buildMcpServer|export async function buildMcpServer/,
      `${b.label}: buildMcpServer doit être async`,
    );
  }
});

test("O4r3.4 TF : 0 handlers métier panier/catalogue dupliqués dans server.ts", () => {
  const server = fs.readFileSync(
    path.join(dockerRoot, "tempoflow2/crm/src/server/mcp/server.ts"),
    "utf8",
  );
  assert.doesNotMatch(server, /commande-queries/);
  assert.doesNotMatch(server, /lib\/queries/);
  assert.doesNotMatch(server, /["']get_panier["']/);
  assert.doesNotMatch(server, /["']search_products["']/);
  assert.doesNotMatch(server, /["']add_to_panier["']/);
  assert.doesNotMatch(server, /["']close_panier["']/);
  assert.match(server, /hono-host-tools|registerTempoflowHonoHostTools/);
});

test("O4r3.5 CV : list_dossiers/get_dossier/list_pieces absents du host", () => {
  const server = fs.readFileSync(
    path.join(dockerRoot, "certivan-app/crm/src/server/mcp/server.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    server,
    /registerMcpTool\(\s*server,\s*ctx,\s*\n\s*"list_dossiers"/,
  );
  assert.doesNotMatch(
    server,
    /registerMcpTool\(\s*server,\s*ctx,\s*\n\s*"get_dossier"/,
  );
  assert.doesNotMatch(
    server,
    /registerMcpTool\(\s*server,\s*ctx,\s*\n\s*"list_pieces"/,
  );
});

test("O4r3.6 mcp-tools TF couvre aliases O4r3 (close/update/product…)", () => {
  const tools = fs.readFileSync(
    path.join(dockerRoot, "tempoflow2/crm/electron/modules/mcp-tools.ts"),
    "utf8",
  );
  for (const name of [
    "module.panier.close",
    "module.panier.update_ligne",
    "module.catalogue.get_product",
    "module.catalogue.search_skus",
    "module.dispatch.list_commandes",
  ]) {
    assert.match(tools, new RegExp(name.replace(/\./g, "\\.")));
  }
  const aliases = fs.readFileSync(
    path.join(dockerRoot, "tempoflow2/crm/electron/modules/mcp-aliases.ts"),
    "utf8",
  );
  assert.match(aliases, /close_panier/);
  assert.match(aliases, /get_product/);
  assert.match(aliases, /list_commandes/);
});

test("O4r3.7 gate enregistrée npm test", () => {
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkg, /test-phase-o4r3\.mjs/);
});
