#!/usr/bin/env node
/**
 * Gate kit M6p — dual-reads legacy Certivan (préalable cutover marques).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`✗ ${name}:`, e instanceof Error ? e.message : e);
  }
}

check("n8n launcher dual-read .${prefix}-encryption-key / owner", () => {
  const src = read("packages/host-runtime/src/n8n/launcher.ts");
  assert.ok(src.includes("-encryption-key"));
  assert.ok(src.includes("-n8n-encryption-key"));
  assert.ok(src.includes("-owner.json"));
  assert.ok(src.includes("-n8n-owner.json"));
  assert.ok(src.includes("brandLegacy") || src.includes("secretPrefix()"));
});

check("hermes ensureApiKey brand-aware + clear webui password legacy", () => {
  const src = read("packages/host-runtime/src/hermes/launcher.ts");
  assert.ok(src.includes("-api-server-key"));
  assert.ok(src.includes("secretFilePrefix") || src.includes("manifest.brandId"));
  // H7 : plus de littéraux marque — le fichier legacy `.{marque}-webui-password`
  // est couvert par la dérivation `.${secretPrefix}-webui-password` (les call
  // sites passent secretFilePrefix || manifest.brandId).
  assert.ok(src.includes("-webui-password"));
  assert.ok(src.includes("secretPrefix"));
  assert.ok(src.includes("clearGeneratedWebuiPassword"));
});

check("hermes bootstrap — plus aucun marker WebUI marque (H11)", () => {
  const src = read(
    "packages/host-runtime/src/hermes/runtime-bootstrap.ts",
  );
  assert.ok(src.includes("WEBUI_DEPS_MARKER"));
  assert.ok(src.includes(".desktop-webui-deps"));
  assert.ok(src.includes(".desktop-webui-pin"));
  assert.equal(src.includes("WEBUI_DEPS_MARKER_LEGACY"), false);
  assert.equal(src.includes(".certivan-"), false);
  assert.equal(src.includes(".fidu-"), false);
  assert.equal(src.includes(".tempoflow-"), false);
  const hermes = read("packages/host-runtime/src/hermes/launcher.ts");
  assert.ok(hermes.includes(`-webui-password`));
});

check("PHASE-M6p.md présent", () => {
  assert.ok(fs.existsSync(path.join(root, "docs/archive/PHASE-M6p.md")));
  const doc = read("docs/archive/PHASE-M6p.md");
  assert.ok(doc.includes("Certivan"));
  assert.ok(doc.includes("Fidu"));
});

if (failed) {
  console.error(`\n${failed} échec(s) M6p`);
  process.exit(1);
}
console.log("\nOK test-phase-m6p");
