#!/usr/bin/env node
/**
 * Gate pré-publish — clôture runtime asar.
 *
 * 1. Embarquement : chaque `@creezio/*` (plancher + deps marque − tooling)
 *    + seeds npm (hono, better-sqlite3, …) présents dans app.asar
 * 2. Resolve : depuis extract asar, `createRequire(asar/package.json)` résout
 *    chaque `require('@creezio/…')` / `import '…'` scanné dans l'asar + deps
 *    npm critiques — échoue si UN seul module manque
 * 3. Natifs better-sqlite3 (.node PE win) + parité tray/NSIS
 *
 * Usage :
 *   node …/verify-pack-runtime.mjs [appRoot] [--kind=server|client] [--platform=win|linux]
 * Exit 1 si manquant — ne pas publier.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const kindArg = args.find((a) => a.startsWith("--kind="));
const kind = kindArg ? kindArg.slice("--kind=".length) : "server";
const platformArg = args.find((a) => a.startsWith("--platform="));
const platform = platformArg ? platformArg.slice("--platform=".length) : "win";
const appRoot = path.resolve(
  args.find((a) => !a.startsWith("--")) || process.cwd(),
);

const TOOLING_ONLY = new Set([
  "desktop-tooling",
  "factory",
  "propagation",
]);

const FLOOR_CREEZIO = [
  "brand-config",
  "platform-core",
  "product-hub",
  "shell",
  "electron-shell",
  "api-kernel",
  "mcp-facade",
  "shell-ui",
  "auth",
  "app-runtime",
  "assistant",
  "tasks",
  "mails",
  "observability",
  "database",
  "onboarding",
  "cockpit",
  "os-ui",
  "brand-spec",
];

const NPM_SEEDS = [
  "hono",
  "better-sqlite3",
  "bindings",
  "file-uri-to-path",
  "zod",
  "jose",
  "@hono/zod-openapi",
];

const distDir =
  kind === "client" ? "dist-electron" : "dist-electron-server";
const unpackedName =
  platform === "linux" ? "linux-unpacked" : "win-unpacked";
const unpacked = path.join(appRoot, distDir, unpackedName);
const asarPath = path.join(unpacked, "resources", "app.asar");
const unpackedAsar = path.join(unpacked, "resources", "app.asar.unpacked");

if (!fs.existsSync(asarPath)) {
  console.error(`verify-pack-runtime: asar manquant: ${asarPath}`);
  console.error("  → lancer pack:win / pack:linux d'abord");
  process.exit(1);
}

// Les sidecars serveur Windows doivent être des extraResources top-level :
// Electron ne peut pas spawn un exécutable dans app.asar. Ce contrôle lit le
// résultat réel du pack, pas seulement la config electron-builder.
if (platform === "win" && kind === "server") {
  const binDir = path.join(unpacked, "resources", "bin");
  const requiredBins = ["meilisearch-win.exe", "cloudflared.exe"];
  const missingBins = requiredBins.filter(
    (name) => !fs.existsSync(path.join(binDir, name)),
  );
  if (missingBins.length) {
    console.error(
      "verify-pack-runtime: sidecars Windows manquants dans resources/bin:",
    );
    for (const name of missingBins) console.error("  -", name);
    console.error("  → lancer electron:stage-win-bins avant le pack serveur");
    process.exit(1);
  }
  for (const name of requiredBins) {
    const candidate = path.join(binDir, name);
    const fd = fs.openSync(candidate, "r");
    const signature = Buffer.alloc(2);
    fs.readSync(fd, signature, 0, 2, 0);
    fs.closeSync(fd);
    if (signature[0] !== 0x4d || signature[1] !== 0x5a) {
      console.error(
        `verify-pack-runtime: ${name} n'est pas un exécutable Windows PE (MZ)`,
      );
      process.exit(1);
    }
  }
}

const require = createRequire(import.meta.url);
let Asar;
try {
  Asar = require("@electron/asar");
} catch {
  try {
    Asar = require(path.join(appRoot, "node_modules/@electron/asar"));
  } catch {
    console.error("verify-pack-runtime: @electron/asar requis");
    process.exit(1);
  }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function brandCreezioPackages() {
  const pkgPath = path.join(appRoot, "package.json");
  const out = new Set(FLOOR_CREEZIO);
  if (!fs.existsSync(pkgPath)) return [...out].sort();
  const deps = readJson(pkgPath).dependencies || {};
  for (const name of Object.keys(deps)) {
    if (!name.startsWith("@creezio/")) continue;
    const short = name.slice("@creezio/".length);
    if (!TOOLING_ONLY.has(short)) out.add(short);
  }
  // clôture transitive vendor
  const queue = [...out];
  const seen = new Set();
  while (queue.length) {
    const short = queue.shift();
    if (seen.has(short) || TOOLING_ONLY.has(short)) continue;
    const vp = path.join(appRoot, "vendor/creezio", short, "package.json");
    if (!fs.existsSync(vp)) continue;
    seen.add(short);
    out.add(short);
    const vdeps = readJson(vp).dependencies || {};
    for (const d of Object.keys(vdeps)) {
      if (!d.startsWith("@creezio/")) continue;
      const s = d.slice("@creezio/".length);
      if (!seen.has(s) && !TOOLING_ONLY.has(s)) queue.push(s);
    }
  }
  return [...out].sort();
}

const list = Asar.listPackage(asarPath);
const tops = new Set();
for (const p of list) {
  const m = String(p).match(/^\/?node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
  if (m) tops.add(m[1]);
}

const requiredCreezio = brandCreezioPackages().map((s) => `@creezio/${s}`);
const missingPresent = [
  ...requiredCreezio.filter((p) => !tops.has(p)),
  ...NPM_SEEDS.filter((p) => !tops.has(p)),
];
if (missingPresent.length) {
  console.error("verify-pack-runtime: packages manquants dans asar:");
  for (const m of missingPresent) console.error("  -", m);
  process.exit(1);
}

// .node : dans asar ou asar.unpacked
const nodeInAsar = list.some((p) => String(p).endsWith(".node"));
let nodeUnpacked = false;
function walkNodes(dir) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkNodes(full);
    else if (ent.name.endsWith(".node")) nodeUnpacked = true;
  }
}
walkNodes(unpackedAsar);

if (!nodeInAsar && !nodeUnpacked) {
  console.error(
    "verify-pack-runtime: aucun .node (better-sqlite3) dans asar/asar.unpacked",
  );
  process.exit(1);
}

/** Nom de package npm valide (évite commentaires `…` / placeholders). */
function isValidPackageId(id) {
  if (!id || id.startsWith(".") || id.startsWith("node:")) return false;
  if (id.startsWith("@")) {
    return /^@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*$/i.test(id);
  }
  return /^[a-z0-9][\w.-]*$/i.test(id);
}

