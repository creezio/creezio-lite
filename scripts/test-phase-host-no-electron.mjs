#!/usr/bin/env node
/**
 * Gate P1.a — pureté host : aucun import STATIQUE d'electron dans le code
 * host Node pur. Depuis P1.b le host vit dans trois zones :
 *   - `packages/host-runtime/src/**` (runtime host extrait) ;
 *   - `packages/search/src/**` (sous-domaine Meili extrait) ;
 *   - `packages/electron-shell/src/host/**` (reliquat browser-tabs, qui
 *     utilise Electron via loadElectron uniquement).
 *
 * Invariant (audit P1.a) : le host doit rester chargeable en Node pur
 * (tests kit, harness serveur, marques headless). Toute valeur Electron
 * s'obtient au runtime via `loadElectron()` (chargement dynamique lazy) —
 * l'UNIQUE exception tolérée est donc `host-runtime/src/load-electron.ts`
 * lui-même, qui encapsule le `require("electron")` (via eval/createRequire,
 * jamais un import top-level).
 *
 * Autorisé partout :
 *   - `import type { … } from "electron"` (effacé à la compilation) ;
 *   - annotations `import("electron").X` (type position, effacée) ;
 *   - `await import("electron")` (chargement DYNAMIQUE lazy — même famille
 *     que loadElectron(), n'exécute rien au simple import du module).
 *
 * Interdit hors load-electron.ts :
 *   - `import { app } from "electron"` / `import electron from "electron"`
 *   - `export … from "electron"`
 *   - `require("electron")` (le loader est le seul à requérir electron)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST_DIRS = [
  path.join(ROOT, "packages/host-runtime/src"),
  path.join(ROOT, "packages/search/src"),
  path.join(ROOT, "packages/electron-shell/src/host"),
];

/** Unique exception : le helper de chargement dynamique lui-même. */
const LOADER_ABS = path.join(ROOT, "packages/host-runtime/src/load-electron.ts");

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

/**
 * Retourne les violations `{ line, text, kind }` d'un source.
 * Un import purement type (`import type …`) n'est PAS une violation.
 */
function findStaticElectronImports(src) {
  const violations = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // import/export … from "electron" (multi-lignes : le `from "electron"`
    // porte la ligne signifiante ; on remonte pour savoir si type-only).
    if (/\bfrom\s+["']electron["']/.test(line)) {
      let stmtStart = i;
      while (stmtStart > 0 && !/^\s*(import|export)\b/.test(lines[stmtStart])) {
        stmtStart--;
      }
      const stmt = lines.slice(stmtStart, i + 1).join("\n");
      if (!/^\s*(import|export)\s+type\b/.test(lines[stmtStart])) {
        violations.push({ line: i + 1, text: line.trim(), kind: stmt.startsWith("export") ? "export" : "import" });
      }
      continue;
    }
    if (/\brequire\(\s*["']electron["']\s*\)/.test(line)) {
      violations.push({ line: i + 1, text: line.trim(), kind: "require" });
    }
  }
  return violations;
}

test("host — le helper load-electron.ts existe et encapsule le chargement", () => {
  assert.ok(
    fs.existsSync(LOADER_ABS),
    `load-electron.ts absent de host-runtime/src — l'exception de cette gate n'a plus de raison d'être, la mettre à jour`,
  );
  const src = fs.readFileSync(LOADER_ABS, "utf8");
  assert.match(src, /export function loadElectron\(/, "loadElectron() attendu dans load-electron.ts");
  // Même le loader ne doit pas faire d'import statique top-level.
  const staticImports = findStaticElectronImports(src).filter((v) => v.kind === "import" || v.kind === "export");
  assert.equal(
    staticImports.length,
    0,
    `load-electron.ts fait un import statique d'electron : ${JSON.stringify(staticImports)}`,
  );
});

test("host (host-runtime + search + reliquat electron-shell) — zéro import statique d'electron", () => {
  const files = HOST_DIRS.flatMap((dir) => walk(dir));
  assert.ok(files.length > 50, `zones host inattendues (${files.length} fichiers)`);
  const failures = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const src = fs.readFileSync(file, "utf8");
    let violations = findStaticElectronImports(src);
    if (file === LOADER_ABS) {
      // Exception documentée : require("electron") DANS le helper uniquement.
      violations = violations.filter((v) => v.kind !== "require");
    }
    for (const v of violations) {
      failures.push(`${rel}:${v.line} — ${v.text}`);
    }
  }
  assert.equal(
    failures.length,
    0,
    `import statique d'electron dans le host (Node pur cassé) :\n  ${failures.join("\n  ")}\n` +
      `→ remplacer par loadElectron() (@creezio/host-runtime) pour les valeurs, ` +
      `import type { … } from "electron" pour les types.`,
  );
});
