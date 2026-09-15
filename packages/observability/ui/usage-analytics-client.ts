/**
 * Tracker d'usage client — pages, dwell, clics, présence (heartbeat / idle / focus).
 * Buffer + flush vers POST /api/v1/analytics/events.
 * Miroir optionnel vers la télémétrie flotte Electron.
 *
 * Vie privée : on ne journalise PAS le contenu des frappes ni les mouvements souris,
 * seulement des signaux d'activité agrégés (heartbeat / idle).
 */

import { getUsageAnalyticsUiBrand, type FleetActionPayload } from "../dist/usage/ui-brand.js";

function mirrorFleetAction(payload: FleetActionPayload): void {
  getUsageAnalyticsUiBrand().mirrorFleetAction?.(payload);
}

function aidAttr(): string {
  return getUsageAnalyticsUiBrand().aidAttr;
}

function titlebarNoDragClass(): string {
  return getUsageAnalyticsUiBrand().titlebarNoDragClass;
}

type Session = {
  userId: string | null;
  username: string | null;
  userKind: "human" | "ai" | "unknown";
  userRole: string | null;
  sessionId: string | null;
};

type QueuedEvent = {
  eventType: string;
  category: string;
  label: string;
  path?: string;
  referrerPath?: string;
  sessionId?: string;
  durationMs?: number;
  meta?: Record<string, unknown>;
  surface?: string;
  createdAt: string;
};

let session: Session = {
  userId: null,
  username: null,
  userKind: "unknown",
  userRole: null,
  sessionId: null,
};

let currentPath: string | null = null;
let pageEnteredAt = 0;
let clickBound = false;
let visibilityBound = false;
let presenceBound = false;
let flushTimer: number | null = null;
let queue: QueuedEvent[] = [];
let flushing = false;
const MAX_QUEUE = 200;
const FLUSH_MS = 2500;

/** Heartbeat toutes les 60s si onglet visible et non idle. */
const HEARTBEAT_MS = 60_000;
/** Idle après 2 min sans interaction. */
const IDLE_AFTER_MS = 2 * 60_000;

let lastActivityAt = 0;
let idleSince: number | null = null;
let heartbeatTimer: number | null = null;
let idleCheckTimer: number | null = null;
let sessionStartedAt = 0;
let focused = true;

function mirrorFleet(ev: QueuedEvent): void {
  // Gaté : sur un client distant, fleet:action est host-only (voir desktop-host).
  mirrorFleetAction({
    type: ev.eventType,
    label: ev.label,
    path: ev.path,
    userId: session.userId ?? undefined,
    username: session.username ?? undefined,
    meta: {
      ...(ev.meta || {}),
      name: ev.eventType,
      category: ev.category,
      sessionId: ev.sessionId ?? session.sessionId,
      surface: ev.surface || "crm",
      referrerPath: ev.referrerPath,
      durationMs: ev.durationMs,
      userKind: session.userKind,
      userRole: session.userRole,
    },
  });
}

function enqueue(partial: Omit<QueuedEvent, "createdAt"> & { createdAt?: string }): void {
  if (!session.userId && !session.sessionId) {
    if (
      !partial.eventType.startsWith("page.") &&
      partial.eventType !== "ui.click" &&
      !partial.eventType.startsWith("presence.")
    ) {
      return;
    }
  }
  const ev: QueuedEvent = {
    ...partial,
    sessionId: partial.sessionId ?? session.sessionId ?? undefined,
    createdAt: partial.createdAt || new Date().toISOString(),
  };
  queue.push(ev);
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  mirrorFleet(ev);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (typeof window === "undefined") return;
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushUsageAnalytics();
  }, FLUSH_MS);
}

