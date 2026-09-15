import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBrandSpec, resolveBrandSpecDir } from "./load.js";
import { doctorBrandModuleMeiliTables } from "./meili-table-coherence.js";
import type { BrandSpecIssue, DoctorResult } from "./types.js";

const BRAND_ID_RE = /^[a-z][a-z0-9]{1,31}$/;

/** Fichiers / stubs d'assemblage — pas des `BrandModuleDef`. */
const MODULE_HELPER_FILES = new Set([
  "index.ts",
  "types.ts",
  "shared.ts",
  "mcp-shared.ts",
  "meili-shared.ts",
]);

/**
 * Seuils de contrat DATÉS (P3.a, F4.4c) — plus de « warn éternel ».
 *
 * Chaque contrat garde sa version d'introduction (`*_CONTRACT_SINCE`) :
 *   - pin marque ≥ seuil          → error (fail-closed, comme avant) ;
 *   - pin < seuil, retard ≤ N-2   → warn (fenêtre de grâce lockstep) ;
 *   - pin < seuil, retard >  N-2  → **error** (marque hors fenêtre de
 *     support — politique N-2 : une marque à plus de 2 versions lockstep
 *     (minor) du kit courant doit monter via `creezio upgrade`).
 *
 * Le « kit courant » = la version de CE package @creezio/brand-spec
 * (lockstep) — le doctor embarqué par une marque juge donc avec la version
 * qu'elle installe, et le doctor du kit avec la tête du kit.
 */
const CONTRACT_STALE_LOCKSTEP_WINDOW = 2;

/** Démo fail-closed depuis 0.10.1 (pins plus vieux : politique datée N-2). */
const DEMO_CONTRACT_SINCE = { major: 0, minor: 10, patch: 1 };

/** Ops fail-closed depuis 0.10.6 (pins plus vieux : politique datée N-2). */
const OPS_CONTRACT_SINCE = { major: 0, minor: 10, patch: 6 };

/**
 * Schéma data + index Meili par module fail-closed depuis 0.10.13
 * (décision « Meili = composant core ») — pins plus vieux : politique N-2.
 */
const MEILI_CONTRACT_SINCE = { major: 0, minor: 10, patch: 13 };

/**
 * Contrat de module importé du kit (P2.c / H9, 0.16.0) : `modules/types.ts`
 * = ré-export de `@creezio/app-runtime` (plus de copie locale) + chaque
 * apiMount manuscrit déclare `permission` ou `accessJustification`.
 * Pins plus vieux : politique datée N-2.
 */
const MODULE_CONTRACT_SINCE = { major: 0, minor: 16, patch: 0 };

const CRUD_OP_IDS = new Set([
  "list",
  "get",
  "create",
  "update",
  "delete",
  "archive",
]);

const MIN_INLINE_DEMO_STEPS = 3;

/** Module `notes` leftover factory — hors cette allowlist = error. */
const NOTES_LEFTOVER_ALLOWLIST = new Set<string>([
  /* vide : aucune marque neuve n'a le droit au leftover notes */
]);

const STUB_FILL_RE = /\(à remplir\)/i;

function resolveAppModulesDir(specRoot: string): string | null {
  const appRoot = path.dirname(specRoot);
  for (const rel of ["server/src/electron/modules", "src/electron/modules"]) {
    const dir = path.join(appRoot, rel);
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

function isModuleHelperName(name: string): boolean {
  if (MODULE_HELPER_FILES.has(name)) return true;
  if (name === "_lib.ts" || name.startsWith("_lib.") || name.startsWith("_")) {
    return true;
  }
  return false;
}

function stripNpmRange(spec: string): string | null {
  const m = spec.trim().match(/^[\^~>=<\s]*(\d+\.\d+\.\d+)/);
  return m?.[1] ?? null;
}

function compareSemver(
  version: string,
  ref: { major: number; minor: number; patch: number },
): number {
  const parts = version.split(".").map((x) => Number(x));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  if (major !== ref.major) return major - ref.major;
  if (minor !== ref.minor) return minor - ref.minor;
  return patch - ref.patch;
}

/** Pin lockstep de l'app (`server/package.json` puis racine). */
function readAppLockstepPin(specRoot: string): string | null {
  const appRoot = path.dirname(specRoot);
  for (const rel of ["server/package.json", "package.json"]) {
    const pkgPath = path.join(appRoot, rel);
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const name of [
        "@creezio/platform-core",
        "@creezio/app-runtime",
        "@creezio/brand-spec",
      ]) {
        const spec = deps[name];
        if (typeof spec === "string") {
          const v = stripNpmRange(spec);
          if (v) return v;
        }
      }
    } catch {
      /* package.json illisible → pin inconnu */
    }
  }
  return null;
}

/** Version lockstep du kit « courant » = celle de CE package (SoT unique). */
function kitLockstepVersion(): { major: number; minor: number } | null {
  try {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      version?: string;
    };
    const m = /^(\d+)\.(\d+)\.\d+/.exec(pkg.version || "");
    return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
  } catch {
    return null;
  }
}

