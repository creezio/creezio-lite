#!/usr/bin/env node
/**
 * Rebuild better-sqlite3 ELF pour Electron courant (après ensure-win-native MZ).
 *
 * Usage :
 *   node …/ensure-linux-native-modules.mjs [appRoot]
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

function magic(file) {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    if (buf[0] === 0x4d && buf[1] === 0x5a) return "MZ";
    if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46)
      return "ELF";
    return "other";
  } catch {
    return "missing";
  }
}

const pkgDir = path.join(appRoot, "node_modules", "better-sqlite3");
if (!fs.existsSync(pkgDir)) {
  console.warn("ensure-linux-native: better-sqlite3 absent — skip");
  process.exit(0);
}

const nodePath = path.join(pkgDir, "build/Release/better_sqlite3.node");
const m = magic(nodePath);
if (m === "ELF") {
  console.log("ensure-linux-native: better_sqlite3.node déjà ELF");
  process.exit(0);
}

const target = electronVersion();
console.log(
  `ensure-linux-native: rebuild better-sqlite3 electron@${target} (was ${m})`,
);

const rebuildBin = path.join(
  appRoot,
  "node_modules/@electron/rebuild/lib/cli.js",
);
let r;
if (fs.existsSync(rebuildBin)) {
  r = spawnSync(
    process.execPath,
    [rebuildBin, "-f", "-w", "better-sqlite3", "-v", target],
    { cwd: appRoot, encoding: "utf8", env: process.env },
  );
} else {
  r = spawnSync(
    "npx",
    ["--yes", "@electron/rebuild", "-f", "-w", "better-sqlite3", "-v", target],
    { cwd: appRoot, encoding: "utf8", env: process.env, shell: true },
  );
}

if (r.status !== 0) {
  console.error(r.stderr || r.stdout || "electron-rebuild failed");
  process.exit(r.status ?? 1);
}

if (magic(nodePath) !== "ELF") {
  console.error("ensure-linux-native: échec — better_sqlite3.node n'est pas ELF");
  process.exit(1);
}
console.log("ensure-linux-native: ok", nodePath);
