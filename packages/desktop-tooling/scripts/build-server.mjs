#!/usr/bin/env node
/**
 * Assemble le serveur Next standalone dans build/server/ pour afterPack.
 *
 * Sources (première trouvée) :
 *   1) ui/.next/standalone  (marques factory / TF3)
 *   2) .next/standalone     (layout TF2 crm/)
 *
 * Usage :
 *   node …/build-server.mjs [appRoot]
 *   CREEZIO_SERVER_PLATFORM=win32 …  # remplace better-sqlite3 si présent
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(
  process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
);

function resolveStandalone() {
  const candidates = [
    path.join(appRoot, "ui", ".next", "standalone"),
    path.join(appRoot, ".next", "standalone"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "server.js"))) return c;
  }
  return null;
}

function resolveStatic(standalone) {
  if (standalone.includes(`${path.sep}ui${path.sep}`)) {
    return path.join(appRoot, "ui", ".next", "static");
  }
  return path.join(appRoot, ".next", "static");
}

function resolvePublic(standalone) {
  if (standalone.includes(`${path.sep}ui${path.sep}`)) {
    return path.join(appRoot, "ui", "public");
  }
  return path.join(appRoot, "public");
}

function binFormat(file) {
  const fd = fs.openSync(file, "r");
  const head = Buffer.alloc(4);
  fs.readSync(fd, head, 0, 4, 0);
  fs.closeSync(fd);
  if (head[0] === 0x4d && head[1] === 0x5a) return "PE";
  if (head[0] === 0x7f && head.toString("latin1", 1, 4) === "ELF") return "ELF";
  return "?";
}

function findBindings(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findBindings(p));
    else if (entry.name === "better_sqlite3.node") found.push(p);
  }
  return found;
}

const standalone = resolveStandalone();
if (!standalone) {
  console.error(
    "build-server: standalone introuvable (ui/.next/standalone ou .next/standalone) — lancer build:ui d'abord",
  );
  process.exit(1);
}

const out = path.join(appRoot, "build", "server");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

console.log("→ copie standalone …", standalone);
fs.cpSync(standalone, out, { recursive: true });

const staticSrc = resolveStatic(standalone);
if (fs.existsSync(staticSrc)) {
  console.log("→ copie .next/static …");
  fs.cpSync(staticSrc, path.join(out, ".next", "static"), { recursive: true });
} else {
  console.warn("build-server: .next/static absent — UI peut être cassée");
}

const publicSrc = resolvePublic(standalone);
if (fs.existsSync(publicSrc)) {
  console.log("→ copie public/ …");
  fs.cpSync(publicSrc, path.join(out, "public"), { recursive: true });
}

// Optionnel : better-sqlite3 seulement si le standalone Next l'utilise déjà
// (TF2). Ne PAS injecter depuis la racine Electron — ça force afterPack win
// alors que l'UI TF3 n'en a pas besoin.
const standaloneHasSqlite = fs.existsSync(
  path.join(out, "node_modules", "better-sqlite3", "package.json"),
);
if (standaloneHasSqlite) {
  for (const mod of ["better-sqlite3", "bindings", "file-uri-to-path"]) {
    if (fs.existsSync(path.join(out, "node_modules", mod, "package.json"))) {
      continue;
    }
    const src = path.join(appRoot, "node_modules", mod);
    const uiSrc = path.join(appRoot, "ui", "node_modules", mod);
    const from = fs.existsSync(src) ? src : fs.existsSync(uiSrc) ? uiSrc : null;
    if (!from) continue;
    console.log(`→ complète node_modules/${mod} …`);
    fs.cpSync(from, path.join(out, "node_modules", mod), { recursive: true });
  }
} else {
  console.log("→ Next UI-only (pas de better-sqlite3 dans standalone)");
}

const targetPlatform =
  process.env.CREEZIO_SERVER_PLATFORM ||
  process.env.TF2_SERVER_PLATFORM ||
  process.platform;

if (targetPlatform === "win32") {
  const winNode = path.join(appRoot, "resources-win", "better_sqlite3.node");
  const bindings = findBindings(out);
  if (bindings.length && fs.existsSync(winNode) && binFormat(winNode) === "PE") {
    for (const t of bindings) {
      fs.copyFileSync(winNode, t);
      console.log("→ binding WINDOWS →", path.relative(out, t));
    }
  } else if (bindings.length) {
    console.warn(
      "build-server: better_sqlite3 présent mais resources-win/better_sqlite3.node manquant — afterPack corrigera",
    );
  }
}

console.log("OK build/server →", out);
