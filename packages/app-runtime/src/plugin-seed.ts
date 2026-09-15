/**
 * Seed des plugins embarqués par la marque — install au boot (P5).
 *
 * Convention kit : une marque peut livrer des plugins prêts à l'emploi dans
 * son repo (`<appRoot>/plugins/<id>/` avec `manifest.json`). Au boot
 * (harness serveur ET desktop), chaque plugin absent du répertoire runtime
 * (`pluginsRootDir(userDataDir)`) y est copié et activé (`.enabled`).
 *
 * Idempotent et non destructif : un plugin déjà installé n'est JAMAIS
 * écrasé (les itérations passent par le control plane / versioning git),
 * et un plugin désactivé par l'utilisateur n'est pas réactivé.
 */

import fs from "node:fs";
import path from "node:path";

export type SeedPluginsResult = {
  seeded: string[];
  skipped: string[];
};

/** Entrées runtime à ne jamais copier depuis une source de seed. */
const SKIP_ENTRIES = new Set([
  ".git",
  "data",
  "home",
  "os-home",
  "node_modules",
  ".enabled",
]);

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_ENTRIES.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

export function seedPluginsFromDirs(opts: {
  /** Répertoires source (ex. `<appRoot>/plugins`) — inexistants ignorés. */
  seedDirs: readonly string[];
  /** Répertoire plugins runtime (`pluginsRootDir(userDataDir)`). */
  pluginsRoot: string;
  log?: (line: string) => void;
}): SeedPluginsResult {
  const seeded: string[] = [];
  const skipped: string[] = [];
  for (const seedDir of opts.seedDirs) {
    if (!seedDir || !fs.existsSync(seedDir)) continue;
    for (const entry of fs.readdirSync(seedDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const src = path.join(seedDir, entry.name);
      if (!fs.existsSync(path.join(src, "manifest.json"))) continue;
      const dest = path.join(opts.pluginsRoot, entry.name);
      if (fs.existsSync(path.join(dest, "manifest.json"))) {
        skipped.push(entry.name);
        continue;
      }
      try {
        copyDir(src, dest);
        // Activé à la PREMIÈRE install uniquement (respecte un disable user).
        fs.writeFileSync(path.join(dest, ".enabled"), "1\n");
        seeded.push(entry.name);
        opts.log?.(`plugin marque installé au boot: ${entry.name}`);
      } catch (e) {
        opts.log?.(
          `seed plugin ${entry.name} échoué: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
  }
  return { seeded, skipped };
}
