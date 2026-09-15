#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const cvRoot = resolveBrandCrmRoot("certivan-app");
const fiduRoot = resolveBrandCrmRoot("fidu");
const MAX = 800;

test("M12p.1 PHASE-M12p.md", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-M12p.md"), "utf8");
  assert.match(doc, /installBrandDesktopRuntime/);
  assert.match(doc, /Fidu/);
  assert.match(doc, /800/);
  assert.doesNotMatch(doc, /Paperclip vertical/);
});

test("M12p.2 kit deps sans Paperclip", () => {
  const src = fs.readFileSync(
    path.join(root, "packages/electron-shell/src/desktop/brand-desktop-runtime.ts"),
    "utf8",
  );
  assert.match(src, /pluginsDirEnvKey/);
  assert.match(src, /deps\.supplierFidQueryParam/);
  assert.doesNotMatch(src, /paperclipApi/);
});

test("M12p.3 export", () => {
  assert.equal(
    typeof require(path.join(root, "packages/electron-shell/dist-cjs/index.js")).installBrandDesktopRuntime,
    "function",
  );
});

test("M12p.4 Certivan", () => {
  const src = fs.readFileSync(path.join(cvRoot, "electron/main.ts"), "utf8");
  assert.ok(src.split("\n").length <= MAX);
  assert.match(src, /installBrandDesktopRuntime/);
});

test("M12p.5 Fidu sans Paperclip", () => {
  const src = fs.readFileSync(path.join(fiduRoot, "electron/main.ts"), "utf8");
  assert.ok(src.split("\n").length <= MAX);
  assert.match(src, /installBrandDesktopRuntime/);
  assert.doesNotMatch(src, /startPaperclip/);
});

test("M12p.6 Fidu Paperclip absent", () => {
  assert.equal(fs.existsSync(path.join(fiduRoot, "electron/paperclip-launcher.ts")), false);
  assert.ok(fs.existsSync(path.join(fiduRoot, "electron/host-stack.ts")));
});
