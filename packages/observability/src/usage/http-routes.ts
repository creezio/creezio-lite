/**
 * Routes Hono usage analytics — ingest + admin (N6).
 * Auth owner pour admin reste côté marque (montage).
 */
import { Hono } from "hono";
import {
  getTopClicks,
  getTopPages,
  getUsageOverview,
  getUsageTimeline,
  getUserStats,
  insertUsageEvents,
  listUsageEvents,
  purgeUsageEvents,
  resolvePeriodFilters,
  type UsageEventInput,
} from "./usage-analytics.js";
import { getProductivityReport } from "./usage-analytics-productivity.js";
import type { UsagePeriod, UsageUserKind } from "./usage-analytics-shared.js";

export type UsageAnalyticsSession = {
  sub: string;
  email?: string | null;
  role?: string | null;
};

export type UsageAnalyticsRouteDeps = {
  getSession: (c: {
    get: (k: string) => unknown;
    req: { header: (n: string) => string | undefined };
  }) => Promise<UsageAnalyticsSession | null> | UsageAnalyticsSession | null;
  getUserKind: (userId: string) => UsageUserKind | string | null | undefined;
};

type IngestBody = {
  events?: Array<{
    eventType?: string;
    type?: string;
    name?: string;
    category?: string;
    label?: string;
    path?: string;
    referrerPath?: string;
    sessionId?: string;
    durationMs?: number;
    meta?: Record<string, unknown>;
    surface?: string;
    createdAt?: string;
  }>;
};

export function createUsageAnalyticsIngestRoutes(
  deps: UsageAnalyticsRouteDeps,
): Hono {
  const app = new Hono();

  app.post("/events", async (c) => {
    const session = await deps.getSession(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);

    let body: IngestBody;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON attendu" }, 400);
    }

    const raw = Array.isArray(body.events) ? body.events : [];
    if (!raw.length) return c.json({ ok: true, inserted: 0 });
    if (raw.length > 100) return c.json({ error: "Max 100 événements par batch" }, 400);

    const userKind = (deps.getUserKind(session.sub) || "human") as UsageUserKind;
    const ua = c.req.header("user-agent") || null;

    const events: UsageEventInput[] = raw.map((e) => ({
      eventType: e.eventType || e.type || e.name || "event",
      category: e.category || "ui",
      label: e.label,
      path: e.path,
      referrerPath: e.referrerPath,
      userId: session.sub,
      username: session.email,
      userKind,
      userRole: session.role,
      sessionId: e.sessionId,
      durationMs: e.durationMs,
      meta: e.meta || null,
      userAgent: ua,
      surface: e.surface || "crm",
      createdAt: e.createdAt,
    }));

    try {
      const inserted = insertUsageEvents(events);
      return c.json({ ok: true, inserted });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Échec insertion" },
        500,
      );
    }
  });

  return app;
}

function parseAdminFilters(c: {
  req: { query: (k: string) => string | undefined };
}) {
  const periodRaw = (c.req.query("period") || "week").toLowerCase();
  const period = (
    ["day", "week", "month", "year"].includes(periodRaw) ? periodRaw : "week"
  ) as UsagePeriod;
  const bounds = resolvePeriodFilters(period, c.req.query("from"), c.req.query("to"));
  const kindRaw = (c.req.query("kind") || "all").toLowerCase();
  const kind = (
    ["human", "ai", "system", "unknown", "all"].includes(kindRaw)
      ? kindRaw
      : "all"
  ) as UsageUserKind | "all";
  return {
    period,
    filters: {
      ...bounds,
      userId: c.req.query("userId") || undefined,
      kind,
      eventType: c.req.query("eventType") || undefined,
      path: c.req.query("path") || undefined,
      q: c.req.query("q") || undefined,
    },
  };
}

export function createUsageAnalyticsAdminRoutes(): Hono {
  const app = new Hono();

  app.get("/analytics/overview", (c) => {
    const { period, filters } = parseAdminFilters(c);
    return c.json({ periodKey: period, ...getUsageOverview(filters) });
  });

  app.get("/analytics/timeline", (c) => {
    const { period, filters } = parseAdminFilters(c);
    return c.json({
      periodKey: period,
      period: { from: filters.from || "", to: filters.to || "" },
      points: getUsageTimeline(filters, period),
    });
  });

  app.get("/analytics/pages", (c) => {
    const { period, filters } = parseAdminFilters(c);
    const limit = Number(c.req.query("limit")) || 25;
    return c.json({
      periodKey: period,
      period: { from: filters.from || "", to: filters.to || "" },
      pages: getTopPages(filters, limit),
    });
  });

  app.get("/analytics/clicks", (c) => {
    const { period, filters } = parseAdminFilters(c);
    const limit = Number(c.req.query("limit")) || 25;
    return c.json({
      periodKey: period,
      period: { from: filters.from || "", to: filters.to || "" },
      clicks: getTopClicks(filters, limit),
    });
  });

  app.get("/analytics/users", (c) => {
    const { period, filters } = parseAdminFilters(c);
    const limit = Number(c.req.query("limit")) || 50;
    return c.json({
      periodKey: period,
      period: { from: filters.from || "", to: filters.to || "" },
      users: getUserStats(filters, limit),
    });
  });

  app.get("/analytics/events", (c) => {
    const { period, filters } = parseAdminFilters(c);
    const limit = Number(c.req.query("limit")) || 100;
    const offset = Number(c.req.query("offset")) || 0;
    const result = listUsageEvents({ ...filters, limit, offset });
    return c.json({
      periodKey: period,
      period: { from: filters.from || "", to: filters.to || "" },
      ...result,
    });
  });

  app.get("/analytics/productivity", (c) => {
    const { period, filters } = parseAdminFilters(c);
    return c.json({
      periodKey: period,
      ...getProductivityReport(filters),
    });
  });

  app.delete("/analytics/events", async (c) => {
    let body: { all?: boolean; before?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    if (!body.all && !body.before) {
      return c.json({ error: "Précisez all=true ou before=ISO" }, 400);
    }
    const cleared = purgeUsageEvents(body);
    return c.json({ ok: true, cleared });
  });

  return app;
}
