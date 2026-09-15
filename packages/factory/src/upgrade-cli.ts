/**
 * CLI `creezio upgrade` — runner de montée de version d'un repo marque (P3.a).
 *
 * Exécuté à la racine d'un clone marque (ou via --brand-root), il rejoue la
 * procédure de montée documentée (docs/PROPAGATION.md, codemods
 * scripts/codemods/README.md) au lieu de la laisser artisanale (F4.1/F4.3) :
 *
 *   1. détecte la version d'architecture COURANTE de la marque
 *      (`creezio.architectureVersion` du package.json racine, sinon le
 *      `@creezio/platform-core` installé dans node_modules, sinon inconnue)
 *      et la version CIBLE (celle du kit qui porte ce CLI) ;
 *   2. applique LA CHAÎNE des codemods intermédiaires dans l'ordre
 *      (ex. H7→H9 = H8 puis H9) — chaque pas est re-exécuté pour PROUVER
 *      l'idempotence (re-run = no-op, sinon échec explicite) ;
 *   3. synchronise les deps `@creezio/*` de TOUS les manifests présents
 *      (racine, server, server/ui, client) avec la SoT du kit
 *      (`planCreezioManifestSync` — sync-creezio-deps.ts) : bump des
 *      existantes vers `^<lockstep kit>` + AJOUT des deps requises
 *      manquantes (SERVER/UI/CLIENT_CREEZIO_DEPS — le trou historique :
 *      os-ui@0.20.0 matérialise /granola et /grokbot sur une marque sans
 *      ces deps → build cassé) ; une dep `@creezio/*` hors SoT n'est
 *      JAMAIS supprimée, elle est listée en warning. Puis régénère les
 *      lockfiles via `npm install --package-lock-only` + locks secondaires
 *      (`ensureBrandPackageLocks` — JAMAIS `npm update`, spin infini connu) ;
 *   4. rematérialise les pages os-ui (mécanisme existant
 *      `npm run os-ui:materialize`) si node_modules est installable/installé ;
 *   5. lance le doctor brand-spec et échoue si error.
 *
 * `--dry-run` liste tout ce qui serait fait sans rien écrire.
 * Version courante = cible et manifests déjà alignés ⇒ no-op explicite.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHITECTURE_VERSION } from "@creezio/platform-core";
import {
  doctorAppBrandSpec,
  formatDoctorReport,
  resolveBrandSpecDir,
} from "@creezio/brand-spec";
import { kitPublishedVersion } from "./kit-release.js";
import { spawnNpmAt } from "./npm-isolated.js";
import { ensureBrandPackageLocks } from "./package-lock.js";
import {
  applyCreezioManifestSync,
  creezioSyncPlanHasChanges,
  planCreezioManifestSync,
  type CreezioManifestSyncPlan,
} from "./sync-creezio-deps.js";

type Log = (line: string) => void;

export type UpgradeCliArgs = {
  brandRoot: string;
  dryRun: boolean;
  /** Saute npm install + rematérialisation os-ui (lock-only reste fait). */
  noInstall: boolean;
  help: boolean;
};

export function parseUpgradeArgs(argv: string[]): UpgradeCliArgs {
  const out: UpgradeCliArgs = {
    brandRoot: process.cwd(),
    dryRun: false,
    noInstall: false,
    help: false,
  };
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift()!;
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--no-install") out.noInstall = true;
    else if (a.startsWith("--brand-root="))
      out.brandRoot = path.resolve(a.slice("--brand-root=".length));
    else if (a === "--brand-root") out.brandRoot = path.resolve(rest.shift() || ".");
    else throw new Error(`creezio upgrade: argument inconnu: ${a}`);
  }
  return out;
}

