#!/usr/bin/env node
/**
 * Gate kit M12 — main.ts TF ≤ 800 LOC via installBrandDesktopRuntime façade kit.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const tfRoot = resolveBrandCrmRoot("tempoflow2");
const MAX_MAIN_LOC = 800;

test("M12.1 PHASE-M12.md présent", () => {
  const docPath = path.join(root, "docs/archive/PHASE-M12.md");
  assert.ok(fs.existsSync(docPath));
  const doc = fs.readFileSync(docPath, "utf8");
  assert.match(doc, /installBrandDesktopRuntime/);
  assert.match(doc, /@creezio\/electron-shell/);
  assert.match(doc, /≤\s*800|≤800|800 LOC/);
});

test("M12.2 kit expose installBrandDesktopRuntime", () => {
  const shell = require(
    path.join(root, "packages/electron-shell/dist-cjs/index.js"),
  );
  assert.equal(typeof shell.installBrandDesktopRuntime, "function");
  const runtimePath = path.join(
    root,
    "packages/electron-shell/src/desktop/brand-desktop-runtime.ts",
  );
  assert.ok(fs.existsSync(runtimePath));
  const src = fs.readFileSync(runtimePath, "utf8");
  assert.match(src, /export function installBrandDesktopRuntime/);
  assert.match(src, /BrandDesktopDeps/);
});

test("M12.3 TF main.ts ≤ 800 LOC + façade kit", () => {
  const mainPath = path.join(tfRoot, "electron/main.ts");
  assert.ok(fs.existsSync(mainPath));
  const src = fs.readFileSync(mainPath, "utf8");
  const loc = src.split("\n").length;
  assert.ok(
    loc <= MAX_MAIN_LOC,
    `main.ts = ${loc} LOC > ${MAX_MAIN_LOC}`,
  );
  assert.match(src, /installBrandDesktopRuntime/);
  assert.match(src, /from ["']@creezio\/electron-shell["']/);
  // Pas de monolithe local : registerIpc / setupAndStart restent dans le kit
  assert.doesNotMatch(src, /function registerIpc\b/);
  assert.doesNotMatch(src, /async function setupAndStart\b/);
  assert.doesNotMatch(src, /async function bootWithRetry\b/);
});
