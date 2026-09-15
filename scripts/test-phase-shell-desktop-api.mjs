#!/usr/bin/env node
/**
 * Gate — accès desktop API via getShellDesktopApi uniquement.
 *
 * Empêche la régression récurrente des agents :
 *   replace_all `window.tempoflowDesktop` → `getShellDesktopApi()`
 *   sans ajouter `import { getShellDesktopApi } from "@creezio/shell-ui"`.
 *
 * Couverture :
 *   - packages kit UI (shell-ui, assistant, os-ui, …) — toujours
 *   - TempoFlow3 `server/ui` si le repo est présent à côté du kit
 *
 * Ne scanne PAS tempoflow2 / certivan / fidu (encore en cutover partiel).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Globals marque hardcodés interdits en lecture runtime (hors .d.ts / config). */
const HARDCODED_WINDOW_DESKTOP_RE =
  /window\s*(?:\.\s*|\[\s*['"])(tempoflowDesktop|tempoflow3Desktop|certivanDesktop|fiduDesktop|creezioDesktop)(?:\s*['"]\s*\])?/;

const KIT_SCAN_DIRS = [
  "packages/shell-ui",
  "packages/assistant",
  "packages/os-ui",
  "packages/cockpit",
  "packages/onboarding",
  "packages/auth",
  "packages/mails",
  "packages/tasks",
  "packages/support",
  "packages/observability",
  "packages/landing",
  "packages/admin",
];

function resolveTempoflow3Ui() {
  const candidates = [
    process.env.CREEZIO_BRAND_ROOT_TEMPOFLOW3,
    path.resolve(root, "../tempoflow3"),
    "/opt/docker/tempoflow3",
  ].filter(Boolean);
  for (const c of candidates) {
    const ui = path.join(path.resolve(c), "server", "ui");
    if (fs.existsSync(ui)) return ui;
  }
  return null;
}

function walkTs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (
        ent.name === "node_modules" ||
        ent.name === "dist" ||
        ent.name === ".next" ||
        ent.name === "vendor"
      ) {
        continue;
      }
      out.push(...walkTs(p));
    } else if (/\.(ts|tsx)$/.test(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

/** Retire commentaires (assez pour cette gate ; pas un parseur TS). */
function stripComments(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  out = out
    .split("\n")
    .map((line) => {
      // garde `http://` / `https://`
      const m = line.match(/^(.*?)(?<!:)\/\/(.*)$/);
      if (!m) return line;
      return m[1];
    })
    .join("\n");
  return out;
}

function hasGetShellDesktopApiBinding(raw) {
  if (/\bexport\s+function\s+getShellDesktopApi\b/.test(raw)) return true;
  if (/\bfunction\s+getShellDesktopApi\b/.test(raw)) return true;
  if (/\bimport\s*\{[^}]*\bgetShellDesktopApi\b[^}]*\}/.test(raw)) return true;
  if (/\bimport\s+getShellDesktopApi\b/.test(raw)) return true;
  if (/\bexport\s*\{[^}]*\bgetShellDesktopApi\b[^}]*\}/.test(raw)) return true;
  // import * as X + X.getShellDesktopApi — rare ; accepter si membre d'un ns importé
  if (
    /\bimport\s+\*\s+as\s+(\w+)\s+from\b/.test(raw) &&
    /\.\s*getShellDesktopApi\b/.test(raw)
  ) {
    return true;
  }
  return false;
}

/**
 * @param {string} dir
 * @param {{ allowWindowInterface?: boolean }} [opts]
 */
function scanDir(dir, opts = {}) {
  /** @type {{ file: string, kind: string, detail: string }[]} */
  const violations = [];
  for (const file of walkTs(dir)) {
    const rel = path.relative(root, file);
    const raw = fs.readFileSync(file, "utf8");
    const isDts = file.endsWith(".d.ts");
    const code = stripComments(raw);

    // 1) window.<brand>Desktop hardcodé (interdit hors déclarations de types)
    if (!isDts) {
      for (const [i, line] of code.split("\n").entries()) {
        const m = line.match(HARDCODED_WINDOW_DESKTOP_RE);
        if (!m) continue;
        // Allow configureShellUiBrand({ desktopApiGlobal: "…" }) — pas window.*
        if (/desktopApiGlobal\s*:/.test(line) && !/window\s*[.\[]/.test(line)) {
          continue;
        }
        violations.push({
          file: rel || file,
          kind: "hardcoded-window-desktop",
          detail: `L${i + 1}: ${line.trim().slice(0, 140)}`,
        });
      }
    } else if (opts.allowWindowInterface === false) {
      // kit .d.ts non concernés en pratique
    }

    // 2) getShellDesktopApi utilisé sans binding local / import
    if (!/\bgetShellDesktopApi\b/.test(code)) continue;
    if (hasGetShellDesktopApiBinding(raw)) continue;
    // usage uniquement en string (tests greppant le littéral) ?
    const codeNoStrings = code.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');
    if (!/\bgetShellDesktopApi\b/.test(codeNoStrings)) continue;
    violations.push({
      file: rel || file,
      kind: "missing-import",
      detail: "getShellDesktopApi utilisé sans import/définition",
    });
  }
  return violations;
}

test("shell-desktop-api: kit — pas de window.*Desktop hardcodé + imports OK", () => {
  const all = [];
  for (const rel of KIT_SCAN_DIRS) {
    all.push(...scanDir(path.join(root, rel)));
  }
  assert.equal(
    all.length,
    0,
    `violations kit:\n${all.map((v) => `  [${v.kind}] ${v.file}: ${v.detail}`).join("\n")}`,
  );
});

test("shell-desktop-api: getShellDesktopApi est exporté par @creezio/shell-ui", () => {
  const brand = fs.readFileSync(
    path.join(root, "packages/shell-ui/src/brand.ts"),
    "utf8",
  );
  assert.match(brand, /export function getShellDesktopApi/);
  const index = fs.readFileSync(
    path.join(root, "packages/shell-ui/src/index.ts"),
    "utf8",
  );
  assert.match(index, /getShellDesktopApi/);
});

test("shell-desktop-api: TF3 server/ui (si présent) — bridge unifié", () => {
  const ui = resolveTempoflow3Ui();
  if (!ui) {
    // skip explicite — repo marque absent (cloud / clone kit seul)
    console.log("  skip: tempoflow3/server/ui absent");
    return;
  }
  const violations = scanDir(ui);
  assert.equal(
    violations.length,
    0,
    `violations TF3:\n${violations.map((v) => `  [${v.kind}] ${v.file}: ${v.detail}`).join("\n")}\n` +
      "Rappel agents : ne jamais sed/replace_all sur window.<brand>Desktop " +
      "sans ajouter `import { getShellDesktopApi } from \"@creezio/shell-ui\"`.",
  );
});
