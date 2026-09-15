#!/usr/bin/env node
/**
 * Phase O4r — Remédiation assistant tools → MCP / kit (TF → CV → Fidu).
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
  { id: "tempoflow2", label: "TF" },
  { id: "certivan-app", label: "CV" },
  { id: "fidu", label: "Fidu" },
];

test("O4r.1 ADR + PHASE-O4r + PLAN-O", () => {
  const adr = fs.readFileSync(
    path.join(root, "docs/adr/ADR-assistant-tools-mcp.md"),
    "utf8",
  );
  assert.match(adr, /BrandTools\.executeTool|brand-chat-tools/);
  assert.match(adr, /MCP registry|discovery MCP/i);
  assert.doesNotMatch(adr, PAPERCLIP_RE);

  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-O4r.md"), "utf8");
  assert.match(phase, /test-phase-o4r/);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /module\.panier|module\.rti|module\.accounting/);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-O.md"), "utf8");
  assert.match(plan, /## O4r — Remédiation assistant tools/);
  assert.match(plan, /PHASE-O4r\.md/);
});

test("O4r.2 brand-chat-tools absent ×3 + mcp/tasks wiring", () => {
  for (const b of BRANDS) {
    const dead = path.join(
      dockerRoot,
      b.id,
      "crm/src/lib/assistant/brand-chat-tools.ts",
    );
    assert.ok(!fs.existsSync(dead), `${b.label}: brand-chat-tools encore présent`);

    const mcp = path.join(
      dockerRoot,
      b.id,
      "crm/src/lib/assistant/mcp-bridge.ts",
    );
    assert.ok(fs.existsSync(mcp), `${b.label}: mcp-bridge manquant`);

    const tasks = path.join(
      dockerRoot,
      b.id,
      "crm/src/lib/assistant/tasks-adapter.ts",
    );
    assert.ok(fs.existsSync(tasks), `${b.label}: tasks-adapter manquant`);

    const cfg = fs.readFileSync(
      path.join(dockerRoot, b.id, "crm/src/lib/assistant/brand-config.ts"),
      "utf8",
    );
    assert.match(cfg, /\bmcp:\s*/, `${b.label}: mcp: manquant`);
    assert.match(cfg, /\btasks:\s*/, `${b.label}: tasks: manquant`);
    assert.doesNotMatch(
      cfg,
      /executeTool:\s*brandExecuteTool|from ["']@\/lib\/assistant\/brand-chat-tools["']/,
      `${b.label}: encore executeTool brand-chat-tools`,
    );
    assert.match(cfg, /auth:\s*\{/);
    assert.match(cfg, /workSkills|sessionIdPrefix/);
  }
});

test("O4r.3 preuves métier TF panier / CV rti / Fidu accounting", () => {
  // O4r2 : SoT = modules/mcp-tools (bridge = adaptateur mince)
  const tf = fs.readFileSync(
    path.join(dockerRoot, "tempoflow2/crm/electron/modules/mcp-tools.ts"),
    "utf8",
  );
  assert.match(tf, /module\.panier\.add_ligne/);
  assert.match(tf, /module\.panier\.get/);
  assert.doesNotMatch(tf, /add_to_cart/);

  const cv = fs.readFileSync(
    path.join(dockerRoot, "certivan-app/crm/electron/modules/mcp-tools.ts"),
    "utf8",
  );
  assert.match(cv, /module\.rti\./);
  assert.doesNotMatch(cv, /module\.panier|add_to_cart/);

  const fidu = fs.readFileSync(
    path.join(dockerRoot, "fidu/crm/electron/modules/mcp-tools.ts"),
    "utf8",
  );
  assert.match(fidu, /module\.accounting\.query/);
  assert.doesNotMatch(fidu, /add_to_cart/);
});

test("O4r.4 kit PLATFORM + MCP bridge + pas executeTool SoT", () => {
  const platform = path.join(
    root,
    "packages/assistant/src/runtime/platform-tool-definitions.ts",
  );
  assert.ok(fs.existsSync(platform));
  const plat = fs.readFileSync(platform, "utf8");
  assert.match(plat, /PLATFORM_TOOL_DEFINITIONS/);
  assert.match(plat, /create_task/);
  assert.doesNotMatch(plat, /add_to_cart/);

  const chat = fs.readFileSync(
    path.join(root, "packages/assistant/src/runtime/assistant-chat.ts"),
    "utf8",
  );
  assert.match(chat, /callAssistantMcpTool|ensureMcpToolCache/);
  assert.match(chat, /executeTaskTool/);
  assert.doesNotMatch(chat, /assistantBrandTools\(\)\.executeTool/);
  assert.doesNotMatch(chat, PAPERCLIP_RE);

  const mcpTools = fs.readFileSync(
    path.join(root, "packages/assistant/src/runtime/mcp-tools.ts"),
    "utf8",
  );
  assert.match(mcpTools, /mcpFacadeToAssistantConfig/);

  const index = fs.readFileSync(
    path.join(root, "packages/assistant/src/index.ts"),
    "utf8",
  );
  assert.match(index, /mcpFacadeToAssistantConfig/);
  assert.match(index, /PLATFORM_TOOL_DEFINITIONS/);
  assert.match(index, /AssistantMcpConfig/);
});

test("O4r.5 gate enregistrée npm test", () => {
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkg, /test-phase-o4r\.mjs/);
});
