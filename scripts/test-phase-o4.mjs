#!/usr/bin/env node
/**
 * Phase O4 — assistant-chat générique → @creezio/assistant (kit only).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dockerRoot = path.resolve(root, "..");
const pkg = path.join(root, "packages/assistant");
const src = path.join(pkg, "src");
const chat = path.join(src, "runtime/assistant-chat.ts");
const PAPERCLIP_RE = /paperclipApi|startPaperclip\b|paperclip-launcher/;

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

test("O4.1 PHASE-O4.md + PLAN-O O4", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-O4.md"), "utf8");
  assert.match(phase, /assistant-chat|handleAssistantChat/i);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-o4/);
  assert.match(phase, /configureAssistantBrand/);
  assert.doesNotMatch(phase, PAPERCLIP_RE);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-O.md"), "utf8");
  assert.match(plan, /## O4 — `assistant-chat` générique/);
  assert.match(plan, /PHASE-O4\.md/);
  assert.match(plan, /O4 — `assistant-chat` générique.*✅|## O4 —[\s\S]*?✅/);
});

test("O4.2 runtime/assistant-chat.ts + exports", () => {
  assert.ok(fs.existsSync(chat), "runtime/assistant-chat.ts manquant");
  const loc = fs.readFileSync(chat, "utf8").split("\n").length;
  assert.ok(loc > 1200, `assistant-chat trop court: ${loc}`);
  const body = fs.readFileSync(chat, "utf8");
  assert.match(body, /export async function handleAssistantChat/);
  assert.match(body, /export const maxDuration/);
  assert.match(body, /callAssistantMcpTool|executeTaskTool/);
  assert.match(body, /auth\?\.getSession|auth:\s*\{\s*getSession/);
  assert.match(body, /workSkills|sessionIdPrefix/);

  const index = fs.readFileSync(path.join(src, "index.ts"), "utf8");
  assert.match(index, /handleAssistantChat/);
  assert.match(index, /maxDuration/);
  assert.match(index, /AssistantAuthSession/);
  assert.match(index, /AssistantMcpConfig|mcpFacadeToAssistantConfig/);

  const types = fs.readFileSync(path.join(src, "brand/types.ts"), "utf8");
  assert.match(types, /AssistantAuthSession/);
  assert.match(types, /AssistantMcpConfig/);
  assert.match(types, /AssistantTasksConfig/);
  assert.match(types, /entitySources\?/);
  assert.match(types, /workSkills\?/);
  assert.match(types, /sessionIdPrefix\?/);
  assert.match(types, /auth\?:/);
});

test("O4.3 pas de métier panier/tasks TF + Paperclip mort", () => {
  const body = fs.readFileSync(chat, "utf8");
  assert.doesNotMatch(body, PAPERCLIP_RE);
  assert.doesNotMatch(body, /getOrCreatePanier|addLigne|commandesReady/);
  assert.doesNotMatch(body, /setEntityStatut/);
  assert.doesNotMatch(body, /from ["']@\//);
  assert.doesNotMatch(body, /tempoflow2-crm|tf2-crm-/);
  assert.doesNotMatch(body, /["']\/panier["']/);
  // add_to_cart mort ; create_task via tasks-tools (pas panier TF)
  assert.doesNotMatch(body, /if \(name === "add_to_cart"\)/);
  assert.doesNotMatch(body, /getOrCreatePanier|addLigne/);

  const corpus = walkTs(src)
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");
  assert.doesNotMatch(corpus, PAPERCLIP_RE);
  assert.match(corpus, /PLATFORM_TOOL_DEFINITIONS/);
});

test("O4.4 cutover délégué O4p (jumeaux absents post-cutover)", () => {
  // O4 extract-only ; O4p a supprimé les jumeaux — assert absences.
  for (const brand of ["tempoflow2", "certivan-app", "fidu"]) {
    const p = path.join(dockerRoot, brand, "crm/src/server/assistant-chat.ts");
    assert.ok(!fs.existsSync(p), `${brand}: jumeau encore présent`);
  }
});

test("O4.5 build dist + smoke export", async () => {
  assert.ok(
    fs.existsSync(path.join(pkg, "dist/runtime/assistant-chat.js")),
    "dist/runtime/assistant-chat.js manquant — rebuild @creezio/assistant",
  );
  assert.ok(
    fs.existsSync(path.join(pkg, "dist-cjs/index.js")),
    "dist-cjs manquant — build-cjs",
  );
  const mod = await import(path.join(pkg, "dist/index.js"));
  assert.equal(typeof mod.handleAssistantChat, "function");
  assert.equal(typeof mod.maxDuration, "number");
  assert.equal(typeof mod.configureAssistantBrand, "function");
});

test("O4.6 gate enregistrée npm test", () => {
  const pkgJson = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkgJson, /test-phase-o4\.mjs/);
});
