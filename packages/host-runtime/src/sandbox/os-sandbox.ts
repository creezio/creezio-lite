/**
 * Politique « OS desktop Creezio » — périmètre d'exécution strict.
 *
 * Principe : un build packagé ne doit JAMAIS résoudre un binaire via le PATH
 * utilisateur, ni accepter un override d'environnement pointant hors du
 * sandbox. Les seuls exécutables légitimes sont :
 *   - ceux packagés sous `process.resourcesPath` (Node, Meili, git, cloudflared…)
 *   - ceux installés par desktop sous `{userData}` (venv Hermes, npm-cli…)
 *   - les utilitaires système FONDAMENTAUX de l'OS, résolus par CHEMIN ABSOLU
 *     connu (jamais par nom sur le PATH) : PowerShell, tar, cmd, bash.
 *
 * Aucun import Electron ici : module pur, testable depuis Node.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Les overrides `{PREFIX}_*_BIN`, `HERMES_BIN`, `TF2_USER_DATA_OVERRIDE`, etc. ne sont
 * honorés qu'en build NON packagé (dev / CI / tests). En prod ils sont ignorés :
 * un malware ou un raccourci piégé ne doit pas pouvoir détourner un spawn.
 */
export function overridesAllowed(isPackaged: boolean): boolean {
  return !isPackaged;
}

/**
 * Répertoires système où un binaire OS fondamental est acceptable, par nom.
 * Retourne le premier chemin absolu existant, ou null.
 */
export function resolveSystemBinary(
  name:
    | "powershell"
    | "cmd"
    | "tar"
    | "bash"
    | "taskkill",
  opts?: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    existsSync?: (p: string) => boolean;
  },
): string | null {
  const platform = opts?.platform || process.platform;
  const env = opts?.env || process.env;
  const exists = opts?.existsSync || fs.existsSync;

  if (platform === "win32") {
    const sysRoot = (env.SystemRoot || env.windir || "C:\\Windows").replace(
      /[\\/]+$/,
      "",
    );
    const sys32 = path.win32.join(sysRoot, "System32");
    const candidates: Record<string, string[]> = {
      powershell: [
        path.win32.join(
          sys32,
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
      ],
      cmd: [path.win32.join(sys32, "cmd.exe")],
      // tar.exe (bsdtar) livré avec Windows 10 build 17063+.
      tar: [path.win32.join(sys32, "tar.exe")],
      taskkill: [path.win32.join(sys32, "taskkill.exe")],
      // Git bash (rare) — resources MinGit géré ailleurs ; pas de fallback OS.
      bash: [],
    };
    for (const c of candidates[name] || []) {
      if (exists(c)) return c;
    }
    return null;
  }

  // POSIX (dev Linux / mac lab) : chemins standards.
  const posix: Record<string, string[]> = {
    bash: ["/bin/bash", "/usr/bin/bash"],
    tar: ["/bin/tar", "/usr/bin/tar"],
    cmd: [],
    powershell: [],
    taskkill: [],
  };
  for (const c of posix[name] || []) {
    if (exists(c)) return c;
  }
  return null;
}

/**
 * PATH minimal pour un process enfant confiné : uniquement les dossiers
 * desktop (Node, binaires runtime) + le System32 de l'OS (pour que les
 * utilitaires fondamentaux résolus en absolu trouvent leurs DLL). JAMAIS le
 * PATH utilisateur complet — pas de résolution d'outils tiers installés.
 */
export function buildConfinedPath(opts: {
  platform: NodeJS.Platform;
  /** Dossiers desktop à mettre en tête (Node, venv, npm…). */
  toolDirs: string[];
  env?: NodeJS.ProcessEnv;
}): string {
  const env = opts.env || {};
  const sep = opts.platform === "win32" ? ";" : ":";
  const dirs = [...opts.toolDirs];

  if (opts.platform === "win32") {
    const sysRoot = (env.SystemRoot || env.windir || "C:\\Windows").replace(
      /[\\/]+$/,
      "",
    );
    dirs.push(
      path.win32.join(sysRoot, "System32"),
      sysRoot,
      path.win32.join(sysRoot, "System32", "Wbem"),
      path.win32.join(sysRoot, "System32", "WindowsPowerShell", "v1.0"),
    );
  } else {
    // Minimal POSIX : chemins système de base, pas ~/.local/bin ni brew.
    dirs.push("/usr/bin", "/bin");
  }

  // Dédup en conservant l'ordre.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of dirs) {
    if (!d) continue;
    const norm = d;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out.join(sep);
}
