#!/usr/bin/env node
/**
 * Copie la SoT des codemods d'architecture (scripts/codemods/ du repo kit)
 * dans packages/factory/codemods/ (publié npm — consommé par
 * `creezio upgrade` quand la factory est installée hors repo kit).
 *
 * Lancé par le build du package (après tsc). No-op explicite hors repo kit
 * (package déjà publié : la copie est dans l'artefact npm).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const factoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const source = path.resolve(factoryRoot, "../../scripts/codemods");
const dest = path.join(factoryRoot, "codemods");

if (!fs.existsSync(source)) {
  console.log("copy-codemods: scripts/codemods absent (hors repo kit) — no-op");
  process.exit(0);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
let copied = 0;
for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (!/^H\d+$/.test(entry.name) && entry.name !== "lib") continue;
  fs.cpSync(path.join(source, entry.name), path.join(dest, entry.name), {
    recursive: true,
  });
  copied++;
}
console.log(`copy-codemods: ${copied} entrée(s) copiée(s) → packages/factory/codemods/`);
