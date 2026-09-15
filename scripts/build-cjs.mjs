#!/usr/bin/env node
/**
 * Dual-build CJS pour consommation depuis Electron CommonJS (Certivan / Fidu / TF).
 * Les packages restent ESM (`type: module`) ; dist-cjs/ a son propre package.json
 * `{ "type": "commonjs" }` pour que require() fonctionne.
 *
 * Usage : npm run build:packages && node scripts/build-cjs.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Packages consommés en require() par les apps Electron CJS (G1–G3). */
const PACKAGES = [
  "brand-config",
  "shell",
  "platform-core",
  "product-hub",
  "api-kernel",
  "mcp-facade",
  "auth",
  "access-control",
  "shell-ui",
  "nav",
  "onboarding",
  "interactive-demo",
  "cockpit",
  "assistant",
  "tasks",
  "mails",
  "observability",
  "landing",
  "admin",
  "support",
  "integrations",
  "granola",
  "grokbot",
  "automations",
  "database",
  "browser-host",
  "search",
  "host-runtime",
  "electron-shell",
  "desktop-tooling",
  "propagation",
];
/** factory utilise import.meta — rester ESM-only (bin creezio). */

function ensureTsconfigCjs(pkgDir) {
  const tsconfigPath = path.join(pkgDir, "tsconfig.cjs.json");
  const cfg = {
    extends: "./tsconfig.json",
    compilerOptions: {
      module: "CommonJS",
      moduleResolution: "Node",
      outDir: "dist-cjs",
      declaration: false,
      declarationMap: false,
      composite: false,
      sourceMap: true,
    },
    // Pas de project references en CJS — on compile contre dist ESM types via node_modules links
    references: [],
  };
  fs.writeFileSync(tsconfigPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  return tsconfigPath;
}

function patchPackageExports(pkgDir) {
  const pkgPath = path.join(pkgDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const exports = pkg.exports?.["."] ?? {};
  pkg.exports = {
    ...(pkg.exports || {}),
    ".": {
      types: exports.types || "./dist/index.d.ts",
      import: exports.import || "./dist/index.js",
      require: "./dist-cjs/index.js",
      default: exports.import || "./dist/index.js",
    },
  };
  // main = CJS pour tools qui lisent main sans exports
  pkg.main = "./dist-cjs/index.js";
  if (!pkg.module) pkg.module = "./dist/index.js";
  const files = new Set(pkg.files || ["dist"]);
  files.add("dist");
  files.add("dist-cjs");
  pkg.files = [...files];
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

for (const name of PACKAGES) {
  const pkgDir = path.join(root, "packages", name);
  if (!fs.existsSync(path.join(pkgDir, "package.json"))) {
    console.warn(`skip missing ${name}`);
    continue;
  }
  ensureTsconfigCjs(pkgDir);
  console.log(`→ CJS ${name}`);
  execFileSync(
    "npx",
    ["tsc", "-p", "tsconfig.cjs.json"],
    { cwd: pkgDir, stdio: "inherit" },
  );
  fs.writeFileSync(
    path.join(pkgDir, "dist-cjs", "package.json"),
    JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
    "utf8",
  );
  patchPackageExports(pkgDir);
}

console.log("OK dual CJS pour", PACKAGES.join(", "));
