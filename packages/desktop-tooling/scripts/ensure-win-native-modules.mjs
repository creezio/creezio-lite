#!/usr/bin/env node
/**
 * Prépare better-sqlite3 win32 (PE) avant pack:win cross-compilé depuis Linux.
 *
 * Usage :
 *   node …/ensure-win-native-modules.mjs [appRoot]
 *   ELECTRON_VERSION=35.7.5 node …/ensure-win-native-modules.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const appRoot = path.resolve(process.argv[2] || process.cwd());
const require = createRequire(path.join(appRoot, "package.json"));

function electronVersion() {
  if (process.env.ELECTRON_VERSION) return process.env.ELECTRON_VERSION;
  try {
    return require("electron/package.json").version;
  } catch {
    return "35.7.5";
  }
}

function isPeMz(file) {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);
    return buf[0] === 0x4d && buf[1] === 0x5a; // MZ
  } catch {
    return false;
  }
}

const pkgDir = path.join(appRoot, "node_modules", "better-sqlite3");
if (!fs.existsSync(pkgDir)) {
  console.warn("ensure-win-native: better-sqlite3 absent — skip");
  process.exit(0);
}

const nodePath = path.join(pkgDir, "build/Release/better_sqlite3.node");
if (isPeMz(nodePath)) {
  console.log("ensure-win-native: better_sqlite3.node déjà win32 (MZ)");
  process.exit(0);
}

const target = electronVersion();
const binCandidates = [
  path.join(appRoot, "node_modules/prebuild-install/bin.js"),
  path.join(pkgDir, "node_modules/prebuild-install/bin.js"),
];
const bin = binCandidates.find((p) => fs.existsSync(p));
console.log(
  `ensure-win-native: prebuild better-sqlite3 electron@${target} win32-x64`,
);

const args = [
  "--platform",
  "win32",
  "--arch",
  "x64",
  "--runtime",
  "electron",
  "--target",
  target,
];
let r;
if (bin) {
  r = spawnSync(process.execPath, [bin, ...args], {
    cwd: pkgDir,
    encoding: "utf8",
    env: process.env,
  });
} else {
  r = spawnSync("npx", ["--yes", "prebuild-install", ...args], {
    cwd: pkgDir,
    encoding: "utf8",
    env: process.env,
    shell: true,
  });
}

if (r.status !== 0) {
  console.error(r.stderr || r.stdout || "prebuild-install failed");
  process.exit(r.status ?? 1);
}

if (!isPeMz(nodePath)) {
  console.error(
    "ensure-win-native: échec — better_sqlite3.node n'est pas un PE win32",
  );
  process.exit(1);
}
console.log("ensure-win-native: ok", nodePath);
