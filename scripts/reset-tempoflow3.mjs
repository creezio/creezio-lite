#!/usr/bin/env node
/**
 * Reset scripté TempoFlow3 : backup → brand apply --force →
 * les fichiers creezio:owned-by-brand / creezio.ownedByBrand sont préservés.
 *
 * App hors monorepo kit — résolue via :
 *   CREEZIO_TEMPOFLOW3_ROOT | ../tempoflow3 | /opt/docker/tempoflow3
 *
 * Usage (depuis la racine kit creezio) :
 *   node scripts/reset-tempoflow3.mjs
 *   node scripts/reset-tempoflow3.mjs --no-proof
 *
 * Préférer aussi le script miroir dans le repo creezio/tempoflow3.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveProbeBrandRoot,
  resolveProbeBrandServerDir,
} from "./lib/resolve-probe-brand.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = resolveProbeBrandRoot(ROOT);
const SERVER = resolveProbeBrandServerDir(ROOT);
const CLI = path.join(ROOT, "packages/factory/bin/creezio.js");
const noProof = process.argv.includes("--no-proof");

if (!APP) {
  console.error(
    "TempoFlow3 introuvable. Définir CREEZIO_TEMPOFLOW3_ROOT ou cloner creezio/tempoflow3 en sibling (../tempoflow3).",
  );
  process.exit(1);
}

const SPEC = path.join(APP, "brand-spec");

const env = {
  ...process.env,
  CREEZIO_KIT_ROOT: ROOT,
  CREEZIO_ROOT: ROOT, // legacy compat (Q8)
  NODE_PATH: path.join(ROOT, "node_modules"),
  PATH: [
    path.join(ROOT, "node_modules", ".bin"),
    process.env.PATH || "",
  ].join(path.delimiter),
};

function run(cmd, args, cwd = ROOT) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd,
    env,
    encoding: "utf8",
    shell: cmd !== process.execPath,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    throw new Error(`fail status=${r.status}`);
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = path.join("/tmp", `tf3-reset-${stamp}`);
console.log(`APP=${APP}`);
console.log(`backup → ${backup}`);
const SKIP_BACKUP = new Set([
  "node_modules",
  "docker-data",
  "dist-electron",
  "dist-electron-server",
  "dumps",
]);
fs.cpSync(APP, backup, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(APP, src);
    const top = rel.split(path.sep)[0];
    const second = rel.split(path.sep)[1];
    if (SKIP_BACKUP.has(top)) return false;
    if (second && SKIP_BACKUP.has(second)) return false;
    return true;
  },
});

run(process.execPath, [CLI, "brand", "doctor", "--spec", SPEC]);
run(process.execPath, [
  CLI,
  "brand",
  "apply",
  "--spec",
  SPEC,
  "--out",
  APP,
  "--force",
]);

const mod = fs.readFileSync(
  path.join(SERVER, "src/electron/brand-module-api.ts"),
  "utf8",
);
if (!mod.includes("creezio:owned-by-brand")) {
  console.warn(
    "WARN: brand-module-api sans owned-by-brand — métier peut avoir été régénéré",
  );
} else {
  console.log("OK brand-module-api préservé (owned-by-brand)");
}
if (!fs.existsSync(path.join(SERVER, "src/electron/brand-bonus-api.ts"))) {
  console.warn("WARN: brand-bonus-api absent après apply");
} else {
  console.log("OK brand-bonus-api présent");
}

run("npm", ["run", "build:electron"], SERVER);
run("npm", ["run", "build:ui"], SERVER);

if (!noProof) {
  run("npm", ["run", "proof:oracle"], SERVER);
  run("npm", ["run", "proof:hard"], SERVER);
}

console.log(`\nRESET OK — backup=${backup}`);