/** Scan require/import dans sources JS de l'extract. */
function scanModuleIds(rootDir) {
  const ids = new Set();
  const re =
    /(?:require\s*\(\s*|from\s+|import\s*\(\s*)['"](@?[^'"]+)['"]/g;
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (
          ent.name === "node_modules" &&
          !full.includes(`${path.sep}node_modules${path.sep}@creezio`)
        ) {
          if (!full.endsWith(`${path.sep}node_modules`)) continue;
          const creezioDir = path.join(full, "@creezio");
          if (fs.existsSync(creezioDir)) walk(creezioDir);
          continue;
        }
        walk(full);
        continue;
      }
      if (!/\.(js|cjs|mjs)$/.test(ent.name)) continue;
      const st = fs.statSync(full);
      if (st.size > 2_000_000) continue;
      let src;
      try {
        src = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        let id = m[1];
        if (!id || id.startsWith(".") || id.startsWith("node:")) continue;
        if (id.startsWith("@")) {
          const parts = id.split("/");
          if (parts.length < 2) continue;
          id = `${parts[0]}/${parts[1]}`;
        } else {
          id = id.split("/")[0];
        }
        if (isValidPackageId(id)) ids.add(id);
      }
    }
  }
  walk(path.join(rootDir, "build"));
  walk(path.join(rootDir, "node_modules", "@creezio"));
  return ids;
}

