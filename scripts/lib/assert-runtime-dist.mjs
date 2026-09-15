/**
 * Garde fail-closed — dist des packages runtime critiques doit refléter le src.
 *
 * Régression prod (Admin Database 0.3.15) : mount câblé en src, dist gitignoré
 * non rebuildé → package publié / image Docker sans routes (« Route inconnue »).
 *
 * Deux couches :
 *   1. Contrats de contenu (tokens présents dans src ET dist) — ADR.1b généralisé.
 *   2. Fraîcheur par CONTENU : hash sha256 des src .ts comparé au manifest
 *      dist/.creezio-src-hash.json écrit par build-workspaces (mtimes non
 *      fiables : src « touchés » à contenu git propre, constat tempoflow-vps).
 *
 * Usage :
 *   node scripts/lib/assert-runtime-dist.mjs [kitRoot]
 *   import { assertRuntimeDist } from "./lib/assert-runtime-dist.mjs"
 *
 * Exit 1 + message « Run: npm run build:packages » si stale / manquant.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_KIT_ROOT = path.resolve(HERE, "../..");

/**
 * Packages embarqués dont un dist stale casse package / image / routes HTTP.
 * Sous-ensemble runtime critique des packages publiés.
 */
export const FRESHNESS_PACKAGES = [
  "app-runtime",
  "database",
  "mcp-facade",
  "api-kernel",
  "auth",
  "observability",
  "platform-core",
  "electron-shell",
  "host-runtime",
  "search",
  "product-hub",
  "mails",
  "tasks",
  "assistant",
];

/**
 * Contrats src↔dist : chaque token DOIT apparaître dans le fichier source
 * (sinon contrat obsolète) ET dans le dist (sinon dist stale).
 * Étendre ici dès qu'un mount / route critique est ajouté.
 */
export const CONTENT_CONTRACTS = [
  {
    id: "ADR.1b-app-runtime-admin-database",
    package: "app-runtime",
    src: "src/mount-brand-mcp-surface.ts",
    dist: "dist/mount-brand-mcp-surface.js",
    tokens: [
      "createBrandAdminDatabaseRoutes",
      "adminDatabaseHandlesPath",
      "MCP + database + analytics + request-logs",
      "authenticateViaKit",
      "verifySessionToken",
    ],
  },
  {
    id: "ADR.1b-app-runtime-admin-database-handles",
    package: "app-runtime",
    src: "src/mount-brand-admin-database.ts",
    dist: "dist/mount-brand-admin-database.js",
    tokens: [
      "registerRuntimeDatabaseStores",
      "createBrandAdminDatabaseRoutes",
      "/api/v1/admin/database",
      "adminDatabaseHandlesPath",
    ],
  },
  {
    id: "app-runtime-platform-auth",
    package: "app-runtime",
    src: "src/mount-brand-platform-surface.ts",
    dist: "dist/mount-brand-platform-surface.js",
    tokens: ["platformSurfaceHandlesPath", "/api/v1/auth"],
  },
  {
    id: "app-runtime-email-surface",
    package: "app-runtime",
    src: "src/mount-brand-email-surface.ts",
    dist: "dist/mount-brand-email-surface.js",
    tokens: ["emailSurfaceHandlesPath", "/api/v1/email"],
  },
  {
    id: "database-admin-routes",
    package: "database",
    src: "src/http/admin-routes.ts",
    dist: "dist/http/admin-routes.js",
    tokens: ["createAdminDatabaseRoutes"],
  },
  {
    id: "database-index-export",
    package: "database",
    src: "src/index.ts",
    dist: "dist/index.js",
    tokens: ["createAdminDatabaseRoutes"],
  },
  {
    id: "api-kernel-hono-mount",
    package: "api-kernel",
    src: "src/hono.ts",
    dist: "dist/hono.js",
    tokens: ["mountApiKernelOnHono"],
  },
  {
    id: "mcp-facade-oauth",
    package: "mcp-facade",
    src: "src/oauth/routes.ts",
    dist: "dist/oauth/routes.js",
    tokens: ["createMcpOAuthRoutes"],
  },
  {
    id: "mcp-facade-tool-policy",
    package: "mcp-facade",
    src: "src/admin/tool-policy-guard.ts",
    dist: "dist/admin/tool-policy-guard.js",
    tokens: ["registerGuardedMcpTool"],
  },
  {
    id: "auth-hono-routes",
    package: "auth",
    src: "src/hono-routes.ts",
    dist: "dist/hono-routes.js",
    tokens: ["createAuthRoutes"],
  },
  {
    id: "observability-usage-analytics",
    package: "observability",
    src: "src/usage/http-routes.ts",
    dist: "dist/usage/http-routes.js",
    tokens: ["createUsageAnalyticsAdminRoutes", "/analytics/overview"],
  },
  {
    id: "host-runtime-cloudflared-respawn",
    package: "host-runtime",
    src: "src/tunnel/tunnel.ts",
    dist: "dist/tunnel/tunnel.js",
    tokens: [
      "shouldRespawnCloudflared",
      "spawnCloudflaredProcess",
      "id ${tunnelId} réutilisé",
    ],
  },
];

