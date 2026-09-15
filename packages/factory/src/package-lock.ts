/**
 * Cohérence package.json ↔ package-lock.json (requis par `npm ci` Docker).
 *
 * Mode npm (distribution npmjs.org) : la racine marque est le SoT —
 * `packages[""]` (orchestrateur) + `packages["server"]` (livrable serveur,
 * workspace). Locks autonomes pour les projets npm indépendants (server/ui,
 * client/). Plus de vendor ni de clôture file: à expanser.
 *
 * Régénération via `npm install --package-lock-only` (push) ou
 * `npm install` (build host). Sans `--link-kit`, interroge npmjs.org
 * (`@creezio/*` publics). Avec `--link-kit` / `CREEZIO_LINK_KIT=1`, les
 * `@creezio/*` sont pinés sur le worktree kit (`file:`) le temps de
 * l'install — les manifests restent `^<lockstep>`.
 *
 * Tout spawn npm est isolé au cwd cible (`spawnNpmAt`) : jamais de
 * prefix/workspace hérité du kit.
 */
import fs from "node:fs";
import path from "node:path";
import {
  creezioLinkKitFileSpecs,
  isLinkKitEnabled,
  resolveKitRoot,
} from "./kit-release.js";
import { spawnNpmAt } from "./npm-isolated.js";

export type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

type LockRoot = {
  packages?: Record<
    string,
    {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    }
  >;
  dependencies?: Record<string, { version?: string } | string>;
};

function declaredDeps(pkg: PkgJson): Record<string, string> {
  return {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };
}

function lockedEntryDeps(
  lock: LockRoot,
  lockKey: string,
): Record<string, string> | null {
  const entry = lock.packages?.[lockKey];
  if (entry) {
    return {
      ...(entry.dependencies || {}),
      ...(entry.devDependencies || {}),
      ...(entry.optionalDependencies || {}),
    };
  }
  // lockfileVersion 1 legacy (locks racine uniquement)
  if (lockKey === "" && lock.dependencies) {
    const out: Record<string, string> = {};
    for (const [name, meta] of Object.entries(lock.dependencies)) {
      if (typeof meta === "string") out[name] = meta;
      else if (meta?.version) out[name] = meta.version;
    }
    return out;
  }
  return null;
}

/**
 * True si le lock couvre exactement les deps déclarées (contrat npm ci).
 * lockKey "" = entrée racine ; "server" = membre du workspace racine (lock
 * racine SoT).
 */
export function isPackageLockInSync(
  packageJsonPath: string,
  lockPath = path.join(path.dirname(packageJsonPath), "package-lock.json"),
  lockKey = "",
): boolean {
  if (!fs.existsSync(packageJsonPath) || !fs.existsSync(lockPath)) return false;
  let pkg: PkgJson;
  let lock: LockRoot;
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PkgJson;
    lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as LockRoot;
  } catch {
    return false;
  }
  const declared = declaredDeps(pkg);
  const locked = lockedEntryDeps(lock, lockKey);
  if (!locked) return false;
  const dKeys = Object.keys(declared).sort();
  const lKeys = Object.keys(locked).sort();
  if (dKeys.length !== lKeys.length) return false;
  for (const k of dKeys) {
    if (locked[k] !== declared[k]) return false;
  }
  return true;
}

type LockTarget = {
  pkgPath: string;
  lockPath: string;
  lockKey: string;
  /** cwd de la régénération npm (workspace → racine). */
  cwd: string;
  rel: string;
};

/**
 * Cibles à garantir : racine (SoT) + membre server/ si monorepo (couvert
 * par le lock racine, entrée packages["server"]) + projets npm autonomes
 * (server/ui, client/) avec leur propre lock.
 */
function collectTargets(brandRoot: string): LockTarget[] {
  const monorepo = fs.existsSync(path.join(brandRoot, "server/package.json"));
  const rootPkg = path.join(brandRoot, "package.json");
  const rootLock = path.join(brandRoot, "package-lock.json");
  const targets: LockTarget[] = [
    { pkgPath: rootPkg, lockPath: rootLock, lockKey: "", cwd: brandRoot, rel: "." },
  ];
  if (monorepo) {
    targets.push({
      pkgPath: path.join(brandRoot, "server/package.json"),
      lockPath: rootLock,
      lockKey: "server",
      cwd: brandRoot, // regen workspace à la racine (jamais de lock server/)
      rel: "server",
    });
  }
  for (const sub of ["server/ui", "client"]) {
    const dir = path.join(brandRoot, sub);
    if (!fs.existsSync(path.join(dir, "package.json"))) continue;
    targets.push({
      pkgPath: path.join(dir, "package.json"),
      lockPath: path.join(dir, "package-lock.json"),
      lockKey: "",
      cwd: dir,
      rel: sub,
    });
  }
  return targets;
}

