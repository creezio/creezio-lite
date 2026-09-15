#!/usr/bin/env node
/**
 * Phase O4p — Cutover assistant-chat TF → CV → Fidu.
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
  { id: "tempoflow2", label: "TF", sha: "92a03f3" },
  { id: "certivan-app", label: "CV", sha: "1e97e72" },
  { id: "fidu", label: "Fidu", sha: "f6d0fb8" },
];

test("O4p.1 PHASE-O4p.md + PLAN-O O4p", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-O4p.md"), "utf8");
  assert.match(phase, /assistant-chat|handleAssistantChat/i);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-o4p/);
  assert.match(phase, /92a03f3|1e97e72|f6d0fb8/);
  assert.doesNotMatch(phase, PAPERCLIP_RE);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-O.md"), "utf8");
  assert.match(plan, /## O4p — Cutover `assistant-chat`/);
  assert.match(plan, /PHASE-O4p\.md/);
  assert.match(plan, /O4p — Cutover `assistant-chat`.*✅|## O4p —[\s\S]*?✅/);
});

test("O4p.2 jumeaux assistant-chat absents ×3 + mount kit", () => {
  for (const b of BRANDS) {
    const twin = path.join(
      dockerRoot,
      b.id,
      "crm/src/server/assistant-chat.ts",
    );
    assert.ok(!fs.existsSync(twin), `${b.label}: jumeau encore présent`);
    // O4r : brand-chat-tools mort — ne plus l'exiger
    const dead = path.join(
      dockerRoot,
      b.id,
      "crm/src/lib/assistant/brand-chat-tools.ts",
    );
    assert.ok(
      !fs.existsSync(dead),
      `${b.label}: brand-chat-tools doit être absent (O4r)`,
    );
    const routes = fs.readFileSync(
      path.join(dockerRoot, b.id, "crm/src/server/routes/assistant.ts"),
      "utf8",
    );
    assert.match(
      routes,
      /handleAssistantChat.*@creezio\/assistant|from ["']@creezio\/assistant["']/,
      `${b.label}: import kit manquant`,
    );
    assert.doesNotMatch(
      routes,
      /from ["']\.\.\/assistant-chat["']/,
      `${b.label}: import local assistant-chat`,
    );
    const cfg = fs.readFileSync(
      path.join(dockerRoot, b.id, "crm/src/lib/assistant/brand-config.ts"),
      "utf8",
    );
    assert.match(cfg, /auth:\s*\{/);
    assert.match(cfg, /\bmcp:\s*|\btasks:\s*/);
    assert.match(cfg, /workSkills|sessionIdPrefix/);
  }
});

test("O4p.3 kit handleAssistantChat + Paperclip mort", () => {
  const chat = path.join(
    root,
    "packages/assistant/src/runtime/assistant-chat.ts",
  );
  assert.ok(fs.existsSync(chat));
  const body = fs.readFileSync(chat, "utf8");
  assert.match(body, /export async function handleAssistantChat/);
  assert.match(body, /callAssistantMcpTool|executeTaskTool|handleAssistantChat/);
  assert.doesNotMatch(body, PAPERCLIP_RE);
  assert.doesNotMatch(body, /getOrCreatePanier|tempoflow2-crm-/);
});

test("O4p.4 SHAs marques dans PHASE-O4p", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-O4p.md"), "utf8");
  for (const b of BRANDS) {
    assert.match(phase, new RegExp(b.sha), `${b.label} SHA manquant`);
  }
});

test("O4p.5 gate enregistrée npm test", () => {
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkg, /test-phase-o4p\.mjs/);
});