export async function flushUsageAnalytics(): Promise<void> {
  if (flushing || !queue.length) return;
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  flushing = true;
  const batch = queue.splice(0, 100);
  try {
    const res = await fetch("/api/v1/analytics/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    });
    if (!res.ok) {
      queue = [...batch, ...queue].slice(0, MAX_QUEUE);
    }
  } catch {
    queue = [...batch, ...queue].slice(0, MAX_QUEUE);
  } finally {
    flushing = false;
    if (queue.length) scheduleFlush();
  }
}

export function setUsageAnalyticsSession(next: {
  userId?: string | null;
  username?: string | null;
  userKind?: "human" | "ai" | "unknown" | null;
  userRole?: string | null;
  sessionId?: string | null;
}): void {
  const prev = session.userId;
  session = {
    userId: next.userId !== undefined ? next.userId : session.userId,
    username: next.username !== undefined ? next.username : session.username,
    userKind: next.userKind !== undefined && next.userKind ? next.userKind : session.userKind,
    userRole: next.userRole !== undefined ? next.userRole : session.userRole,
    sessionId: next.sessionId !== undefined ? next.sessionId : session.sessionId,
  };
  if (session.userId && session.userId !== prev) {
    sessionStartedAt = Date.now();
    lastActivityAt = Date.now();
    idleSince = null;
    enqueue({
      eventType: "session.start",
      category: "auth",
      label: `Session ${session.username || session.userId}`,
      path: typeof location !== "undefined" ? location.pathname : undefined,
      meta: { kind: session.userKind, role: session.userRole },
    });
    startPresenceLoops();
  }
  if (!session.userId) {
    stopPresenceLoops();
  }
}

function closePage(reason: string): void {
  if (!currentPath || !pageEnteredAt) return;
  const durationMs = Date.now() - pageEnteredAt;
  enqueue({
    eventType: "page.hide",
    category: "navigation",
    label: `Quitte ${currentPath}`,
    path: currentPath,
    durationMs,
    meta: { reason },
  });
  pageEnteredAt = 0;
}

export function trackUsagePageView(path: string): void {
  const next = String(path || "").slice(0, 300);
  if (!next) return;
  if (currentPath === next && pageEnteredAt) return;
  const prev = currentPath;
  if (prev) closePage("navigate");
  currentPath = next;
  pageEnteredAt = Date.now();
  markActivity("navigate");
  enqueue({
    eventType: "page.view",
    category: "navigation",
    label: `Page ${next}`,
    path: next,
    referrerPath: prev || undefined,
  });
}

export function trackUsageEvent(opts: {
  eventType: string;
  category?: string;
  label: string;
  path?: string;
  durationMs?: number;
  meta?: Record<string, unknown>;
  surface?: string;
}): void {
  enqueue({
    eventType: opts.eventType,
    category: opts.category || "ui",
    label: opts.label,
    path: opts.path || currentPath || undefined,
    durationMs: opts.durationMs,
    meta: opts.meta,
    surface: opts.surface,
  });
}

function clickLabel(el: Element): string {
  const aid = el.getAttribute(aidAttr());
  if (aid) return aid;
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.slice(0, 120);
  const title = el.getAttribute("title");
  if (title) return title.slice(0, 120);
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 120);
  const tag = el.tagName.toLowerCase();
  const href = el.getAttribute("href");
  if (href) return `${tag} ${href}`.slice(0, 120);
  return tag;
}

function onClickCapture(ev: MouseEvent): void {
  const t = ev.target;
  if (!(t instanceof Element)) return;
  markActivity("click");
  const el =
    t.closest(
      `[${aidAttr()}],button,a,[role='button'],[role='tab'],input[type='submit']`,
    ) || null;
  if (!el) return;
  if (el.closest(`.${titlebarNoDragClass()}`)) return;
  if (
    el instanceof HTMLInputElement &&
    el.type !== "submit" &&
    el.type !== "button" &&
    el.type !== "checkbox" &&
    el.type !== "radio"
  ) {
    return;
  }
  const aid = el.getAttribute(aidAttr()) || undefined;
  enqueue({
    eventType: "ui.click",
    category: "ui",
    label: clickLabel(el),
    path: currentPath || (typeof location !== "undefined" ? location.pathname : undefined),
    meta: {
      aid: aid || null,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || null,
    },
  });
}

function markActivity(reason: string, opts?: { force?: boolean }): void {
  const now = Date.now();
  // Throttle des signaux souris/clavier (sauf sortie d'idle / force)
  if (!opts?.force && idleSince == null && now - lastActivityAt < 1_000) {
    lastActivityAt = now;
    return;
  }
  if (idleSince != null) {
    const idleMs = now - idleSince;
    enqueue({
      eventType: "presence.active",
      category: "presence",
      label: "Retour activité",
      path: currentPath || undefined,
      durationMs: idleMs,
      meta: { reason, idleMs },
    });
    // l'idle écoulé est aussi journalisé pour les agrégations
    enqueue({
      eventType: "presence.idle",
      category: "presence",
      label: "Pause / idle",
      path: currentPath || undefined,
      durationMs: idleMs,
      meta: { reason: "ended", endedBy: reason },
      createdAt: new Date(idleSince).toISOString(),
    });
    idleSince = null;
  }
  lastActivityAt = now;
}