export function printUpgradeHelp(): void {
  console.log(`creezio upgrade — montée de version d'un repo marque (kit → marque)

Usage:
  creezio upgrade [--brand-root <dir>] [--dry-run] [--no-install]

À la racine d'un clone marque, applique dans l'ordre :
  1. chaîne des codemods d'architecture intermédiaires (ex. H7→H9 = H8 puis H9),
     idempotence PROUVÉE à chaque pas (re-run = no-op sinon échec) ;
  2. sync des deps @creezio/* de TOUS les manifests (racine, server,
     server/ui, client) avec la SoT du kit installé : bump vers la version
     lockstep + AJOUT des deps requises manquantes (jamais de suppression —
     une dep hors SoT est listée en warning), puis régénération des
     lockfiles (npm install --package-lock-only + locks secondaires —
     jamais npm update) ;
  3. rematérialisation des pages os-ui (npm run os-ui:materialize) si
     node_modules est présent (sinon skip explicite — le prebuild marque la
     refait) ;
  4. doctor brand-spec (échec si error).

Options:
  --brand-root <dir>  Racine du repo marque (défaut : cwd)
  --dry-run           Liste ce qui serait fait, n'écrit rien
  --no-install        Pas de npm install ni de rematérialisation os-ui
                      (lockfiles régénérés quand même, --package-lock-only)

Déjà à jour (même architecture, manifests alignés) ⇒ no-op explicite, exit 0.
`);
}

/* ------------------------------------------------------------- résolutions */

function factoryPackageRoot(): string {
  // dist/upgrade-cli.js → packages/factory (ou node_modules/@creezio/factory)
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..");
}

function kitRepoRoot(): string {
  return path.resolve(
    process.env.CREEZIO_KIT_ROOT || path.resolve(factoryPackageRoot(), "../.."),
  );
}

/**
 * Dossier des codemods d'architecture. Deux layouts :
 *   - package npm @creezio/factory : copie publiée `codemods/` (build) ;
 *   - repo kit : SoT `scripts/codemods/`.
 */
export function resolveCodemodsDir(): string | null {
  const candidates = [
    path.join(factoryPackageRoot(), "codemods"),
    path.join(kitRepoRoot(), "scripts", "codemods"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir)) && fs.statSync(dir).isDirectory()) {
      // Un dossier codemods valide contient au moins un HN/manifest.json.
      const hasVersion = fs
        .readdirSync(dir)
        .some(
          (name) =>
            /^H\d+$/.test(name) &&
            fs.existsSync(path.join(dir, name, "manifest.json")),
        );
      if (hasVersion) return dir;
    }
  }
  return null;
}

function archNumber(version: string): number | null {
  const m = /^H(\d+)$/.exec(version.trim());
  return m ? Number(m[1]) : null;
}

/** Versions codemods disponibles, triées numériquement (H7 < H8 < … < H10). */
export function listCodemodVersions(codemodsDir: string): string[] {
  return fs
    .readdirSync(codemodsDir)
    .filter(
      (name) =>
        archNumber(name) !== null &&
        fs.existsSync(path.join(codemodsDir, name, "manifest.json")),
    )
    .sort((a, b) => archNumber(a)! - archNumber(b)!);
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Version lockstep @creezio/platform-core VERROUILLÉE (package-lock.json
 * racine — reflète le dernier bump commité, contrairement à node_modules
 * qui peut être stale sur un poste où le deploy passe par Docker).
 */
function lockedPlatformCoreVersion(brandRoot: string): string | null {
  try {
    const lock = JSON.parse(
      fs.readFileSync(path.join(brandRoot, "package-lock.json"), "utf8"),
    ) as { packages?: Record<string, { version?: string }> };
    const v = lock.packages?.["node_modules/@creezio/platform-core"]?.version;
    return typeof v === "string" && /^\d+\.\d+\.\d+/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * lockstep → version d'architecture, via le champ `since` des manifests
 * codemods (SoT scripts/codemods/README.md) : l'architecture courante est
 * la plus grande HN dont `since` ≤ la version lockstep. Version plus
 * vieille que le plus ancien codemod connu → null (chaîne complète).
 */
export function archVersionForLockstep(
  codemodsDir: string,
  lockstep: string,
): string | null {
  let best: string | null = null;
  for (const version of listCodemodVersions(codemodsDir)) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(codemodsDir, version, "manifest.json"), "utf8"),
    ) as { since?: string };
    if (!manifest.since || !/^\d+\.\d+\.\d+$/.test(manifest.since)) continue;
    if (compareSemver(lockstep, manifest.since) >= 0) best = version;
  }
  return best;
}

