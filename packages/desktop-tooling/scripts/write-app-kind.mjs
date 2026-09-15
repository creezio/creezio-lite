#!/usr/bin/env node
/**
 * Pose `build/electron/app-kind.json` ({"kind":"server"|"client"}) avant
 * le packaging electron-builder. Lu au boot par prepareDesktopBoot.
 *
 * Usage :
 *   node …/write-app-kind.mjs <server|client> [appRoot]
 */
import fs from "node:fs";
import path from "node:path";

const kindRaw = String(process.argv[2] || "").trim().toLowerCase();
const kind = kindRaw === "server" || kindRaw === "client" ? kindRaw : null;
if (!kind) {
  console.error("usage: write-app-kind.mjs <server|client> [appRoot]");
  process.exit(1);
}
const appRoot = path.resolve(process.argv[3] || process.cwd());
const outDir = path.join(appRoot, "build", "electron");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "app-kind.json");
fs.writeFileSync(out, JSON.stringify({ kind }, null, 2) + "\n", "utf8");
console.log("wrote", out);