/**
 * true si le pin marque est HORS fenêtre de support N-2 (plus de
 * CONTRACT_STALE_LOCKSTEP_WINDOW versions lockstep minor de retard sur le
 * kit courant, ou major plus ancien). Kit indéterminable → false (pas
 * d'escalade aveugle).
 */
function pinBeyondSupportWindow(pin: string): boolean {
  const kit = kitLockstepVersion();
  if (!kit) return false;
  const parts = pin.split(".").map((x) => Number(x));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  if (major !== kit.major) return major < kit.major;
  return kit.minor - minor > CONTRACT_STALE_LOCKSTEP_WINDOW;
}

type ContractPolicy = {
  level: "warn" | "error";
  /** true = pin pré-contrat (messages « warn » historiques). */
  preContract: boolean;
  /** true = warn daté ESCALADÉ en error (pin hors fenêtre N-2). */
  stale: boolean;
};

/**
 * Politique de niveau d'un contrat daté (P3.a / F4.4c) — voir le bloc de
 * doc des `*_CONTRACT_SINCE` ci-dessus.
 */
function contractPolicyFor(
  pin: string | null,
  since: { major: number; minor: number; patch: number },
): ContractPolicy {
  if (!pin || compareSemver(pin, since) >= 0) {
    return { level: "error", preContract: false, stale: false };
  }
  if (pinBeyondSupportWindow(pin)) {
    return { level: "error", preContract: true, stale: true };
  }
  return { level: "warn", preContract: true, stale: false };
}

/** Suffixe de message quand un warn daté est escaladé (fenêtre N-2 dépassée). */
function staleSuffix(pin: string | null): string {
  const kit = kitLockstepVersion();
  return (
    ` [politique N-2 : pin kit ${pin ?? "?"} à plus de ${CONTRACT_STALE_LOCKSTEP_WINDOW} ` +
    `versions lockstep du kit courant${kit ? ` ${kit.major}.${kit.minor}.x` : ""} — ` +
    `warn daté devenu ERROR ; monter via \`creezio upgrade\`]`
  );
}

