/**
 * Templates de plugins kit (`templates/plugins/<id>/`) — 100 % génériques
 * (zéro métier marque, ADR-no-brand-domain-in-native-packages).
 *
 * `installKitPluginTemplate` copie un template dans le répertoire plugins
 * d'une app (convention host : `<userData>/plugins/<id>/` + `.enabled`).
 * Utilisé par les gates (sandbox demobrand) et disponible pour les marques.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Racine `templates/plugins` du package (dist/ → ../templates/plugins). */
export function kitPluginTemplatesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "templates", "plugins");
}

export function listKitPluginTemplates(): string[] {
  const dir = kitPluginTemplatesDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        fs.existsSync(path.join(dir, d.name, "manifest.json")),
    )
    .map((d) => d.name)
    .sort();
}

export type InstallKitPluginTemplateResult = {
  pluginId: string;
  dir: string;
  files: string[];
  created: boolean;
};

/** Entrées runtime à ne jamais copier depuis un template. */
const SKIP_ENTRIES = new Set([".git", "data", "home", "os-home", ".enabled"]);

function copyDir(src: string, dest: string, rel: string, files: string[]): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_ENTRIES.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      copyDir(from, to, relPath, files);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
      files.push(relPath);
    }
  }
}

export function installKitPluginTemplate(opts: {
  /** Id du template sous `templates/plugins/` (= id plugin). */
  templateId: string;
  /** Répertoire plugins de l'app (`pluginsRootDir(userDataDir)`). */
  pluginsDir: string;
  /** Activer le plugin (`.enabled`) — défaut true. */
  enable?: boolean;
  /** Écraser une installation existante — défaut false (idempotent). */
  force?: boolean;
}): InstallKitPluginTemplateResult {
  const src = path.join(kitPluginTemplatesDir(), opts.templateId);
  if (!fs.existsSync(path.join(src, "manifest.json"))) {
    throw new Error(`template plugin inconnu: ${opts.templateId}`);
  }
  const dest = path.join(opts.pluginsDir, opts.templateId);
  const existed = fs.existsSync(path.join(dest, "manifest.json"));
  const files: string[] = [];
  if (!existed || opts.force) {
    copyDir(src, dest, "", files);
  }
  if (opts.enable !== false) {
    fs.writeFileSync(path.join(dest, ".enabled"), "1\n");
  }
  return {
    pluginId: opts.templateId,
    dir: dest,
    files,
    created: !existed,
  };
}
