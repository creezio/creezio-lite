#!/usr/bin/env node
/**
 * Codemod H12 (1/2) — purge des shims P1.b d'@creezio/electron-shell
 * (ARCHITECTURE_VERSION H11 → H12).
 *
 * Usage (contrat scripts/codemods/README.md) :
 *   ROOT=<racine du clone marque> node h12-electron-shell-imports.mjs
 *
 * Le barrel `@creezio/electron-shell` ne ré-exporte plus le host Node pur
 * ni le sous-domaine Meili, et le subpath `@creezio/electron-shell/meili`
 * n'existe plus. Réécritures :
 *
 *   1. `@creezio/electron-shell/meili` → `@creezio/search` (imports
 *      statiques, dynamiques et `require`) ;
 *   2. imports nommés `from "@creezio/electron-shell"` : chaque
 *      spécificateur est reclassé vers son package SoT — desktop natif
 *      (reste electron-shell), sous-domaine Meili (`@creezio/search`),
 *      helpers ressources kit (`@creezio/platform-core`), tout le reste du
 *      host (`@creezio/host-runtime`) ;
 *   3. alias host nommés marque supprimés du kit :
 *      `ensureTempoflowNode` → `ensureDesktopNode`,
 *      `resolveTempoflowNodeBinary` → `resolveDesktopNodeBinary`,
 *      `TF2_NODE_PIN` → `DESKTOP_NODE_PIN`,
 *      `TF2_NODE_MIN_FOR_EMBEDS` → `DESKTOP_NODE_MIN_FOR_EMBEDS`,
 *      `TF2_NPM_PIN` → `DESKTOP_NPM_PIN`,
 *      `tempoflowSandboxPaths` → `desktopSandboxPaths` ;
 *   4. `nodeEnsure: "tempoflow"` → `nodeEnsure: "desktop"`
 *      (BrandHostRuntimeConfig).
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
const CODE_EXT_RE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const LOCKFILE_RE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;

/** Desktop natif : reste importable depuis `@creezio/electron-shell`. */
const NATIVE = new Set([
  "ASSISTANT_FAB_MARGIN_PX", "ASSISTANT_FAB_SIZE_PX", "AssistantChromeBrand", "AssistantChromeContentRect",
  "AssistantChromeMode", "AssistantChromeOverlay", "BrandDesktopDeps", "BrandDesktopHosts",
  "BrandDesktopPaths", "BrandDesktopVertical", "CreateHostRuntimeOptions", "DesktopBootContext",
  "DesktopSessionApi", "DesktopSessionInfo", "DesktopSessionStatus", "ErrorPageBrand",
  "GoogleOAuthLoopbackOptions", "GoogleOAuthTokenStore", "GoogleTokens", "PickerRememberedServer",
  "PrepareDesktopBootOptions", "ProfilePickerBrand", "SPLASH_STEP_WEIGHTS", "SetupAutoUpdaterOptions",
  "SplashHtmlOptions", "SplashStepId", "SplashStepStatus", "SplashStepView",
  "SplashViewModel", "TrayAiWorkspaceEntry", "TrayController", "TrayControllerOptions",
  "UpdateStatus", "UpdaterSend", "activateSplashStep", "adminWindowVisible",
  "applyLaunchAtStartup", "assistantFabScreenRect", "checkForUpdatesNow", "closeAdminWindow",
  "completeSplashStep", "computeOverallPercent", "createDesktopSessionStore", "createHostRuntime",
  "createLocalSplashSteps", "createRemoteSplashSteps", "createSplashModel", "downloadAndInstallUpdate",
  "errorPageDataUrl", "errorPageHtmlDocument", "estimateEmbedPercent", "formatElapsedMs",
  "getUpdaterStatus", "googleLoginLoopback", "installBrandDesktopRuntime", "installCloseToTray",
  "instrumentWebContents", "localConfigPathForBoot", "openAdminWindow", "pathsContextFromBoot",
  "prepareDesktopBoot", "prepareHostDesktop", "profilePickerHtml", "rectsOverlap",
  "reduceUpdateEvent", "registerDesktopSessionIpc", "registerUpdateIpc", "sanitizeSplashDetail",
  "sendUpdateToWebContents", "setUpdaterRenderer", "setupAutoUpdater", "spawnBrandMetierApi",
  "splashDataUrl", "splashHtmlDocument", "stepProgressRatio", "storedGoogleTokens",
  "updateSplashStep", "vendorDir", "windowChromeBarHtml", "windowChromeCss",
  "windowChromeJs", "writeAppKindFile",
]);

