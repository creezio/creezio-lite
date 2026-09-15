#!/usr/bin/env node
/**
 * Pré-flight Docker marque (mode npm) — garantit les package-lock alignés
 * sur les package.json AVANT `docker build` / `npm ci` :
 *   - layout monorepo : lock RACINE (workspace npm — SoT, couvre server/)
 *     + locks autonomes server/ui et client/ (projets npm indépendants) ;
 *   - layout plat legacy : lock racine seul.
 *
 * Plus de vendor : les deps @creezio/* sont des versions npm publiées sur
 * GitHub Packages (`^0.4.0`, …). La régénération (`npm install
 * --package-lock-only`) interroge le registre → CREEZIO_NPM_TOKEN doit être
 * exporté (le .npmrc commité référence ${CREEZIO_NPM_TOKEN}, jamais de
 * token en clair).
 *
 * SoT kit : `docker/server/ensure-server-lock.mjs` — matérialisé en marque
 * `scripts/ensure-server-lock.mjs` (scaffold factory). Ne pas éditer la
 * copie marque : elle est rafraîchie.
 *
 * Usage (racine marque) :
 *   node scripts/ensure-server-lock.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const brandRoot = path.resolve(
  process.env.CREEZIO_APP_ROOT ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
);

function declaredDeps(pkg) {
  return {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };
}

/** Deps enregistrées dans le lock pour une entrée packages[<lockKey>]. */
function lockedEntryDeps(lock, lockKey) {
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
    const out = {};
    for (const [name, meta] of Object.entries(lock.dependencies)) {
      out[name] = typeof meta === "string" ? meta : meta?.version;
    }
    return out;
  }
  return null;
}

/** pkgPath cohérent avec packages[lockKey] du lockPath (contrat npm ci). */
function isInSync(pkgPath, lockPath, lockKey) {
  if (!fs.existsSync(pkgPath) || !fs.existsSync(lockPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
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
  } catch {
    return false;
  }
}

/**
 * Cibles à garantir : { pkgPath, lockPath, lockKey, cwd (regen), rel }.
 * Monorepo : server/package.json est couvert par le lock RACINE (entrée
 * packages["server"]) — la régénération se fait à la racine (workspace).
 */
function collectTargets(root) {
  const monorepo = fs.existsSync(path.join(root, "server/package.json"));
  const rootPkg = path.join(root, "package.json");
  const rootLock = path.join(root, "package-lock.json");
  const targets = [
    {
      pkgPath: rootPkg,
      lockPath: rootLock,
      lockKey: "",
      cwd: root,
      rel: ".",
    },
  ];
  if (monorepo) {
    targets.push({
      pkgPath: path.join(root, "server/package.json"),
      lockPath: rootLock,
      lockKey: "server",
      cwd: root, // regen workspace à la racine (jamais de lock server/)
      rel: "server",
    });
  }
  for (const sub of ["server/ui", "client"]) {
    const dir = path.join(root, sub);
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

function npmRegenLock(target) {
  console.log(
    `ensure-server-lock: package-lock manquant/incohérent (${target.rel}) — npm install --package-lock-only…`,
  );
  const r = spawnSync(
    "npm",
    [
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: target.cwd, stdio: "inherit", env: process.env },
  );
  if (r.status !== 0) {
    console.error(
      `ensure-server-lock: échec npm dans ${target.rel} (exit ${r.status ?? "?"})\n` +
        "  deps @creezio/* privées → exporter CREEZIO_NPM_TOKEN (read:packages).",
    );
    process.exit(r.status ?? 1);
  }
}

let refreshed = 0;
for (const target of collectTargets(brandRoot)) {
  if (isInSync(target.pkgPath, target.lockPath, target.lockKey)) continue;
  npmRegenLock(target);
  if (!isInSync(target.pkgPath, target.lockPath, target.lockKey)) {
    console.error(
      `ensure-server-lock: lock toujours incohérent (${target.rel}) après npm`,
    );
    process.exit(1);
  }
  refreshed++;
}

if (refreshed === 0) {
  console.log("ensure-server-lock: package-lock OK");
} else {
  console.log(`ensure-server-lock: ${refreshed} lock(s) régénéré(s)`);
}