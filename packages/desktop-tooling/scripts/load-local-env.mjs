#!/usr/bin/env node
/**
 * Charge `<appRoot>/.env` (gitignoré) dans process.env.
 * N’écrase pas une variable déjà définie dans le shell.
 *
 * Usage marque :
 *   import { loadLocalEnv } from "@creezio/desktop-tooling/scripts/load-local-env.mjs"
 *   // ou copie thin : node vendor/creezio/desktop-tooling/scripts/load-local-env.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string} [root]
 * @returns {{ loaded: boolean, path: string, keys: string[] }}
 */
export function loadLocalEnv(root) {
  const envPath = path.join(root, ".env");
  const keys = [];
  if (!fs.existsSync(envPath)) {
    return { loaded: false, path: envPath, keys };
  }
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!key) continue;
    if (process.env[key] === undefined) {
      process.env[key] = val;
      keys.push(key);
    }
  }
  return { loaded: true, path: envPath, keys };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : process.cwd();
  const r = loadLocalEnv(root);
  console.log(
    JSON.stringify(
      { loaded: r.loaded, path: r.path, keyCount: r.keys.length, keys: r.keys },
      null,
      2,
    ),
  );
}
