#!/usr/bin/env node
/**
 * Gate — lien `node_modules` kit pour les smokes d'app générée hors ligne.
 *
 * Contrat : `linkKitNodeModules` pose un symlink vers le hoist du kit
 * (pas de npm install). Les gates factory-prd* doivent l'importer et
 * poser `CREEZIO_SKIP_BRAND_DIST=1` + `npm_config_offline=true`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  linkKitNodeModules,
  linkKitNodeModulesForBrand,
} from "./lib/link-kit-node-modules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("linkKitNodeModules pose un symlink vers le hoist kit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-link-nm-"));
  try {
    const { linked, path: nm } = linkKitNodeModules(dir, ROOT);
    assert.equal(linked, true);
    assert.ok(fs.statSync(nm).isDirectory());
    assert.ok(!fs.lstatSync(nm).isSymbolicLink(), "dossier réel (pas un symlink kit)");
    assert.ok(fs.lstatSync(path.join(nm, "@types")).isSymbolicLink());
    assert.equal(
      fs.realpathSync(path.join(nm, "@types/node")),
      fs.realpathSync(path.join(ROOT, "node_modules/@types/node")),
    );
    const again = linkKitNodeModules(dir, ROOT);
    assert.equal(again.linked, false, "ne remplace pas un node_modules déjà utilisable");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("linkKitNodeModules ne remplace pas un node_modules déjà utilisable", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-link-nm-real-"));
  try {
    const real = path.join(dir, "node_modules");
    fs.mkdirSync(path.join(real, "@types/node"), { recursive: true });
    fs.writeFileSync(path.join(real, "sentinel"), "keep");
    const { linked } = linkKitNodeModules(dir, ROOT);
    assert.equal(linked, false);
    assert.equal(fs.readFileSync(path.join(real, "sentinel"), "utf8"), "keep");
    assert.ok(!fs.lstatSync(real).isSymbolicLink());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("linkKitNodeModules recrée un symlink cassé", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-link-nm-broken-"));
  try {
    fs.symlinkSync(
      path.join(dir, "missing-nm"),
      path.join(dir, "node_modules"),
      "dir",
    );
    const { linked, path: nm } = linkKitNodeModules(dir, ROOT);
    assert.equal(linked, true);
    assert.ok(fs.statSync(nm).isDirectory());
    assert.ok(fs.existsSync(path.join(nm, "@types/node")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("linkKitNodeModulesForBrand cible server/ en monorepo", () => {
  const brand = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-link-nm-brand-"));
  try {
    const server = path.join(brand, "server");
    fs.mkdirSync(server);
    fs.writeFileSync(path.join(server, "package.json"), "{}");
    const { dir, linked } = linkKitNodeModulesForBrand(brand, ROOT);
    assert.equal(dir, server);
    assert.equal(linked, true);
    assert.ok(fs.existsSync(path.join(server, "node_modules/@types/node")));
  } finally {
    fs.rmSync(brand, { recursive: true, force: true });
  }
});

test("factory-prd* : hors-ligne (skip dist + npm offline + helper)", () => {
  const prd = fs.readFileSync(
    path.join(ROOT, "scripts/test-phase-factory-prd.mjs"),
    "utf8",
  );
  const exp = fs.readFileSync(
    path.join(ROOT, "scripts/test-phase-factory-prd-experience.mjs"),
    "utf8",
  );
  for (const [name, src] of [
    ["factory-prd", prd],
    ["factory-prd-experience", exp],
  ]) {
    assert.match(src, /link-kit-node-modules/, `${name} doit lier le node_modules kit`);
    assert.match(
      src,
      /CREEZIO_SKIP_BRAND_DIST/,
      `${name} doit sauter prepareBrandDistribution (npm lock réseau)`,
    );
    assert.match(
      src,
      /npm_config_offline/,
      `${name} doit forcer npm offline (pas d'install registre)`,
    );
  }
  const scaffold = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/scaffold.ts"),
    "utf8",
  );
  assert.match(
    scaffold,
    /include": \["src\/electron\/preload\.ts", "src\/electron\/electron-shim\.d\.ts"\]/,
    "tsconfig.preload généré doit typer electron via le shim (pas le paquet npm)",
  );
});
