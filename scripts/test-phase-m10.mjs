#!/usr/bin/env node
/**
 * Gate kit M10 — une seule arborescence métier TF (symlink, pas de doublon).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tfRoot = resolveBrandCrmRoot("tempoflow2");
const modulesPath = path.join(tfRoot, "modules");
const electronModulesPath = path.join(tfRoot, "electron/modules");

test("M10.1 PHASE-M10.md présent", () => {
  const docPath = path.join(root, "docs/archive/PHASE-M10.md");
  assert.ok(fs.existsSync(docPath));
  const doc = fs.readFileSync(docPath, "utf8");
  assert.match(doc, /symlink/i);
  assert.match(doc, /electron\/modules/);
});

test("M10.2 crm/modules est symlink → electron/modules", () => {
  assert.ok(fs.existsSync(modulesPath), "modules manquant");
  assert.ok(fs.lstatSync(modulesPath).isSymbolicLink(), "modules n'est pas un symlink");
  const target = fs.readlinkSync(modulesPath);
  assert.ok(
    target === "electron/modules" ||
      path.resolve(tfRoot, target) === path.resolve(electronModulesPath),
    `symlink target inattendu: ${target}`,
  );
  assert.equal(
    fs.realpathSync(modulesPath),
    fs.realpathSync(electronModulesPath),
  );
});

test("M10.3 mounts métier : même inode via modules et electron/modules", () => {
  const ids = [
    "panier",
    "dispatch",
    "releves",
    "catalogue",
    "stack",
    "scan",
  ];
  for (const id of ids) {
    const a = path.join(modulesPath, id, "api-mount.ts");
    const b = path.join(electronModulesPath, id, "api-mount.ts");
    assert.ok(fs.existsSync(b), `manque ${id}/api-mount.ts`);
    assert.equal(fs.statSync(a).ino, fs.statSync(b).ino, `${id} inode mismatch`);
  }
});

test("M10.4 pas de second arbre physique modules/ (hors symlink)", () => {
  // Si modules était un vrai dossier distinct, on aurait des fichiers
  // non liés — interdit. Le symlink garantit l'absence de doublon.
  assert.ok(fs.lstatSync(modulesPath).isSymbolicLink());
  assert.ok(!fs.existsSync(path.join(tfRoot, "modules.real")));
  assert.ok(!fs.existsSync(path.join(tfRoot, "modules.bak")));
});
