#!/usr/bin/env node
/**
 * Phase O8 — Gates anti-façade permanents (remplace indulgence N8 ≤40 LOC).
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
  { name: "tempoflow2", dir: path.join(dockerRoot, "tempoflow2/crm"), mcp: "createTempoflowBrandMcp" },
  { name: "certivan-app", dir: path.join(dockerRoot, "certivan-app/crm"), mcp: "createCertivanBrandMcp" },
  { name: "fidu", dir: path.join(dockerRoot, "fidu/crm"), mcp: "createFiduBrandMcp" },
];

/** Plafonds O7 — permanents sous O8. */
const O7_CEILINGS = {
  "electron/host-stack.ts": 80,
  "electron/host-runtime-ctx.ts": 100,
  "electron/preload-app.ts": 120,
};

/** Surfaces façade / jumeaux validés comme done = interdits. */
const FORBIDDEN = [
  "electron/meili-launcher.ts",
  "electron/local-config.ts",
  "electron/host-na-stubs.ts",
  "electron/supplier-tabs.ts", // SoT kit browser-tabs — jumeau local interdit ×3
  "electron/supplier-driver.ts",
  "src/lib/assistant/brand-chat-tools.ts",
  "src/lib/mcp-admin.ts",
  "src/lib/usage-analytics.ts",
  "src/lib/assistant/chat-db.ts",
  "src/components/admin/analytics-client.tsx",
  "src/components/admin/mcp-admin-client.tsx",
  "src/components/admin/analytics-productivity-panel.tsx",
  "src/lib/brand-database-host.ts",
  "src/lib/brand-mcp-admin-host.ts",
  "src/lib/brand-usage-analytics-host.ts",
  "src/lib/brand-product-hub-ui-host.ts",
];

const REEXPORT_RE =
  /^\s*export\s+(?:\*|\{[^}]+\})\s+from\s+["'][^"']+["']\s*;?\s*$/;

function loc(file) {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

function exists(dir, rel) {
  return fs.existsSync(path.join(dir, rel));
}

function listTsFiles(dir, sub) {
  const base = path.join(dir, sub);
  if (!fs.existsSync(base)) return [];
  const out = [];
  function walk(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name === "vendor" || ent.name === "dist")
        continue;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(".ts") || ent.name.endsWith(".tsx")) out.push(p);
    }
  }
  walk(base);
  return out;
}

/** Fichier ≤40 LOC dont ≥70 % des lignes code sont des re-export. */
function isForbiddenReexportFacade(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split("\n");
  if (lines.length > 40) return false;
  const code = lines.filter((l) => {
    const t = l.trim();
    return t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && t !== "*/";
  });
  if (code.length === 0) return false;
  const reex = code.filter((l) => REEXPORT_RE.test(l));
  return reex.length >= 1 && reex.length / code.length >= 0.7;
}

test("O8.1 PHASE-O8.md + PLAN-O O8 livré", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-O8.md"), "utf8");
  assert.match(phase, /anti-façade|Gates anti-façade/i);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-o8/);
  assert.match(phase, /interdit|forbidden|NON done/i);
  assert.match(phase, /≤80|≤100|≤120/);
  assert.doesNotMatch(phase, PAPERCLIP_RE);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-O.md"), "utf8");
  assert.match(plan, /## O8 — Gates anti-façade/);
  assert.match(plan, /PHASE-O8\.md/);
});

test("O8.2 ceilings O7 permanents ×3", () => {
  for (const b of BRANDS) {
    for (const [rel, max] of Object.entries(O7_CEILINGS)) {
      const file = path.join(b.dir, rel);
      assert.ok(fs.existsSync(file), `${b.name}: ${rel}`);
      const n = loc(file);
      assert.ok(n <= max, `${b.name}: ${rel} ${n} > ${max}`);
    }
  }
});

test("O8.3 forbidden façades / jumeaux absents (CV/Fidu supplier ; ×3 chat-tools)", () => {
  for (const b of BRANDS) {
    for (const rel of FORBIDDEN) {
      if (
        (rel === "src/lib/mcp-admin.ts" ||
          rel === "src/lib/usage-analytics.ts") &&
        b.name === "fidu"
      ) {
        // Fidu n'avait pas ces surfaces — vérifier absence OK
      }
      assert.ok(
        !exists(b.dir, rel),
        `${b.name}: façade/jumeau encore présent: ${rel}`,
      );
    }
  }
  // supplier-tabs SoT kit — jumeaux locaux absents ×3
  const kitMgr = path.join(
    root,
    "packages/electron-shell/src/host/browser-tabs/browser-tab-manager.ts",
  );
  assert.ok(fs.existsSync(kitMgr));
  assert.ok(loc(kitMgr) >= 400);
});

test("O8.4 0 re-export façade ≤40 LOC (src/lib + electron)", () => {
  for (const b of BRANDS) {
    const files = [
      ...listTsFiles(b.dir, "src/lib"),
      ...listTsFiles(b.dir, "electron"),
    ];
    const bad = files.filter(isForbiddenReexportFacade);
    assert.deepEqual(
      bad.map((f) => path.relative(b.dir, f)),
      [],
      `${b.name}: re-export façades: ${bad.map((f) => path.relative(b.dir, f)).join(", ")}`,
    );
  }
});

test("O8.5 un seul MCP SoT marque (modules/brand-mcp) ; 0 brand-chat-tools", () => {
  for (const b of BRANDS) {
    assert.ok(
      !exists(b.dir, "src/lib/assistant/brand-chat-tools.ts"),
      `${b.name}: brand-chat-tools`,
    );
    const brandMcp = path.join(b.dir, "modules/brand-mcp.ts");
    assert.ok(fs.existsSync(brandMcp), `${b.name}: modules/brand-mcp.ts`);
    const src = fs.readFileSync(brandMcp, "utf8");
    assert.match(src, new RegExp(b.mcp));
    // Bridge assistant consomme la façade marque
    const bridge = path.join(b.dir, "src/lib/assistant/mcp-bridge.ts");
    if (fs.existsSync(bridge)) {
      const br = fs.readFileSync(bridge, "utf8");
      assert.match(br, new RegExp(b.mcp));
      assert.doesNotMatch(br, /brand-chat-tools/);
    }
  }
});

test("O8.6 Paperclip mort + gate npm test", () => {
  for (const b of BRANDS) {
    const main = fs.readFileSync(path.join(b.dir, "electron/main.ts"), "utf8");
    assert.doesNotMatch(main, PAPERCLIP_RE);
  }
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkg, /test-phase-o8\.mjs/);
});
