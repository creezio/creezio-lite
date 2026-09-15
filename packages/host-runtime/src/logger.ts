/**
 * Logger process principal — paramétré par logBasename (manifest).
 * Port de electron/logger.ts (historique), sans hardcode.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_LOG_BYTES = 8 * 1024 * 1024;
const ARCHIVE_KEEP = 10;
const ARCHIVE_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
/** Ring large : un splash n8n génère facilement >400 lignes (migrations…). */
const RING_SIZE = 2500;

let logDir: string | null = null;
let logFile: string | null = null;
let logBasename = "creezio-main";
const ring: string[] = [];

/**
 * Hook boîte noire : consomme les lignes événement des sous-process.
 * Renvoie true si la ligne a été consommée (pas de log texte).
 */
let opsLineHandler: ((scope: string, line: string) => boolean) | null = null;

export function setOpsLineHandler(
  handler: ((scope: string, line: string) => boolean) | null,
): void {
  opsLineHandler = handler;
}

/** Crée `userData/logs/` immédiatement (premier lancement / avant initLogger). */
export function ensureLogsDir(userDataDir: string): string {
  const dir = path.join(userDataDir, "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export type EarlyBootLogSource = "userData" | "exe" | "tmpdir";

export type EarlyBootLogResult = {
  logDir: string;
  logFile: string;
  source: EarlyBootLogSource;
};

/**
 * Logger ultra-early (avant prepareDesktopBoot / userData server).
 * Essaye userData → dossier `early-logs` à côté de l’exe → tmpdir.
 * Écrit la 1ʳᵉ ligne de façon synchrone (utile si crash preload/native ensuite).
 */
export function initEarlyBootLogger(opts: {
  basename?: string;
  userDataDir?: string | null;
  /** Défaut : process.execPath */
  exePath?: string;
}): EarlyBootLogResult {
  const basename = opts.basename || logBasename || "creezio-main";
  logBasename = basename;
  const exePath = opts.exePath || process.execPath;
  const candidates: { dir: string; source: EarlyBootLogSource }[] = [];
  if (opts.userDataDir) {
    candidates.push({
      dir: path.join(opts.userDataDir, "logs"),
      source: "userData",
    });
  }
  candidates.push({
    dir: path.join(path.dirname(exePath), "early-logs"),
    source: "exe",
  });
  candidates.push({
    dir: path.join(os.tmpdir(), `creezio-early-${basename}`),
    source: "tmpdir",
  });

  for (const c of candidates) {
    try {
      fs.mkdirSync(c.dir, { recursive: true });
      const file = path.join(c.dir, `${basename}.log`);
      const line = `${new Date().toISOString()} [early] --- démarrage early source=${c.source} ---`;
      fs.appendFileSync(file, `${line}\n`, "utf8");
      logDir = c.dir;
      logFile = file;
      ring.push(line);
      if (ring.length > RING_SIZE) ring.shift();
      try {
        console.log(line);
      } catch {
        /* ignore */
      }
      return { logDir: c.dir, logFile: file, source: c.source };
    } catch {
      /* essai suivant */
    }
  }
  return { logDir: "", logFile: "", source: "tmpdir" };
}

/** À appeler tôt (après app.whenReady) avec le dossier userData. */
export function initLogger(
  userDataDir: string,
  basename = "creezio-main",
): void {
  try {
    logBasename = basename;
    logDir = ensureLogsDir(userDataDir);
    logFile = path.join(logDir, `${logBasename}.log`);
    archivePreviousBootLog();
    log("logger", `--- démarrage ${new Date().toISOString()} ---`);
  } catch {
    logFile = null;
  }
}

export function logFilePath(): string | null {
  return logFile;
}

/** Archive le log du boot précédent puis purge les archives anciennes. */
function archivePreviousBootLog(): void {
  if (!logFile || !logDir) return;
  try {
    const st = fs.statSync(logFile);
    if (st.size > 0) {
      const stamp = new Date(st.mtimeMs).toISOString().replace(/[:.]/g, "-");
      fs.renameSync(
        logFile,
        path.join(logDir, `${logBasename}-${stamp}.log`),
      );
    }
  } catch {
    /* premier lancement */
  }
  try {
    const old = `${logFile}.old`;
    if (fs.existsSync(old)) {
      const st = fs.statSync(old);
      const stamp = new Date(st.mtimeMs).toISOString().replace(/[:.]/g, "-");
      fs.renameSync(old, path.join(logDir, `${logBasename}-${stamp}.log`));
    }
  } catch {
    /* ignore */
  }
  pruneArchives();
}

function pruneArchives(): void {
  if (!logDir) return;
  try {
    const archives = fs
      .readdirSync(logDir)
      .filter(
        (f) => f.startsWith(`${logBasename}-`) && f.endsWith(".log"),
      )
      .map((f) => {
        const full = path.join(logDir!, f);
        try {
          const st = fs.statSync(full);
          return { full, mtime: st.mtimeMs, size: st.size };
        } catch {
          return { full, mtime: 0, size: 0 };
        }
      })
      .sort((a, b) => b.mtime - a.mtime);
    let total = 0;
    archives.forEach((f, i) => {
      total += f.size;
      if (i >= ARCHIVE_KEEP || total > ARCHIVE_MAX_TOTAL_BYTES) {
        try {
          fs.unlinkSync(f.full);
        } catch {
          /* best-effort */
        }
      }
    });
  } catch {
    /* best-effort */
  }
}

/** Rotation en cours de boot (log courant anormalement gros). */
function rotateIfNeeded(): void {
  if (!logFile || !logDir) return;
  try {
    const st = fs.statSync(logFile);
    if (st.size > MAX_LOG_BYTES) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.renameSync(
        logFile,
        path.join(logDir, `${logBasename}-${stamp}.log`),
      );
      pruneArchives();
    }
  } catch {
    /* fichier absent */
  }
}

/** Ligne de log horodatée, écrite fichier + ring + console. */
export function log(scope: string, message: string): void {
  const entry = `${new Date().toISOString()} [${scope}] ${message}`;
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
  try {
    console.log(entry);
  } catch {
    /* ignore */
  }
  if (logFile) {
    try {
      rotateIfNeeded();
      fs.appendFileSync(logFile, `${entry}\n`, "utf8");
    } catch {
      /* disque plein / permissions : on garde au moins le ring */
    }
  }
}

export function logError(scope: string, err: unknown): void {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  log(scope, `ERREUR: ${msg}`);
}

/** Dernières lignes de log (jointes aux rapports de crash). */
export function recentLines(n = 120): string[] {
  return ring.slice(-n);
}

/** Alias — anneau complet. */
export function getLogRing(): string[] {
  return [...ring];
}

/** Queue du fichier de log (splash long) — complément au ring mémoire. */
export function logFileTail(maxBytes = 120_000): string | null {
  if (!logFile) return null;
  try {
    const st = fs.statSync(logFile);
    if (st.size <= 0) return "";
    const start = Math.max(0, st.size - maxBytes);
    const len = st.size - start;
    const fd = fs.openSync(logFile, "r");
    try {
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      return buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * Fabrique un logger scellé sur un scope (pour les callbacks onLog).
 * Les lignes événement des sous-process sont routées vers la boîte noire.
 */
export function scoped(scope: string): (line: string) => void {
  return (line: string) => {
    try {
      if (opsLineHandler?.(scope, line)) return;
    } catch {
      /* le hook ne doit jamais bloquer le log */
    }
    log(scope, line);
  };
}

/** Route les lignes événement structurées des sous-process (si handler ops). */
export function feedChildLine(scope: string, line: string): void {
  scoped(scope)(line);
}
