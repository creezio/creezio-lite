/**
 * Générateur de config electron-builder Client / Serveur à partir d'un AppManifest.
 *
 * Port brand-agnostic de `crm/scripts/electron/build-builder-config.mjs`.
 * L'appelant fournit la config de base (YAML/JSON parsé) et reçoit les overrides.
 *
 * Usage typique dans une app marque :
 * ```ts
 * import { buildElectronBuilderConfig, demobrandManifest } from "@creezio/brand-config";
 * const cfg = buildElectronBuilderConfig(demobrandManifest, "server", baseYaml);
 * ```
 */

import fs from "node:fs";
import path from "node:path";
import type { AppKind, AppManifest, ExeIdentity } from "./types.js";
import { exeForKind } from "./types.js";

/**
 * Plancher @creezio/* toujours emballé (boot main Electron).
 * La liste effective = plancher ∪ deps `@creezio/*` du package.json marque
 * ∪ clôture transitive npm — voir `collectCreezioRuntimePackages()`.
 *
 * Les apps marques consomment `@creezio/*` en packages npm (GitHub
 * Packages). electron-builder exclut `node_modules/**` → FileSet par
 * package résolu (walk-up : `node_modules/…` ou `../node_modules/…` en
 * workspaces) vers `node_modules/@creezio/<pkg>` dans l'asar.
 *
 * Ne plus maintenir une allowlist partielle seule : tout oubli = MODULE_NOT_FOUND
 * packagé. Les deps npm « vraies » (hono, zod…) → `CREEZIO_ASAR_NPM_RUNTIME_PACKAGES`.
 */
export const CREEZIO_ASAR_RUNTIME_PACKAGES = [
  "brand-config",
  "platform-core",
  "product-hub",
  "shell",
  "electron-shell",
  // H3 — brand-runtime (api-kernel / mcp / shell-ui / auth) dans le main
  "api-kernel",
  "mcp-facade",
  "shell-ui",
  "auth",
  // PnP / from-prd — orchestration + surfaces OS dans le main
  "app-runtime",
  "assistant",
  "tasks",
  "mails",
  "observability",
  "database",
  "onboarding",
  "nav",
  "cockpit",
  "os-ui",
  "brand-spec",
] as const;

/**
 * Packages @creezio/* tooling-only — jamais nécessaires au runtime packagé
 * (scripts publish / factory / propagation). Exclus même s’ils figurent
 * dans dependencies du package.json marque.
 */
export const CREEZIO_ASAR_TOOLING_ONLY = [
  "desktop-tooling",
  "factory",
  "propagation",
] as const;

/**
 * Seeds npm runtime du main Electron (hors @creezio/*).
 *
 * Piège packagé : files exclut tout node_modules ; sans FileSet dédié,
 * hono / better-sqlite3 / zod restent hors asar → ERR_MODULE_NOT_FOUND
 * au boot.
 *
 * `collectNpmRuntimePackages()` étend ces seeds à la clôture transitive
 * (package.json deps) en ignorant les outils d'install (prebuild-install…).
 * Emballage via FileSet objet (fiable vs globs réordonnés par e-builder).
 */
export const CREEZIO_ASAR_NPM_RUNTIME_PACKAGES = [
  // HTTP / validation (api-kernel, app-runtime, auth, mcp, …)
  "hono",
  "@hono/zod-openapi",
  "@hono/zod-validator",
  "@asteasolutions/zod-to-openapi",
  "openapi3-ts",
  "zod",
  "jose",
  // Assistant chat-db (natif — asarUnpack *.node)
  "better-sqlite3",
  "bindings",
  "file-uri-to-path",
  // Divers kit
  "yaml",
  "clsx",
  "tailwind-merge",
] as const;

