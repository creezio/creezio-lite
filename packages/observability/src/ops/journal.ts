/**
 * Boîte noire desktop — journal d'événements structurés (JSONL / boot).
 * Hooks marque pour log + anomaly.
 *
 * Best-effort intégral : le journal ne doit JAMAIS être une source de crash.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  parseOpsLine,
  redactOpsCtx,
  sanitizeOpsEventInput,
  serializeOpsEvent,
  type OpsBootSummary,
  type OpsEvent,
  type OpsEventInput,
  type OpsLevel,
} from "./types.js";

const OPS_KEEP_FILES = 30;
const OPS_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const INDEX_MAX_BOOTS = 60;
const PENDING_MAX = 500;

export type OpsJournalHooks = {
  /** Miroir texte (logger marque). */
  log?: (scope: string, line: string) => void;
  /**
   * Anomalies → canal always-on (crash-reporter marque).
   * Jamais de re-entrée vers trackCrashMirror.
   */
  onAnomaly?: (evt: OpsEvent) => void;
};

let hooks: OpsJournalHooks = {};
let opsDir: string | null = null;
let bootId = "";
let bootStartedAt = "";
let appVersion = "0.0.0";
let seq = 0;

const pending: OpsEvent[] = [];
const counts: Partial<Record<OpsLevel, number>> = {};
const decisions: Record<string, { outcome?: string; reason?: string }> = {};
const durations: Record<string, number> = {};

export function setOpsJournalHooks(next: OpsJournalHooks): void {
  hooks = next || {};
}

export function getOpsBootId(): string {
  return bootId;
}

export function getOpsDir(): string | null {
  return opsDir;
}

function bootFile(): string | null {
  return opsDir && bootId ? path.join(opsDir, `${bootId}.jsonl`) : null;
}

function indexFile(): string | null {
  return opsDir ? path.join(opsDir, "index.json") : null;
}

