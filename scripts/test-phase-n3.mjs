#!/usr/bin/env node
/**
 * Phase N3 — Assistant générique → @creezio/assistant (kit only).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = path.join(root, "packages/assistant");
const src = path.join(pkg, "src");
const ui = path.join(pkg, "ui");
const PAPERCLIP_RE = /paperclipApi|startPaperclip\b|paperclip-launcher/;

const RUNTIME_REQUIRED = [
  "runtime/agent-loop.ts",
  "runtime/hermes-client.ts",
  "runtime/chat-db.ts",
  "runtime/modes.ts",
  "runtime/models.ts",
  "runtime/tool-trace.ts",
  "runtime/whisper.ts",
  "runtime/meili-rag.ts",
  "runtime/routing.ts",
  "runtime/active-surface.ts",
  "runtime/ui-actions.ts",
  "runtime/surface-router.ts",
  "brand/registry.ts",
  "brand/types.ts",
  "brand/app-map-shim.ts",
  "brand/prompts-shim.ts",
];

const UI_REQUIRED = [
  "assistant-widget.tsx",
  "assistant-provider.tsx",
  "ui-driver.tsx",
  "use-voice-input.ts",
  "index.ts",
];

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

test("N3.1 PHASE-N3.md + PLAN-N N3", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-N3.md"), "utf8");
  assert.match(phase, /Assistant/i);
  assert.match(phase, /4f37a9e|configureAssistantBrand|AssistantBrandTools/);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-n3/);
  assert.match(phase, /wc -l|LOC/i);
  assert.doesNotMatch(phase, PAPERCLIP_RE);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-N.md"), "utf8");
  assert.match(plan, /## N3 — Assistant marque → `@creezio\/assistant`/);
  assert.match(plan, /PHASE-N3\.md/);
  assert.match(plan, /Done|livr/i);
});

test("N3.2 runtime + brand modules présents", () => {
  for (const rel of RUNTIME_REQUIRED) {
    const p = path.join(src, rel);
    assert.ok(fs.existsSync(p), `manquant: ${rel}`);
    assert.ok(loc(p) > 10, `${rel} trop court`);
  }
  const reg = fs.readFileSync(path.join(src, "brand/registry.ts"), "utf8");
  assert.match(reg, /export function configureAssistantBrand/);
  const types = fs.readFileSync(path.join(src, "brand/types.ts"), "utf8");
  assert.match(types, /AssistantBrandTools/);
  assert.match(types, /AssistantAppMapConfig|AssistantAppPage/);
  assert.match(types, /AssistantPromptsConfig/);
});

test("N3.3 UI exportée via ./ui", () => {
  for (const rel of UI_REQUIRED) {
    const p = path.join(ui, rel);
    assert.ok(fs.existsSync(p), `UI manquante: ${rel}`);
  }
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(pkg, "package.json"), "utf8"),
  );
  assert.ok(pkgJson.exports?.["./ui"], "exports ./ui manquant");
  const idx = fs.readFileSync(path.join(ui, "index.ts"), "utf8");
  assert.match(idx, /AssistantWidget/);
  assert.match(idx, /AssistantProvider/);
});

test("N3.4 LOC runtime+UI ≫ store-only + exports publics", () => {
  const files = [...walkTs(src), ...walkTs(ui)];
  const total = files.reduce((n, f) => n + loc(f), 0);
  assert.ok(total > 5000, `LOC assistant trop bas: ${total}`);

  const index = fs.readFileSync(path.join(src, "index.ts"), "utf8");
  for (const sym of [
    "configureAssistantBrand",
    "createSqliteAssistantStore",
    "searchKnowledge",
    "parseAssistantMode",
    "resolveActiveSurface",
    "shouldPreferSearchKnowledge",
    "ASSISTANT_FAB_SAFE_PX",
  ]) {
    assert.match(index, new RegExp(sym), `export manquant: ${sym}`);
  }

  assert.ok(
    fs.existsSync(path.join(pkg, "dist/runtime/routing.js")),
    "dist runtime manquant — rebuild @creezio/assistant",
  );
  assert.ok(
    fs.existsSync(path.join(pkg, "dist-cjs/index.js")),
    "dist-cjs manquant — build-cjs",
  );
});

test("N3.5 pas de métier panier/dispatch en dur + Paperclip mort", () => {
  const corpus = [...walkTs(src), ...walkTs(ui)]
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");
  assert.doesNotMatch(corpus, PAPERCLIP_RE);
  assert.doesNotMatch(
    corpus,
    /export const TOOL_DEFINITIONS\s*=\s*\[[\s\S]*add_to_cart/,
  );
  assert.doesNotMatch(corpus, /route:\s*["']\/panier["']/);
  assert.doesNotMatch(corpus, /tf2_marketplaces|tf2_produits/);
  const appMap = fs.readFileSync(
    path.join(src, "brand/app-map-shim.ts"),
    "utf8",
  );
  assert.match(appMap, /assistantAppMapPages|configureAssistantBrand/);
});

test("N3.6 routing kit (Meili vs SQL)", async () => {
  const mod = await import(path.join(pkg, "dist/runtime/routing.js"));
  const {
    looksLikeUiCommand,
    shouldForceRunSql,
    shouldPreferSearchKnowledge,
  } = mod;

  const paella =
    "Y a-t-il un fournisseur à Paris qui a de la paella dans son offre ?";
  assert.equal(shouldPreferSearchKnowledge(paella), true);
  assert.equal(shouldForceRunSql(paella), false);

  const combien = "Combien de fournisseurs à Paris ?";
  assert.equal(shouldPreferSearchKnowledge(combien), false);
  assert.equal(shouldForceRunSql(combien), true);

  const uiCmd = "Va dans le catalogue et cherche paella";
  assert.equal(looksLikeUiCommand(uiCmd), true);
  assert.equal(shouldPreferSearchKnowledge(uiCmd), false);
});
