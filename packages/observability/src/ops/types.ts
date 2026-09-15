/**
 * Boîte noire desktop — types + helpers PURS (aucun import Electron).
 * Contrat JSONL ops (R4 / P29) — préfixe d'émission filaire historique
 * conservé (wire sous-process Electron ×3). Lecture via `OPS_EVENT_PREFIXES` ;
 * ne pas changer le préfixe d'émission sans cutover des installs existantes.
 */

export const TF2EVENT_PREFIX = "TF2EVENT ";
/** Alias générique — même valeur que `TF2EVENT_PREFIX` (émission). */
export const OPS_EVENT_PREFIX = TF2EVENT_PREFIX;
/**
 * Préfixes stdout acceptés en lecture (M7p / P29).
 * L'émission SoT reste le préfixe filaire historique ; un alias de lecture
 * est conservé pour les journaux déjà écrits (contrat wire, pas un fallback env).
 */
export const OPS_EVENT_PREFIXES = [
  TF2EVENT_PREFIX,
  "CertivanEVENT ",
] as const;

export type OpsLevel = "decision" | "event" | "anomaly" | "error" | "crash";

export const OPS_LEVELS: readonly OpsLevel[] = [
  "decision",
  "event",
  "anomaly",
  "error",
  "crash",
];

/** Événement tel qu'émis par le code appelant. */
export type OpsEventInput = {
  level: OpsLevel;
  /** Taxonomie stable `domaine.action` : meili.ready, boot.done, updater.check… */
  kind: string;
  /** Process émetteur — défaut "main" côté journal. */
  source?: string;
  /** Branche choisie : skip, full-reindex, present, downloaded, ok, error… */
  outcome?: string;
  /** POURQUOI : fingerprint-absent, timeout, http-503… */
  reason?: string;
  durationMs?: number;
  /** Contexte libre, redacté et plafonné à MAX_CTX_BYTES. */
  ctx?: Record<string, unknown>;
};

/** Événement complet, tel que persisté dans le JSONL. */
export type OpsEvent = OpsEventInput & {
  ts: string;
  bootId: string;
  seq: number;
  source: string;
};

/** Taille max du ctx sérialisé (au-delà : tronqué avec marqueur). */
export const MAX_CTX_BYTES = 4096;

const SECRET_KEY_RE =
  /token|secret|password|passwd|api[-_]?key|jwt|auth|bearer|cookie|master[-_]?key/i;
const SECRET_VALUE_RE =
  /(sk-[A-Za-z0-9_-]{10,}|tf2_live_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{10,})/g;

/** Redaction récursive : clés sensibles masquées, motifs secrets dans les strings. */
export function redactOpsCtx(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") {
    return value.replace(SECRET_VALUE_RE, "[redacted]").slice(0, 800);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redactOpsCtx(v, depth + 1));
  }
  if (typeof value === "object" && value !== undefined) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? "[redacted]" : redactOpsCtx(v, depth + 1);
    }
    return out;
  }
  return value === undefined ? undefined : String(value);
}

/** Valide + normalise un input (renvoie null si inutilisable). */
export function sanitizeOpsEventInput(raw: unknown): OpsEventInput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const level = OPS_LEVELS.includes(o.level as OpsLevel)
    ? (o.level as OpsLevel)
    : null;
  const kind =
    typeof o.kind === "string" && /^[a-z0-9_-]+\.[a-z0-9._-]+$/i.test(o.kind)
      ? o.kind.slice(0, 80)
      : null;
  if (!level || !kind) return null;
  const evt: OpsEventInput = { level, kind };
  if (typeof o.source === "string") evt.source = o.source.slice(0, 40);
  if (typeof o.outcome === "string") evt.outcome = o.outcome.slice(0, 120);
  if (typeof o.reason === "string") evt.reason = o.reason.slice(0, 300);
  if (typeof o.durationMs === "number" && Number.isFinite(o.durationMs)) {
    evt.durationMs = Math.max(0, Math.round(o.durationMs));
  }
  if (o.ctx && typeof o.ctx === "object" && !Array.isArray(o.ctx)) {
    evt.ctx = redactOpsCtx(o.ctx) as Record<string, unknown>;
  }
  return evt;
}

/** Sérialise en plafonnant le ctx (jamais de throw). */
export function serializeOpsEvent(evt: OpsEvent): string {
  try {
    let line = JSON.stringify(evt);
    if (evt.ctx && Buffer.byteLength(line, "utf8") > MAX_CTX_BYTES + 1024) {
      line = JSON.stringify({ ...evt, ctx: { _truncated: true } });
    }
    return line;
  } catch {
    return JSON.stringify({
      ts: evt.ts,
      bootId: evt.bootId,
      seq: evt.seq,
      source: evt.source,
      level: evt.level,
      kind: evt.kind,
      reason: "serialize-error",
    });
  }
}

/**
 * Parse une ligne stdout d'un sous-process.
 * Renvoie l'input si la ligne est un événement ops valide, sinon null.
 */
export function parseOpsLine(line: string): OpsEventInput | null {
  const trimmed = line.trim();
  for (const prefix of OPS_EVENT_PREFIXES) {
    if (!trimmed.startsWith(prefix)) continue;
    try {
      return sanitizeOpsEventInput(JSON.parse(trimmed.slice(prefix.length)));
    } catch {
      return null;
    }
  }
  return null;
}

/** Résumé d'un boot (ops/index.json + heartbeat flotte). */
export type OpsBootSummary = {
  bootId: string;
  startedAt: string;
  endedAt?: string;
  appVersion?: string;
  durationMs?: number;
  counts: Partial<Record<OpsLevel, number>>;
  /** Décisions du boot : kind → { outcome, reason }. */
  decisions: Record<string, { outcome?: string; reason?: string }>;
  /** Durée max observée par kind (événements portant durationMs). */
  durations: Record<string, number>;
};
