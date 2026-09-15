/**
 * Version npm publiée des packages @creezio/* (lockstep — SoT
 * packages/platform-core/package.json du kit courant). Les apps générées
 * consomment `@creezio/<pkg>: ^<version>` (docs/NPM-DISTRIBUTION.md) —
 * plus de `file:vendor/creezio/*`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Racine kit par défaut : packages/factory/{src,dist} → ../../.. */
function defaultKitRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..");
}

/** Version lockstep publiée (fallback 0.4.0 = bootstrap). */
export function kitPublishedVersion(kitRoot?: string): string {
  const root = path.resolve(
    kitRoot || process.env.CREEZIO_KIT_ROOT || defaultKitRoot(),
  );
  try {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(root, "packages/platform-core/package.json"),
        "utf8",
      ),
    ) as { version?: string };
    if (typeof pkg.version === "string" && pkg.version) return pkg.version;
  } catch {
    /* kit partiel (tests unitaires) → fallback */
  }
  return "0.4.0";
}

/** Spec npm des deps @creezio/* générées (`^<lockstep>`). */
export function creezioDepSpec(kitRoot?: string): string {
  return `^${kitPublishedVersion(kitRoot)}`;
}

/** Map de deps `@creezio/<name>` → `^<lockstep>` (triées). */
export function creezioNpmDeps(
  names: readonly string[],
  kitRoot?: string,
): Record<string, string> {
  const spec = creezioDepSpec(kitRoot);
  const deps: Record<string, string> = {};
  for (const name of [...names].sort()) {
    deps[`@creezio/${name}`] = spec;
  }
  return deps;
}

const LINK_KIT_TRUTHY = new Set(["1", "true", "yes", "on"]);

/**
 * Mode `--link-kit` / `CREEZIO_LINK_KIT=1` : l'install d'une app fraîche
 * consomme les packages du worktree kit (`file:`) au lieu du registre.
 * Les manifests générés restent `^<lockstep>` (contrat clone autonome).
 */
export function isLinkKitEnabled(explicit?: boolean): boolean {
  if (explicit === true) return true;
  if (explicit === false) return false;
  const raw = (process.env.CREEZIO_LINK_KIT || "").trim().toLowerCase();
  return LINK_KIT_TRUTHY.has(raw);
}

/** Racine kit : option, `CREEZIO_KIT_ROOT`, ou monorepo autour de factory. */
export function resolveKitRoot(kitRoot?: string): string {
  return path.resolve(
    kitRoot || process.env.CREEZIO_KIT_ROOT || defaultKitRoot(),
  );
}

export type CreezioPackageRef = { name: string; dir: string };

/** Packages `@creezio/*` présents sous `<kit>/packages/*`. */
export function listCreezioPackageRefs(kitRoot?: string): CreezioPackageRef[] {
  const packagesDir = path.join(resolveKitRoot(kitRoot), "packages");
  if (!fs.existsSync(packagesDir)) return [];
  const out: CreezioPackageRef[] = [];
  for (const name of fs.readdirSync(packagesDir)) {
    const dir = path.join(packagesDir, name);
    const pj = path.join(dir, "package.json");
    if (!fs.existsSync(pj)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pj, "utf8")) as { name?: string };
      if (typeof pkg.name === "string" && pkg.name.startsWith("@creezio/")) {
        out.push({ name: pkg.name, dir: path.resolve(dir) });
      }
    } catch {
      /* package.json illisible */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Specs `file:<abs>` pour chaque package `@creezio/*` du kit. */
export function creezioLinkKitFileSpecs(
  kitRoot?: string,
): Record<string, string> {
  const specs: Record<string, string> = {};
  for (const ref of listCreezioPackageRefs(kitRoot)) {
    specs[ref.name] = `file:${ref.dir}`;
  }
  return specs;
}

/**
 * Clôture @creezio serveur (deps directes npm publiées) — SoT unique pour
 * `scaffold.ts` et `scaffold-from-prd.ts`. Toute page OS qui importe un
 * `@creezio/*` côté serveur (granola, grokbot, nav, …) doit figurer ici
 * — une liste parallèle dans --from-prd a déjà fait rater la gate
 * os-ui-scaffold (PR #154/#166).
 */
export const SERVER_CREEZIO_DEPS = [
  "api-kernel",
  "app-runtime",
  "assistant",
  "auth",
  "brand-config",
  "brand-spec",
  "browser-host",
  "cockpit",
  "database",
  "desktop-tooling",
  "host-runtime",
  "granola",
  "grokbot",
  "integrations",
  "interactive-demo",
  "mails",
  "mcp-facade",
  "nav",
  "observability",
  "onboarding",
  "os-ui",
  "platform-core",
  "product-hub",
  "search",
  "shell",
  "shell-ui",
  "support",
  "tasks",
] as const;

/**
 * Clôture @creezio du projet UI (`server/ui/package.json`) — SoT unique pour
 * `renderUiPackageJson` (generators/os-ui.ts) ET pour la synchronisation
 * d'upgrade (`sync-creezio-deps.ts`). Toute page os-ui / composant kit
 * importé par l'UI (`@creezio/<pkg>/ui`) exige `<pkg>` ici — une liste
 * parallèle inline a déjà cassé le build marque (os-ui@0.20.0 matérialise
 * /granola et /grokbot sur une marque sans ces deps, incident prod 0.20.0).
 * Les peers kit déclarés en `dependencies` (résolution déterministe hors
 * workspace) figurent aussi ici : platform-core, brand-config, shell,
 * api-kernel, integrations.
 */
export const UI_CREEZIO_DEPS = [
  "access-control",
  "api-kernel",
  "assistant",
  "auth",
  "brand-config",
  "cockpit",
  "database",
  "granola",
  "grokbot",
  "integrations",
  "interactive-demo",
  "mails",
  "mcp-facade",
  "nav",
  "observability",
  "onboarding",
  "os-ui",
  "platform-core",
  "product-hub",
  "shell",
  "shell-ui",
  "support",
  "tasks",
] as const;

/** Clôture @creezio requise par le client thin (startBrandDesktop remote-only). */
export const CLIENT_CREEZIO_DEPS = [
  "api-kernel",
  "app-runtime",
  "assistant",
  "auth",
  "brand-config",
  "brand-spec",
  "browser-host",
  "cockpit",
  "database",
  "desktop-tooling",
  "electron-shell",
  "granola",
  "grokbot",
  "integrations",
  "mails",
  "mcp-facade",
  "nav",
  "observability",
  "onboarding",
  "os-ui",
  "platform-core",
  "product-hub",
  "shell",
  "shell-ui",
  "support",
  "tasks",
] as const;

/**
 * Contenu des `.npmrc` générés (racine + livrables hors workspace) :
 * registre npmjs.org pour @creezio/* — packages publics, aucun token.
 */
export function renderCreezioNpmrc(): string {
  return `# Registre npm des packages du kit Creezio (npmjs.org, org creezio).
# Packages publics — aucun token requis (plus de GitHub Packages).
@creezio:registry=https://registry.npmjs.org
`;
}