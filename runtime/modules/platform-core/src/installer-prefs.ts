/**
 * Préférences écrites par l'installeur NSIS (`installer-prefs.json` sous userData).
 * Consommées une seule fois au boot packagé pour synchroniser
 * `launchAtStartup` avec local-config marque + setLoginItemSettings.
 *
 * Module pur (pas d'import Electron) — testable depuis Node.
 */

import fs from "node:fs";
import path from "node:path";

export const INSTALLER_PREFS_FILENAME = "installer-prefs.json";

export type InstallerPrefs = {
  launchAtStartup?: boolean;
  createDesktopShortcut?: boolean;
};

export function installerPrefsPath(userDataRoot: string): string {
  return path.join(userDataRoot, INSTALLER_PREFS_FILENAME);
}

/** Parse tolérant — JSON invalide / objet vide → null. */
export function parseInstallerPrefs(raw: string): InstallerPrefs | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    const out: InstallerPrefs = {};
    if (typeof o.launchAtStartup === "boolean") {
      out.launchAtStartup = o.launchAtStartup;
    }
    if (typeof o.createDesktopShortcut === "boolean") {
      out.createDesktopShortcut = o.createDesktopShortcut;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Lit puis supprime `installer-prefs.json` (one-shot).
 * Fichier absent / illisible → null. Jamais bloquant.
 */
export function consumeInstallerPrefsFile(
  userDataRoot: string,
): InstallerPrefs | null {
  const prefsPath = installerPrefsPath(userDataRoot);
  let raw: string;
  try {
    if (!fs.existsSync(prefsPath)) return null;
    raw = fs.readFileSync(prefsPath, "utf8");
  } catch {
    return null;
  }

  const prefs = parseInstallerPrefs(raw);

  try {
    fs.unlinkSync(prefsPath);
  } catch {
    /* best-effort */
  }

  return prefs;
}