/** Deps d'install only — jamais nécessaires au runtime packagé. */
export const CREEZIO_ASAR_NPM_INSTALL_ONLY = [
  "prebuild-install",
  "node-abi",
  "napi-build-utils",
  "simple-get",
  "simple-concat",
  "expand-template",
  "github-from-package",
  "rc",
  "deep-extend",
  "ini",
  "minimist",
  "strip-json-comments",
  "tar-fs",
  "tar-stream",
  "tunnel-agent",
  "mkdirp-classic",
  "pump",
  "end-of-stream",
  "once",
  "wrappy",
  "bl",
  "buffer",
  "base64-js",
  "ieee754",
  "readable-stream",
  "string_decoder",
  "util-deprecate",
  "safe-buffer",
  "inherits",
  "fs-constants",
  "chownr",
  "detect-libc",
  "mimic-response",
  "decompress-response",
] as const;

/** Patterns asarUnpack pour binaires natifs (better-sqlite3 .node). */
export const CREEZIO_ASAR_UNPACK_NATIVE = [
  "**/*.node",
  "**/better-sqlite3/build/**",
] as const;

/** Liste des modules main Electron réservés à l'hôte (exclus du paquet Client). */
export const DEFAULT_HOST_ONLY_ELECTRON_MODULES = [
  "server-launcher",
  "meili-launcher",
  "meili-coherence",
  "meili-index-schema",
  "catalog-sync",
  "hermes-launcher",
  "hermes-runtime-bootstrap",
  "hermes-skills-seed",
  "hermes-crm-key",
  "hermes-context-seed",
  "n8n-launcher",
  "n8n-runtime-bootstrap",
  "disk-space",
  "node-runtime",
  "npm-cli",
  "plugin-launcher",
  "plugin-control-api",
  "plugin-runtime",
  "plugin-test-runner",
  "plugin-accept-check",
  "plugin-crm-key",
  "plugin-git",
  "plugin-events",
  "plugin-control-token",
  "plugin-execution-grant",
  "tunnel",
  "factory-reset",
] as const;

/**
 * Binaires Windows serveur via `win.extraResources` (filtre) — jamais dans l'asar.
 * Uniquement `meilisearch-win.exe` + `cloudflared.exe` (pas d'alias meili.exe).
 */
export const WIN_SERVER_BIN_FILTER = [
  "cloudflared.exe",
  "meilisearch-win.exe",
] as const;

/** Exclusion asar : bins kit ne doivent jamais être emballés dans app.asar. */
export const ASAR_EXCLUDE_KIT_BINS = "!**/host-runtime/resources/bin/**";

/**
 * Stage relatif marque pour bins Win (cross-compile Linux → Windows).
 * Surcharge : env `CREEZIO_WIN_BIN_STAGE`.
 */
export const DEFAULT_WIN_BIN_STAGE = ".creezio/win-bin-stage";

export type BuildBuilderConfigOptions = {
  /** Modules host-only à exclure du paquet Client (défaut = liste kit). */
  hostOnlyModules?: readonly string[];
  /**
   * Si `false`, n'applique pas `applyClientSlim` (apps sans host-stack lazy,
   * Client et Serveur embarquent encore la stack locale).
   * Défaut `true` (client slim).
   */
  clientSlim?: boolean;
  /** Chemin include NSIS (défaut `installer.nsh`). `false` = ne pas forcer. */
  nsisInclude?: string | false;
  /** Prefixe relatif des icônes (`resources/icons/{kind}.png`). */
  iconDir?: string;
  /**
   * Embarque `@creezio/*` runtime (packages npm résolus walk-up) dans l'asar.
   * - `true` : toujours
   * - `false` : jamais (demobrand / workspace sans deps installées)
   * - `undefined` (défaut) : auto si `files` contient une exclusion `!node_modules`
   */
  packCreezioVendor?: boolean;
  /**
   * Stage bins Windows serveur (`win.extraResources` → `bin/`).
   * Défaut : `CREEZIO_WIN_BIN_STAGE` ou `.creezio/win-bin-stage`.
   */
  winBinStage?: string;
  /**
   * Racine app marque (pour clôture transitive node_modules).
   * Défaut : `CREEZIO_APP_ROOT` ou `process.cwd()`.
   */
  appRoot?: string;
};

type JsonRecord = Record<string, unknown>;

function asRecord(v: unknown): JsonRecord {
  return v && typeof v === "object" && !Array.isArray(v)
    ? ({ ...(v as JsonRecord) } as JsonRecord)
    : {};
}