function extractObjectKeys(src: string, field: string): string[] {
  const m = src.match(new RegExp(`${field}\\s*:\\s*\\{([^}]*)\\}`));
  const body = m?.[1];
  if (!body) return [];
  return [...body.matchAll(/(?:["']([a-z][\w-]*)["']|(\b[a-z][\w-]*))\s*:/g)]
    .map((x) => x[1] || x[2])
    .filter((k): k is string => Boolean(k));
}

function extractOperationIds(src: string): string[] {
  const ids: string[] = [];
  for (const block of src.matchAll(/operations\s*:\s*\[([\s\S]*?)\]/g)) {
    const body = block[1];
    if (!body) continue;
    ids.push(
      ...[...body.matchAll(/id\s*:\s*["']([a-z][a-z0-9_-]*)["']/g)].map(
        (hit) => hit[1]!,
      ),
    );
  }
  return ids;
}

function extractMcpToolNames(src: string): string[] {
  return [
    ...src.matchAll(/name\s*:\s*["'](module\.[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*)["']/g),
  ].map((m) => m[1]!);
}

/** Ignore les commentaires ligne et bloc — un stub commenté ne doit pas fail-close. */
function stripModuleSourceComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line))
    .join("\n");
}

/**
 * Contrat 0.10.6 : apiMount manuscrit ⇒ operations[] **non vide** ;
 * extraRoutes cataloguées ; `mcpTools` restant = error (n'existe plus).
 * Pin < 0.10.6 = warn.
 *
 * Exemption (documentée, pas un allowlist de noms) : les mounts kit
 * internes (`KIT_INTERNAL_MODULE_MOUNT_IDS` : schema / dashboard / search /
 * interactive-demo) et les surfaces OS vivent hors `modules/*.ts` — le
 * doctor ne les scanne pas. Un BrandModuleDef métier du même nom n'est
 * PAS exempté (un module `dashboard` de marque doit déclarer operations[]).
 * EntitySpec seul : CRUD auto via `operationsFromEntitySpec` — pas d'ops
 * manuscrites exigées.
 */
function doctorBrandModuleOps(
  specRoot: string,
  issues: BrandSpecIssue[],
): void {
  const modulesDir = resolveAppModulesDir(specRoot);
  if (!modulesDir) return;
  const pin = readAppLockstepPin(specRoot);
  const { level, preContract, stale } = contractPolicyFor(
    pin,
    OPS_CONTRACT_SINCE,
  );
  const dated = stale ? staleSuffix(pin) : "";
  const files = fs
    .readdirSync(modulesDir)
    .filter((f) => f.endsWith(".ts") && !isModuleHelperName(f))
    .sort();
  for (const file of files) {
    const id = file.replace(/\.ts$/, "");
    const filePath = path.join(modulesDir, file);
    const src = stripModuleSourceComments(fs.readFileSync(filePath, "utf8"));
    const rel = path.relative(specRoot, filePath);
    const mountKeys = extractObjectKeys(src, "apiMounts");
    const hasApiMounts = /\bapiMounts\s*:/.test(src);
    const declaredOpIds = extractOperationIds(src);
    const hasNonEmptyOperations = declaredOpIds.length > 0;
    const hasEntitySpecs = /\bentitySpecs\s*:/.test(src);
    const hasMcpTools = /\bmcpTools\s*:/.test(src);
    const hasExtraRoutes = /\bextraRoutes\s*:/.test(src);

    if (hasApiMounts && mountKeys.length > 0 && !hasNonEmptyOperations) {
      issues.push({
        level,
        code: "MODULE_OP_MISSING",
        message: preContract
          ? `module ${id}: apiMounts sans operations[] non vide — pin kit < 0.10.6 ; obligatoire depuis 0.10.6.${dated}`
          : `module ${id}: chaque apiMount doit déclarer operations[] (non vide). EntitySpec : CRUD auto, ne pas re-déclarer.`,
        path: rel,
      });
    }

    if (hasExtraRoutes) {
      const extraIds = extractOperationIds(src).filter(
        (opId) => !CRUD_OP_IDS.has(opId),
      );
      if (extraIds.length === 0) {
        issues.push({
          level,
          code: "MODULE_OP_UNCATALOGUED",
          message: `module ${id}: extraRoutes hors operations[] — chaque subPath servi doit être une op déclarée.`,
          path: rel,
        });
      }
    }

    if (hasMcpTools) {
      const toolNames = extractMcpToolNames(src);
      const opIds = new Set([
        ...extractOperationIds(src),
        ...(hasEntitySpecs ? CRUD_OP_IDS : []),
      ]);
      const overlap = toolNames.filter((name) => {
        const opId = name.split(".")[2];
        return Boolean(opId && opIds.has(opId));
      });
      if (overlap.length) {
        issues.push({
          level,
          code: "MODULE_OP_MCP_OVERLAP",
          message: `module ${id}: mcpTools() recouvre des ops générées (${overlap.join(", ")}). mcpTools n'existe plus — SoT = operations[].`,
          path: rel,
        });
      } else {
        issues.push({
          level: "error",
          code: "MODULE_MCP_TOOLS_DEPRECATED",
          message: `module ${id}: mcpTools() n'existe plus — SoT = operations[] (tools générés).`,
          path: rel,
        });
      }
    }
  }
}

/**
 * Contrat « Meili = composant core » (0.10.13, fail-closed) : chaque module
 * métier avec une entité listable (`entitySpecs` — liste CRUD auto — ou une
 * op `list` manuscrite) doit déclarer son schéma data + index :
 * - `meiliIndexes` (uid `catalog_*`, settings, loadDocs/table+columns), ou
 * - `horsIndexJustification` explicite (relevés, joins commande, écritures,
 *   SKU EAN, agrégats…) — jamais de liste browse implicitement hors Meili.
 * Pin < 0.10.13 = warn.
 */
function doctorBrandModuleMeili(
  specRoot: string,
  issues: BrandSpecIssue[],
): void {
  const modulesDir = resolveAppModulesDir(specRoot);
  if (!modulesDir) return;
  const pin = readAppLockstepPin(specRoot);
  const { level, preContract, stale } = contractPolicyFor(
    pin,
    MEILI_CONTRACT_SINCE,
  );
  const dated = stale ? staleSuffix(pin) : "";
  const files = fs
    .readdirSync(modulesDir)
    .filter((f) => f.endsWith(".ts") && !isModuleHelperName(f))
    .sort();
  for (const file of files) {
    const id = file.replace(/\.ts$/, "");
    const filePath = path.join(modulesDir, file);
    const src = stripModuleSourceComments(fs.readFileSync(filePath, "utf8"));
    const rel = path.relative(specRoot, filePath);
    const hasEntitySpecs = /\bentitySpecs\s*:/.test(src);
    const hasListOp = extractOperationIds(src).includes("list");
    if (!hasEntitySpecs && !hasListOp) continue;
    const hasMeiliIndexes = /\bmeiliIndexes\s*:/.test(src);
    const hasHorsIndex = /\bhorsIndexJustification\s*:/.test(src);
    if (hasMeiliIndexes || hasHorsIndex) continue;
    issues.push({
      level,
      code: "MODULE_MEILI_MISSING",
      message: preContract
        ? `module ${id}: entité listable sans meiliIndexes ni horsIndexJustification — pin kit < 0.10.13 ; obligatoire depuis 0.10.13 (Meili = composant core).${dated}`
        : `module ${id}: entité listable — déclarer meiliIndexes (schéma data + index catalog_*) OU horsIndexJustification explicite (relevés, joins, écritures…). Meili = composant core fail-closed.`,
      path: rel,
    });
  }
}

/**
 * Contrat P2.c / H9 (0.16.0, fail-closed) : le contrat `BrandModuleDef` est
 * IMPORTÉ du kit — le `modules/types.ts` d'une marque est un simple
 * ré-export de `@creezio/app-runtime`. Une redéclaration locale (copie
 * mutable du contrat) = `MODULE_TYPES_DIVERGENT`. Pin < 0.16.0 = warn.
 * types.ts absent (registre important le kit en direct) = valide.
 */
function doctorBrandModuleTypesContract(
  specRoot: string,
  issues: BrandSpecIssue[],
): void {
  const modulesDir = resolveAppModulesDir(specRoot);
  if (!modulesDir) return;
  const typesPath = path.join(modulesDir, "types.ts");
  if (!fs.existsSync(typesPath)) return;
  const pin = readAppLockstepPin(specRoot);
  const { level, preContract, stale } = contractPolicyFor(
    pin,
    MODULE_CONTRACT_SINCE,
  );
  const dated = stale ? staleSuffix(pin) : "";
  const src = stripModuleSourceComments(fs.readFileSync(typesPath, "utf8"));
  const rel = path.relative(specRoot, typesPath);
  // Le risque audité (F3.4) = fork local du contrat. Un types.ts qui ne
  // déclare aucun des types du contrat (helper synthétique, ré-export) est
  // laissé au compilateur — seule une redéclaration locale rougit.
  const declaresLocally =
    /(?:export\s+)?type\s+(?:BrandModuleDef|BrandNavItem|BrandMeiliIndex)\s*=/.test(
      src,
    );
  if (!declaresLocally) return;
  issues.push({
    level,
    code: "MODULE_TYPES_DIVERGENT",
    message: preContract
      ? `modules/types.ts redéclare le contrat de module localement — pin kit < 0.16.0 ; depuis 0.16.0 le contrat est importé du kit (codemod H9 : ré-export @creezio/app-runtime).${dated}`
      : `modules/types.ts divergent du contrat kit — attendu : ré-export \`export type { BrandModuleDef, … } from "@creezio/app-runtime"\` sans redéclaration locale (P2.c / codemod H9).`,
    path: rel,
  });
}

/**
 * Règle d'or n°7 (audit F3.4, 0.16.0, fail-closed) : chaque apiMount
 * manuscrit déclare son contrôle d'accès — `permission` (garde
 * `authorizeModuleAccess`) OU `accessJustification` explicite (route
 * publique/machine assumée). `accessJustification: "à qualifier"` (posée
 * par le codemod H9) = warn `MODULE_PERMISSION_UNQUALIFIED` — dette
 * visible, jamais une permission inventée. EntitySpec seul : CRUD derrière
 * la garde session de bordure (module-mount-auth) — pas exigé ici.
 * Pin < 0.16.0 = warn.
 */
function doctorBrandModulePermissions(
  specRoot: string,
  issues: BrandSpecIssue[],
): void {
  const modulesDir = resolveAppModulesDir(specRoot);
  if (!modulesDir) return;
  const pin = readAppLockstepPin(specRoot);
  const { level, preContract, stale } = contractPolicyFor(
    pin,
    MODULE_CONTRACT_SINCE,
  );
  const dated = stale ? staleSuffix(pin) : "";
  const files = fs
    .readdirSync(modulesDir)
    .filter((f) => f.endsWith(".ts") && !isModuleHelperName(f))
    .sort();
  for (const file of files) {
    const id = file.replace(/\.ts$/, "");
    const filePath = path.join(modulesDir, file);
    const src = stripModuleSourceComments(fs.readFileSync(filePath, "utf8"));
    const rel = path.relative(specRoot, filePath);
    if (!/\bapiMounts\s*:/.test(src)) continue;
    const hasPermission = /\bpermission\s*:/.test(src);
    const hasJustification = /\baccessJustification\s*:/.test(src);
    if (!hasPermission && !hasJustification) {
      issues.push({
        level,
        code: "MODULE_PERMISSION_MISSING",
        message: preContract
          ? `module ${id}: apiMount sans permission ni accessJustification — pin kit < 0.16.0 ; obligatoire depuis 0.16.0 (règle d'or n°7).${dated}`
          : `module ${id}: chaque apiMount déclare permission (garde authorizeModuleAccess) OU accessJustification explicite (route publique/machine assumée) — règle d'or n°7 (audit F3.4).`,
        path: rel,
      });
      continue;
    }
    if (/\baccessJustification\s*:\s*["']à qualifier["']/.test(src)) {
      issues.push({
        level: "warn",
        code: "MODULE_PERMISSION_UNQUALIFIED",
        message: `module ${id}: accessJustification "à qualifier" (dette codemod H9) — qualifier la permission réelle ou justifier la route publique.`,
        path: rel,
      });
    }
  }
}

/**
 * Volet 2 F3.4 (T5) : un module qui expose une surface API (`apiMounts`
 * ou `entitySpecs` → mounts CRUD) devrait déclarer `assistantSources`
 * (descripteurs typés) OU `assistantSourcesJustification`. **Warn
 * uniquement** — champ additif, pas de cassure des marques existantes
 * (même esprit que `horsIndexJustification` à son introduction).
 */
function doctorBrandModuleAssistantSources(
  specRoot: string,
  issues: BrandSpecIssue[],
): void {
  const modulesDir = resolveAppModulesDir(specRoot);
  if (!modulesDir) return;
  const files = fs
    .readdirSync(modulesDir)
    .filter((f) => f.endsWith(".ts") && !isModuleHelperName(f))
    .sort();
  for (const file of files) {
    const id = file.replace(/\.ts$/, "");
    const filePath = path.join(modulesDir, file);
    const src = stripModuleSourceComments(fs.readFileSync(filePath, "utf8"));
    const rel = path.relative(specRoot, filePath);
    const exposesApi = /\bapiMounts\s*:/.test(src) || /\bentitySpecs\s*:/.test(src);
    if (!exposesApi) continue;
    const hasSources = /\bassistantSources\s*:/.test(src);
    const hasJustification = /\bassistantSourcesJustification\s*:/.test(src);
    if (hasSources || hasJustification) continue;
    issues.push({
      level: "warn",
      code: "MODULE_ASSISTANT_SOURCES_MISSING",
      message: `module ${id}: surface API (apiMounts / entitySpecs) sans assistantSources ni assistantSourcesJustification — déclarer les sources/outils exposés à l'assistant, ou justifier l'absence (écritures internes, webhook machine…).`,
      path: rel,
    });
  }
}

function moduleWiringHasDemoScenarios(src: string): boolean {
  if (!/\bdemo\s*:/.test(src) || !/\bscenarios\s*:/.test(src)) return false;
  return (
    /genericOsTourScenario\s*\(/.test(src) ||
    /kind\s*:\s*["'](?:say|navigate|highlight|click|type|scroll|wait)/.test(src)
  );
}

function countInlineDemoSteps(src: string): number {
  return (
    src.match(
      /kind\s*:\s*["'](?:say|navigate|highlight|click|type|scroll|wait)/g,
    ) ?? []
  ).length;
}

/**
 * Chaque BrandModuleDef d'une app déjà scaffoldée doit exposer ≥ 1 scénario
 * jouable. Spec seul (avant apply) : pas de modules/*.ts → no-op.
 * Helpers (`_lib`, `shared.ts`, `mcp-shared.ts`, `meili-shared.ts`,
 * `index.ts`, `types.ts`) ignorés. Démo trop pauvre = **warn** (pas
 * fail-closed). Pin kit < 0.10.1 (marques en 0.9.x) : démo absente = warn.
 */
function doctorBrandModuleDemos(
  specRoot: string,
  issues: BrandSpecIssue[],
): void {
  const modulesDir = resolveAppModulesDir(specRoot);
  if (!modulesDir) return;
  const pin = readAppLockstepPin(specRoot);
  const { level, preContract, stale } = contractPolicyFor(
    pin,
    DEMO_CONTRACT_SINCE,
  );
  const dated = stale ? staleSuffix(pin) : "";
  const files = fs
    .readdirSync(modulesDir)
    .filter((f) => f.endsWith(".ts") && !isModuleHelperName(f))
    .sort();
  for (const file of files) {
    const id = file.replace(/\.ts$/, "");
    const filePath = path.join(modulesDir, file);
    const src = fs.readFileSync(filePath, "utf8");
    const rel = path.relative(specRoot, filePath);
    if (!moduleWiringHasDemoScenarios(src)) {
      issues.push({
        level,
        code: "MODULE_DEMO_MISSING",
        message: preContract
          ? `module ${id}: demo.scenarios absent — pin kit < 0.10.1 ; obligatoire depuis 0.10.1.${dated}`
          : `module ${id}: demo.scenarios obligatoire (≥ 1 scénario jouable). Une app Creezio sans démo interactive est invalide.`,
        path: rel,
      });
      continue;
    }
    const hasAutoStart = /\bautoStart\s*:\s*true\b/.test(src);
    const usesGeneric = /genericOsTourScenario\s*\(/.test(src);
    const inlineSteps = countInlineDemoSteps(src);
    const stepsTooShort =
      !usesGeneric && inlineSteps > 0 && inlineSteps < MIN_INLINE_DEMO_STEPS;
    if (!hasAutoStart || stepsTooShort) {
      const reasons: string[] = [];
      if (!hasAutoStart) reasons.push("aucun autoStart: true");
      if (stepsTooShort) {
        reasons.push(`steps trop courts (< ${MIN_INLINE_DEMO_STEPS})`);
      }
      issues.push({
        level: "warn",
        code: "MODULE_DEMO_THIN",
        message: `module ${id}: démo trop pauvre (${reasons.join(", ")}) — warn, pas fail-closed.`,
        path: rel,
      });
    }
  }
}

/**
 * Valide un BrandSpec (structure + cohérence minimale).
 */
export function doctorBrandSpec(rootDir: string): DoctorResult {
  const issues: BrandSpecIssue[] = [];
  let spec = null;

  try {
    spec = loadBrandSpec(rootDir);
  } catch (err) {
    issues.push({
      level: "error",
      code: "LOAD_FAILED",
      message: err instanceof Error ? err.message : String(err),
      path: rootDir,
    });
    return { ok: false, spec: null, issues };
  }

  const { brand } = spec;

  if (!BRAND_ID_RE.test(brand.brandId)) {
    issues.push({
      level: "error",
      code: "BRAND_ID_INVALID",
      message: `brandId invalide: ${brand.brandId} (attendu [a-z][a-z0-9]{1,31})`,
      path: "brand.yaml",
    });
  }

  if (!brand.brandName.trim()) {
    issues.push({
      level: "error",
      code: "BRAND_NAME_EMPTY",
      message: "brandName vide",
      path: "brand.yaml",
    });
  }

  if (!brand.domain.includes(".")) {
    issues.push({
      level: "warn",
      code: "DOMAIN_SUSPICIOUS",
      message: `domain sans point: ${brand.domain}`,
      path: "brand.yaml",
    });
  }

  if (!spec.productMd) {
    issues.push({
      level: "error",
      code: "PRODUCT_MD_MISSING",
      message: "product.md manquant — requis (plus de fallback notes)",
      path: "product.md",
    });
  } else if (STUB_FILL_RE.test(spec.productMd)) {
    issues.push({
      level: "error",
      code: "PRODUCT_MD_STUB",
      message:
        "product.md contient « (à remplir) » — refill avant apply métier / livrable",
      path: "product.md",
    });
  }

  if (!spec.agentsMd) {
    issues.push({
      level: "warn",
      code: "AGENTS_MD_MISSING",
      message: "AGENTS.md interview manquant",
      path: "AGENTS.md",
    });
  }

  if (!spec.interviewSchema) {
    issues.push({
      level: "info",
      code: "INTERVIEW_SCHEMA_MISSING",
      message: "interview.schema.json absent (optionnel)",
      path: "interview.schema.json",
    });
  }

  if (spec.modules.length === 0) {
    issues.push({
      level: "error",
      code: "NO_MODULES",
      message:
        "aucun module sous modules/ — brand create pose un registre vide ; module init + specs remplies avant apply métier",
      path: "modules/",
    });
  }

  for (const mod of spec.modules) {
    if (!mod.hasPrd) {
      issues.push({
        level: "error",
        code: "MODULE_PRD_MISSING",
        message: `module ${mod.id}: prd.md manquant`,
        path: path.relative(spec.rootDir, mod.dir),
      });
    } else {
      const prdPath = path.join(mod.dir, "prd.md");
      const interviewPath = path.join(mod.dir, "interview.md");
      const prd = fs.existsSync(prdPath)
        ? fs.readFileSync(prdPath, "utf8")
        : "";
      const interview = fs.existsSync(interviewPath)
        ? fs.readFileSync(interviewPath, "utf8")
        : "";
      if (STUB_FILL_RE.test(prd) || STUB_FILL_RE.test(interview)) {
        issues.push({
          level: "error",
          code: "MODULE_SPEC_STUB",
          message: `module ${mod.id}: spec stub « (à remplir) » — refill avant apply métier`,
          path: path.relative(spec.rootDir, mod.dir),
        });
      }
    }
    if (mod.id === "notes" && !NOTES_LEFTOVER_ALLOWLIST.has(brand.brandId)) {
      issues.push({
        level: "error",
        code: "NOTES_LEFTOVER",
        message:
          "module leftover « notes » interdit (hors allowlist) — utiliser brand create + module init métier",
        path: path.relative(spec.rootDir, mod.dir),
      });
    }
  }

  const leftoverNotesTs = resolveAppModulesDir(spec.rootDir);
  if (
    leftoverNotesTs &&
    fs.existsSync(path.join(leftoverNotesTs, "notes.ts")) &&
    !NOTES_LEFTOVER_ALLOWLIST.has(brand.brandId)
  ) {
    issues.push({
      level: "error",
      code: "NOTES_LEFTOVER",
      message:
        "server/src/electron/modules/notes.ts leftover interdit (hors allowlist)",
      path: path.relative(spec.rootDir, path.join(leftoverNotesTs, "notes.ts")),
    });
  }

  if (brand.meili?.enabled && brand.meili.feedPreset === "custom") {
    if (!brand.meili.indexes?.length) {
      issues.push({
        level: "error",
        code: "MEILI_CUSTOM_NO_INDEXES",
        message: "meili.feedPreset=custom sans indexes[]",
        path: "brand.yaml",
      });
    }
  }

  if (brand.platform?.desktop === false) {
    issues.push({
      level: "info",
      code: "DESKTOP_DISABLED",
      message: "platform.desktop=false — pas de startBrandDesktop attendu",
      path: "brand.yaml",
    });
  }

  doctorBrandModuleDemos(spec.rootDir, issues);
  doctorBrandModuleOps(spec.rootDir, issues);
  doctorBrandModuleMeili(spec.rootDir, issues);
  doctorBrandModuleMeiliTables(spec.rootDir, issues);
  doctorBrandModuleTypesContract(spec.rootDir, issues);
  doctorBrandModulePermissions(spec.rootDir, issues);
  doctorBrandModuleAssistantSources(spec.rootDir, issues);
  doctorCreezioManifestAlignment(spec.rootDir, issues);
  doctorOsUiPageDeps(spec.rootDir, issues);

  // Anti-jumeau : pas de sidecars dans brand-spec
  for (const bad of ["metier-api.mjs", "store.json", "meili-launcher.ts"]) {
    const p = path.join(spec.rootDir, bad);
    if (fs.existsSync(p)) {
      issues.push({
        level: "error",
        code: "FORBIDDEN_SIDECAR",
        message: `fichier interdit dans brand-spec: ${bad}`,
        path: bad,
      });
    }
  }

  const ok = !issues.some((i) => i.level === "error");
  return { ok, spec, issues };
}

/**
 * Manifests d'une app marque susceptibles de porter des deps `@creezio/*`.
 * Une marque monorepo en a plusieurs (workspace server, UI hors workspace,
 * client thin) — un bump partiel entre eux = CI verte mais ancienne page
 * os-ui servie (incident login 0.6.0, docs/PROPAGATION.md « Règle d'or du
 * bump côté apps »). `package.json` racine couvre le layout plat legacy
 * (l'orchestrateur monorepo n'a pas de deps @creezio/* → ignoré de fait).
 */
const CREEZIO_MANIFEST_CANDIDATES = [
  "package.json",
  "server/package.json",
  "server/ui/package.json",
  "client/package.json",
] as const;

function readCreezioDepSpecs(pkgPath: string): Record<string, string> | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const merged = { ...pkg.dependencies, ...pkg.devDependencies };
    const specs: Record<string, string> = {};
    for (const [name, spec] of Object.entries(merged)) {
      if (name.startsWith("@creezio/") && typeof spec === "string") {
        specs[name] = spec;
      }
    }
    return specs;
  } catch {
    return null;
  }
}

/**
 * Fail-closed : toute dep `@creezio/*` présente dans ≥ 2 manifests de l'app
 * doit avoir un spec npm strictement identique partout. Politique
 * intersection : un package présent dans un seul manifest n'est pas une
 * erreur. Pas de gating par pin lockstep : un désalignement est un bug
 * runtime quel que soit l'âge de la marque.
 */
function doctorCreezioManifestAlignment(
  specRoot: string,
  issues: BrandSpecIssue[],
): void {
  const appRoot = path.dirname(specRoot);
  const manifests: { rel: string; specs: Record<string, string> }[] = [];
  for (const rel of CREEZIO_MANIFEST_CANDIDATES) {
    const pkgPath = path.join(appRoot, rel);
    if (!fs.existsSync(pkgPath)) continue;
    const specs = readCreezioDepSpecs(pkgPath);
    if (specs === null) {
      issues.push({
        level: "error",
        code: "CREEZIO_MANIFEST_UNREADABLE",
        message: `${rel} illisible (JSON invalide) — alignement @creezio/* invérifiable`,
        path: rel,
      });
      continue;
    }
    if (Object.keys(specs).length > 0) manifests.push({ rel, specs });
  }
  if (manifests.length < 2) return;

  const byPackage = new Map<string, Map<string, string[]>>();
  for (const { rel, specs } of manifests) {
    for (const [name, spec] of Object.entries(specs)) {
      const bySpec = byPackage.get(name) ?? new Map<string, string[]>();
      bySpec.set(spec, [...(bySpec.get(spec) ?? []), rel]);
      byPackage.set(name, bySpec);
    }
  }
  for (const [name, bySpec] of [...byPackage.entries()].sort()) {
    if (bySpec.size <= 1) continue;
    const detail = [...bySpec.entries()]
      .map(([spec, rels]) => rels.map((rel) => `${rel}=${spec}`).join(", "))
      .join(" ; ");
    issues.push({
      level: "error",
      code: "CREEZIO_MANIFEST_MISALIGNED",
      message:
        `${name}: specs divergentes entre manifests (${detail}) — bumper TOUS les manifests ensemble ` +
        `(npm install '${name}@^X.Y.Z' --save à la racine ET --prefix server/ui, ` +
        `voir docs/PROPAGATION.md « Règle d'or du bump côté apps », incident login 0.6.0)`,
      path: manifests[0]!.rel,
    });
  }
}

/* ------------------------------------------- deps des pages os-ui (UI) */

/** Groupe de routes matérialisé par @creezio/os-ui (scripts/materialize.mjs). */
const OS_UI_ROUTE_GROUP = "(creezio-os)";

function walkUiSourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walkUiSourceFiles(abs, out);
    else if (/\.(?:tsx?|jsx?|mjs|cjs)$/.test(ent.name)) out.push(abs);
  }
  return out;
}

/** Packages `@creezio/<name>` importés par une source UI (commentaires ignorés). */
function extractCreezioUiImports(src: string): string[] {
  const clean = stripModuleSourceComments(src);
  const names = new Set<string>();
  for (const m of clean.matchAll(
    /["'`](@creezio\/[a-z0-9-]+)(?:\/[a-z0-9./_-]*)?["'`]/g,
  )) {
    names.add(m[1]!);
  }
  return [...names];
}

/**
 * routes/ du package `@creezio/os-ui` INSTALLÉ (walk-up node_modules depuis
 * server/ui — même résolution que le runtime Next et que le script
 * materialize de la marque). null = os-ui non installé.
 */
function resolveInstalledOsUiRoutes(appRoot: string): string | null {
  let dir = path.join(appRoot, "server", "ui");
  for (;;) {
    const cand = path.join(dir, "node_modules", "@creezio", "os-ui", "routes");
    if (fs.existsSync(cand) && fs.statSync(cand).isDirectory()) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Fail-closed (incident prod 0.20.0 : os-ui@0.20.0 matérialise /granola et
 * /grokbot, build marque cassé — deps absentes de server/ui/package.json) :
 * tout package `@creezio/*` importé par une page os-ui — matérialisée sous
 * `server/ui/app/(creezio-os)/` ou embarquée dans le `@creezio/os-ui`
 * installé (ce que la prochaine matérialisation produira) — doit être
 * DÉCLARÉ dans `server/ui/package.json`. Error, pas warn : une dep absente
 * = build UI cassé, quel que soit l'âge de la marque (même politique que
 * CREEZIO_MANIFEST_MISALIGNED). Le correctif canonique est
 * `creezio upgrade` (sync SoT kit), jamais un retrait de page.
 *
 * Ni pages matérialisées ni os-ui installé (clone frais sans npm install)
 * → skip explicite en info, jamais silencieux.
 */
function doctorOsUiPageDeps(
  specRoot: string,
  issues: BrandSpecIssue[],
): void {
  const appRoot = path.dirname(specRoot);
  const uiPkgRel = path.join("server", "ui", "package.json");
  const uiPkgPath = path.join(appRoot, uiPkgRel);
  if (!fs.existsSync(uiPkgPath)) return;
  let declared: Record<string, string>;
  try {
    const pkg = JSON.parse(fs.readFileSync(uiPkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    declared = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.optionalDependencies,
    };
  } catch {
    // JSON illisible : déjà remonté en CREEZIO_MANIFEST_UNREADABLE.
    return;
  }

  const sources: { origin: string; root: string; files: string[] }[] = [];
  const materialized = path.join(appRoot, "server", "ui", "app", OS_UI_ROUTE_GROUP);
  if (fs.existsSync(materialized) && fs.statSync(materialized).isDirectory()) {
    sources.push({
      origin: `pages matérialisées ${path.join("server", "ui", "app", OS_UI_ROUTE_GROUP)}`,
      root: materialized,
      files: walkUiSourceFiles(materialized),
    });
  }
  const installedRoutes = resolveInstalledOsUiRoutes(appRoot);
  if (installedRoutes) {
    sources.push({
      origin: `routes du @creezio/os-ui installé (${path.relative(appRoot, installedRoutes)})`,
      root: installedRoutes,
      files: walkUiSourceFiles(installedRoutes),
    });
  }
  if (sources.length === 0) {
    issues.push({
      level: "info",
      code: "OS_UI_DEPS_UNCHECKED",
      message:
        "deps des pages os-ui non vérifiables (ni pages matérialisées ni @creezio/os-ui installé — npm install d'abord)",
      path: uiPkgRel,
    });
    return;
  }

  const requiredBy = new Map<string, Set<string>>();
  for (const source of sources) {
    for (const file of source.files) {
      let src: string;
      try {
        src = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const relPage = path.relative(source.root, file);
      for (const name of extractCreezioUiImports(src)) {
        const pages = requiredBy.get(name) ?? new Set<string>();
        if (pages.size < 3) pages.add(relPage);
        requiredBy.set(name, pages);
      }
    }
  }

  for (const name of [...requiredBy.keys()].sort()) {
    if (declared[name] !== undefined) continue;
    const pages = [...requiredBy.get(name)!].sort();
    issues.push({
      level: "error",
      code: "OS_UI_PAGE_DEP_MISSING",
      message:
        `${name} est importé par les pages os-ui (${pages.join(", ")}) mais absent de server/ui/package.json — ` +
        `build UI cassé (incident 0.20.0). Correctif : \`creezio upgrade\` (sync SoT kit) ou ajouter la dep au pin lockstep.`,
      path: uiPkgRel,
    });
  }
}

/**
 * Doctor sur une app marque (résout brand-spec/).
 */
export function doctorAppBrandSpec(appRoot: string): DoctorResult {
  const dir = resolveBrandSpecDir(appRoot);
  if (!dir) {
    return {
      ok: false,
      spec: null,
      issues: [
        {
          level: "error",
          code: "BRAND_SPEC_NOT_FOUND",
          message: `Aucun brand.yaml sous ${appRoot}/brand-spec ni ${appRoot}`,
          path: appRoot,
        },
      ],
    };
  }
  return doctorBrandSpec(dir);
}

export function formatDoctorReport(result: DoctorResult): string {
  const lines: string[] = [];
  lines.push(
    result.ok
      ? `✓ BrandSpec OK${result.spec ? ` (${result.spec.brand.brandId})` : ""}`
      : `✗ BrandSpec INVALIDE${result.spec ? ` (${result.spec.brand.brandId})` : ""}`,
  );
  if (result.spec) {
    lines.push(`  root     ${result.spec.rootDir}`);
    lines.push(`  modules  ${result.spec.modules.map((m) => m.id).join(", ") || "(aucun)"}`);
  }
  for (const issue of result.issues) {
    const mark =
      issue.level === "error" ? "E" : issue.level === "warn" ? "W" : "I";
    lines.push(
      `  [${mark}] ${issue.code}: ${issue.message}${issue.path ? ` @ ${issue.path}` : ""}`,
    );
  }
  return lines.join("\n");
}