/**
 * Version d'architecture courante de la marque :
 *   1. marqueur `creezio.architectureVersion` du package.json racine
 *      (stampé par la factory au scaffold et par ce runner après upgrade) ;
 *   2. version @creezio/platform-core du package-lock.json racine (état
 *      COMMITÉ du dernier bump), mappée via les `since` des codemods ;
 *   3. `@creezio/platform-core` INSTALLÉ (node_modules — peut être stale) ;
 *   4. null = inconnue (chaîne complète appliquée, codemods idempotents).
 */
export function detectBrandArchitectureVersion(
  brandRoot: string,
  codemodsDir?: string,
): string | null {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(brandRoot, "package.json"), "utf8"),
    ) as { creezio?: { architectureVersion?: string } };
    const marked = pkg.creezio?.architectureVersion;
    if (typeof marked === "string" && archNumber(marked) !== null) {
      return marked.trim();
    }
  } catch {
    /* package.json illisible → autres sources */
  }
  if (codemodsDir) {
    const locked = lockedPlatformCoreVersion(brandRoot);
    if (locked) {
      const mapped = archVersionForLockstep(codemodsDir, locked);
      if (mapped) return mapped;
    }
  }
  const installedCandidates = [
    "node_modules/@creezio/platform-core/dist/architecture-version.js",
    "node_modules/@creezio/platform-core/dist-cjs/architecture-version.js",
    "server/node_modules/@creezio/platform-core/dist/architecture-version.js",
  ];
  for (const rel of installedCandidates) {
    const abs = path.join(brandRoot, rel);
    if (!fs.existsSync(abs)) continue;
    const m = /ARCHITECTURE_VERSION\s*=\s*["']([^"']+)["']/.exec(
      fs.readFileSync(abs, "utf8"),
    );
    if (m && archNumber(m[1]!) !== null) return m[1]!;
  }
  return null;
}

/** Version lockstep cible = celle du kit qui porte ce CLI. */
export function targetLockstepVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("@creezio/platform-core/package.json") as {
      version?: string;
    };
    if (typeof pkg.version === "string" && pkg.version) return pkg.version;
  } catch {
    /* export ./package.json absent (pin < 0.17) → lecture repo kit */
  }
  const fromKit = kitPublishedVersion(kitRepoRoot());
  if (fromKit === "0.4.0") {
    // Fallback bootstrap de kitPublishedVersion — jamais une cible d'upgrade.
    throw new Error(
      "creezio upgrade: version lockstep du kit indéterminable " +
        "(@creezio/platform-core introuvable et pas de repo kit — " +
        "poser CREEZIO_KIT_ROOT ou installer les packages @creezio/*)",
    );
  }
  return fromKit;
}

/* ------------------------------------------------------------------- plan */

/** Warning listé (jamais de suppression silencieuse) des deps hors SoT. */
function logExtrasWarnings(
  plans: CreezioManifestSyncPlan[],
  log: Log,
): void {
  for (const plan of plans) {
    if (plan.extras.length === 0) continue;
    log(
      `  ⚠ ${plan.rel} : deps @creezio/* hors SoT kit (CONSERVÉES — vérifier ` +
        `qu'elles sont encore voulues) : ${plan.extras.join(", ")}`,
    );
  }
}