function iconFor(kind: AppKind, iconDir: string): string {
  return `${iconDir.replace(/\/+$/, "")}/${kind}.png`;
}

function applyExeIdentity(
  base: JsonRecord,
  exe: ExeIdentity,
  kind: AppKind,
  opts: {
    nsisInclude: string | false;
    iconDir: string;
  },
): void {
  base.appId = exe.appId;
  base.productName = exe.productName;
  base.executableName = exe.executableName;
  base.artifactName = exe.artifactName;
  base.directories = {
    ...asRecord(base.directories),
    output: kind === "server" ? "dist-electron-server" : "dist-electron",
  };
  base.extraMetadata = {
    ...asRecord(base.extraMetadata),
    name: exe.packageName,
    productName: exe.productName,
  };
  const nsis: JsonRecord = {
    ...asRecord(base.nsis),
    shortcutName: exe.productName,
    uninstallDisplayName: exe.productName,
    guid: exe.nsisGuid,
    // Include custom : LangString manquants (ex. Vietnamese) ne doivent pas
    // faire échouer makensis (warningsAsErrors electron-builder).
    warningsAsErrors: false,
  };
  if (opts.nsisInclude !== false) {
    nsis.include = opts.nsisInclude;
  }
  base.nsis = nsis;
  base.publish = {
    provider: "generic",
    url: exe.feedUrl,
    useMultipleRangeRequest: false,
  };
  base.win = {
    ...asRecord(base.win),
    icon: iconFor(kind, opts.iconDir),
  };
  // Linux AppImage/dir : electron-builder CollectIcons exige un dossier
  // `NxN.png` (ou icon.png) — `resources/icons/{kind}.png` seul échoue.
  base.linux = {
    category: "Office",
    icon: opts.iconDir.replace(/\/+$/, ""),
    ...asRecord(base.linux),
  };
  if (!base.icon) {
    base.icon = `${opts.iconDir.replace(/\/+$/, "")}/512x512.png`;
  }
}

const CREEZIO_ASAR_WITH_UI = new Set([
  "shell-ui",
  "os-ui",
  "product-hub",
  "auth",
  "onboarding",
  "nav",
  "cockpit",
  "assistant",
  "tasks",
  "mails",
  "mcp-facade",
  "database",
  "observability",
]);

function resolveAppRoot(appRoot?: string): string {
  return path.resolve(
    appRoot || process.env.CREEZIO_APP_ROOT || process.cwd(),
  );
}

function readJsonDeps(pkgJsonPath: string): string[] {
  if (!fs.existsSync(pkgJsonPath)) return [];
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    return Object.keys(pkg.dependencies || {});
  } catch {
    return [];
  }
}

/**
 * Résout le dossier d'un package installé par walk-up node_modules depuis
 * `root` (workspaces npm : hoisting au node_modules racine → `../…`).
 * @returns chemin relatif POSIX depuis root (ex. `node_modules/hono` ou
 *          `../node_modules/@creezio/hono`), null si absent.
 */
function resolveInstalledRel(root: string, name: string): string | null {
  const parts = name.split("/");
  let dir = root;
  for (;;) {
    const cand = path.join(dir, "node_modules", ...parts);
    if (fs.existsSync(path.join(cand, "package.json"))) {
      const rel = path.relative(root, cand);
      return rel.split(path.sep).join("/") || "node_modules/" + name;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** package.json d'un package installé (walk-up), null si absent. */
function resolveInstalledPkgJson(root: string, name: string): string | null {
  const rel = resolveInstalledRel(root, name);
  return rel ? path.join(root, rel, "package.json") : null;
}

/**
 * Clôture @creezio/* runtime pour l'asar :
 * plancher `CREEZIO_ASAR_RUNTIME_PACKAGES`
 * ∪ `@creezio/*` du package.json marque (hors tooling)
 * ∪ deps `@creezio/*` transitives des package.json installés (node_modules,
 * walk-up workspaces). Ne retourne que les packages réellement résolus.
 */
export function collectCreezioRuntimePackages(appRoot?: string): string[] {
  const root = resolveAppRoot(appRoot);
  const tooling = new Set<string>(CREEZIO_ASAR_TOOLING_ONLY);
  const seeds = new Set<string>(CREEZIO_ASAR_RUNTIME_PACKAGES);

  for (const dep of readJsonDeps(path.join(root, "package.json"))) {
    if (!dep.startsWith("@creezio/")) continue;
    const short = dep.slice("@creezio/".length);
    if (!tooling.has(short)) seeds.add(short);
  }

  const seen = new Set<string>();
  const queue = [...seeds];
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name) || tooling.has(name)) continue;
    const pkgJson = resolveInstalledPkgJson(root, `@creezio/${name}`);
    if (!pkgJson) continue;
    seen.add(name);
    for (const dep of readJsonDeps(pkgJson)) {
      if (!dep.startsWith("@creezio/")) continue;
      const short = dep.slice("@creezio/".length);
      if (!seen.has(short) && !tooling.has(short)) queue.push(short);
    }
  }

  // Si rien d'installé (sandbox kit), retomber sur le plancher.
  if (!seen.size) return [...CREEZIO_ASAR_RUNTIME_PACKAGES];
  return [...seen].sort();
}

