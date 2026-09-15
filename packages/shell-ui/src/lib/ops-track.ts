/**
 * Boîte noire — émission d'événements ops depuis le SERVEUR Next.
 *
 * Le serveur tourne en sous-process du main Electron : une ligne
 * `TF2EVENT {json}` sur stdout est captée par le hook logger du main
 * (voir `@creezio/observability` initOpsJournal). En mode serveur pur (Docker), la ligne
 * reste un simple log console — inoffensif.
 *
 * Volontairement autonome (pas d'import electron/) pour respecter la
 * frontière de build Next.
 */

const TF2EVENT_PREFIX = "TF2EVENT ";

export type ServerOpsLevel = "decision" | "event" | "anomaly" | "error";

export type ServerOpsEvent = {
  level: ServerOpsLevel;
  /** Taxonomie `domaine.action` — ex. search.fallback, api.error. */
  kind: string;
  outcome?: string;
  reason?: string;
  durationMs?: number;
  ctx?: Record<string, unknown>;
};

export function trackServer(evt: ServerOpsEvent): void {
  try {
    // eslint-disable-next-line no-console
    console.log(`${TF2EVENT_PREFIX}${JSON.stringify({ ...evt, source: "next" })}`);
  } catch {
    /* best-effort : jamais de throw depuis l'instrumentation */
  }
}

const lastSentByKey = new Map<string, number>();

/**
 * Variante anti-spam : au plus un événement par `kind+outcome` toutes les
 * `intervalMs` (5 min par défaut) — pour les chemins chauds (fallback SQL
 * appelé à chaque recherche quand Meili est down).
 */
export function trackServerDebounced(evt: ServerOpsEvent, intervalMs = 5 * 60_000): void {
  const key = `${evt.kind}|${evt.outcome || ""}`;
  const now = Date.now();
  const last = lastSentByKey.get(key) || 0;
  if (now - last < intervalMs) return;
  lastSentByKey.set(key, now);
  trackServer(evt);
}
