/**
 * Résout la marque sonde TempoFlow3 hors monorepo kit.
 *
 * Layout nominal : 2 repos — monorepo marque (`server/`, `client/`) + repo
 * admin dédié `<brand>-admin`. Le layout plat historique (src/electron à la
 * racine) reste détecté.
 *
 * Ordre candidats :
 * 1. CREEZIO_TEMPOFLOW3_ROOT
 * 2. apps/tempoflow3 (legacy — ne doit plus exister sur main)
 * 3. ../tempoflow3 (sibling clone, ex. /opt/docker/tempoflow3)
 * 4. /opt/docker/tempoflow3
 */
import fs from "node:fs";
import path from "node:path";

function candidateRoots(kitRoot) {
  return [
    process.env.CREEZIO_TEMPOFLOW3_ROOT,
    path.join(kitRoot, "apps/tempoflow3"),
    path.resolve(kitRoot, "../tempoflow3"),
    "/opt/docker/tempoflow3",
  ].filter(Boolean);
}

function hasElectronSrc(dir) {
  return (
    fs.existsSync(path.join(dir, "src/electron/brand-migrations.ts")) ||
    fs.existsSync(path.join(dir, "src/electron/main.ts"))
  );
}

/**
 * Racine du repo marque (là où vivent brand-spec/, docker-data/, package.json
 * orchestrateur).
 *
 * @param {string} kitRoot
 * @returns {string|null}
 */
export function resolveProbeBrandRoot(kitRoot) {
  for (const candidate of candidateRoots(kitRoot)) {
    const root = path.resolve(candidate);
    if (hasElectronSrc(path.join(root, "server")) || hasElectronSrc(root)) {
      return root;
    }
  }
  return null;
}

/**
 * Livrable serveur : dossier contenant src/electron métier, build/electron
 * et les scripts npm (build:electron, proof:*…). `<root>/server` en layout
 * monorepo, `<root>` en layout plat legacy.
 *
 * @param {string} kitRoot
 * @returns {string|null}
 */
export function resolveProbeBrandServerDir(kitRoot) {
  const root = resolveProbeBrandRoot(kitRoot);
  if (!root) return null;
  const server = path.join(root, "server");
  return hasElectronSrc(server) ? server : root;
}

export function probeBrandPresent(kitRoot) {
  const server = resolveProbeBrandServerDir(kitRoot);
  return Boolean(
    server &&
      fs.existsSync(path.join(server, "src/electron/brand-migrations.ts")),
  );
}
