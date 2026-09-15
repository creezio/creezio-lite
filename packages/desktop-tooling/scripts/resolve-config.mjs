#!/usr/bin/env node
/**
 * Dump JSON ou export shell de la config publish pour une marque.
 *
 *   node scripts/resolve-config.mjs --brand=tempoflow --kind=client
 *   eval "$(node scripts/resolve-config.mjs --brand=fidu --export-shell)"
 */
import {
  parseBrandArg,
  parseKindArg,
  resolvePublishConfig,
  toShellExports,
} from "../dist/resolve-publish-config.js";

const args = process.argv.slice(2);
const get = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const brandId = parseBrandArg(get("brand"));
const kind = parseKindArg(get("kind"));
const appRoot = get("app-root");
const version = get("version");
const platformRaw = (get("platform") || process.env.CREEZIO_PLATFORM || "win")
  .trim()
  .toLowerCase();
const platform =
  platformRaw === "linux" || platformRaw === "appimage" ? "linux" : "win";
const cfg = resolvePublishConfig({ brandId, kind, appRoot, version, platform });

if (args.includes("--export-shell")) {
  console.log(toShellExports(cfg));
} else {
  console.log(JSON.stringify(cfg, null, args.includes("--pretty") ? 2 : 0));
}