/** Purge rétention : garde les OPS_KEEP_FILES plus récents / plafond octets. */
function pruneOldBootFiles(): void {
  if (!opsDir) return;
  try {
    const files = fs
      .readdirSync(opsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const full = path.join(opsDir as string, f);
        try {
          const st = fs.statSync(full);
          return { full, mtime: st.mtimeMs, size: st.size };
        } catch {
          return { full, mtime: 0, size: 0 };
        }
      })
      .sort((a, b) => b.mtime - a.mtime);
    let total = 0;
    files.forEach((f, i) => {
      total += f.size;
      if (i >= OPS_KEEP_FILES || total > OPS_MAX_TOTAL_BYTES) {
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

/** À appeler tôt (après initLogger) avec le dossier userData. */
export function initOpsJournal(
  userDataDir: string,
  version: string,
  nextHooks?: OpsJournalHooks,
): void {
  try {
    if (nextHooks) hooks = nextHooks;
    appVersion = version;
    opsDir = path.join(userDataDir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    bootId = crypto.randomUUID();
    bootStartedAt = new Date().toISOString();
    seq = 0;
    pending.length = 0;
    for (const k of Object.keys(counts)) delete counts[k as OpsLevel];
    for (const k of Object.keys(decisions)) delete decisions[k];
    for (const k of Object.keys(durations)) delete durations[k];
    pruneOldBootFiles();
  } catch {
    opsDir = null;
  }
}

/**
 * Enregistre un événement : JSONL local + file flotte + miroir log texte.
 * `source` défaut "main". Jamais de throw.
 */
export function track(input: OpsEventInput): void {
  try {
    const evt: OpsEvent = {
      ...input,
      ctx: input.ctx
        ? (redactOpsCtx(input.ctx) as Record<string, unknown>)
        : undefined,
      source: input.source || "main",
      ts: new Date().toISOString(),
      bootId,
      seq: seq++,
    };

    counts[evt.level] = (counts[evt.level] || 0) + 1;
    if (evt.level === "decision") {
      decisions[evt.kind] = { outcome: evt.outcome, reason: evt.reason };
    }
    if (evt.durationMs != null) {
      durations[evt.kind] = Math.max(durations[evt.kind] || 0, evt.durationMs);
    }

    const line = serializeOpsEvent(evt);
    const file = bootFile();
    if (file) {
      try {
        fs.appendFileSync(file, line + "\n");
      } catch {
        /* disque plein / permissions */
      }
    }

    pending.push(evt);
    if (pending.length > PENDING_MAX) pending.shift();

    try {
      hooks.log?.(
        "ops",
        `${evt.level} ${evt.kind}` +
          (evt.outcome ? ` outcome=${evt.outcome}` : "") +
          (evt.reason ? ` reason=${evt.reason}` : "") +
          (evt.durationMs != null ? ` ${evt.durationMs}ms` : ""),
      );
    } catch {
      /* best-effort */
    }

    if (evt.level === "anomaly") {
      try {
        hooks.onAnomaly?.(evt);
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* best-effort */
  }
}

/** Décision : sucre pour les gates. */
export function trackDecision(
  kind: string,
  outcome: string,
  opts?: {
    reason?: string;
    durationMs?: number;
    ctx?: Record<string, unknown>;
    source?: string;
  },
): void {
  track({ level: "decision", kind, outcome, ...opts });
}

/**
 * Miroir des crashes (appelé par crash-reporter via import dynamique).
 * Journal uniquement — PAS de re-déclenchement reportCrash.
 */
export function trackCrashMirror(
  kind: string,
  detail: Record<string, unknown>,
): void {
  try {
    const evt: OpsEvent = {
      level: "crash",
      kind: `crash.${kind}`,
      source: "main",
      reason:
        typeof detail.message === "string"
          ? detail.message.slice(0, 300)
          : undefined,
      ctx: redactOpsCtx({
        child: detail.child,
        code: detail.code,
        step: detail.step,
      }) as Record<string, unknown>,
      ts: new Date().toISOString(),
      bootId,
      seq: seq++,
    };
    counts.crash = (counts.crash || 0) + 1;
    const file = bootFile();
    if (file) fs.appendFileSync(file, serializeOpsEvent(evt) + "\n");
    pending.push(evt);
    if (pending.length > PENDING_MAX) pending.shift();
  } catch {
    /* best-effort */
  }
}

/**
 * Ligne stdout d'un sous-process : consommée si préfixe ops + JSON.
 * Renvoie true si la ligne était un événement (à ne pas logger en texte).
 */
export function consumeOpsLine(source: string, line: string): boolean {
  try {
    const input = parseOpsLine(line);
    if (!input) return false;
    track({ ...input, source: input.source || source });
    return true;
  } catch {
    return false;
  }
}

/** Événement venant d'un canal non fiable (IPC renderer) : sanitizé. */
export function trackExternal(raw: unknown, source: string): boolean {
  const input = sanitizeOpsEventInput(raw);
  if (!input) return false;
  // Le renderer ne peut pas émettre de crash/anomaly (anti-spam canal always-on).
  if (input.level === "crash" || input.level === "anomaly") {
    input.level = "error";
  }
  track({ ...input, source });
  return true;
}

/** Drain de la file pour l'agent flotte (bundle kind=ops_events). */
export function drainPendingOpsEvents(max = 100): OpsEvent[] {
  const out = pending.slice(0, max);
  pending.splice(0, out.length);
  return out;
}

/** Résumé du boot courant (index.json + heartbeat flotte). */
export function currentBootSummary(): OpsBootSummary {
  const summary: OpsBootSummary = {
    bootId,
    startedAt: bootStartedAt,
    appVersion,
    counts: { ...counts },
    decisions: { ...decisions },
    durations: { ...durations },
  };
  return summary;
}

/** Écrit / met à jour le résumé du boot courant dans ops/index.json. */
export function persistBootSummary(extra?: Partial<OpsBootSummary>): void {
  const file = indexFile();
  if (!file) return;
  try {
    let boots: OpsBootSummary[] = [];
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
        boots?: OpsBootSummary[];
      };
      if (Array.isArray(raw.boots)) boots = raw.boots;
    } catch {
      /* premier boot */
    }
    const summary = { ...currentBootSummary(), ...extra };
    const idx = boots.findIndex((b) => b.bootId === bootId);
    if (idx >= 0) boots[idx] = summary;
    else boots.push(summary);
    if (boots.length > INDEX_MAX_BOOTS) boots = boots.slice(-INDEX_MAX_BOOTS);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ boots }, null, 1));
    fs.renameSync(tmp, file);
  } catch {
    /* best-effort */
  }
}

/** Résumés des boots précédents (le courant exclu), du plus récent au plus ancien. */
export function readPreviousBootSummaries(limit = 10): OpsBootSummary[] {
  const file = indexFile();
  if (!file) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      boots?: OpsBootSummary[];
    };
    if (!Array.isArray(raw.boots)) return [];
    return raw.boots
      .filter((b) => b.bootId !== bootId)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** Tests : reset état module. */
export function __resetOpsJournalForTests(): void {
  hooks = {};
  opsDir = null;
  bootId = "";
  bootStartedAt = "";
  appVersion = "0.0.0";
  seq = 0;
  pending.length = 0;
  for (const k of Object.keys(counts)) delete counts[k as OpsLevel];
  for (const k of Object.keys(decisions)) delete decisions[k];
  for (const k of Object.keys(durations)) delete durations[k];
}
