/**
 * Journal d’événements produit flotte (ring mémoire).
 * Schema FleetProductEvent v1 — attribution session + dwell.
 * Buffer actions flotte (M7).
 */

export type FleetSurface =
  | "crm"
  | "supplier_tab"
  | "hermes"
  | "n8n"
  | "ai_workspace"
  | "system";

export type FleetAction = {
  schemaVersion: 1;
  id: string;
  at: string;
  name: string;
  category: string;
  type: string;
  label: string;
  path?: string;
  referrerPath?: string;
  userId?: string;
  username?: string;
  sessionId?: string;
  surface?: FleetSurface;
  durationMs?: number;
  meta?: Record<string, unknown>;
};

export type FleetSessionContext = {
  userId: string | null;
  username: string | null;
  sessionId: string | null;
};

const MAX = 800;
const ring: FleetAction[] = [];
let seq = 0;
let session: FleetSessionContext = {
  userId: null,
  username: null,
  sessionId: null,
};

export function setFleetSessionContext(next: Partial<FleetSessionContext>): void {
  session = {
    userId:
      next.userId !== undefined
        ? next.userId
          ? String(next.userId).slice(0, 80)
          : null
        : session.userId,
    username:
      next.username !== undefined
        ? next.username
          ? String(next.username).slice(0, 80)
          : null
        : session.username,
    sessionId:
      next.sessionId !== undefined
        ? next.sessionId
          ? String(next.sessionId).slice(0, 80)
          : null
        : session.sessionId,
  };
}

export function getFleetSessionContext(): FleetSessionContext {
  return { ...session };
}

function sanitizeMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(meta)) {
    if (n >= 20) break;
    const key = String(k).slice(0, 40);
    if (
      /password|token|secret|authorization|cookie|api[_-]?key/i.test(key)
    ) {
      continue;
    }
    if (v == null || typeof v === "boolean" || typeof v === "number") {
      out[key] = v;
      n++;
    } else if (typeof v === "string") {
      out[key] = v.slice(0, 200);
      n++;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

let lastDedupeKey = "";
let lastDedupeAt = 0;

/** Enregistre un événement (toujours local ; envoi flotte gate par scope actions). */
export function recordFleetAction(input: {
  type?: string;
  name?: string;
  category?: string;
  label: string;
  path?: string;
  referrerPath?: string;
  userId?: string;
  username?: string;
  sessionId?: string;
  surface?: FleetSurface;
  durationMs?: number;
  meta?: Record<string, unknown>;
}): FleetAction | null {
  const name = String(input.name || input.type || "event").slice(0, 60);
  const type = String(input.type || name).slice(0, 40);
  const label = String(input.label || "").slice(0, 200);
  if (!label && !name) return null;

  // Évite les doubles (main/preload/renderer) sur une même action.
  if (
    type === "page.view" ||
    name === "page.view" ||
    type === "ui.click" ||
    name === "ui.click"
  ) {
    const key = `${type}|${input.path || ""}|${label}`;
    const now = Date.now();
    if (key === lastDedupeKey && now - lastDedupeAt < 500) return null;
    lastDedupeKey = key;
    lastDedupeAt = now;
  }

  const ev: FleetAction = {
    schemaVersion: 1,
    id: `fa_${Date.now()}_${++seq}`,
    at: new Date().toISOString(),
    name,
    category: String(input.category || "ui").slice(0, 40),
    type,
    label: label || name,
    path: input.path ? String(input.path).slice(0, 300) : undefined,
    referrerPath: input.referrerPath
      ? String(input.referrerPath).slice(0, 300)
      : undefined,
    userId: (input.userId ?? session.userId)?.slice(0, 80) || undefined,
    username: (input.username ?? session.username)?.slice(0, 80) || undefined,
    sessionId: (input.sessionId ?? session.sessionId)?.slice(0, 80) || undefined,
    surface: input.surface || "crm",
    durationMs:
      typeof input.durationMs === "number" && Number.isFinite(input.durationMs)
        ? Math.max(0, Math.round(input.durationMs))
        : undefined,
    meta: sanitizeMeta(input.meta),
  };
  ring.push(ev);
  while (ring.length > MAX) ring.shift();
  return ev;
}

export function sampleFleetActions(limit = 120): FleetAction[] {
  return ring.slice(-limit).reverse();
}

/** Snapshot + optionnellement vide le ring après flush (non utilisé par défaut). */
export function drainFleetActions(limit = 200): FleetAction[] {
  const out = ring.slice(-limit);
  ring.length = 0;
  seq = 0;
  return out.reverse();
}

export function _resetFleetActivityForTests(): void {
  ring.length = 0;
  seq = 0;
  session = { userId: null, username: null, sessionId: null };
  lastDedupeKey = "";
  lastDedupeAt = 0;
}
