#!/usr/bin/env node
/**
 * Gate arch-codemod — un bump d'ARCHITECTURE_VERSION livre ses codemods.
 *
 * Contrat (scripts/codemods/README.md + docs/CONTRIBUTING-BRANDS.md) :
 *   1. si HEAD change la valeur d'ARCHITECTURE_VERSION
 *      (packages/platform-core/src/architecture-version.ts) par rapport à
 *      HEAD~1, alors scripts/codemods/<nouvelleValeur>/manifest.json existe —
 *      les marques doivent pouvoir migrer automatiquement (les codemods
 *      accompagnent le bump de version npm qu'elles consomment) ;
 *   2. chaque manifest existant référence des scripts présents sur disque ;
 *   3. chaque script codemod est syntaxiquement valide (`node --check`).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CODEMODS_DIR = path.join(ROOT, "scripts", "codemods");
const ARCH_FILE = "packages/platform-core/src/architecture-version.ts";

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function archValueOf(source) {
  const m = /ARCHITECTURE_VERSION\s*=\s*["']([^"']+)["']/.exec(source);
  return m ? m[1] : null;
}

test("A1 bump ARCHITECTURE_VERSION ⇒ codemods livrés", () => {
  // Checkout shallow (CI GH-hosted) : HEAD~1 peut manquer — on approfondit.
  try {
    git("rev-parse", "--verify", "HEAD~1");
  } catch {
    try {
      git("fetch", "--deepen=1", "origin");
      git("rev-parse", "--verify", "HEAD~1");
    } catch {
      console.log("∅ HEAD~1 indisponible (historique tronqué) — check bump skippé");
      return;
    }
  }

  let previous;
  try {
    previous = archValueOf(git("show", `HEAD~1:${ARCH_FILE}`));
  } catch {
    // Fichier absent au commit parent (création) : pas une migration.
    return;
  }
  const current = archValueOf(fs.readFileSync(path.join(ROOT, ARCH_FILE), "utf8"));
  assert.ok(current, `ARCHITECTURE_VERSION introuvable dans ${ARCH_FILE}`);
  if (!previous || previous === current) return;

  const manifest = path.join(CODEMODS_DIR, current, "manifest.json");
  assert.ok(
    fs.existsSync(manifest),
    `ARCHITECTURE_VERSION bumpée ${previous} → ${current} sans codemod de ` +
      `migration : ${path.relative(ROOT, manifest)} manquant.\n` +
      `Les marques en ${previous} ne pourraient plus migrer proprement — ` +
      `livrer les codemods (scripts/codemods/README.md) dans le MÊME commit.`,
  );
});

test("A2 manifests codemods cohérents + scripts valides", () => {
  if (!fs.existsSync(CODEMODS_DIR)) return;
  const versions = fs
    .readdirSync(CODEMODS_DIR)
    .filter(
      (name) =>
        /^H\d+$/.test(name) &&
        fs.statSync(path.join(CODEMODS_DIR, name)).isDirectory(),
    );

  for (const version of versions) {
    const dir = path.join(CODEMODS_DIR, version);
    const manifestPath = path.join(dir, "manifest.json");
    assert.ok(
      fs.existsSync(manifestPath),
      `scripts/codemods/${version}/ sans manifest.json`,
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.ok(
      Array.isArray(manifest.scripts) && manifest.scripts.length > 0,
      `scripts/codemods/${version}/manifest.json : "scripts" doit être un tableau non vide`,
    );
    // `since` = version lockstep qui a introduit cette architecture — SoT du
    // mapping lockstep→arch utilisé par `creezio upgrade` (détection via le
    // package-lock marque quand le marqueur creezio.architectureVersion manque).
    assert.match(
      String(manifest.since || ""),
      /^\d+\.\d+\.\d+$/,
      `scripts/codemods/${version}/manifest.json : "since" (version lockstep ` +
        `d'introduction, ex. "0.16.0") requis — consommé par creezio upgrade`,
    );
    for (const script of manifest.scripts) {
      const file = path.join(dir, script);
      assert.ok(
        fs.existsSync(file),
        `scripts/codemods/${version}/manifest.json référence un script absent : ${script}`,
      );
      // Validité syntaxique sans exécution (les codemods mutent une marque).
      execFileSync(process.execPath, ["--check", file], { cwd: ROOT });
    }
  }
});

test("A3 SKIP_DIRS partagé : artefacts packagés jamais marchés", async () => {
  const helperPath = path.join(CODEMODS_DIR, "lib", "skip-dirs.mjs");
  assert.ok(
    fs.existsSync(helperPath),
    "scripts/codemods/lib/skip-dirs.mjs manquant — SoT partagée des SKIP_DIRS",
  );
  const helper = await import(pathToFileURL(helperPath).href);
  for (const name of [
    "node_modules",
    "dist",
    "dist-cjs",
    "dist-electron-server",
    "win-unpacked",
    "release",
    "out",
    ".next",
    ".git",
    "docker-data",
  ]) {
    assert.ok(
      helper.shouldSkipDir(name),
      `shouldSkipDir(${name}) doit être true`,
    );
  }

  const versions = fs
    .readdirSync(CODEMODS_DIR)
    .filter(
      (name) =>
        /^H\d+$/.test(name) &&
        fs.statSync(path.join(CODEMODS_DIR, name)).isDirectory(),
    );
  for (const version of versions) {
    const dir = path.join(CODEMODS_DIR, version);
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".mjs")) continue;
      const src = fs.readFileSync(path.join(dir, name), "utf8");
      if (!/\bfunction walk\b/.test(src)) continue;
      assert.match(
        src,
        /from ["']\.\.\/lib\/skip-dirs\.mjs["']/,
        `${version}/${name} marche un arbre sans importer le SKIP_DIRS partagé`,
      );
      assert.doesNotMatch(
        src,
        /const SKIP_DIRS = new Set/,
        `${version}/${name} redéclare SKIP_DIRS localement`,
      );
    }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-codemod-skip-"));
  try {
    const poison = "SHOULD_NOT_SEE";
    for (const dir of [
      "dist-electron-server/win-unpacked",
      "release",
      "out",
      "src",
    ]) {
      fs.mkdirSync(path.join(tmp, dir), { recursive: true });
      fs.writeFileSync(path.join(tmp, dir, "poison.ts"), `const x = "${poison}";\n`);
    }
    const seen = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) {
          if (helper.shouldSkipDir(name)) continue;
          walk(p);
        } else {
          seen.push(path.relative(tmp, p));
        }
      }
    };
    walk(tmp);
    assert.deepEqual(seen.sort(), ["src/poison.ts"]);
    assert.ok(
      !seen.some((rel) => /dist-electron-server|win-unpacked|release|out/.test(rel)),
      "artefacts packagés exclus du walk",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