function creezioAsarFileSets(appRoot?: string): JsonRecord[] {
  const root = resolveAppRoot(appRoot);
  const names = collectCreezioRuntimePackages(appRoot);
  return names.map((name) => {
    const filter = [
      "package.json",
      "dist/**/*",
      "dist-cjs/**/*",
      "!resources/bin/**",
      ...(CREEZIO_ASAR_WITH_UI.has(name) ? ["ui/**/*"] : []),
    ];
    return {
      from:
        resolveInstalledRel(root, `@creezio/${name}`) ??
        `node_modules/@creezio/${name}`,
      to: `node_modules/@creezio/${name}`,
      filter,
    };
  });
}

/**
 * Clôture transitive des seeds npm runtime (node_modules, walk-up workspaces).
 * Ignore les outils d'install (prebuild-install…) et les packages absents.
 */
export function collectNpmRuntimePackages(appRoot?: string): string[] {
  const root = resolveAppRoot(appRoot);
  const installOnly = new Set<string>(CREEZIO_ASAR_NPM_INSTALL_ONLY);
  const seen = new Set<string>();
  const queue: string[] = [...CREEZIO_ASAR_NPM_RUNTIME_PACKAGES];

  // Seeds supplémentaires depuis dependencies npm « vraies » de la marque
  // (hors @creezio/* et tooling electron-builder).
  const brandSkip = new Set([
    ...CREEZIO_ASAR_NPM_INSTALL_ONLY,
    "electron",
    "electron-builder",
    "electron-updater",
    "typescript",
    "@types/node",
  ]);
  for (const dep of readJsonDeps(path.join(root, "package.json"))) {
    if (dep.startsWith("@creezio/")) continue;
    if (!brandSkip.has(dep)) queue.push(dep);
  }

  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name) || installOnly.has(name)) continue;
    const pkgJson = resolveInstalledPkgJson(root, name);
    if (!pkgJson) continue;
    seen.add(name);
    for (const dep of readJsonDeps(pkgJson)) {
      if (!seen.has(dep) && !installOnly.has(dep) && !dep.startsWith("@creezio/")) {
        queue.push(dep);
      }
    }
  }
  return [...seen].sort();
}

/**
 * Filesets `{from,to}` pour deps npm runtime (+ clôture transitive).
 * FileSet objet — les globs sont réordonnés avant `!node_modules` par
 * electron-builder et restent exclus. `from` résolu walk-up (workspaces).
 */
function npmRuntimeAsarFileSets(appRoot?: string): JsonRecord[] {
  const root = resolveAppRoot(appRoot);
  const names = collectNpmRuntimePackages(appRoot);
  const list = names.length ? names : [...CREEZIO_ASAR_NPM_RUNTIME_PACKAGES];
  return list.map((name) => ({
    from: resolveInstalledRel(root, name) ?? `node_modules/${name}`,
    to: `node_modules/${name}`,
    filter: [
      "**/*",
      "!**/*.md",
      "!**/LICENSE*",
      "!**/license*",
      "!**/prebuilds/**",
      "!**/docs/**",
    ],
  }));
}

