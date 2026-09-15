#!/usr/bin/env node
/**
 * Codemod H13 — classes / ids UI kit nommés marque → creezio-*
 * (ARCHITECTURE_VERSION H12 → H13).
 *
 * Usage (contrat scripts/codemods/README.md) :
 *   ROOT=<racine du clone marque> node h13-ui-debrand.mjs
 *
 * Le kit n'exporte plus les sélecteurs / caches / ids hérités. Réécritures :
 *
 *   1. `.tempoflow-titlebar-drag` / `tempoflow-titlebar-drag`
 *      → `.creezio-titlebar-drag` / `creezio-titlebar-drag`
 *      (idem `-no-drag`) ;
 *   2. `tf2-fake-cursor` → `creezio-fake-cursor` ;
 *   3. `__tfFakeCursor` → `__creezioFakeCursor` ;
 *   4. préfixe de cache SW `tf2-shell-` → `creezio-shell-`.
 *
 * Idempotent : relancer sur une marque déjà migrée = no-op (exit 0, zéro
 * ligne `~`). Ne touche jamais node_modules/, dist/, dist-cjs/, .next/,
 * docker-data/, .git/ ni les lockfiles.
 */
import fs from "node:fs";
import path from "node:path";
import { shouldSkipDir } from "../lib/skip-dirs.mjs";

const ROOT = path.resolve(process.env.ROOT || ".");
if (!fs.existsSync(ROOT)) {
  console.error(`ROOT introuvable : ${ROOT}`);
  process.exit(1);
}

const CODE_EXT_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|css)$/;

const REPLACEMENTS = [
  ["tempoflow-titlebar-no-drag", "creezio-titlebar-no-drag"],
  ["tempoflow-titlebar-drag", "creezio-titlebar-drag"],
  ["tf2-fake-cursor", "creezio-fake-cursor"],
  ["__tfFakeCursor", "__creezioFakeCursor"],
  ["tf2-shell-", "creezio-shell-"],
];

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (shouldSkipDir(name)) continue;
      walk(p, acc);
    } else {
      acc.push(p);
    }
  }
  return acc;
}

const rel = (abs) => path.relative(ROOT, abs);
const writes = [];

for (const abs of walk(ROOT).filter((p) => CODE_EXT_RE.test(p))) {
  const src = fs.readFileSync(abs, "utf8");
  let next = src;
  for (const [from, to] of REPLACEMENTS) {
    if (next.includes(from)) next = next.split(from).join(to);
  }
  if (next !== src) writes.push({ abs, rel: rel(abs), body: next });
}

if (writes.length === 0) {
  console.log("✓ codemod H13 (ui-debrand) : rien à migrer — no-op");
} else {
  for (const { abs, body } of writes) fs.writeFileSync(abs, body, "utf8");
  console.log(`✓ codemod H13 (ui-debrand) : ${writes.length} fichier(s) migré(s)`);
  for (const { rel: r } of writes) console.log(`  ~ ${r}`);
}
