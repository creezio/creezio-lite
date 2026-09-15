/**
 * Synchronisation des deps `@creezio/*` d'une marque avec la SoT du kit
 * (P3.a correctif systémique — incident prod 0.20.0).
 *
 * Le trou d'origine : le runner `creezio upgrade` (et le rollout
 * `scripts/propagate-brands.mjs`) ne bumpaient que les deps `@creezio/*`
 * EXISTANTES des manifests. Quand le kit ajoute une dep requise (ex.
 * `@creezio/granola` / `@creezio/grokbot` quand os-ui@0.20.0 a matérialisé
 * `/granola` et `/grokbot`), les marques existantes ne la recevaient
 * jamais → build marque cassé après bump.
 *
 * Ce module est la LOGIQUE PARTAGÉE (SoT côté kit) consommée par :
 *   - `creezio upgrade` (upgrade-cli.ts) ;
 *   - `scripts/propagate-brands.mjs` (rollout flotte, PRs de bump).
 *
 * Contrat :
 *   - chaque manifest à rôle connu (server / server/ui / client) est
 *     synchronisé avec sa liste SoT (kit-release.ts :
 *     SERVER_CREEZIO_DEPS / UI_CREEZIO_DEPS / CLIENT_CREEZIO_DEPS) ;
 *   - dep requise absente → AJOUT en `^<lockstep>` (section dependencies) ;
 *   - dep présente en spec semver ≠ cible → bump (comportement historique) ;
 *   - spec non semver (file:/link:/workspace:) → JAMAIS touchée (dev local) ;
 *   - dep `@creezio/*` présente hors SoT → JAMAIS supprimée : reportée dans
 *     `extras` pour warning listé par l'appelant (une dep en trop se
 *     discute, ne disparaît pas silencieusement) ;
 *   - manifest racine : rôle sans SoT (l'orchestrateur monorepo n'a pas de
 *     deps @creezio/*, le layout plat legacy en héberge) → bump seul,
 *     ni ajout ni extras.
 */
import fs from "node:fs";
import path from "node:path";
import {
  CLIENT_CREEZIO_DEPS,
  SERVER_CREEZIO_DEPS,
  UI_CREEZIO_DEPS,
} from "./kit-release.js";

/** Manifests d'une marque susceptibles de porter des deps @creezio/* (SoT
 * partagée avec le doctor CREEZIO_MANIFEST_MISALIGNED — bump TOUS ensemble). */
export const CREEZIO_MANIFEST_CANDIDATES = [
  "package.json",
  "server/package.json",
  "server/ui/package.json",
  "client/package.json",
] as const;

export type CreezioManifestRole = "root" | "server" | "server-ui" | "client";

/** Rôle d'un manifest relatif marque (null = hors périmètre de sync). */
export function creezioManifestRole(rel: string): CreezioManifestRole | null {
  switch (rel) {
    case "package.json":
      return "root";
    case "server/package.json":
      return "server";
    case "server/ui/package.json":
      return "server-ui";
    case "client/package.json":
      return "client";
    default:
      return null;
  }
}

/**
 * Liste SoT des deps `@creezio/*` requises pour un rôle de manifest, ou
 * null quand le rôle n'a pas de clôture imposée (racine : orchestrateur
 * monorepo sans deps, ou layout plat legacy — dans les deux cas on ne
 * peut pas trancher, donc jamais d'ajout ni de warning « extra »).
 */
export function requiredCreezioDepsForRole(
  role: CreezioManifestRole,
): readonly string[] | null {
  switch (role) {
    case "server":
      return SERVER_CREEZIO_DEPS;
    case "server-ui":
      return UI_CREEZIO_DEPS;
    case "client":
      return CLIENT_CREEZIO_DEPS;
    case "root":
      return null;
  }
}

type DepsSections = "dependencies" | "devDependencies" | "optionalDependencies";
const DEP_SECTIONS: DepsSections[] = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
];

