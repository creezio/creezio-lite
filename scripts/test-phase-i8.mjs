/**
 * Phase I8 — freeze H6 : ARCHITECTURE_VERSION + factory scaffold + parity doc.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ARCHITECTURE_VERSION } from "../packages/platform-core/dist/index.js";
import { scaffoldNewApp } from "../packages/factory/dist/index.js";
import { createDemobrandSandbox } from "../apps/demobrand/build/electron/sandbox-runtime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("I8 ARCHITECTURE_VERSION >= H6 (freeze I* signé en H6)", () => {
  // Le freeze I1–I7 a été signé au niveau H6 ; les bumps suivants (H7+)
  // livrent leurs codemods (gate test-phase-arch-codemod) sans casser I8.
  const m = /^H(\d+)$/.exec(ARCHITECTURE_VERSION);
  assert.ok(
    m && Number(m[1]) >= 6,
    `ARCHITECTURE_VERSION inattendue: ${ARCHITECTURE_VERSION}`,
  );
});

test("I8 demobrand feature-parity surfaces I1–I7", () => {
  const sandbox = createDemobrandSandbox();
  try {
    assert.ok(sandbox.auth);
    assert.ok(sandbox.assistant);
    assert.ok(sandbox.tasks);
    assert.ok(sandbox.mails);
    assert.ok(typeof sandbox.controlPlaneAcl === "function");
    const mounts = sandbox.api.listMounts();
    assert.ok(
      mounts.some((m) => m.id === "admin-plugins"),
      `admin-plugins missing in ${mounts.map((m) => m.id).join(",")}`,
    );
    assert.ok(mounts.some((m) => m.id === "platform-tasks"));
    assert.ok(mounts.some((m) => m.id === "platform-mails"));
  } finally {
    sandbox.close();
  }
});

// Depuis la façade app-runtime, le main scaffolder boote via startBrandDesktop
// et la nav marque vit dans vertical-slot.ts (registerBrandNav). L'invariant I8
// (« plus de mergeNav(coreNavItems…) hardcodé ») est conservé.
test("I8 factory scaffold boote startBrandDesktop + registerBrandNav", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-i8-factory-"));
  const outDir = path.join(tmp, "i8freeze");
  const result = scaffoldNewApp({
    brandId: "i8freeze",
    productName: "I8 Freeze",
    domain: "i8freeze.test",
    outDir,
    force: true,
    sandbox: true,
  });
  const mainPath = path.join(result.serverDir, "src/electron/main.ts");
  const main = fs.readFileSync(mainPath, "utf8");
  assert.match(main, /startBrandDesktop/);
  assert.ok(!main.includes("mergeNav(coreNavItems"));
  const slotPath = path.join(result.serverDir, "src/electron/vertical-slot.ts");
  const slot = fs.readFileSync(slotPath, "utf8");
  assert.match(slot, /registerBrandNav/);
  assert.ok(!slot.includes("mergeNav(coreNavItems"));
});

test("I8 docs freeze présents", () => {
  for (const p of [
    "docs/archive/PHASE-I8.md",
    "docs/archive/FEATURE-PARITY-DEMOBRAND-H6.md",
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), p);
  }
});
