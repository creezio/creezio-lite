#!/usr/bin/env node
/**
 * Clean cross-platform (Q9) — remplace `rm -rf` pour les devs Windows.
 * Cibles identiques à l'ancien script : packages/<*>/dist, apps/console/.next,
 * apps/demobrand/build.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [];
const packagesDir = path.join(root, "packages");
if (fs.existsSync(packagesDir)) {
  for (const ent of fs.readdirSync(packagesDir)) {
    targets.push(path.join(packagesDir, ent, "dist"));
  }
}
targets.push(path.join(root, "apps", "console", ".next"));
targets.push(path.join(root, "apps", "demobrand", "build"));

let removed = 0;
for (const t of targets) {
  if (fs.existsSync(t)) {
    fs.rmSync(t, { recursive: true, force: true });
    removed++;
  }
}
console.log(`clean: ${removed} dossier(s) supprimé(s)`);