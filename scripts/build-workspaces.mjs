#!/usr/bin/env node
/**
 * Build workspaces — source de vérité UNIQUE générée depuis le graphe
 * npm workspaces (fix P1 : `build` et `build:packages` étaient deux listes
 * manuscrites divergentes ; os-ui / interactive-demo / landing / admin
 * manquaient au `build` par défaut → dist obsolètes).
 *
 * Usage :
 *   node scripts/build-workspaces.mjs                # tous les workspaces
 *   node scripts/build-workspaces.mjs --packages-only # packages/* seulement
 *   node scripts/build-workspaces.mjs --list          # dry-run (ordre topo)
 *
 * L'ordre est un tri topologique des deps `@creezio/*` (dependencies +
 * devDependencies + peerDependencies) — plus de liste à maintenir à la main.
 * `scripts/build-cjs.mjs` est exécuté en fin de build (comme avant pour
 * build:packages ; désormais aussi pour le build complet).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSrcHashManifests } from "./lib/assert-runtime-dist.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesOnly = process.argv.includes("--packages-only");
const listOnly = process.argv.includes("--list");

const rootPkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const globs = rootPkg.workspaces || [];

/** @type {Map<string, { dir: string; deps: string[] }>} */
const workspaces = new Map();
for (const glob of globs) {
  const base = glob.replace(/\/\*$/, "");
  if (packagesOnly && base !== "packages") continue;
  const baseDir = path.join(root, base);
  if (!fs.existsSync(baseDir)) continue;
  for (const entry of fs.readdirSync(baseDir)) {
    const pkgPath = path.join(baseDir, entry, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (!pkg.scripts?.build) continue;
    // Les peerDependencies OPTIONNELLES (peerDependenciesMeta[dep].optional)
    // ne contraignent pas l'ordre de build des types : elles sont résolues
    // au RUNTIME (createRequire), jamais importées à la compilation.
    // Ex. platform-core → auth/database/product-hub en peer optionnelle :
    // les compter créait un cycle fantôme plaçant platform-core APRÈS
    // assistant (erreur TS2307 « Cannot find module @creezio/platform-core »
    // sur node_modules propre / CI). On les exclut du tri topo.
    const optionalPeers = new Set(
      Object.entries(pkg.peerDependenciesMeta || {})
        .filter(([, meta]) => meta && meta.optional)
        .map(([dep]) => dep),
    );
    const deps = [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}).filter(
        (d) => !optionalPeers.has(d),
      ),
    ].filter((d) => d.startsWith("@creezio/"));
    workspaces.set(pkg.name, { dir: path.join(base, entry), deps });
  }
}

// Tri topologique (DFS post-ordre) — deps hors graphe ignorées. Les cycles
// (ex. platform-core ↔ auth, builds TS indépendants des dist) sont cassés
// de façon déterministe avec un warning, comme le faisait implicitement
// l'ancienne liste manuscrite.
const order = [];
const state = new Map(); // 0 = en cours, 1 = fait
const warnedCycles = new Set();
function visit(name, chain) {
  if (state.get(name) === 1) return;
  if (state.get(name) === 0) {
    const cycle = [...chain.slice(chain.indexOf(name)), name].join(" → ");
    if (!warnedCycles.has(cycle)) {
      warnedCycles.add(cycle);
      console.warn(`[build-workspaces] cycle cassé : ${cycle}`);
    }
    return;
  }
  state.set(name, 0);
  const ws = workspaces.get(name);
  for (const dep of ws.deps) {
    if (workspaces.has(dep)) visit(dep, [...chain, name]);
  }
  state.set(name, 1);
  order.push(name);
}
for (const name of [...workspaces.keys()].sort()) visit(name, []);

if (listOnly) {
  for (const name of order) console.log(name);
  process.exit(0);
}

for (const name of order) {
  console.log(`\n[build-workspaces] ${name}`);
  execSync(`npm run build -w ${name}`, { cwd: root, stdio: "inherit" });
}
execSync("node scripts/build-cjs.mjs", { cwd: root, stdio: "inherit" });
// Manifeste des packages publiés (consommé par les gates deps-integrity des
// apps via node_modules/@creezio/platform-core/kit-packages.json).
execSync("node scripts/generate-kit-packages.mjs", { cwd: root, stdio: "inherit" });
// Manifest src-hash (garde assert-runtime-dist) : preuve par CONTENU que le
// dist reflète le src — les mtimes ne sont pas fiables (constat tempoflow-vps).
const manifested = writeSrcHashManifests(root);
console.log(
  `[build-workspaces] manifests src-hash écrits: ${manifested.length} packages runtime`,
);
console.log(
  `\n[build-workspaces] OK — ${order.length} workspaces (${packagesOnly ? "packages" : "packages + apps"}) + build-cjs`,
);