/** Garantit asarUnpack des binaires natifs (.node / better-sqlite3). */
function ensureAsarUnpackNative(base: JsonRecord): void {
  const prev = Array.isArray(base.asarUnpack)
    ? (base.asarUnpack as unknown[])
    : [];
  const next = [...prev];
  for (const pat of CREEZIO_ASAR_UNPACK_NATIVE) {
    if (!next.includes(pat)) next.push(pat);
  }
  base.asarUnpack = next;
}

function filesExcludeNodeModules(files: unknown[]): boolean {
  return files.some(
    (entry) => typeof entry === "string" && entry.includes("!node_modules"),
  );
}

/** FileSet déjà présent pour une cible asar (`to`), quel que soit le from. */
function hasFilesetTo(files: unknown[], to: string): boolean {
  return files.some(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      String((entry as { to?: string }).to || "") === to,
  );
}

/** Retire les anciens globs `node_modules/<pkg>/**` (inefficaces vs !node_modules). */
function stripLegacyNpmRuntimeGlobs(files: unknown[]): unknown[] {
  return files.filter((entry) => {
    if (typeof entry !== "string") return true;
    const norm = entry.replace(/^(?:\.\.\/)+/, "");
    if (!norm.startsWith("node_modules/") || !norm.endsWith("/**/*")) {
      return true;
    }
    // Conserver les includes electron-updater (base kit) — retirer seulement
    // les globs seeds runtime qu'on remplace par des FileSets.
    const pkg = norm.slice("node_modules/".length, -"/**/*".length);
    return !(CREEZIO_ASAR_NPM_RUNTIME_PACKAGES as readonly string[]).includes(
      pkg,
    );
  });
}

/**
 * Ré-inclut les packages runtime @creezio/* + deps npm (clôture) dans l'asar
 * quand la config exclut `node_modules/**` (pattern historique des apps).
 * Idempotent : n'ajoute que les filesets manquants (dedup sur la cible asar).
 */
function ensureCreezioVendorInAsar(
  base: JsonRecord,
  pack: boolean | undefined,
  appRoot?: string,
): void {
  let files = Array.isArray(base.files) ? [...(base.files as unknown[])] : [];
  const shouldPack =
    pack === true ||
    (pack !== false && filesExcludeNodeModules(files));
  if (!shouldPack) {
    base.files = files;
    return;
  }
  files = stripLegacyNpmRuntimeGlobs(files);
  const next = [...files];
  for (const set of creezioAsarFileSets(appRoot)) {
    if (!hasFilesetTo(next, String(set.to))) next.push(set);
  }
  for (const set of npmRuntimeAsarFileSets(appRoot)) {
    if (!hasFilesetTo(next, String(set.to))) next.push(set);
  }
  base.files = next;
}

/** Garantit l'exclusion asar des bins kit (Linux+Win fat). */
function ensureAsarExcludesKitBins(base: JsonRecord): void {
  const files = Array.isArray(base.files) ? [...(base.files as unknown[])] : [];
  const has = files.some(
    (entry) =>
      typeof entry === "string" &&
      entry.includes("electron-shell/resources/bin"),
  );
  if (!has) {
    files.push(ASAR_EXCLUDE_KIT_BINS);
  }
  base.files = files;
}

function entryFrom(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    return String((entry as { from?: string }).from || "");
  }
  return "";
}

function entryTo(entry: unknown): string {
  if (entry && typeof entry === "object") {
    return String((entry as { to?: string }).to || "");
  }
  return "";
}

/** Détecte un mapping extraResources vers `bin/` (kit ou stage). */
export function isKitBinExtraResource(entry: unknown): boolean {
  const from = entryFrom(entry);
  const to = entryTo(entry);
  if (to === "bin" || to.endsWith("/bin")) return true;
  return (
    from.includes("host-runtime/resources/bin") ||
    from.includes("electron-shell/resources/bin") ||
    from.includes("/resources/bin") ||
    from.includes("win-bin-stage") ||
    from.endsWith("/bin")
  );
}

function stripKitBinExtraResources(list: unknown[]): unknown[] {
  return list.filter((entry) => !isKitBinExtraResource(entry));
}

