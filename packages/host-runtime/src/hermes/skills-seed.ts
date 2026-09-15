/**
 * Seed des skills Hermes vers `{HERMES_HOME}/skills/` (parité gold
 * hermes-skills-seed première marque) — générique kit.
 *
 * Sources (dans l'ordre, les dernières écrasent les premières) :
 * 1. Skills génériques kit : `@creezio/host-runtime/resources/vendor/hermes-skills`
 *    (creezio-n8n, creezio-plugins…).
 * 2. Skills marque : `{resourcesRoot}/vendor/hermes-skills` (packagé) ou
 *    `{appRoot}/vendor/hermes-skills` (dev/harness).
 *
 * Idempotent : écrase les skills seedés (source of truth = vendor), préserve
 * les skills tiers installés par l'utilisateur.
 */

import fs from "node:fs";
import path from "node:path";
import { kitOsResourcesRoot } from "@creezio/platform-core";

/** Dossier des skills génériques shippés par le kit. */
export function kitHermesSkillsDir(): string {
  return path.join(kitOsResourcesRoot(), "vendor", "hermes-skills");
}

/**
 * H3 « Hermes cerveau unique » — namespace RÉSERVÉ aux skills APPRIS par
 * Hermes (skills de sites fournisseurs auto-entretenus, format
 * `creezio-site-skills`). Jamais shippés par un vendor : le seed les
 * REFUSE, garantissant qu'un `site-*` installé par Hermes survit aux boots
 * (le seed écrase les skills vendored, préserve le reste).
 */
export const LEARNED_SITE_SKILL_PREFIX = "site-";

/** True si le nom appartient au namespace réservé des skills appris. */
export function isLearnedSiteSkillName(name: string): boolean {
  return String(name || "")
    .toLowerCase()
    .startsWith(LEARNED_SITE_SKILL_PREFIX);
}

/**
 * Dossiers skills marque candidats pour un resourcesRoot donné (packagé ou
 * layout dev `{appRoot}/resources`).
 */
export function brandHermesSkillsDirCandidates(
  resourcesRoot: string,
): string[] {
  return [
    path.join(resourcesRoot, "vendor", "hermes-skills"),
    path.join(resourcesRoot, "..", "vendor", "hermes-skills"),
  ];
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDirRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

/**
 * Copie chaque skill (`<dir>/<name>/SKILL.md`) vers `{hermesHome}/skills/<name>`.
 * Retourne les noms seedés (dédupliqués, dernier gagnant).
 */
export function seedHermesSkillsFromDirs(opts: {
  hermesHome: string;
  dirs: string[];
  log?: (line: string) => void;
}): string[] {
  const log = opts.log || (() => undefined);
  const destRoot = path.join(opts.hermesHome, "skills");
  const seeded = new Set<string>();
  for (const dir of opts.dirs) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // dossier absent — marque sans skills, pas une erreur
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (isLearnedSiteSkillName(ent.name)) {
        // Namespace réservé aux skills appris — un vendor ne doit jamais
        // écraser un skill site entretenu par Hermes.
        log(
          `skills: refus seed ${ent.name} (namespace ${LEARNED_SITE_SKILL_PREFIX}* réservé aux skills appris)`,
        );
        continue;
      }
      const src = path.join(dir, ent.name);
      if (!fs.existsSync(path.join(src, "SKILL.md"))) {
        log(`skills: skip ${ent.name} (SKILL.md manquant)`);
        continue;
      }
      try {
        copyDirRecursive(src, path.join(destRoot, ent.name));
        seeded.add(ent.name);
      } catch (e) {
        log(
          `skills: échec seed ${ent.name} (${e instanceof Error ? e.message : e})`,
        );
      }
    }
  }
  if (seeded.size) {
    log(`skills: seed ${[...seeded].join(", ")} → ${destRoot}`);
  }
  return [...seeded];
}