/**
 * Régénère les package-lock manquants / incohérents d'une marque.
 * @param mode `lock-only` = push GitHub (pas de node_modules) ;
 *             `install` = build Docker host (node_modules + lock).
 */
export function ensureBrandPackageLocks(
  brandRoot: string,
  opts?: {
    mode?: "lock-only" | "install";
    log?: (line: string) => void;
    /** Racine du kit (packages/*) — requis si link-kit. */
    kitRoot?: string;
    /** Pin `@creezio/*` sur le worktree (sinon env `CREEZIO_LINK_KIT`). */
    linkKit?: boolean;
    /** Env du spawn npm (défaut : process.env, isolé du prefix kit). */
    env?: NodeJS.ProcessEnv;
  },
): { refreshed: string[] } {
  const log = opts?.log || ((l: string) => console.log(l));
  const mode = opts?.mode || "lock-only";
  const linkKit = isLinkKitEnabled(opts?.linkKit);
  const restore = linkKit
    ? pinCreezioDepsToKitWorktree(brandRoot, opts?.kitRoot, log)
    : () => {};
  try {
    return refreshBrandPackageLocks(
      brandRoot,
      mode,
      log,
      linkKit,
      opts?.env ?? process.env,
    );
  } finally {
    restore();
  }
}

/**
 * Réécrit temporairement les `@creezio/*` des package.json en `file:<kit>`
 * + overrides (transitives). Restaure le contenu original à l'appel du
 * retour — les manifests committables restent `^<lockstep>`.
 */
export function pinCreezioDepsToKitWorktree(
  brandRoot: string,
  kitRoot: string | undefined,
  log: (line: string) => void,
): () => void {
  const root = resolveKitRoot(kitRoot);
  const fileSpecs = creezioLinkKitFileSpecs(root);
  if (!Object.keys(fileSpecs).length) {
    throw new Error(
      `link-kit : aucun package @creezio/* sous ${path.join(root, "packages")} — ` +
        "poser CREEZIO_KIT_ROOT ou lancer le CLI depuis le clone kit",
    );
  }
  const backups: Array<{ pkgPath: string; original: string }> = [];
  const seen = new Set<string>();
  for (const target of collectTargets(brandRoot)) {
    if (seen.has(target.pkgPath) || !fs.existsSync(target.pkgPath)) continue;
    seen.add(target.pkgPath);
    const original = fs.readFileSync(target.pkgPath, "utf8");
    let pkg: PkgJson & { overrides?: Record<string, string> };
    try {
      pkg = JSON.parse(original) as PkgJson & {
        overrides?: Record<string, string>;
      };
    } catch {
      continue;
    }
    backups.push({ pkgPath: target.pkgPath, original });
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ] as const) {
      const deps = pkg[field];
      if (!deps) continue;
      for (const name of Object.keys(deps)) {
        if (fileSpecs[name]) deps[name] = fileSpecs[name];
      }
    }
    pkg.overrides = { ...pkg.overrides, ...fileSpecs };
    fs.writeFileSync(target.pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }
  log(
    `link-kit : ${Object.keys(fileSpecs).length} @creezio/* → file:${path.join(root, "packages")}/*`,
  );
  return () => {
    for (const b of backups) {
      fs.writeFileSync(b.pkgPath, b.original);
    }
  };
}

function refreshBrandPackageLocks(
  brandRoot: string,
  mode: "lock-only" | "install",
  log: (line: string) => void,
  linkKit: boolean,
  env: NodeJS.ProcessEnv,
): { refreshed: string[] } {
  const refreshed: string[] = [];
  for (const target of collectTargets(brandRoot)) {
    if (isPackageLockInSync(target.pkgPath, target.lockPath, target.lockKey)) {
      continue;
    }
    log(
      `package-lock manquant/incohérent (${target.rel}) — npm ${mode === "install" ? "install" : "install --package-lock-only"}…`,
    );
    const args =
      mode === "install"
        ? ["install", "--no-audit", "--no-fund"]
        : [
            "install",
            "--package-lock-only",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
          ];
    const r = spawnNpmAt(target.cwd, args, { stdio: "inherit", env });
    if (r.status !== 0) {
      throw new Error(
        `npm ${args.join(" ")} exit ${r.status ?? "?"} dans ${target.rel} — ` +
          (linkKit
            ? "lock impossible en --link-kit (worktree kit ou deps publiques injoignables)"
            : "lock impossible (deps @creezio/* injoignables — npmjs.org, ou --link-kit)"),
      );
    }
    if (!isPackageLockInSync(target.pkgPath, target.lockPath, target.lockKey)) {
      throw new Error(
        `package-lock toujours incohérent après npm dans ${target.rel} (deps package.json ≠ lock)`,
      );
    }
    refreshed.push(target.rel);
  }
  return { refreshed };
}