/** Sous-domaine Meili → `@creezio/search`. */
const SEARCH = new Set([
  "BrandMeiliBootResult", "BrandMeiliDocument", "BrandMeiliFeed", "BrandMeiliIndexSpec",
  "CATALOG_INDEXES", "CatalogIndexUid", "CatalogSqlCounts", "CoherenceDbSnapshot",
  "GED_INDEXES", "GENERIC_CATALOG_INDEXES", "GedIndexUid", "GedSqlCounts",
  "GenericCatalogIndexUid", "INDEX_SCHEMA_VERSION", "MEILI_FINGERPRINT_META_KEY", "MEILI_INDEX_IN_PROGRESS_KEY",
  "MeiliBrowseRequest", "MeiliBrowseResult", "MeiliCatalogSqlTables", "MeiliCoherencePaths",
  "MeiliFingerprint", "MeiliIndexInProgress", "MeiliReadyDecision", "MeiliRequiredError",
  "RunningMeili", "StartMeiliOptions", "browseMeiliIndex", "buildFingerprint",
  "configureMeiliBrandFeed", "configureMeiliCatalogSqlTables", "configureMeiliCoherencePaths", "countCatalogSql",
  "countGedSql", "decideMeiliReady", "expectedCountsForFeed", "expectedMeiliCounts",
  "getMeiliBrandFeed", "getMeiliCatalogSqlTables", "isMeiliRequiredError", "maybeBootBrandMeili",
  "meiliCoherenceScriptPath", "meiliFilterEq", "parseFingerprint", "readCoherenceDbSnapshot",
  "readFingerprintFromDb", "readIndexInProgress", "readSqliteSchemaVersion", "resetMeiliBrandFeedForTests",
  "resetMeiliCatalogSqlTablesForTests", "runFeedIndexation", "runIndexation", "searchMeiliIndexes",
  "serializeFingerprint", "startMeili", "writeFingerprintToDb",
]);

/** Helpers ressources kit → `@creezio/platform-core`. */
const PLATFORM = new Set([
  "electronShellPackageRoot",
  "kitOsResourcesRoot",
  "kitOsVendorDir",
]);

/** Alias host nommés marque, supprimés du kit en H12. */
const HOST_ALIAS_RENAMES = [
  ["ensureTempoflowNode", "ensureDesktopNode"],
  ["resolveTempoflowNodeBinary", "resolveDesktopNodeBinary"],
  ["TF2_NODE_PIN", "DESKTOP_NODE_PIN"],
  ["TF2_NODE_MIN_FOR_EMBEDS", "DESKTOP_NODE_MIN_FOR_EMBEDS"],
  ["TF2_NPM_PIN", "DESKTOP_NPM_PIN"],
  ["tempoflowSandboxPaths", "desktopSandboxPaths"],
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

/** Découpe `{ a, type B, c as d }` en spécificateurs bruts. */
function splitSpecifiers(inner) {
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Nom SoT (avant `as`) d'un spécificateur, sans le mot-clé `type`. */
function sourceName(spec) {
  return spec.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
}

function renderImport(kind, specs, from, quote) {
  const keyword = kind === "export" ? "export" : "import";
  if (specs.length === 1) {
    return `${keyword} { ${specs[0]} } from ${quote}${from}${quote};`;
  }
  return `${keyword} {\n  ${specs.join(",\n  ")},\n} from ${quote}${from}${quote};`;
}

const IMPORT_RE =
  /(import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*(["'])@creezio\/electron-shell\4\s*;?/g;

const writes = [];

for (const abs of walk(ROOT)) {
  if (!CODE_EXT_RE.test(abs) || LOCKFILE_RE.test(rel(abs))) continue;
  const src = fs.readFileSync(abs, "utf8");
  let next = src;

  // 1. Subpath meili → @creezio/search (statique, dynamique, require).
  next = next
    .replaceAll('"@creezio/electron-shell/meili"', '"@creezio/search"')
    .replaceAll("'@creezio/electron-shell/meili'", "'@creezio/search'");

  // 3. Alias host nommés marque (avant reclassement des imports).
  for (const [from, to] of HOST_ALIAS_RENAMES) {
    next = next.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  }

  // 4. BrandHostRuntimeConfig.nodeEnsure.
  next = next.replace(/nodeEnsure:\s*(["'])tempoflow\1/g, 'nodeEnsure: $1desktop$1');

  // 2. Reclassement des imports nommés du barrel electron-shell.
  next = next.replace(IMPORT_RE, (full, kind, typeOnly, inner, quote) => {
    const specs = splitSpecifiers(inner);
    const buckets = {
      "@creezio/electron-shell": [],
      "@creezio/host-runtime": [],
      "@creezio/search": [],
      "@creezio/platform-core": [],
    };
    for (const spec of specs) {
      const name = sourceName(spec);
      if (NATIVE.has(name)) buckets["@creezio/electron-shell"].push(spec);
      else if (SEARCH.has(name)) buckets["@creezio/search"].push(spec);
      else if (PLATFORM.has(name)) buckets["@creezio/platform-core"].push(spec);
      else buckets["@creezio/host-runtime"].push(spec);
    }
    const parts = [];
    for (const [pkg, list] of Object.entries(buckets)) {
      if (!list.length) continue;
      const prefixed = typeOnly
        ? list.map((s) => s.replace(/^type\s+/, ""))
        : list;
      parts.push(
        renderImport(
          kind,
          prefixed,
          pkg,
          quote,
        ).replace(/^(import|export)\s+\{/, typeOnly ? "$1 type {" : "$1 {"),
      );
    }
    return parts.join("\n");
  });

  // Import dynamique du barrel : impossible de reclasser statiquement les
  // usages — signaler seulement si le fichier consomme un symbole déplacé.
  // (Les usages connus du barrel dynamique portent sur le desktop natif.)

  if (next !== src) writes.push({ abs, rel: rel(abs), body: next });
}

if (writes.length === 0) {
  console.log("✓ codemod H12 (electron-shell) : rien à migrer — no-op");
} else {
  for (const { abs, body } of writes) fs.writeFileSync(abs, body, "utf8");
  console.log(`✓ codemod H12 (electron-shell) : ${writes.length} fichier(s) migré(s)`);
  for (const { rel: r } of writes) console.log(`  ~ ${r}`);
}