fs.mkdirSync(path.join(appRoot, ".tmp"), { recursive: true });
const tmp = fs.mkdtempSync(path.join(appRoot, ".tmp", "pack-runtime-"));
try {
  Asar.extractAll(asarPath, tmp);
  if (fs.existsSync(unpackedAsar)) {
    fs.cpSync(unpackedAsar, tmp, { recursive: true });
  }

  const honoPkg = path.join(tmp, "node_modules/hono/package.json");
  const bsqlPkg = path.join(tmp, "node_modules/better-sqlite3/package.json");
  if (!fs.existsSync(honoPkg) || !fs.existsSync(bsqlPkg)) {
    console.error("verify-pack-runtime: extract incomplet (hono/better-sqlite3)");
    process.exit(1);
  }

  if (kind === "server") {
    // La cohérence Meili est exécutée par Node vanilla : le script ne peut pas
    // vivre seulement dans app.asar. Il est donc une extraResource serveur.
    const coherenceQuery = path.join(
      unpacked,
      "resources",
      "scripts",
      "meili-coherence-query.cjs",
    );
    if (!fs.existsSync(coherenceQuery)) {
      console.error(
        "verify-pack-runtime: meili coherence-query absent de resources/scripts",
      );
      process.exit(1);
    }
    // Le CRM principal est le Next standalone (parité TF2) : sans lui le shell
    // runtime n'a rien à charger après le splash.
    const nextEntry = path.join(unpacked, "resources", "server", "server.js");
    if (!fs.existsSync(nextEntry)) {
      console.error(
        "verify-pack-runtime: Next standalone absent de resources/server/server.js",
      );
      console.error("  → lancer build:ui + electron:build-server avant le pack");
      process.exit(1);
    }
  }

  // Require ancré DANS l'asar (équivalent createAppRequire packagé)
  const asarReq = createRequire(path.join(tmp, "package.json"));
  // Aussi depuis platform-core (ancrage module — piège cwd installDir)
  const coreEntry = path.join(
    tmp,
    "node_modules/@creezio/platform-core/dist-cjs/index.js",
  );
  const coreReq = fs.existsSync(coreEntry)
    ? createRequire(coreEntry)
    : asarReq;

  const scanned = scanModuleIds(tmp);
  const mustResolve = new Set([
    ...requiredCreezio,
    ...NPM_SEEDS,
    ...[...scanned].filter(
      (id) =>
        id.startsWith("@creezio/") ||
        NPM_SEEDS.includes(id) ||
        id === "hono" ||
        id === "zod" ||
        id === "jose" ||
        id.startsWith("@hono/") ||
        id === "better-sqlite3" ||
        id === "yaml" ||
        id === "clsx" ||
        id === "tailwind-merge" ||
        id === "openapi3-ts" ||
        id === "@asteasolutions/zod-to-openapi",
    ),
  ]);

  // Ne pas exiger electron / react / next dans le main packagé
  const resolveSkip = new Set([
    "electron",
    "react",
    "react-dom",
    "next",
    "lucide-react",
    "typescript",
  ]);

  const unresolved = [];
  for (const id of [...mustResolve].sort()) {
    if (resolveSkip.has(id)) continue;
    // tooling never in asar
    if (id.startsWith("@creezio/")) {
      const short = id.slice("@creezio/".length);
      if (TOOLING_ONLY.has(short)) continue;
    }
    let ok = false;
    for (const req of [asarReq, coreReq]) {
      try {
        req.resolve(id);
        ok = true;
        break;
      } catch {
        /* try next */
      }
    }
    if (!ok) unresolved.push(id);
  }

  if (unresolved.length) {
    console.error("verify-pack-runtime: MODULE_NOT_FOUND (resolve asar):");
    for (const m of unresolved) console.error("  -", m);
    process.exit(1);
  }

  // Preuve anti-régression documentaire : createRequire({installDir}) hors
  // de tout arbre node_modules (simule Win installDir) échoue pour
  // @creezio/auth — alors que l'ancrage asar ci-dessus réussit.
  // Skip si NODE_PATH pollue la résolution.
  if (!process.env.NODE_PATH) {
    const fakeCwd = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-pack-fake-"));
    try {
      const badReq = createRequire(path.join(fakeCwd, "package.json"));
      badReq.resolve("@creezio/auth");
      console.error(
        "verify-pack-runtime: ATTENDU que resolve depuis installDir vide échoue",
      );
      process.exit(1);
    } catch {
      /* attendu — piège cwd packagé */
    } finally {
      fs.rmSync(fakeCwd, { recursive: true, force: true });
    }
  }

  // import hono (ESM)
  const honoMod = await import(
    pathToFileURL(path.join(tmp, "node_modules/hono/dist/index.js")).href
  );
  if (!honoMod.Hono) {
    console.error("verify-pack-runtime: Hono export manquant");
    process.exit(1);
  }

  // Charge effective @creezio/auth (CJS) depuis ancrage asar
  try {
    const auth = asarReq("@creezio/auth");
    if (!auth || typeof auth !== "object") {
      console.error("verify-pack-runtime: @creezio/auth load vide");
      process.exit(1);
    }
  } catch (e) {
    console.error(
      "verify-pack-runtime: require('@creezio/auth') échoue:",
      e instanceof Error ? e.message : e,
    );
    process.exit(1);
  }

  const nodeFile = path.join(
    tmp,
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
  );
  if (!fs.existsSync(nodeFile)) {
    console.error("verify-pack-runtime: better_sqlite3.node absent après extract");
    process.exit(1);
  }
  const fd = fs.openSync(nodeFile, "r");
  const buf = Buffer.alloc(2);
  fs.readSync(fd, buf, 0, 2, 0);
  fs.closeSync(fd);
  const isMz = buf[0] === 0x4d && buf[1] === 0x5a;
  const isElf = buf[0] === 0x7f && buf[1] === 0x45;
  if (!isMz && !isElf) {
    console.error("verify-pack-runtime: better_sqlite3.node format inconnu");
    process.exit(1);
  }
  if (
    platform === "win" &&
    process.env.CREEZIO_VERIFY_WIN_NATIVE !== "0" &&
    !isMz
  ) {
    console.error(
      "verify-pack-runtime: better_sqlite3.node n'est pas win32 (MZ) — relancer ensure-win-native-modules",
    );
    process.exit(1);
  }
  if (platform === "linux" && !isElf && process.env.CREEZIO_VERIFY_LINUX_NATIVE !== "0") {
    // cross-pack win native dans linux-unpacked est OK si on vérifie win ;
    // pour linux pack, attendre ELF
    if (!isMz) {
      console.error("verify-pack-runtime: better_sqlite3.node ni ELF ni MZ");
      process.exit(1);
    }
  }

  // Parité TF2 server : tray / auto-launch / factory-reset
  const parityNeedles = [
    "TrayController",
    "applyLaunchAtStartup",
    "setLoginItemSettings",
    "config:factory-reset",
    "launchAtStartup",
  ];
  const shellCandidates = [
    path.join(tmp, "node_modules/@creezio/electron-shell/dist/tray.js"),
    path.join(tmp, "node_modules/@creezio/electron-shell/dist-cjs/tray.js"),
    path.join(
      tmp,
      "node_modules/@creezio/electron-shell/dist/desktop/brand-desktop-runtime.js",
    ),
    path.join(
      tmp,
      "node_modules/@creezio/electron-shell/dist-cjs/desktop/brand-desktop-runtime.js",
    ),
  ];
  let asarBlob = "";
  for (const f of shellCandidates) {
    if (fs.existsSync(f)) asarBlob += fs.readFileSync(f, "utf8");
  }
  if (!asarBlob) {
    const walk = (dir) => {
      if (!fs.existsSync(dir) || asarBlob.length > 50_000) return;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === "node_modules" && !dir.includes("@creezio")) continue;
          walk(full);
        } else if (
          ent.name === "tray.js" ||
          ent.name === "brand-desktop-runtime.js"
        ) {
          asarBlob += fs.readFileSync(full, "utf8");
        }
      }
    };
    walk(path.join(tmp, "node_modules/@creezio/electron-shell"));
  }
  const missingParity = parityNeedles.filter((n) => !asarBlob.includes(n));
  if (missingParity.length) {
    console.error(
      "verify-pack-runtime: hooks desktop manquants dans asar:",
      missingParity.join(", "),
    );
    process.exit(1);
  }

  const installerNsh = path.join(appRoot, "installer.nsh");
  if (fs.existsSync(installerNsh) && platform === "win") {
    const nsh = fs.readFileSync(installerNsh, "utf8");
    if (
      /placeholder \(custom macros marque\)/.test(nsh) ||
      !/customUnWelcomePage/.test(nsh) ||
      !/launchAtStartup/.test(nsh)
    ) {
      console.error(
        "verify-pack-runtime: installer.nsh placeholder ou incomplet (parité TF2)",
      );
      process.exit(1);
    }
    // Sans customRemoveFiles, electron-builder fait RMDir /r $INSTDIR :
    // désinstallation lente ET data purgé même case décochée / à l'upgrade.
    if (!/customRemoveFiles/.test(nsh)) {
      console.error(
        "verify-pack-runtime: installer.nsh sans customRemoveFiles — " +
          "purge lente de {installDir}\\data et perte de données à l'upgrade",
      );
      process.exit(1);
    }
  }

  // Anti-régression Windows : un regex `file:\/\/[^…:…]` (classe excluant ':')
  // ne matche JAMAIS `file:///C:/…` (deux-points de lettre de lecteur) —
  // crash « loadBrowserTabs: URL module introuvable » sur client packagé Win.
  // Interdit dans tout dist @creezio embarqué.
  const driveUnsafeRe = /file:\\\/\\\/\[\^[^\]]*:[^\]]*\]/;
  const driveUnsafeHits = [];
  {
    const creezioRoot = path.join(tmp, "node_modules", "@creezio");
    const walkDist = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === "node_modules") continue;
          walkDist(full);
        } else if (/\.(js|cjs|mjs)$/.test(ent.name)) {
          // Ne pas se scanner soi-même : ce script embarque le pattern
          // interdit (en tant que détecteur) dans les tooling scripts packés.
          if (ent.name === "verify-pack-runtime.mjs") continue;
          let src;
          try {
            src = fs.readFileSync(full, "utf8");
          } catch {
            continue;
          }
          if (driveUnsafeRe.test(src)) {
            driveUnsafeHits.push(path.relative(tmp, full));
          }
        }
      }
    };
    walkDist(creezioRoot);
  }
  if (driveUnsafeHits.length) {
    console.error(
      "verify-pack-runtime: regex file:// incompatible chemins Windows (lettre de lecteur) dans:",
    );
    for (const f of driveUnsafeHits) console.error("  -", f);
    console.error("  → utiliser createAppRequire (@creezio/platform-core)");
    process.exit(1);
  }

  // Preuve que loadBrowserTabs (app-runtime) passe par createAppRequire.
  {
    const candidates = [
      path.join(
        tmp,
        "node_modules/@creezio/app-runtime/dist/install-brand-os-desktop.js",
      ),
      path.join(
        tmp,
        "node_modules/@creezio/app-runtime/dist-cjs/install-brand-os-desktop.js",
      ),
    ];
    for (const f of candidates) {
      if (!fs.existsSync(f)) continue;
      const src = fs.readFileSync(f, "utf8");
      if (/loadBrowserTabs/.test(src) && !/createAppRequire/.test(src)) {
        console.error(
          "verify-pack-runtime: loadBrowserTabs sans createAppRequire dans",
          path.relative(tmp, f),
        );
        process.exit(1);
      }
    }
  }

  // Preuve createAppRequire présent dans platform-core packagé
  const appRequireCandidates = [
    path.join(tmp, "node_modules/@creezio/platform-core/dist-cjs/app-require.js"),
    path.join(tmp, "node_modules/@creezio/platform-core/dist/app-require.js"),
  ];
  const hasAppRequire = appRequireCandidates.some((f) => fs.existsSync(f));
  if (!hasAppRequire) {
    console.error(
      "verify-pack-runtime: createAppRequire absent de platform-core dans asar — sync vendor / rebuild kit",
    );
    process.exit(1);
  }

  console.log("verify-pack-runtime: OK");
  console.log("  asar       ", asarPath);
  console.log("  @creezio   ", requiredCreezio.length, "packages");
  console.log("  resolved   ", mustResolve.size, "ids (scan+seeds)");
  console.log(
    "  .node      ",
    isMz ? "win32 PE" : "ELF",
    nodeUnpacked ? "(asar.unpacked)" : "(asar)",
  );
  console.log("  parity     ", parityNeedles.join(", "));
  console.log("  appRequire ", "present");
  if (kind === "server") {
    console.log("  coherence  ", "meili coherence-query external present");
  }
  if (platform === "win" && kind === "server") {
    console.log("  sidecars   ", "meilisearch-win.exe, cloudflared.exe (PE)");
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
