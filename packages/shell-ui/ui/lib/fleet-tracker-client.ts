import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";
/**
 * Tracker produit flotte (renderer) — page views, clics, session.
 * Envoie via getShellDesktopApi().reportFleetAction (opt-in côté main).
 */

import { mirrorFleetAction } from "./desktop-host";
import { resolveAidAttr } from "./aid";

type FleetReport = {
  type?: string;
  name?: string;
  category?: string;
  label: string;
  path?: string;
  referrerPath?: string;
  userId?: string;
  username?: string;
  sessionId?: string;
  surface?: string;
  durationMs?: number;
  meta?: Record<string, unknown>;
};

type Session = {
  userId: string | null;
  username: string | null;
  sessionId: string | null;
};

let session: Session = {
  userId: null,
  username: null,
  sessionId: null,
};
let currentPath: string | null = null;
let pageEnteredAt = 0;
let clickBound = false;
let visibilityBound = false;

function report(payload: FleetReport): void {
  // Gaté : sur un client distant, fleet:action est host-only (voir desktop-host).
  mirrorFleetAction({
    type: payload.type || payload.name || "event",
    label: payload.label,
    path: payload.path,
    userId: payload.userId ?? session.userId ?? undefined,
    username: payload.username ?? session.username ?? undefined,
    meta: {
      ...(payload.meta || {}),
      name: payload.name || payload.type,
      category: payload.category || "ui",
      sessionId: payload.sessionId ?? session.sessionId,
      surface: payload.surface || "crm",
      referrerPath: payload.referrerPath,
      durationMs: payload.durationMs,
    },
  });
}

export function setFleetTrackerSession(next: {
  userId?: string | null;
  username?: string | null;
  sessionId?: string | null;
}): void {
  const prev = session.userId;
  session = {
    userId: next.userId !== undefined ? next.userId : session.userId,
    username: next.username !== undefined ? next.username : session.username,
    sessionId: next.sessionId !== undefined ? next.sessionId : session.sessionId,
  };
  if (session.userId && session.userId !== prev) {
    report({
      name: "session.start",
      type: "session.start",
      category: "auth",
      label: `Session ${session.username || session.userId}`,
      path: typeof location !== "undefined" ? location.pathname : undefined,
    });
  }
}

function closePage(reason: string): void {
  if (!currentPath || !pageEnteredAt) return;
  const durationMs = Date.now() - pageEnteredAt;
  report({
    name: "page.hide",
    type: "page.hide",
    category: "navigation",
    label: `Quitte ${currentPath}`,
    path: currentPath,
    durationMs,
    meta: { reason },
  });
  pageEnteredAt = 0;
}

export function trackFleetPageView(path: string): void {
  const next = String(path || "").slice(0, 300);
  if (!next) return;
  if (currentPath === next && pageEnteredAt) return;
  const prev = currentPath;
  if (prev) closePage("navigate");
  currentPath = next;
  pageEnteredAt = Date.now();
  report({
    name: "page.view",
    type: "page.view",
    category: "navigation",
    label: `Page ${next}`,
    path: next,
    referrerPath: prev || undefined,
  });
}

export function trackFleetEvent(payload: FleetReport): void {
  report(payload);
}

function clickLabel(el: Element): string {
  const aid = el.getAttribute(resolveAidAttr());
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
  const el =
    t.closest(
      `[${resolveAidAttr()}],button,a,[role='button'],[role='tab'],input[type='submit']`,
    ) || null;
  if (!el) return;
  // Ignore chrome fenêtre / inputs texte purs
  if (el.closest("." + getShellUiBrand().titlebarNoDragClass)) return;
  if (
    el instanceof HTMLInputElement &&
    el.type !== "submit" &&
    el.type !== "button" &&
    el.type !== "checkbox" &&
    el.type !== "radio"
  ) {
    return;
  }
  const aid = el.getAttribute(resolveAidAttr()) || undefined;
  report({
    name: "ui.click",
    type: "ui.click",
    category: "ui",
    label: clickLabel(el),
    path: currentPath || location.pathname,
    meta: {
      aid: aid || null,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || null,
    },
  });
}

function onVisibility(): void {
  if (document.visibilityState === "hidden") {
    closePage("hidden");
  } else if (document.visibilityState === "visible" && currentPath) {
    pageEnteredAt = Date.now();
    report({
      name: "page.view",
      type: "page.view",
      category: "navigation",
      label: `Retour ${currentPath}`,
      path: currentPath,
      meta: { reason: "visible" },
    });
  }
}

export function ensureFleetTrackerDom(): void {
  if (typeof document === "undefined") return;
  if (!clickBound) {
    document.addEventListener("click", onClickCapture, true);
    clickBound = true;
  }
  if (!visibilityBound) {
    document.addEventListener("visibilitychange", onVisibility);
    visibilityBound = true;
  }
}

export function trackFleetCommerce(opts: {
  action: string;
  entityType: string;
  entityId?: string | number;
  label?: string;
  meta?: Record<string, unknown>;
}): void {
  report({
    name: `commerce.${opts.action}`,
    type: `commerce.${opts.action}`,
    category: "commerce",
    label:
      opts.label ||
      `${opts.action} ${opts.entityType}${opts.entityId != null ? ` #${opts.entityId}` : ""}`,
    path: currentPath || undefined,
    meta: {
      entityType: opts.entityType,
      entityId: opts.entityId != null ? String(opts.entityId) : null,
      ...(opts.meta || {}),
    },
  });
  // Persistance locale (Admin → Analytics) en plus du miroir flotte.
  void import("@creezio/observability/ui")
    .then(({ trackUsageEvent }) => {
      trackUsageEvent({
        eventType: `commerce.${opts.action}`,
        category: "commerce",
        label:
          opts.label ||
          `${opts.action} ${opts.entityType}${opts.entityId != null ? ` #${opts.entityId}` : ""}`,
        meta: {
          entityType: opts.entityType,
          entityId: opts.entityId != null ? String(opts.entityId) : null,
          ...(opts.meta || {}),
        },
      });
    })
    .catch(() => {
      /* ignore — tests / environnements sans tracker */
    });
}
