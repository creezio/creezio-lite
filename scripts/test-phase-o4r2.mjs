#!/usr/bin/env node
/**
 * Phase O4r2 — Un registre MCP unique (façade marque = SoT).
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

test("O4r2.1 ADR + PHASE-O4r2 + PLAN-O", () => {
  const adr = fs.readFileSync(
    path.join(root, "docs/adr/ADR-assistant-tools-mcp.md"),
    "utf8",
  );
  assert.match(adr, /O4r2/);
  assert.match(adr, /create\*BrandMcp|brand-mcp\.ts/);
  assert.match(adr, /mini-registre|second SoT|handlers en dur/i);

  const phase = fs.readFileSync(
    path.join(root, "docs/archive/PHASE-O4r2.md"),
    "utf8",
  );
  assert.match(phase, /test-phase-o4r2/);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /create\*BrandMcp|brand-mcp/);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-O.md"), "utf8");
  assert.match(plan, /## O4r2 —/);
  assert.match(plan, /PHASE-O4r2\.md/);
});

test("O4r2.2 factory brand-mcp + brand-module-api ×3", () => {
  for (const b of BRANDS) {
    const brandMcp = path.join(
      dockerRoot,
      b.id,
      "crm/electron/modules/brand-mcp.ts",
    );
    assert.ok(fs.existsSync(brandMcp), `${b.label}: brand-mcp manquant`);
    const src = fs.readFileSync(brandMcp, "utf8");
    assert.match(src, new RegExp(`export function ${b.factory}`));
    assert.match(src, /createBrandMcpFacade|createMcpFacade/);
    assert.match(src, /create\w+ModuleMcpTools/);

    const api = path.join(
      dockerRoot,
      b.id,
      "crm/src/lib/brand-module-api.ts",
    );
    assert.ok(fs.existsSync(api), `${b.label}: brand-module-api manquant`);
    assert.match(fs.readFileSync(api, "utf8"), /createApiKernel/);
  }
});

test("O4r2.3 mcp-bridge mince ×3 (pas de handlers métier)", () => {
  for (const b of BRANDS) {
    const bridge = fs.readFileSync(
      path.join(dockerRoot, b.id, "crm/src/lib/assistant/mcp-bridge.ts"),
      "utf8",
    );
    assert.match(
      bridge,
      new RegExp(b.factory),
      `${b.label}: bridge doit appeler ${b.factory}`,
    );
    assert.match(bridge, /mcpFacadeToAssistantConfig/);
    assert.doesNotMatch(
      bridge,
      /^\s*handler\s*:/m,
      `${b.label}: handler métier encore dans mcp-bridge`,
    );
    assert.doesNotMatch(
      bridge,
      /name:\s*["']module\./,
      `${b.label}: catalogue module.* hardcodé dans mcp-bridge`,
    );
    assert.doesNotMatch(bridge, /add_to_cart/);
  }
});

test("O4r2.4 Electron brand-runtime utilise create*BrandMcp", () => {
  for (const b of BRANDS) {
    const rt = fs.readFileSync(
      path.join(dockerRoot, b.id, "crm/electron/brand-runtime.ts"),
      "utf8",
    );
    assert.match(
      rt,
      new RegExp(b.factory),
      `${b.label}: brand-runtime sans ${b.factory}`,
    );
    assert.doesNotMatch(
      rt,
      /discoverToolsBySpace:\s*async\s*\(\)\s*=>\s*\(\{\s*module:\s*create\w+ModuleMcpTools/,
      `${b.label}: encore discoverToolsBySpace inline (jumeau)`,
    );
  }
});

test("O4r2.5 preuves métier dans mcp-tools (pas bridge)", () => {
  const tf = fs.readFileSync(
    path.join(dockerRoot, "tempoflow2/crm/electron/modules/mcp-tools.ts"),
    "utf8",
  );
  assert.match(tf, /module\.panier\.add_ligne/);
  assert.match(tf, /module\.statut\.set/);

  const cv = fs.readFileSync(
    path.join(dockerRoot, "certivan-app/crm/electron/modules/mcp-tools.ts"),
    "utf8",
  );
  assert.match(cv, /module\.rti\./);
  assert.doesNotMatch(cv, /module\.panier/);

  const fidu = fs.readFileSync(
    path.join(dockerRoot, "fidu/crm/electron/modules/mcp-tools.ts"),
    "utf8",
  );
  assert.match(fidu, /module\.accounting\.query/);
  assert.ok(
    fs.existsSync(
      path.join(
        dockerRoot,
        "fidu/crm/electron/modules/accounting/api-mount.ts",
      ),
    ),
  );
});

test("O4r2.6 TOOL_DEFINITIONS stubs absents ×3", () => {
  for (const b of BRANDS) {
    const prompts = fs.readFileSync(
      path.join(dockerRoot, b.id, "crm/src/lib/assistant/prompts.ts"),
      "utf8",
    );
    assert.doesNotMatch(
      prompts,
      /export const TOOL_DEFINITIONS/,
      `${b.label}: TOOL_DEFINITIONS stub encore présent`,
    );
  }
});

test("O4r2.7 gate enregistrée npm test", () => {
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkg, /test-phase-o4r2\.mjs/);
});
