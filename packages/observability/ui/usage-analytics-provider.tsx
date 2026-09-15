"use client";

/**
 * Monte le tracker d'usage local : session, page views (dwell), capture clics.
 * Persiste via /api/v1/analytics/events (SQLite) + miroir flotte Electron.
 *
 * N6. Session injectée (pas de `@/` marque).
 */

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ensureUsageAnalyticsDom,
  flushUsageAnalytics,
  setUsageAnalyticsSession,
  trackUsagePageView,
} from "./usage-analytics-client";

export type UsageAnalyticsProviderSession = {
  user_id?: string | null;
  user?: string | null;
  kind?: string | null;
  role?: string | null;
} | null;

function newSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function UsageAnalyticsProvider({
  children,
  me,
}: {
  children: ReactNode;
  /** Session courante (marque) — null si anonyme. */
  me: UsageAnalyticsProviderSession;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    ensureUsageAnalyticsDom();
    return () => {
      void flushUsageAnalytics();
    };
  }, []);

  useEffect(() => {
    if (!me) {
      setUsageAnalyticsSession({
        userId: null,
        username: null,
        userKind: "unknown",
        userRole: null,
        sessionId: null,
      });
      sessionIdRef.current = null;
      return;
    }
    if (!sessionIdRef.current) sessionIdRef.current = newSessionId();
    const userId = me.user_id || me.user;
    setUsageAnalyticsSession({
      userId: userId ?? null,
      username: me.user ?? null,
      userKind: me.kind === "ai" ? "ai" : "human",
      userRole: me.role ?? null,
      sessionId: sessionIdRef.current,
    });
  }, [me]);

  useEffect(() => {
    if (!pathname) return;
    const q = search?.toString();
    const path = q ? `${pathname}?${q}` : pathname;
    trackUsagePageView(path);
  }, [pathname, search]);

  return <>{children}</>;
}
