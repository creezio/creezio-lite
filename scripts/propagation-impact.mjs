#!/usr/bin/env node
/**
 * Dry-run « bump package → liste impacts » (alias pratique de kit:version --impact-only).
 *
 * Usage:
 *   npm run kit:impact -- --package=@creezio/platform-core
 *   npm run kit:impact -- --package=electron-shell --bump=major --json
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kitVersion = path.join(ROOT, "scripts/kit-version.mjs");

const args = ["--impact-only", ...process.argv.slice(2)];
const r = spawnSync(process.execPath, [kitVersion, ...args], {
  cwd: ROOT,
  stdio: "inherit",
});
process.exit(r.status ?? 1);
