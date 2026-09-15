#!/usr/bin/env node
/**
 * Phase N3p — Cutover assistant TF → Certivan → Fidu.
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
  {
    name: "tempoflow2",
    dir: path.join(dockerRoot, "tempoflow2/crm"),
    shaHint: "cfd4a49",
  },
  {
    name: "certivan-app",
    dir: path.join(dockerRoot, "certivan-app/crm"),
    shaHint: "49d39be",
  },
  {
    name: "fidu",
    dir: path.join(dockerRoot, "fidu/crm"),
    shaHint: "e9542f5",
  },
];

const FORBIDDEN = [
  "src/components/assistant/assistant-widget.tsx",
  "src/lib/assistant/meili-rag.ts",
  "src/lib/assistant/hermes-client.ts",
  "src/lib/assistant/agent-loop.ts",
  "src/lib/assistant/routing.ts",
  "src/lib/assistant/models.ts",
];

const REQUIRED = [
  "src/lib/assistant/configure-brand.ts",
  "src/lib/assistant/app-map.ts",
  "src/lib/assistant/prompts.ts",
];

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

function brandLoc(crmDir) {
  const files = [
    ...walkTs(path.join(crmDir, "src/lib/assistant")),
    ...walkTs(path.join(crmDir, "src/components/assistant")),
  ];
  return files.reduce(
    (n, f) => n + fs.readFileSync(f, "utf8").split("\n").length,
    0,
  );
}

test("N3p.1 PHASE-N3p.md + PLAN-N N3p livré", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-N3p.md"), "utf8");
  assert.match(phase, /Cutover assistant/i);
  assert.match(phase, /863406f|a358d5b/);
  assert.match(phase, /cfd4a49/);
  assert.match(phase, /49d39be/);
  assert.match(phase, /e9542f5/);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-n3p/);
  assert.doesNotMatch(phase, PAPERCLIP_RE);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-N.md"), "utf8");
  assert.match(plan, /## N3p — Cutover assistant/);
  assert.match(plan, /PHASE-N3p\.md/);
  assert.match(plan, /Done|livr/i);
});

test("N3p.2 jumeaux génériques absents ×3 ; brand mounts présents", () => {
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
    const cfg = fs.readFileSync(
      path.join(b.dir, "src/lib/assistant/configure-brand.ts"),
      "utf8",
    );
    assert.match(cfg, /configureAssistantBrand/);
  }
});

test("N3p.3 budgets LOC ≤2400 ; chat-db absent (O2)", () => {
  for (const b of BRANDS) {
    const loc = brandLoc(b.dir);
    // O4p : + brand-chat-tools (~250–400 LOC métier) → budget 2000→2400
    assert.ok(loc <= 2400, `${b.name}: LOC ${loc} > 2400`);
    assert.ok(loc > 200, `${b.name}: LOC trop bas ${loc}`);
    assert.ok(
      !fs.existsSync(path.join(b.dir, "src/lib/assistant/chat-db.ts")),
      `${b.name}: façade chat-db`,
    );
  }
});

test("N3p.4 Paperclip mort sur arbres assistant marques", () => {
  for (const b of BRANDS) {
    const files = [
      ...walkTs(path.join(b.dir, "src/lib/assistant")),
      ...walkTs(path.join(b.dir, "src/components/assistant")),
    ];
    const corpus = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
    assert.doesNotMatch(corpus, PAPERCLIP_RE);
  }
});
