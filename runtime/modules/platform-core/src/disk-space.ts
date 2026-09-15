/**
 * Détection espace disque insuffisant (npm install n8n, cache userData).
 * Testable sans I/O réseau.
 */

import fs from "node:fs";
import path from "node:path";

/** Exit code npm Windows quand ENOSPC (-4055 signé → uint32). */
export const WINDOWS_NPM_ENOSPC_EXIT = 4294963241;

/** Seuil prudent avant `npm install n8n@pin` (~plusieurs Go d’arbre npm). */
export const N8N_INSTALL_MIN_FREE_BYTES = 3 * 1024 * 1024 * 1024;

export function isDiskSpaceError(opts: {
  code?: number | null;
  text?: string;
}): boolean {
  const t = String(opts.text || "").toLowerCase();
  if (
    /enospc|no space left|disk space|not enough space|insufficient storage|espace disque|espace.*insuffisant|try again.*disk/i.test(
      t,
    )
  ) {
    return true;
  }
  const code = opts.code;
  if (code == null) return false;
  if (code === WINDOWS_NPM_ENOSPC_EXIT) return true;
  const signed = code > 0x7fffffff ? code - 0x100000000 : code;
  return signed === -4055 || signed === -28 || signed === -112;
}

export function formatBytesFr(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} Go`;
  const mb = bytes / (1024 * 1024);
  return `${Math.max(1, Math.round(mb))} Mo`;
}

export function formatN8nDiskSpaceError(userDataPath: string, opts?: {
  freeBytes?: number | null;
  cleaned?: string[];
  productName?: string;
}): string {
  const product = opts?.productName || "l'application";
  const lines = [
    "Espace disque insuffisant pour installer n8n (automatisations).",
    "",
    `${product} a besoin de plusieurs Go libres sur le lecteur où sont stockées les données de l'application.`,
    "",
    `Dossier des données : ${userDataPath}`,
  ];
  if (typeof opts?.freeBytes === "number" && Number.isFinite(opts.freeBytes)) {
    lines.push(
      `Espace libre détecté : ${formatBytesFr(opts.freeBytes)} (minimum recommandé : ${formatBytesFr(N8N_INSTALL_MIN_FREE_BYTES)}).`,
    );
  }
  lines.push(
    "",
    "Actions recommandées :",
    "• Libérez au moins 4–5 Go (corbeille, fichiers temporaires, anciennes sauvegardes).",
    "• Vérifiez l’espace sur le disque système (souvent C:) si les données sont sous AppData.",
  );
  if (opts?.cleaned?.length) {
    lines.push(
      "",
      "Nettoyage partiel effectué (fichiers d’installation incomplets / cache npm) :",
      ...opts.cleaned.map((p) => `• ${p}`),
      "",
      "Libérez de l’espace puis cliquez sur Réessayer.",
    );
  } else {
    lines.push("", "Libérez de l’espace puis cliquez sur Réessayer.");
  }
  return lines.join("\n");
}

export function getFreeDiskBytes(
  targetDir: string,
  statfsSync: (p: string) => { bfree: number; bsize: number } = fs.statfsSync,
): number | null {
  try {
    const dir = path.resolve(targetDir);
    fs.mkdirSync(dir, { recursive: true });
    const st = statfsSync(dir);
    if (!st || !Number.isFinite(st.bfree) || !Number.isFinite(st.bsize)) return null;
    return st.bfree * st.bsize;
  } catch {
    return null;
  }
}

/** Best-effort : récupère de l’espace après un npm install interrompu. */
export function cleanupN8nInstallArtifacts(
  userData: string,
  opts?: {
    npmCacheSegment?: string;
    rmSync?: (p: string, o: fs.RmOptions) => void;
    existsSync?: (p: string) => boolean;
  },
): string[] {
  const rmSync = opts?.rmSync ?? fs.rmSync;
  const existsSync = opts?.existsSync ?? fs.existsSync;
  const npmSeg = opts?.npmCacheSegment ?? "desktop-npm";
  const removed: string[] = [];
  const targets = [
    path.join(userData, "n8n-runtime", "node_modules"),
    path.join(userData, "n8n-runtime", "package-lock.json"),
    path.join(userData, npmSeg, "cache"),
  ];
  for (const t of targets) {
    if (!existsSync(t)) continue;
    try {
      rmSync(t, { recursive: true, force: true });
      removed.push(t);
    } catch {
      /* ignore */
    }
  }
  return removed;
}

export function diskSpacePreflightMessage(
  userDataPath: string,
  freeBytes: number | null,
): string | null {
  if (freeBytes == null) return null;
  if (freeBytes >= N8N_INSTALL_MIN_FREE_BYTES) return null;
  return formatN8nDiskSpaceError(userDataPath, { freeBytes });
}