export type CreezioManifestSyncPlan = {
  /** Chemin relatif du manifest (ex. "server/ui/package.json"). */
  rel: string;
  abs: string;
  role: CreezioManifestRole;
  /** Deps existantes à re-versionner : name → { from, to }. */
  bumps: Record<string, { from: string; to: string }>;
  /** Deps SoT manquantes à ajouter : name → spec cible. */
  adds: Record<string, string>;
  /** Deps @creezio/* présentes hors SoT — conservées, à lister en warning. */
  extras: string[];
};

/** true si le plan implique une écriture (bump ou ajout — pas les extras). */
export function creezioSyncPlanHasChanges(
  plan: CreezioManifestSyncPlan,
): boolean {
  return (
    Object.keys(plan.bumps).length > 0 || Object.keys(plan.adds).length > 0
  );
}

/**
 * Planifie la synchronisation de tous les manifests présents d'une marque.
 * `targetSpec` = spec npm cible partagée (ex. `^0.20.0`).
 */
export function planCreezioManifestSync(
  brandRoot: string,
  targetSpec: string,
): CreezioManifestSyncPlan[] {
  const plans: CreezioManifestSyncPlan[] = [];
  for (const rel of CREEZIO_MANIFEST_CANDIDATES) {
    const role = creezioManifestRole(rel);
    if (!role) continue;
    const abs = path.join(brandRoot, rel);
    if (!fs.existsSync(abs)) continue;
    const pkg = JSON.parse(fs.readFileSync(abs, "utf8")) as Record<
      DepsSections,
      Record<string, string> | undefined
    >;
    const required = requiredCreezioDepsForRole(role);
    const requiredNames = new Set(
      (required ?? []).map((name) => `@creezio/${name}`),
    );
    const bumps: CreezioManifestSyncPlan["bumps"] = {};
    const extras = new Set<string>();
    for (const section of DEP_SECTIONS) {
      for (const [name, spec] of Object.entries(pkg[section] || {})) {
        if (!name.startsWith("@creezio/")) continue;
        // Seuls les specs semver sont bumpés (file:/link:/workspace: intacts).
        const semver = /^[\^~]?\d+\.\d+\.\d+/.test(spec.trim());
        if (semver && spec.trim() !== targetSpec) {
          bumps[name] = { from: spec, to: targetSpec };
        }
        if (required !== null && !requiredNames.has(name)) extras.add(name);
      }
    }
    const adds: CreezioManifestSyncPlan["adds"] = {};
    if (required !== null) {
      const present = new Set<string>();
      for (const section of DEP_SECTIONS) {
        for (const name of Object.keys(pkg[section] || {})) present.add(name);
      }
      for (const name of [...requiredNames].sort()) {
        if (!present.has(name)) adds[name] = targetSpec;
      }
    }
    plans.push({
      rel,
      abs,
      role,
      bumps,
      adds,
      extras: [...extras].sort(),
    });
  }
  return plans;
}

/**
 * Applique un plan : bumps dans leur section d'origine, ajouts dans
 * `dependencies` (les clôtures SoT sont des deps runtime). Écriture
 * JSON 2 espaces + \n (format des manifests générés par la factory).
 */
export function applyCreezioManifestSync(
  plan: CreezioManifestSyncPlan,
): void {
  if (!creezioSyncPlanHasChanges(plan)) return;
  const pkg = JSON.parse(fs.readFileSync(plan.abs, "utf8")) as Record<
    string,
    unknown
  >;
  for (const section of DEP_SECTIONS) {
    const deps = pkg[section] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const [name, change] of Object.entries(plan.bumps)) {
      if (deps[name] !== undefined) deps[name] = change.to;
    }
  }
  const addNames = Object.keys(plan.adds);
  if (addNames.length > 0) {
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    for (const name of addNames) deps[name] = plan.adds[name]!;
    pkg.dependencies = deps;
  }
  fs.writeFileSync(plan.abs, JSON.stringify(pkg, null, 2) + "\n", "utf8");
}