/** Manifest de hash src écrit dans dist/ par build-workspaces (contenu). */
export const SRC_HASH_MANIFEST = ".creezio-src-hash.json";

/**
 * @param {string} dir
 * @param {(name: string) => boolean} pred
 * @returns {string[]}
 */
function walkFiles(dir, pred) {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        stack.push(full);
      } else if (ent.isFile() && pred(ent.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Hash sha256 du CONTENU des src .ts d'un package (chemins relatifs triés +
 * octets). Indépendant des mtimes.
 * @param {string} pkgRoot
 * @returns {string | null} hex, ou null si aucun .ts sous src/
 */
export function computeSrcHash(pkgRoot) {
  const files = walkFiles(
    path.join(pkgRoot, "src"),
    (n) => n.endsWith(".ts") && !n.endsWith(".d.ts"),
  ).sort();
  if (!files.length) return null;
  const h = crypto.createHash("sha256");
  for (const f of files) {
    h.update(path.relative(pkgRoot, f).split(path.sep).join("/"));
    h.update("\0");
    h.update(fs.readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex");
}

/**
 * Écrit le manifest src-hash dans dist/ des packages runtime (appelé en fin
 * de build-workspaces). Le dist porte ainsi la preuve du src qui l'a produit.
 * @param {string} kitRoot
 * @param {string[]} [packages]
 * @returns {string[]} packages écrits
 */
export function writeSrcHashManifests(kitRoot, packages = FRESHNESS_PACKAGES) {
  /** @type {string[]} */
  const written = [];
  for (const name of packages) {
    const pkgRoot = path.join(kitRoot, "packages", name);
    const distDir = path.join(pkgRoot, "dist");
    if (!fs.existsSync(distDir)) continue;
    const hash = computeSrcHash(pkgRoot);
    if (!hash) continue;
    fs.writeFileSync(
      path.join(distDir, SRC_HASH_MANIFEST),
      JSON.stringify(
        { srcHash: hash, generatedAt: new Date().toISOString() },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    written.push(name);
  }
  return written;
}

/**
 * @typedef {{ ok: boolean, errors: string[], warnings: string[] }} AssertResult
 */

/**
 * @param {string} kitRoot
 * @param {{ contracts?: typeof CONTENT_CONTRACTS }} [opts]
 * @returns {AssertResult}
 */
export function assertContentContracts(kitRoot, opts = {}) {
  const contracts = opts.contracts || CONTENT_CONTRACTS;
  /** @type {string[]} */
  const errors = [];
  for (const c of contracts) {
    const srcPath = path.join(kitRoot, "packages", c.package, c.src);
    const distPath = path.join(kitRoot, "packages", c.package, c.dist);
    if (!fs.existsSync(srcPath)) {
      errors.push(
        `[${c.id}] source manquant: packages/${c.package}/${c.src} (contrat obsolète ?)`,
      );
      continue;
    }
    if (!fs.existsSync(distPath)) {
      errors.push(
        `[${c.id}] dist manquant: packages/${c.package}/${c.dist} — Run: npm run build:packages`,
      );
      continue;
    }
    const src = fs.readFileSync(srcPath, "utf8");
    const dist = fs.readFileSync(distPath, "utf8");
    for (const token of c.tokens) {
      if (!src.includes(token)) {
        errors.push(
          `[${c.id}] token absent du SRC (contrat à mettre à jour): ${JSON.stringify(token)} in ${c.src}`,
        );
      } else if (!dist.includes(token)) {
        errors.push(
          `[${c.id}] dist stale — token présent en src mais absent du dist: ${JSON.stringify(token)} in ${c.dist} — Run: npm run build:packages`,
        );
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}

/**
 * Fraîcheur par CONTENU : le hash des src .ts doit égaler le manifest écrit
 * dans dist/ lors du dernier build (writeSrcHashManifests). Remplace la
 * comparaison par mtimes, non fiable (src « touchés » sans changement de
 * contenu — constat tempoflow-vps, git status propre).
 * @param {string} kitRoot
 * @param {{ packages?: string[] }} [opts]
 * @returns {AssertResult}
 */
export function assertSrcHashFreshness(kitRoot, opts = {}) {
  const packages = opts.packages || FRESHNESS_PACKAGES;
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  for (const name of packages) {
    const pkgRoot = path.join(kitRoot, "packages", name);
    const distDir = path.join(pkgRoot, "dist");
    if (!fs.existsSync(pkgRoot)) {
      errors.push(`package manquant: packages/${name}`);
      continue;
    }
    if (!fs.existsSync(distDir)) {
      errors.push(
        `dist manquant: packages/${name}/dist — Run: npm run build:packages`,
      );
      continue;
    }
    const current = computeSrcHash(pkgRoot);
    if (current == null) {
      warnings.push(`packages/${name}: aucun .ts sous src/ (skip hash)`);
      continue;
    }
    const manifestPath = path.join(distDir, SRC_HASH_MANIFEST);
    if (!fs.existsSync(manifestPath)) {
      errors.push(
        `packages/${name}: manifest ${SRC_HASH_MANIFEST} absent (dist construit avant la garde par contenu) — Run: npm run build:packages`,
      );
      continue;
    }
    /** @type {string | null} */
    let recorded = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      recorded = typeof parsed?.srcHash === "string" ? parsed.srcHash : null;
    } catch {
      recorded = null;
    }
    if (recorded !== current) {
      errors.push(
        `packages/${name}: hash src (contenu) différent du manifest du dernier build — dist stale. Run: npm run build:packages`,
      );
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** @deprecated mtimes non fiables — alias de compat vers la garde par contenu. */
export const assertMtimeFreshness = assertSrcHashFreshness;

/**
 * @param {string} [kitRoot]
 * @param {{ content?: boolean, mtime?: boolean }} [opts]
 * @returns {AssertResult}
 */
export function assertRuntimeDist(kitRoot = DEFAULT_KIT_ROOT, opts = {}) {
  const wantContent = opts.content !== false;
  const wantMtime = opts.mtime !== false;
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  if (wantContent) {
    const r = assertContentContracts(kitRoot);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }
  if (wantMtime) {
    const r = assertSrcHashFreshness(kitRoot);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Lance l'assert et throw Error si KO (pour factory / sync).
 * @param {string} [kitRoot]
 * @param {{ content?: boolean, mtime?: boolean, label?: string }} [opts]
 */
export function assertRuntimeDistOrThrow(kitRoot = DEFAULT_KIT_ROOT, opts = {}) {
  const r = assertRuntimeDist(kitRoot, opts);
  for (const w of r.warnings) {
    console.warn(`⚠ runtime-dist: ${w}`);
  }
  if (!r.ok) {
    const label = opts.label || "kit runtime dist";
    const msg = [
      `ERROR: ${label} stale / incomplet (anti-wipe vendor & routes manquantes).`,
      ...r.errors.map((e) => `  - ${e}`),
      "  Fix: cd " + kitRoot + " && npm run build:packages",
      "  Gate: node --test scripts/test-phase-runtime-dist-freshness.mjs",
    ].join("\n");
    throw new Error(msg);
  }
}

function main() {
  const kit = path.resolve(process.argv[2] || DEFAULT_KIT_ROOT);
  try {
    assertRuntimeDistOrThrow(kit, { label: "kit runtime dist" });
    console.log("▸ kit runtime dist OK (content contracts + src-hash freshness)");
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