function stampArchitectureVersion(brandRoot: string, arch: string): void {
  const abs = path.join(brandRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(abs, "utf8")) as {
    creezio?: Record<string, unknown>;
  } & Record<string, unknown>;
  const creezio = (pkg.creezio ?? {}) as Record<string, unknown>;
  if (creezio.architectureVersion === arch && pkg.creezio) return;
  creezio.architectureVersion = arch;
  pkg.creezio = creezio;
  fs.writeFileSync(abs, JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

/* --------------------------------------------------------------- codemods */

type CodemodRun = { version: string; script: string };

function codemodChain(
  codemodsDir: string,
  current: string | null,
  target: string,
): CodemodRun[] {
  const targetNum = archNumber(target);
  if (targetNum === null) {
    throw new Error(`Version d'architecture cible invalide: ${target}`);
  }
  const currentNum = current === null ? null : archNumber(current);
  const runs: CodemodRun[] = [];
  for (const version of listCodemodVersions(codemodsDir)) {
    const num = archNumber(version)!;
    if (num > targetNum) continue;
    if (currentNum !== null && num <= currentNum) continue;
    const manifest = JSON.parse(
      fs.readFileSync(path.join(codemodsDir, version, "manifest.json"), "utf8"),
    ) as { scripts?: string[] };
    for (const script of manifest.scripts || []) {
      runs.push({ version, script });
    }
  }
  return runs;
}

/**
 * Exécute un script codemod (`ROOT=<brandRoot> node <script>`). Retourne la
 * sortie ; jette si exit ≠ 0. Contrat scripts/codemods/README.md : chaque
 * fichier modifié est listé sur une ligne `  ~ <rel>` — c'est ce qui permet
 * de PROUVER l'idempotence au re-run.
 */
function runCodemodScript(
  codemodsDir: string,
  run: CodemodRun,
  brandRoot: string,
): string {
  const abs = path.join(codemodsDir, run.version, run.script);
  const r = spawnSync(process.execPath, [abs], {
    cwd: brandRoot,
    encoding: "utf8",
    env: { ...process.env, ROOT: brandRoot },
  });
  const output = `${r.stdout || ""}${r.stderr || ""}`;
  if (r.status !== 0) {
    throw new Error(
      `codemod ${run.version}/${run.script} exit ${r.status ?? "?"} — marque intacte.\n${output.trim()}`,
    );
  }
  return output;
}

function codemodChangedFiles(output: string): string[] {
  return [...output.matchAll(/^\s+~\s+(.+)$/gm)].map((m) => m[1]!.trim());
}

/* ---------------------------------------------------------------- npm run */

function runNpm(args: string[], cwd: string, log: Log): void {
  log(`  $ npm ${args.join(" ")}`);
  const r = spawnNpmAt(cwd, args, { stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`npm ${args.join(" ")} exit ${r.status ?? "?"} dans ${cwd}`);
  }
}

/* ------------------------------------------------------------------- main */

export async function runUpgradeCli(argv: string[]): Promise<void> {
  const args = parseUpgradeArgs(argv);
  if (args.help) {
    printUpgradeHelp();
    return;
  }
  const log: Log = (line) => console.log(line);
  const brandRoot = args.brandRoot;
  if (!fs.existsSync(path.join(brandRoot, "package.json"))) {
    throw new Error(
      `creezio upgrade: ${brandRoot} n'est pas une racine de repo marque (package.json absent)`,
    );
  }

  const codemodsDir = resolveCodemodsDir();
  if (!codemodsDir) {
    throw new Error(
      "creezio upgrade: codemods d'architecture introuvables " +
        "(ni codemods/ du package factory, ni scripts/codemods/ du repo kit — poser CREEZIO_KIT_ROOT)",
    );
  }

  const currentArch = detectBrandArchitectureVersion(brandRoot, codemodsDir);
  const targetArch = ARCHITECTURE_VERSION;
  const targetVersion = targetLockstepVersion();
  const targetSpec = `^${targetVersion}`;

  log(`creezio upgrade — ${brandRoot}`);
  log(`  architecture : ${currentArch ?? "inconnue"} → ${targetArch}`);
  log(`  lockstep kit : ${targetVersion} (deps @creezio/* → ${targetSpec})`);
  if (currentArch === null) {
    log(
      "  ⚠ version courante inconnue (ni marqueur creezio.architectureVersion, " +
        "ni platform-core installé) — chaîne complète appliquée (codemods idempotents)",
    );
  }

  const currentNum = currentArch === null ? null : archNumber(currentArch);
  const targetNum = archNumber(targetArch)!;
  if (currentNum !== null && currentNum > targetNum) {
    throw new Error(
      `creezio upgrade: la marque est en ${currentArch}, PLUS RÉCENTE que le kit ` +
        `de ce CLI (${targetArch}) — mettre à jour le kit/CLI, jamais de downgrade.`,
    );
  }

  const chain = codemodChain(codemodsDir, currentArch, targetArch);
  const syncPlans = planCreezioManifestSync(brandRoot, targetSpec);
  const changedPlans = syncPlans.filter(creezioSyncPlanHasChanges);
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(brandRoot, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string>; creezio?: { architectureVersion?: string } };
  // Script de matérialisation : racine (proxy --prefix server) sinon server/.
  const materializeCwd = rootPkg.scripts?.["os-ui:materialize"]
    ? brandRoot
    : (() => {
        try {
          const srvPkg = JSON.parse(
            fs.readFileSync(path.join(brandRoot, "server/package.json"), "utf8"),
          ) as { scripts?: Record<string, string> };
          return srvPkg.scripts?.["os-ui:materialize"]
            ? path.join(brandRoot, "server")
            : null;
        } catch {
          return null;
        }
      })();
  const hasMaterialize = materializeCwd !== null;
  const hasNodeModules = fs.existsSync(path.join(brandRoot, "node_modules"));
  const needsStamp = rootPkg.creezio?.architectureVersion !== targetArch;

  // No-op = rien à migrer, NI à bumper, NI à ajouter. Le marqueur seul ne
  // déclenche pas d'écriture (une marque à jour sans marqueur reste no-op —
  // détection lock). Les deps hors SoT (extras) ne bloquent pas le no-op :
  // elles sont des warnings, pas des changements.
  const noop = chain.length === 0 && changedPlans.length === 0;

  if (args.dryRun) {
    log("  mode         : DRY-RUN (rien n'est écrit)");
    if (noop) {
      log(`✓ no-op — marque déjà en ${targetArch} / ${targetSpec}`);
      logExtrasWarnings(syncPlans, log);
      return;
    }
    if (chain.length) {
      log(`  codemods     : ${chain.length} pas (idempotence vérifiée à chaque pas)`);
      for (const run of chain) log(`    → ${run.version}/${run.script}`);
    } else {
      log("  codemods     : aucun (architecture déjà à la cible)");
    }
    if (changedPlans.length) {
      log(`  manifests    : ${changedPlans.length} à synchroniser (puis lockfiles --package-lock-only)`);
      for (const plan of changedPlans) {
        const nBump = Object.keys(plan.bumps).length;
        const addNames = Object.keys(plan.adds);
        const parts: string[] = [];
        if (nBump > 0) {
          const sample = Object.entries(plan.bumps)[0]!;
          parts.push(
            `${nBump} bumps, ex. ${sample[0]}: ${sample[1].from} → ${sample[1].to}`,
          );
        }
        if (addNames.length > 0) {
          parts.push(`${addNames.length} ajouts : ${addNames.join(", ")}`);
        }
        log(`    ~ ${plan.rel} (${parts.join(" ; ")})`);
      }
    } else {
      log("  manifests    : déjà synchronisés avec la SoT kit (aucun bump/ajout)");
    }
    logExtrasWarnings(syncPlans, log);
    if (needsStamp) {
      log(`  marqueur     : creezio.architectureVersion → ${targetArch} (package.json racine)`);
    }
    log(
      `  os-ui        : ${
        !hasMaterialize
          ? "pas de script os-ui:materialize (skip)"
          : args.noInstall
            ? "skip (--no-install)"
            : hasNodeModules
              ? "npm install + npm run os-ui:materialize"
              : "skip (node_modules absent — refait au prochain npm ci/prebuild)"
      }`,
    );
    log(
      `  doctor       : ${
        resolveBrandSpecDir(brandRoot)
          ? "brand-spec (échec si error)"
          : "pas de brand.yaml (repo admin) — skip explicite"
      }`,
    );
    return;
  }

  if (noop) {
    log(`✓ no-op — marque déjà en ${targetArch} / ${targetSpec}`);
    logExtrasWarnings(syncPlans, log);
    return;
  }

  // 1. Chaîne de codemods, idempotence prouvée à chaque pas.
  for (const run of chain) {
    log(`  codemod ${run.version}/${run.script}`);
    const first = runCodemodScript(codemodsDir, run, brandRoot);
    for (const rel of codemodChangedFiles(first)) log(`    ~ ${rel}`);
    const second = runCodemodScript(codemodsDir, run, brandRoot);
    const residue = codemodChangedFiles(second);
    if (residue.length > 0) {
      throw new Error(
        `codemod ${run.version}/${run.script} NON idempotent — le re-run a encore modifié : ` +
          `${residue.join(", ")}. Migration arrêtée (contrat scripts/codemods/README.md).`,
      );
    }
  }

  // 2. Sync des manifests (bumps + ajouts SoT) + lockfiles
  //    (--package-lock-only + locks secondaires).
  if (changedPlans.length) {
    for (const plan of changedPlans) {
      applyCreezioManifestSync(plan);
      const nBump = Object.keys(plan.bumps).length;
      const addNames = Object.keys(plan.adds);
      if (nBump > 0) {
        log(`  bump ${plan.rel} (${nBump} deps → ${targetSpec})`);
      }
      for (const name of addNames) {
        log(`  ajout ${name} → ${plan.adds[name]} (${plan.rel}) — requis par la SoT kit`);
      }
    }
    const { refreshed } = ensureBrandPackageLocks(brandRoot, {
      mode: "lock-only",
      log: (l) => log(`  lock ${l}`),
    });
    for (const rel of refreshed) log(`  lock régénéré : ${rel}`);
  }
  logExtrasWarnings(syncPlans, log);

  // 3. Marqueur d'architecture (source de détection des prochains upgrades).
  stampArchitectureVersion(brandRoot, targetArch);
  log(`  marqueur creezio.architectureVersion = ${targetArch}`);

  // 4. Rematérialisation os-ui (mécanisme existant de la marque).
  if (hasMaterialize && !args.noInstall) {
    if (hasNodeModules) {
      runNpm(["install", "--no-audit", "--no-fund"], brandRoot, log);
      runNpm(["run", "os-ui:materialize"], materializeCwd!, log);
    } else {
      log(
        "  os-ui : node_modules absent — matérialisation refaite au prochain npm ci/prebuild (skip explicite)",
      );
    }
  } else if (hasMaterialize) {
    log("  os-ui : skip (--no-install) — matérialisation au prochain build");
  }

  // 5. Doctor brand-spec (fail-closed). Les repos admin (admin-spec/, pas de
  // brand.yaml) n'ont pas de BrandSpec : skip explicite, jamais silencieux.
  if (resolveBrandSpecDir(brandRoot)) {
    const doctor = doctorAppBrandSpec(brandRoot);
    log(formatDoctorReport(doctor));
    if (!doctor.ok) {
      throw new Error(
        "creezio upgrade: doctor brand-spec en ERROR après migration — corriger avant commit",
      );
    }
  } else {
    log("  doctor : pas de brand.yaml (repo admin/app sans BrandSpec) — skip explicite");
  }

  log(`✓ upgrade terminé — ${currentArch ?? "?"} → ${targetArch}, deps ${targetSpec}`);
}