function tickIdleCheck(): void {
  if (!session.userId) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  if (!focused) return;
  const now = Date.now();
  if (idleSince == null && lastActivityAt && now - lastActivityAt >= IDLE_AFTER_MS) {
    idleSince = lastActivityAt;
    enqueue({
      eventType: "presence.idle_start",
      category: "presence",
      label: "Début idle",
      path: currentPath || undefined,
      meta: { afterMs: IDLE_AFTER_MS },
    });
  }
}

function tickHeartbeat(): void {
  if (!session.userId) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  if (!focused) return;
  if (idleSince != null) return;
  enqueue({
    eventType: "presence.heartbeat",
    category: "presence",
    label: "Présence active",
    path: currentPath || undefined,
    durationMs: HEARTBEAT_MS,
    meta: { intervalMs: HEARTBEAT_MS },
  });
}

function startPresenceLoops(): void {
  if (typeof window === "undefined") return;
  stopPresenceLoops();
  lastActivityAt = Date.now();
  heartbeatTimer = window.setInterval(() => tickHeartbeat(), HEARTBEAT_MS);
  idleCheckTimer = window.setInterval(() => tickIdleCheck(), 15_000);
  // premier heartbeat rapide pour amorcer la journée
  window.setTimeout(() => tickHeartbeat(), 5_000);
}

function stopPresenceLoops(): void {
  if (typeof window === "undefined") return;
  if (heartbeatTimer != null) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (idleCheckTimer != null) {
    window.clearInterval(idleCheckTimer);
    idleCheckTimer = null;
  }
}

function onVisibility(): void {
  if (document.visibilityState === "hidden") {
    closePage("hidden");
    if (idleSince == null && lastActivityAt) {
      // onglet caché ≈ fin de focus
      enqueue({
        eventType: "presence.blur",
        category: "presence",
        label: "Onglet masqué",
        path: currentPath || undefined,
        meta: { reason: "hidden" },
      });
    }
    void flushUsageAnalytics();
  } else if (document.visibilityState === "visible" && currentPath) {
    pageEnteredAt = Date.now();
    markActivity("visible");
    enqueue({
      eventType: "page.view",
      category: "navigation",
      label: `Retour ${currentPath}`,
      path: currentPath,
      meta: { reason: "visible" },
    });
    enqueue({
      eventType: "presence.focus",
      category: "presence",
      label: "Onglet visible",
      path: currentPath,
      meta: { reason: "visible" },
    });
  }
}

function onWindowBlur(): void {
  focused = false;
  enqueue({
    eventType: "presence.blur",
    category: "presence",
    label: "Fenêtre blur",
    path: currentPath || undefined,
  });
}

function onWindowFocus(): void {
  focused = true;
  markActivity("focus");
  enqueue({
    eventType: "presence.focus",
    category: "presence",
    label: "Fenêtre focus",
    path: currentPath || undefined,
  });
}

function onPageHide(): void {
  closePage("pagehide");
  if (session.userId && sessionStartedAt) {
    enqueue({
      eventType: "session.end",
      category: "auth",
      label: "Fin de session",
      path: currentPath || undefined,
      durationMs: Date.now() - sessionStartedAt,
    });
  }
  if (idleSince != null) {
    enqueue({
      eventType: "presence.idle",
      category: "presence",
      label: "Pause / idle",
      path: currentPath || undefined,
      durationMs: Date.now() - idleSince,
      meta: { reason: "pagehide" },
      createdAt: new Date(idleSince).toISOString(),
    });
    idleSince = null;
  }
  void flushUsageAnalytics();
}

function onActivitySignal(): void {
  markActivity("signal");
}

export function ensureUsageAnalyticsDom(): void {
  if (typeof document === "undefined") return;
  if (!clickBound) {
    document.addEventListener("click", onClickCapture, true);
    clickBound = true;
  }
  if (!visibilityBound) {
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    visibilityBound = true;
  }
  if (!presenceBound) {
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    // Signaux d'activité — pas journalisés unitairement
    const opts = { passive: true, capture: true } as const;
    document.addEventListener("mousemove", onActivitySignal, opts);
    document.addEventListener("keydown", onActivitySignal, opts);
    document.addEventListener("scroll", onActivitySignal, opts);
    document.addEventListener("touchstart", onActivitySignal, opts);
    document.addEventListener("pointerdown", onActivitySignal, opts);
    presenceBound = true;
    if (session.userId) startPresenceLoops();
  }
}