function hasKitOsVendor(extra: unknown[]): boolean {
  return extra.some((entry) => {
    const f = entryFrom(entry);
    return (
      f.includes("host-runtime/resources/vendor") ||
      f.includes("electron-shell/resources/vendor") ||
      f.endsWith("/resources/vendor")
    );
  });
}

function resolveWinBinStage(options: BuildBuilderConfigOptions): string {
  return (
    options.winBinStage ||
    process.env.CREEZIO_WIN_BIN_STAGE ||
    DEFAULT_WIN_BIN_STAGE
  );
}

/**
 * Normalise le glob build/electron en fileset objet {from,to,filter}.
 * Les négations plates (!node_modules) cassent sinon la collecte asar
 * (main.js absent) — piège electron-builder.
 */
function normalizeBuildElectronFileset(
  base: JsonRecord,
  filterExtra: readonly string[] = [],
): void {
  const filter = ["**/*", ...filterExtra];
  base.files = (Array.isArray(base.files) ? base.files : []).map((entry) => {
    if (entry === "build/electron/**/*") {
      return { from: "build/electron", to: "build/electron", filter: [...filter] };
    }
    if (entry && typeof entry === "object") {
      const rec = entry as { from?: string; to?: string; filter?: unknown };
      if (rec.from === "build/electron" && (!rec.to || rec.to === "build/electron")) {
        const prev = Array.isArray(rec.filter) ? (rec.filter as string[]) : ["**/*"];
        const merged = [...new Set([...prev, ...filterExtra])];
        return { ...rec, to: "build/electron", filter: merged };
      }
    }
    return entry;
  });
}

/**
 * Applique les overrides Client (filtre modules host-only du main).
 */
function applyClientSlim(
  base: JsonRecord,
  hostOnly: readonly string[],
): void {
  const filterNegations = hostOnly.flatMap((m) => [`!${m}.js`, `!${m}.js.map`]);

  base.extraResources = (Array.isArray(base.extraResources)
    ? base.extraResources
    : []
  ).filter((entry) => {
    const from =
      typeof entry === "object" && entry !== null
        ? String((entry as { from?: string }).from || "")
        : String(entry);
    return !from.startsWith("vendor/");
  });

  base.win = {
    ...asRecord(base.win),
    extraResources: [],
  };

  normalizeBuildElectronFileset(base, filterNegations);

  base.extraResources = (
    Array.isArray(base.extraResources) ? base.extraResources : []
  ).map((entry) => {
    const from =
      typeof entry === "object" && entry !== null
        ? String((entry as { from?: string }).from || "")
        : "";
    if (from !== "build/electron") return entry;
    return {
      ...(entry as JsonRecord),
      filter: ["**/*", ...filterNegations],
    };
  });
}

/**
 * Clone profond minimal (JSON) de la config de base puis applique kind.
 */
