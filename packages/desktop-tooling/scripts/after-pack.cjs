/**
 * Hook electron-builder afterPack — générique multi-marque.
 *
 * Port de `crm/scripts/electron/after-pack.cjs` (TF2 0.10.26).
 * Aucune marque hardcodée : lit `build/electron/app-kind.json`.
 *
 * 1. Client léger : n'embarque pas le standalone Next.
 * 2. Serveur / legacy : copie `build/server` (ou assemble ui/.next/standalone)
 *    vers resources/server. better-sqlite3 imposé seulement s'il est présent
 *    (TF2) — Next UI-only (TF3) OK sans.
 *
 * Usage dans electron-builder.yml d'une app :
 *   afterPack: node_modules/@creezio/desktop-tooling/scripts/after-pack.cjs
 *   (ou vendor/creezio/desktop-tooling/scripts/after-pack.cjs)
 */
const fs = require("node:fs");
const path = require("node:path");

/** "PE" (Windows, MZ), "ELF" (Linux) ou "?" d'après l'en-tête du fichier. */
function binFormat(file) {
  const fd = fs.openSync(file, "r");
  const head = Buffer.alloc(4);
  fs.readSync(fd, head, 0, 4, 0);
  fs.closeSync(fd);
  if (head[0] === 0x4d && head[1] === 0x5a) return "PE";
  if (head[0] === 0x7f && head.toString("latin1", 1, 4) === "ELF") return "ELF";
  return "?";
}

/** Tous les better_sqlite3.node sous `dir` (récursif). */
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

/** Kind packagé, écrit par write-app-kind juste avant electron-builder. */
function packagedAppKind(root) {
  try {
    const raw = fs.readFileSync(
      path.join(root, "build", "electron", "app-kind.json"),
      "utf8",
    );
    const kind = JSON.parse(raw).kind;
    return kind === "server" || kind === "client" ? kind : "legacy";
  } catch {
    return "legacy";
  }
}

function assembleFromUiStandalone(root, dest) {
  const candidates = [
    path.join(root, "ui", ".next", "standalone"),
    path.join(root, ".next", "standalone"),
  ];
  const standalone = candidates.find((c) =>
    fs.existsSync(path.join(c, "server.js")),
  );
  if (!standalone) {
    throw new Error(
      "afterPack : ni build/server ni ui/.next/standalone — lancer build:ui + electron:build-server",
    );
  }
  fs.cpSync(standalone, dest, { recursive: true });
  const staticSrc = standalone.includes(`${path.sep}ui${path.sep}`)
    ? path.join(root, "ui", ".next", "static")
    : path.join(root, ".next", "static");
  if (fs.existsSync(staticSrc)) {
    fs.cpSync(staticSrc, path.join(dest, ".next", "static"), {
      recursive: true,
    });
  }
  const publicSrc = standalone.includes(`${path.sep}ui${path.sep}`)
    ? path.join(root, "ui", "public")
    : path.join(root, "public");
  if (fs.existsSync(publicSrc)) {
    fs.cpSync(publicSrc, path.join(dest, "public"), { recursive: true });
  }
  console.log(`  • afterPack : assembled from ${path.relative(root, standalone)}`);
}

/** Tous les fichiers `name` sous `dir` (récursif). */
function findFiles(dir, name) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findFiles(p, name));
    else if (entry.name === name) found.push(p);
  }
  return found;
}

/**
 * Gate artefact : `browser-tab-preload.js` (onglets externes / pilotage IA)
 * doit être présent dans l'app packagée — sinon les onglets seraient ouverts
 * sans IPC (dégradés silencieux). Échec du build plutôt qu'un artefact bancal.
 */
function verifyBrowserTabPreload(context) {
  const resources = path.join(context.appOutDir, "resources");
  const needle = "browser-tab-preload.js";
  const asarPath = path.join(resources, "app.asar");
  if (fs.existsSync(asarPath)) {
    let asar = null;
    try {
      asar = require("@electron/asar");
    } catch {
      try {
        // eslint-disable-next-line n/no-missing-require
        asar = require("asar");
      } catch {
        asar = null;
      }
    }
    if (!asar) {
      console.warn(
        "  • afterPack : module asar introuvable — vérif browser-tab-preload sautée (app.asar non listable)",
      );
      return;
    }
    const entries = asar.listPackage(asarPath, {});
    if (!entries.some((e) => e.endsWith(needle))) {
      throw new Error(
        `afterPack : ${needle} absent de app.asar — onglets externes muets. ` +
          "Vérifier que vendor/creezio/electron-shell/dist* est bien packagé (files electron-builder).",
      );
    }
  } else {
    const appDir = path.join(resources, "app");
    if (findFiles(appDir, needle).length === 0) {
      throw new Error(
        `afterPack : ${needle} absent de resources/app — onglets externes muets.`,
      );
    }
  }
  console.log(`  • afterPack : ${needle} présent dans l'artefact — OK`);
}

module.exports = async function afterPack(context) {
  const root = context.packager.projectDir;
  const kind = packagedAppKind(root);
  const dest = path.join(context.appOutDir, "resources", "server");
  fs.rmSync(dest, { recursive: true, force: true });

  verifyBrowserTabPreload(context);

  // Client léger : allowLocalStack=false → jamais de serveur Next local.
  if (kind === "client") {
    console.log(
      "  • afterPack : kind=client → standalone Next non embarqué (client léger)",
    );
    return;
  }

  const src = path.join(root, "build", "server");
  if (fs.existsSync(path.join(src, "server.js"))) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(`  • afterPack : build/server copié intégralement → ${dest}`);
  } else {
    assembleFromUiStandalone(root, dest);
  }

  const platform = context.electronPlatformName; // "win32" | "linux" | "darwin"
  const expected = platform === "win32" ? "PE" : "ELF";
  const bindings = findBindings(dest);

  if (bindings.length === 0) {
    console.log(
      "  • afterPack : Next UI-only (pas de better-sqlite3 dans resources/server) — OK",
    );
    return;
  }

  if (platform === "win32") {
    const winNode = path.join(root, "resources-win", "better_sqlite3.node");
    if (!fs.existsSync(winNode) || binFormat(winNode) !== "PE") {
      throw new Error(
        "afterPack : resources-win/better_sqlite3.node absent ou pas un binaire Windows (PE).",
      );
    }
    for (const t of bindings) {
      fs.mkdirSync(path.dirname(t), { recursive: true });
      fs.copyFileSync(winNode, t);
      console.log(`  • afterPack : binding WINDOWS → ${path.relative(dest, t)}`);
    }
  }

  const resources = path.join(context.appOutDir, "resources");
  const all = findBindings(resources);
  for (const b of all) {
    const fmt = binFormat(b);
    console.log(`  • afterPack : vérif ${path.relative(resources, b)} = ${fmt}`);
    if (fmt !== expected) {
      throw new Error(
        `afterPack : ${b} est ${fmt}, attendu ${expected} pour la cible ${platform} — build refusé.`,
      );
    }
  }

  for (const mod of ["bindings", "file-uri-to-path"]) {
    const p = path.join(dest, "node_modules", mod, "package.json");
    if (!fs.existsSync(p)) {
      throw new Error(
        `afterPack : node_modules/${mod} manquant dans le serveur embarqué.`,
      );
    }
  }
  console.log(
    `  • afterPack : binding better-sqlite3 conforme (${expected}) + bindings/file-uri-to-path OK`,
  );
};
