#!/usr/bin/env node
/**
 * Gate P1.a — graphe d'imports `@creezio/*` RUNTIME vs ordre de build.
 *
 * L'ordre de build des packages est le tri topologique des deps déclarées,
 * calculé par `scripts/build-workspaces.mjs` (SoT unique de `build:packages`,
 * dry-run `--list`). Les cycles de deps DÉCLARÉES y sont cassés avec warning
 * car un build TS peut tolérer un cycle type-only — mais un cycle d'imports
 * RUNTIME, lui, est un vrai bug (résolution partielle à l'exécution), et un
 * import runtime « vers l'avant » (package construit APRÈS l'importeur)
 * signifie qu'un build frais peut consommer un dist stale/absent.
 *
 * Invariants gravés :
 *   1. aucun cycle dans le graphe des imports runtime (type-only ignorés) ;
 *   2. chaque import runtime pointe vers un package construit AVANT
 *      l'importeur dans l'ordre de build.
 *
 * Périmètre : `packages/<pkg>/src` — le code compilé par tsc vers dist/.
 * Les arbres `packages/<pkg>/ui` (composants Next livrés en .tsx source,
 * compilés par l'APP consommatrice, hors `include` des tsconfig — vérifié
 * sur shell-ui) ne sont pas contraints par l'ordre de build tsc et sont
 * donc hors périmètre de CETTE gate.
 *
 * Type-only (ignorés) : `import type … from`, `export type … from`,
 * annotations `import("@creezio/x").T`, `typeof import(…)`. Le code généré
 * dans des template literals (factory) et les commentaires sont neutralisés
 * avant scan.
 *
 * Allowlist : AUCUNE — zéro violation réelle à la création de la gate
 * (audit P1.a confirmé : la discipline type-only est respectée ; les
 * pseudo-violations étaient du code généré dans des templates factory).
 * Ne pas affaiblir l'assert : déclarer la dep, passer en `import type`,
 * ou inverser la dépendance.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKGS_DIR = path.join(ROOT, "packages");

function walkSources(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === "dist-cjs") continue;
      walkSources(p, acc);
    } else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(name)) {
      acc.push(p);
    }
  }
  return acc;
}

/** `@creezio/electron-shell/browser-tabs` → `@creezio/electron-shell`. */
function toPackageName(specifier) {
  const parts = specifier.split("/");
  return parts.slice(0, 2).join("/");
}

/**
 * Neutralise commentaires et template literals (remplacés par des espaces,
 * sauts de ligne préservés) pour que le code GÉNÉRÉ embarqué dans des
 * backticks (factory) et les exemples en commentaire ne comptent pas comme
 * imports. Les strings ' / " sont conservées (ce sont les spécifieurs).
 * Gère l'imbrication `…${ code }…` via une pile.
 */
function stripCommentsAndTemplates(src) {
  const out = [];
  // Pile : "code" top-level, "template", ou { depth } pour un ${…} en cours.
  const stack = ["code"];
  let i = 0;
  const blank = (ch) => (ch === "\n" ? "\n" : " ");
  while (i < src.length) {
    const top = stack[stack.length - 1];
    const ch = src[i];
    const next = src[i + 1];
    if (top === "template") {
      if (ch === "\\") { out.push(" ", " "); i += 2; continue; }
      if (ch === "`") { out.push(" "); i++; stack.pop(); continue; }
      if (ch === "$" && next === "{") { out.push(" ", " "); i += 2; stack.push({ depth: 0 }); continue; }
      out.push(blank(ch)); i++; continue;
    }
    // Mode code (top-level ou intérieur d'un ${…}).
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") { out.push(" "); i++; }
      continue;
    }
    if (ch === "/" && next === "*") {
      out.push(" ", " "); i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { out.push(blank(src[i])); i++; }
      if (i < src.length) { out.push(" ", " "); i += 2; }
      continue;
    }
    if (ch === '"' || ch === "'") {
      const q = ch; out.push(ch); i++;
      while (i < src.length && src[i] !== q && src[i] !== "\n") {
        if (src[i] === "\\") { out.push(src[i], src[i + 1] ?? ""); i += 2; continue; }
        out.push(src[i]); i++;
      }
      if (i < src.length && src[i] === q) { out.push(q); i++; }
      continue;
    }
    if (ch === "`") { out.push(" "); i++; stack.push("template"); continue; }
    if (typeof top === "object") {
      if (ch === "{") top.depth++;
      else if (ch === "}") {
        if (top.depth === 0) { out.push(" "); i++; stack.pop(); continue; }
        top.depth--;
      }
    }
    out.push(ch); i++;
  }
  return out.join("");
}

/**
 * Extrait les imports `@creezio/*` RUNTIME d'un source TS/JS.
 * @returns {{ pkg: string, line: number, text: string }[]}
 */