export function buildElectronBuilderConfig(
  manifest: AppManifest,
  kind: AppKind,
  baseConfig: unknown,
  options: BuildBuilderConfigOptions = {},
): JsonRecord {
  const base = JSON.parse(JSON.stringify(baseConfig ?? {})) as JsonRecord;
  const exe = exeForKind(manifest, kind);
  const nsisInclude =
    options.nsisInclude === false ? false : (options.nsisInclude ?? "installer.nsh");
  const iconDir = options.iconDir ?? "resources/icons";
  const hostOnly = options.hostOnlyModules ?? DEFAULT_HOST_ONLY_ELECTRON_MODULES;
  const clientSlim = options.clientSlim !== false;

  applyExeIdentity(base, exe, kind, { nsisInclude, iconDir });

  if (kind === "client" && clientSlim) {
    applyClientSlim(base, hostOnly);
  } else {
    // Serveur / client fat : fileset objet obligatoire si !node_modules/**.
    normalizeBuildElectronFileset(base);
  }

  ensureCreezioVendorInAsar(
    base,
    options.packCreezioVendor,
    options.appRoot || process.env.CREEZIO_APP_ROOT,
  );
  ensureAsarUnpackNative(base);
  ensureAsarExcludesKitBins(base);

  // better-sqlite3 / natifs via prebuild win (ensure-win-native),
  // jamais rebuild ABI Electron hôte Linux pendant cross-pack.
  if (base.npmRebuild === undefined) {
    base.npmRebuild = false;
  }

  // afterPack : embarque Next standalone dans resources/server (serveur).
  if (!base.afterPack) {
    // Package npm @creezio/desktop-tooling résolu walk-up (workspaces).
    const appRoot = options.appRoot || process.env.CREEZIO_APP_ROOT || "";
    const fallback = "node_modules/@creezio/desktop-tooling/scripts/after-pack.cjs";
    let resolved: string | null = null;
    if (appRoot) {
      const pkgRel = resolveInstalledRel(appRoot, "@creezio/desktop-tooling");
      if (pkgRel) {
        const cand = `${pkgRel}/scripts/after-pack.cjs`;
        if (fs.existsSync(path.join(appRoot, cand))) resolved = cand;
      }
    } else if (fs.existsSync(fallback)) {
      resolved = fallback;
    }
    base.afterPack = resolved || fallback;
  }

  // Client slim : PAS de bins. Serveur / client fat : bins Win only.
  const includeBin = kind === "server" || (kind === "client" && !clientSlim);
  ensureKitOsVendorExtraResources(base, {
    includeBin,
    winBinStage: resolveWinBinStage(options),
    appRoot: options.appRoot || process.env.CREEZIO_APP_ROOT,
  });

  if (manifest.copyright) {
    base.copyright = manifest.copyright;
  }

  return base;
}

/**
 * Vendor OS natif (Hermes/n8n manifests + install scripts) depuis le package
 * npm `@creezio/host-runtime/resources/vendor` — jamais depuis la marque.
 * Résolu walk-up (workspaces : `../node_modules/…` depuis le livrable).
 *
 * Bins : **jamais** le dossier kit `host-runtime/resources/bin` en bloc
 * (Linux+Win → double packing asar + extraResources ≈ +450 Mo). Client slim
 * = zéro bin. Serveur = `win.extraResources` filtré depuis un stage Win.
 */
function ensureKitOsVendorExtraResources(
  base: JsonRecord,
  opts: { includeBin: boolean; winBinStage: string; appRoot?: string },
): void {
  const hostRel = opts.appRoot
    ? resolveInstalledRel(opts.appRoot, "@creezio/host-runtime")
    : null;
  const hostFrom = hostRel ?? "node_modules/@creezio/host-runtime";
  const vendorFrom = `${hostFrom}/resources/vendor`;
  const scriptsFrom = `${hostFrom}/resources/scripts`;
  let extra = Array.isArray(base.extraResources)
    ? ([...base.extraResources] as unknown[])
    : [];

  // Retirer tout mapping bin top-level (y compris legacy kit unfiltered).
  extra = stripKitBinExtraResources(extra);

  if (!hasKitOsVendor(extra)) {
    extra.push({ from: vendorFrom, to: "vendor" });
  }
  // Scripts Node génériques exécutés hors app.asar (cohérence SQLite/Meili).
  // Ils doivent être présents avant le premier boot serveur, sans dépendre
  // d'un build/electron spécifique à chaque marque.
  if (
    !extra.some(
      (entry) =>
        entryFrom(entry).includes("host-runtime/resources/scripts") ||
        entryFrom(entry).includes("electron-shell/resources/scripts") ||
        entryTo(entry) === "scripts",
    )
  ) {
    extra.push({ from: scriptsFrom, to: "scripts" });
  }
  base.extraResources = extra;

  const win = asRecord(base.win);
  let winExtra = Array.isArray(win.extraResources)
    ? ([...win.extraResources] as unknown[])
    : [];
  winExtra = stripKitBinExtraResources(winExtra);

  if (opts.includeBin) {
    const already = winExtra.some((entry) => isKitBinExtraResource(entry));
    if (!already) {
      winExtra.push({
        from: opts.winBinStage,
        to: "bin",
        filter: [...WIN_SERVER_BIN_FILTER],
      });
    }
  }

  win.extraResources = winExtra;
  base.win = win;
}
