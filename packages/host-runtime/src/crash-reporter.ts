/**
 * Rapport de crash : fichier local (userData/logs/ + crash-reports/) + envoi
 * automatique au collecteur éditeur (télémétrie — service autonome VPS).
 *
 * Règles :
 * - best-effort intégral : timeout court, try/catch partout, JAMAIS de throw ;
 * - l'envoi ne bloque rien (fire-and-forget) ;
 * - queue fichier si hors-ligne → flush au rapport suivant / flushPending ;
 * - identifiant d'installation anonyme (uuid v4, persisté userData).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { recentLines, log, logFileTail, logFilePath } from "./logger.js";

export type CrashReporterConfig = {
  /** URL collecteur par défaut (marque). Absente = conserve la valeur courante. */
  defaultEndpoint?: string;
  /** Env override (clé canonique `envKey(manifest, "CRASH_ENDPOINT")`). */
  endpointEnvKey?: string;
  /** brandId joint aux rapports (filtre VPS). */
  brandId?: string;
  /** Miroir flotte optionnel (marque). */
  sendFleetCrash?: (report: Record<string, unknown>) => void | Promise<void>;
};

let config: CrashReporterConfig = {
  defaultEndpoint: "http://127.0.0.1/crash-disabled",
};

export function configureCrashReporter(next: CrashReporterConfig): void {
  const { defaultEndpoint, ...rest } = next;
  config = {
    ...config,
    ...rest,
    ...(defaultEndpoint !== undefined ? { defaultEndpoint } : {}),
  };
}

function resolveCrashEndpoint(): string {
  const key = config.endpointEnvKey;
  if (key) {
    const fromEnv = (process.env[key] || "").trim();
    if (fromEnv) return fromEnv;
  }
  const globalEnv = (process.env.CREEZIO_CRASH_ENDPOINT || "").trim();
  if (globalEnv) return globalEnv;
  return config.defaultEndpoint || "http://127.0.0.1/crash-disabled";
}

function isUploadEnabled(): boolean {
  const ep = resolveCrashEndpoint();
  return Boolean(ep) && !/crash-disabled/i.test(ep);
}

/* ── Early crash writer ──────────────────────────────────────────────────
 * Filet AVANT toute résolution de chemins (userData, logger, manifest…) :
 * si le main crashe dans les toutes premières lignes du boot, on veut au
 * moins un JSON sur disque à côté de l'exécutable. Aucune dépendance :
 * dirname(execPath)/data/crash-reports/early-*.json (fallback tmpdir). */

let earlyWriterInstalled = false;
let earlyWriterActive = false;

function writeEarlyCrashFile(kind: string, detail: Record<string, unknown>): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const body = JSON.stringify(
    {
      kind,
      early: true,
      timestamp: new Date().toISOString(),
      pid: process.pid,
      execPath: process.execPath,
      platform: process.platform,
      arch: process.arch,
      detail,
    },
    null,
    2,
  );
  const candidates = [
    path.join(path.dirname(process.execPath), "data", "crash-reports"),
    path.join(os.tmpdir(), "creezio-crash"),
  ];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `early-${stamp}-${kind}.json`), body);
      return;
    } catch {
      /* essayer le fallback suivant */
    }
  }
}

/**
 * Handler minimal `uncaughtException`/`unhandledRejection` à installer dès la
 * PREMIÈRE ligne du main (avant Electron, avant résolution des paths).
 * Se désactive quand `initCrashReporter` prend le relais (rapports complets).
 */