export function findRuntimeCreezioImports(rawSrc) {
  const src = stripCommentsAndTemplates(rawSrc);
  const found = [];
  const lineOf = (idx) => src.slice(0, idx).split("\n").length;
  const push = (m, spec) => {
    const lead = m[0].match(/^[;\s]*/)[0].length; // ancre [;\n] hors statement
    found.push({
      pkg: toPackageName(spec),
      line: lineOf(m.index + lead),
      text: m[0].slice(lead).split("\n")[0].trim() || "(import multi-lignes)",
    });
  };

  // import [clause] from "@creezio/x" — ancré début de statement ; la clause
  // ne contient ni ; ni quote (empêche de déborder sur le statement suivant).
  for (const m of src.matchAll(
    /(?:^|[;\n])\s*import\s+(type\s+)?([^;"'()=]*?)\bfrom\s*["'](@creezio\/[^"']+)["']/g,
  )) {
    if (m[1]) continue; // import type … from — effacé à la compilation
    push(m, m[3]);
  }
  // export … from "@creezio/x" (re-export runtime sauf `export type`).
  for (const m of src.matchAll(
    /(?:^|[;\n])\s*export\s+(type\s+)?(\*(\s+as\s+\w+)?|\{[^;"'}]*\})\s*from\s*["'](@creezio\/[^"']+)["']/g,
  )) {
    if (m[1]) continue;
    push(m, m[4]);
  }
  // Side-effect import : import "@creezio/x" (toujours runtime).
  for (const m of src.matchAll(/(?:^|[;\n])\s*import\s*["'](@creezio\/[^"']+)["']/g)) {
    push(m, m[1]);
  }
  // require("@creezio/x") — toujours runtime.
  for (const m of src.matchAll(/\brequire\(\s*["'](@creezio\/[^"']+)["']\s*\)/g)) {
    push(m, m[1]);
  }
  // import("@creezio/x") dynamique : runtime SAUF position type
  // (`import("x").T`, `typeof import("x")`).
  for (const m of src.matchAll(/\bimport\(\s*["'](@creezio\/[^"']+)["']\s*\)(\s*\.)?/g)) {
    const before = src.slice(Math.max(0, m.index - 12), m.index);
    if (m[2]) continue; // `.T` → annotation de type
    if (/typeof\s+$/.test(before)) continue;
    push(m, m[1]);
  }
  return found;
}

/** Graphe runtime : nom package → Map<dep, occurrences[]>. */
function buildRuntimeGraph() {
  const graph = new Map();
  for (const entry of fs.readdirSync(PKGS_DIR).sort()) {
    const pkgJsonPath = path.join(PKGS_DIR, entry, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;
    const name = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")).name;
    const edges = new Map();
    for (const file of walkSources(path.join(PKGS_DIR, entry, "src"))) {
      const src = fs.readFileSync(file, "utf8");
      for (const imp of findRuntimeCreezioImports(src)) {
        if (imp.pkg === name) continue; // self-import (subpath) toléré
        const rel = path.relative(ROOT, file);
        edges.set(imp.pkg, [
          ...(edges.get(imp.pkg) ?? []),
          `${rel}:${imp.line} — ${imp.text}`,
        ]);
      }
    }
    graph.set(name, edges);
  }
  return graph;
}

/** Ordre de build SoT : dry-run du script build:packages. */
function buildOrder() {
  const r = spawnSync(
    process.execPath,
    ["scripts/build-workspaces.mjs", "--packages-only", "--list"],
    { encoding: "utf8", cwd: ROOT },
  );
  assert.equal(r.status, 0, `build-workspaces --list a échoué :\n${r.stderr}`);
  const order = r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  assert.ok(order.length >= 25, `ordre de build suspect (${order.length} packages)`);
  return order;
}

const graph = buildRuntimeGraph();
const order = buildOrder();
const rank = new Map(order.map((name, i) => [name, i]));

test("BO1 graphe runtime — aucun cycle d'imports @creezio/* runtime", () => {
  const state = new Map(); // 0 en cours, 1 fait
  const cycles = [];
  function visit(name, chain) {
    if (state.get(name) === 1) return;
    if (state.get(name) === 0) {
      cycles.push([...chain.slice(chain.indexOf(name)), name].join(" → "));
      return;
    }
    state.set(name, 0);
    for (const dep of graph.get(name)?.keys() ?? []) {
      if (graph.has(dep)) visit(dep, [...chain, name]);
    }
    state.set(name, 1);
  }
  for (const name of [...graph.keys()].sort()) visit(name, []);
  assert.equal(
    cycles.length,
    0,
    `cycle(s) d'imports RUNTIME entre packages @creezio/* :\n  ${cycles.join("\n  ")}\n` +
      `→ casser le cycle : passer un des imports en \`import type\` + injection runtime, ` +
      `ou extraire le code partagé vers un package plus bas dans l'ordre de build.`,
  );
});

test("BO2 ordre de build — chaque import runtime pointe vers un package construit avant", () => {
  const violations = [];
  for (const [name, edges] of graph) {
    for (const [dep, occurrences] of edges) {
      if (!rank.has(dep)) {
        violations.push(
          `${name} importe ${dep} qui n'est pas dans l'ordre de build (--list) :\n    ${occurrences[0]}`,
        );
        continue;
      }
      if (rank.get(dep) >= rank.get(name)) {
        violations.push(
          `${name} (rang ${rank.get(name)}) importe en RUNTIME ${dep} (rang ${rank.get(dep)}, construit après) :\n    ` +
            occurrences.slice(0, 3).join("\n    ") +
            (occurrences.length > 3 ? `\n    … (${occurrences.length} occurrences)` : ""),
        );
      }
    }
  }
  assert.equal(
    violations.length,
    0,
    `import(s) runtime violant l'ordre de build (dist stale/absent garanti sur build frais) :\n  ${violations.join("\n  ")}\n` +
      `→ soit déclarer la dep dans le package.json de l'importeur (l'ordre topo suivra), soit passer en ` +
      `import type, soit inverser la dépendance. Ordre SoT : node scripts/build-workspaces.mjs --packages-only --list`,
  );
});

test("BO3 sanity — le graphe runtime n'est pas vide (le scanner voit bien les imports)", () => {
  const edgeCount = [...graph.values()].reduce((n, e) => n + e.size, 0);
  assert.ok(
    edgeCount >= 20,
    `seulement ${edgeCount} arêtes runtime détectées — scanner probablement cassé`,
  );
});
