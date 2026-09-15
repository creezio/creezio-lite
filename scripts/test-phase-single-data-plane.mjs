#!/usr/bin/env node
/**
 * Gate single-data-plane — un seul plan de données métier : brand.db
 * (docs/adr/ADR-single-data-plane.md).
 *
 * Détection statique, fail-closed :
 *   1. kit/factory : le générateur UI n'émet aucun client SQLite (l'UI
 *      générée parle HTTP au kernel — jamais d'ouverture de base locale) ;
 *   2. marque sonde TF3 (skip explicite si absente) :
 *      - aucune référence aux fichiers du flux catalogue
 *        (`tempoflow2.db`, `catalog-remote.db`, `/data/tempoflow2`,
 *        `process.env.DB_PATH`) hors du module d'import
 *        (catalog-sync / tf2-catalog-import / modules/catalog-import) ;
 *      - sous `server/ui/**`, toute ouverture SQLite
 *        (`better-sqlite3` / `node:sqlite`) doit viser le layout kit :
 *        le fichier porte un marqueur d'ouverture connu
 *        (`CREEZIO_BRAND_DB_PATH`, `CREEZIO_CORE_DB_PATH`,
 *        `ASSISTANT_DB_PATH`, résolveur partagé `getDbPath`,
 *        `plugin.sqlite` couche plugin) ;
 *      - allowlist marque `server/scripts/single-data-plane.allowlist.json`
 *        (entrées datées, justifiées) — une entrée périmée (fichier redevenu
 *        conforme ou disparu) fait échouer la gate.
 *
 * Même contrat que la gate marque `server/scripts/test-single-data-plane.mjs`
 * (TF3) — garder les deux scanners alignés.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveProbeBrandServerDir } from "./lib/resolve-probe-brand.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ */
/* Scanner partagé (miroir de la gate marque)                          */
/* ------------------------------------------------------------------ */

const CATALOG_FILE_PATTERNS = [
  /tempoflow2\.db/,
  /catalog-remote\.db/,
  /\/data\/tempoflow2/,
  /process\.env\.DB_PATH\b/,
];

/** Seuls lecteurs légitimes du fichier flux catalogue (module d'import). */
const IMPORT_MODULE_FILES = new Set([
  "src/electron/catalog-sync.ts",
  "src/electron/tf2-catalog-import.ts",
  "src/electron/modules/catalog-import.ts",
]);

/** Import runtime (pas `import type`) d'un client SQLite. */
const SQLITE_OPEN_RE =
  /(?:^|\n)\s*import\s+(?!type\b)[^;]*from\s+["'](?:better-sqlite3|node:sqlite)["']|require\(["'](?:better-sqlite3|node:sqlite)["']\)/;

/** Marqueurs « ouverture layout kit » tolérés sous server/ui. */
const UI_OPENER_MARKERS = [
  "CREEZIO_BRAND_DB_PATH",
  "CREEZIO_CORE_DB_PATH",
  "ASSISTANT_DB_PATH",
  "getDbPath",
  "plugin.sqlite",
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      ent.name === "node_modules" ||
      ent.name === ".next" ||
      ent.name === "build" ||
      ent.name.startsWith(".")
    ) {
      continue;
    }
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, out);
    else if (/\.(tsx?|mjs|cjs|js)$/.test(ent.name)) out.push(abs);
  }
  return out;
}

/**
 * Scanne un livrable serveur de marque. Retourne { violations, allowlisted,
 * stale } — violations = écarts hors allowlist.
 */
export function scanSingleDataPlane(serverDir) {
  const allowlistPath = path.join(
    serverDir,
    "scripts/single-data-plane.allowlist.json",
  );
  const allowlist = fs.existsSync(allowlistPath)
    ? JSON.parse(fs.readFileSync(allowlistPath, "utf8"))
    : [];
  const allowedFiles = new Map(allowlist.map((e) => [e.file, e]));

  const offending = new Map(); // rel → [raisons]
  const addOffense = (rel, reason) => {
    if (!offending.has(rel)) offending.set(rel, []);
    offending.get(rel).push(reason);
  };

  const scopes = [
    { root: path.join(serverDir, "ui"), prefix: "ui/" },
    { root: path.join(serverDir, "src/electron"), prefix: "src/electron/" },
  ];
  for (const scope of scopes) {
    for (const abs of walk(scope.root)) {
      const rel = path
        .relative(serverDir, abs)
        .split(path.sep)
        .join("/");
      const raw = fs.readFileSync(abs, "utf8");
      const isImportModule = IMPORT_MODULE_FILES.has(rel);

      if (!isImportModule) {
        for (const re of CATALOG_FILE_PATTERNS) {
          if (re.test(raw)) {
            addOffense(rel, `référence flux catalogue hors module d'import (${re})`);
          }
        }
      }

      if (rel.startsWith("ui/") && SQLITE_OPEN_RE.test(raw)) {
        const marked = UI_OPENER_MARKERS.some((m) => raw.includes(m));
        if (!marked) {
          addOffense(
            rel,
            "client SQLite sous server/ui sans marqueur layout kit",
          );
        }
      }
    }
  }

  const violations = [];
  const allowlisted = [];
  for (const [rel, reasons] of offending) {
    if (allowedFiles.has(rel)) {
      allowlisted.push({ file: rel, reasons, entry: allowedFiles.get(rel) });
    } else {
      violations.push({ file: rel, reasons });
    }
  }
  const stale = [...allowedFiles.keys()].filter((f) => !offending.has(f));
  return { violations, allowlisted, stale };
}

/* ------------------------------------------------------------------ */
/* 1. Factory : l'UI générée ne parle jamais SQLite                    */
/* ------------------------------------------------------------------ */

test("single-data-plane — factory : UI générée sans client SQLite", () => {
  const generators = path.join(ROOT, "packages/factory/src/generators");
  for (const name of ["ui.ts", "os-ui.ts", "nav.ts"]) {
    const file = path.join(generators, name);
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, "utf8");
    assert.ok(
      !/better-sqlite3|node:sqlite/.test(raw),
      `${name} : le générateur UI ne doit émettre aucun client SQLite (ADR-single-data-plane)`,
    );
  }
  // Le smoke généré verrouille déjà « SoT = brand.db » (pas de store.json).
  const tests = fs.readFileSync(
    path.join(generators, "tests.ts"),
    "utf8",
  );
  assert.ok(
    tests.includes("store.json interdit"),
    "generators/tests.ts doit garder l'assert « store.json interdit — SoT = brand.db »",
  );
});

/* ------------------------------------------------------------------ */
/* 2. Marque sonde TF3                                                 */
/* ------------------------------------------------------------------ */

const tf3Server = resolveProbeBrandServerDir(ROOT);

test("single-data-plane — sonde TF3", (t) => {
  if (!tf3Server) {
    t.skip("repo tempoflow3 absent — scan marque sauté");
    return;
  }
  const { violations, allowlisted, stale } = scanSingleDataPlane(tf3Server);
  for (const a of allowlisted) {
    console.log(
      `  allowlist single-data-plane: ${a.file} (${a.entry.reason || "?"}, ${a.entry.date || "?"})`,
    );
  }
  assert.deepEqual(
    stale,
    [],
    `entrées allowlist périmées (fichier conforme ou disparu) — les retirer :\n  ${stale.join("\n  ")}`,
  );
  assert.deepEqual(
    violations.map((v) => `${v.file} — ${v.reasons.join(" ; ")}`),
    [],
    "lecture hors brand.db détectée (ADR-single-data-plane) — projeter la donnée via le module d'import ou allowlister avec date + tâche TODO P0",
  );
});