export function installEarlyCrashWriter(): void {
  if (earlyWriterInstalled) return;
  earlyWriterInstalled = true;
  earlyWriterActive = true;
  process.on("uncaughtException", (e) => {
    if (!earlyWriterActive) return;
    writeEarlyCrashFile("uncaughtException", {
      message: e?.message,
      stack: e?.stack,
    });
  });
  process.on("unhandledRejection", (reason) => {
    if (!earlyWriterActive) return;
    writeEarlyCrashFile("unhandledRejection", {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

let installId = "unknown";
let appVersion = "0.0.0";
let crashDir: string | null = null;
let crashReportsDirPath: string | null = null;
let pendingDir: string | null = null;
let bootStage = "init";
const bootTimeline: { at: string; stage: string }[] = [];

/** Étape de démarrage courante — jointe aux rapports pour situer le crash. */
export function setBootStage(stage: string): void {
  bootStage = stage;
  bootTimeline.push({ at: new Date().toISOString(), stage });
  if (bootTimeline.length > 100) bootTimeline.shift();
  try {
    log("boot", `stage=${stage}`);
  } catch {
    /* best-effort */
  }
}

export function getBootStage(): string {
  return bootStage;
}

export function getBootTimeline(): { at: string; stage: string }[] {
  return bootTimeline.slice();
}

/** Dossier des JSON crash (userData/crash-reports). */
export function crashReportsDir(): string | null {
  return crashReportsDirPath;
}

/** Chemin journal texte principal (logger). */
export function crashLogHint(): string {
  return (
    logFilePath() ||
    crashReportsDirPath ||
    crashDir ||
    path.join(os.tmpdir(), "creezio-crash")
  );
}

export function initCrashReporter(userDataDir: string, version: string): void {
  appVersion = version;
  // Le reporter complet prend le relais — l'early writer se tait.
  earlyWriterActive = false;
  try {
    crashDir = path.join(userDataDir, "logs");
    crashReportsDirPath = path.join(userDataDir, "crash-reports");
    pendingDir = path.join(crashReportsDirPath, "pending");
    fs.mkdirSync(crashDir, { recursive: true });
    fs.mkdirSync(crashReportsDirPath, { recursive: true });
    fs.mkdirSync(pendingDir, { recursive: true });
    const idFile = path.join(userDataDir, "install-id");
    try {
      installId = fs.readFileSync(idFile, "utf8").trim();
      if (!installId) throw new Error("vide");
    } catch {
      installId = crypto.randomUUID();
      try {
        fs.writeFileSync(idFile, installId);
      } catch {
        /* best-effort */
      }
    }
    // Flush différé des rapports hors-ligne précédents.
    setTimeout(() => {
      void flushPendingCrashReports();
    }, 2_000);
  } catch {
    crashDir = null;
    crashReportsDirPath = null;
    pendingDir = null;
  }
}

/** Endpoint + identifiants exposés (injectés au serveur Next par server-launcher). */
export function crashEndpoint(): string {
  return resolveCrashEndpoint();
}

export function getInstallId(): string {
  return installId;
}

export type CrashKind =
  | "uncaughtException"
  | "unhandledRejection"
  | "boot-failure"
  | "child-exit"
  | "renderer-gone"
  | "child-process-gone"
  /** Erreur dans un handler IPC / la gestion d'onglets (non fatale). */
  | "tab-error"
  /** Exception JS / rejet non géré DANS la page (UI CRM ou vue fournisseur). */
  | "renderer-error"
  /** Événement webContents anormal : preload-error, did-fail-load, unresponsive… */
  | "web-event"
  /** Anomalie détectée par la boîte noire (ops-rules) — remontée always-on. */
  | "ops-anomaly";

function writeLocalReport(
  report: Record<string, unknown>,
  kind: string,
  timestamp: string,
): void {
  const name = `crash-${timestamp.replace(/[:.]/g, "-")}-${kind}.json`;
  const body = JSON.stringify(report, null, 2);
  for (const dir of [crashReportsDirPath, crashDir]) {
    if (!dir) continue;
    try {
      fs.writeFileSync(path.join(dir, name), body);
    } catch {
      /* best-effort */
    }
  }
}

function enqueuePending(report: Record<string, unknown>): void {
  if (!pendingDir) return;
  try {
    const name = `pending-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`;
    fs.writeFileSync(path.join(pendingDir, name), JSON.stringify(report));
  } catch {
    /* best-effort */
  }
}

/**
 * Enregistre un rapport localement puis l'envoie au collecteur.
 * Ne throw jamais.
 *
 * `boot-failure` : ring élargi + queue fichier + timeline des stages splash
 * (sinon un npm install n8n noie les 120 dernières lignes utiles).
 */
export function reportCrash(kind: CrashKind, detail: Record<string, unknown>): void {
  const isBootFail = kind === "boot-failure";
  const timestamp = new Date().toISOString();
  const report: Record<string, unknown> = {
    kind,
    brandId: config.brandId || null,
    installId,
    appVersion,
    bootStage,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    electron: process.versions.electron,
    timestamp,
    detail,
    bootTimeline: getBootTimeline(),
    recentLog: recentLines(isBootFail ? 800 : 120),
    localPaths: {
      crashReports: crashReportsDirPath,
      logs: crashDir,
      logFile: logFilePath(),
    },
  };
  if (isBootFail) {
    const tail = logFileTail(150_000);
    if (tail != null) report.logFileTail = tail;
  }

  writeLocalReport(report, kind, timestamp);
  try {
    log(
      "crash",
      `${kind} @ ${bootStage}: ${JSON.stringify(detail).slice(0, 500)} → ${crashLogHint()}`,
    );
  } catch {
    /* best-effort */
  }

  void sendReport(report).then((ok) => {
    if (!ok && isUploadEnabled()) enqueuePending(report);
  });

  if (config.sendFleetCrash) {
    void Promise.resolve(config.sendFleetCrash(report)).catch(() => {
      /* best-effort */
    });
  }

  if (kind !== "ops-anomaly") {
    void import("@creezio/observability")
      .then((m) => m.trackCrashMirror(kind, detail))
      .catch(() => {
        /* best-effort */
      });
  }
}

/**
 * Variante anti-spam : au plus un rapport par `key` toutes les `intervalMs`
 * (5 min par défaut). Les occurrences suivantes restent dans le log local.
 */
const lastReportByKey = new Map<string, number>();
export function reportCrashDebounced(
  kind: CrashKind,
  key: string,
  detail: Record<string, unknown>,
  intervalMs = 5 * 60_000,
): void {
  const now = Date.now();
  const last = lastReportByKey.get(key) || 0;
  if (now - last < intervalMs) {
    try {
      log("crash", `(débounce ${key}) ${kind}: ${JSON.stringify(detail).slice(0, 300)}`);
    } catch {
      /* best-effort */
    }
    return;
  }
  lastReportByKey.set(key, now);
  reportCrash(kind, detail);
}

async function postReport(report: Record<string, unknown>): Promise<boolean> {
  if (!isUploadEnabled()) return false;
  try {
    const res = await fetch(resolveCrashEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

async function sendReport(report: Record<string, unknown>): Promise<boolean> {
  const ok = await postReport(report);
  if (ok) {
    try {
      log("crash", `upload OK → ${resolveCrashEndpoint().replace(/\/[^/]+$/, "/***")} `);
    } catch {
      /* ignore */
    }
  }
  return ok;
}

/** Renvoie les rapports pending (hors-ligne) — best-effort. */
export async function flushPendingCrashReports(): Promise<number> {
  if (!pendingDir || !isUploadEnabled()) return 0;
  let sent = 0;
  try {
    const files = fs.readdirSync(pendingDir).filter((f) => f.endsWith(".json"));
    for (const f of files.slice(0, 40)) {
      const full = path.join(pendingDir, f);
      try {
        const report = JSON.parse(fs.readFileSync(full, "utf8")) as Record<
          string,
          unknown
        >;
        if (await postReport(report)) {
          fs.unlinkSync(full);
          sent += 1;
        }
      } catch {
        /* skip corrupt */
      }
    }
  } catch {
    /* best-effort */
  }
  if (sent > 0) {
    try {
      log("crash", `flush pending: ${sent} rapport(s) envoyé(s)`);
    } catch {
      /* ignore */
    }
  }
  return sent;
}

let globalHandlersInstalled = false;

/** Handlers globaux du process principal — à installer au tout début (idempotent). */
export function installGlobalHandlers(): void {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;
  process.on("uncaughtException", (e) => {
    reportCrash("uncaughtException", {
      message: e?.message,
      stack: e?.stack,
    });
    // On ne quitte PAS : beaucoup d'exceptions (ex. réseau) sont récupérables.
  });
  process.on("unhandledRejection", (reason) => {
    reportCrash("unhandledRejection", {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}
