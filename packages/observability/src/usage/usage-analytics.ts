/**
 * Analytics d'usage — persistance SQLite + agrégations Admin.
 * Événements UI (pages, clics, dwell) + actions serveur (agent IA…).
 */
import {
  uaGetWriteDb as getWriteDb,
  uaQueryAll as queryAll,
  uaQueryOne as queryOne,
  uaTableExists as tableExists,
} from "./adapters.js";
import {
  formatDuration,
  type UsagePeriod,
  type UsageUserKind,
} from "./usage-analytics-shared.js";

export type { UsagePeriod, UsageUserKind };
export { formatDuration };

export type UsageEventInput = {
  eventType: string;
  category?: string;
  label?: string | null;
  path?: string | null;
  referrerPath?: string | null;
  userId?: string | null;
  username?: string | null;
  userKind?: UsageUserKind | string | null;
  userRole?: string | null;
  sessionId?: string | null;
  durationMs?: number | null;
  meta?: Record<string, unknown> | null;
  userAgent?: string | null;
  surface?: string | null;
  createdAt?: string | null;
};

export type UsageEventRow = {
  id: number;
  created_at: string;
  event_type: string;
  category: string;
  label: string | null;
  path: string | null;
  referrer_path: string | null;
  user_id: string | null;
  username: string | null;
  user_kind: string;
  user_role: string | null;
  session_id: string | null;
  duration_ms: number | null;
  meta_json: string | null;
  user_agent: string | null;
  surface: string;
};

export type UsageFilters = {
  from?: string;
  to?: string;
  userId?: string;
  kind?: UsageUserKind | "all";
  eventType?: string;
  path?: string;
  q?: string;
};

let schemaReady = false;

export function usageAnalyticsReady(): boolean {
  return tableExists("usage_events");
}

/** Crée la table si absente (dev / avant migration Electron). */
export function ensureUsageAnalyticsSchema(): void {
  if (schemaReady && usageAnalyticsReady()) return;
  const db = getWriteDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      event_type TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'ui',
      label TEXT,
      path TEXT,
      referrer_path TEXT,
      user_id TEXT,
      username TEXT,
      user_kind TEXT NOT NULL DEFAULT 'human',
      user_role TEXT,
      session_id TEXT,
      duration_ms INTEGER,
      meta_json TEXT,
      user_agent TEXT,
      surface TEXT NOT NULL DEFAULT 'crm'
    );
    CREATE INDEX IF NOT EXISTS idx_usage_events_created
      ON usage_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_events_user_created
      ON usage_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_events_type_created
      ON usage_events(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_events_path_created
      ON usage_events(path, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_events_kind_created
      ON usage_events(user_kind, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_events_session
      ON usage_events(session_id, created_at);
  `);
  schemaReady = true;
}

function normalizeKind(v: unknown): UsageUserKind {
  const s = String(v || "").toLowerCase();
  if (s === "ai") return "ai";
  if (s === "system") return "system";
  if (s === "human") return "human";
  return "unknown";
}

function clampStr(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function periodBounds(period: UsagePeriod, now = new Date()): { from: string; to: string } {
  const to = now.toISOString();
  const d = new Date(now);
  if (period === "day") d.setUTCDate(d.getUTCDate() - 1);
  else if (period === "week") d.setUTCDate(d.getUTCDate() - 7);
  else if (period === "month") d.setUTCDate(d.getUTCDate() - 30);
  else d.setUTCFullYear(d.getUTCFullYear() - 1);
  return { from: d.toISOString(), to };
}

function buildWhere(filters: UsageFilters): { sql: string; params: unknown[] } {
  const parts: string[] = ["1=1"];
  const params: unknown[] = [];
  if (filters.from) {
    parts.push("created_at >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    parts.push("created_at <= ?");
    params.push(filters.to);
  }
  if (filters.userId) {
    parts.push("user_id = ?");
    params.push(filters.userId);
  }
  if (filters.kind && filters.kind !== "all") {
    parts.push("user_kind = ?");
    params.push(filters.kind);
  }
  if (filters.eventType) {
    parts.push("event_type = ?");
    params.push(filters.eventType);
  }
  if (filters.path) {
    parts.push("path LIKE ?");
    params.push(`${filters.path}%`);
  }
  if (filters.q) {
    parts.push("(label LIKE ? OR path LIKE ? OR username LIKE ? OR event_type LIKE ?)");
    const like = `%${filters.q}%`;
    params.push(like, like, like, like);
  }
  return { sql: parts.join(" AND "), params };
}

export function insertUsageEvents(events: UsageEventInput[]): number {
  if (!events.length) return 0;
  ensureUsageAnalyticsSchema();
  const db = getWriteDb();
  const stmt = db.prepare(`
    INSERT INTO usage_events (
      created_at, event_type, category, label, path, referrer_path,
      user_id, username, user_kind, user_role, session_id,
      duration_ms, meta_json, user_agent, surface
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  let inserted = 0;
  const insertRows = (rows: UsageEventInput[]) => {
    for (const e of rows) {
      const eventType = clampStr(e.eventType, 80);
      if (!eventType) continue;
      const duration =
        typeof e.durationMs === "number" && Number.isFinite(e.durationMs) && e.durationMs >= 0
          ? Math.min(Math.round(e.durationMs), 86_400_000)
          : null;
      stmt.run(
        clampStr(e.createdAt, 40) || now,
        eventType,
        clampStr(e.category, 40) || "ui",
        clampStr(e.label, 240),
        clampStr(e.path, 500),
        clampStr(e.referrerPath, 500),
        clampStr(e.userId, 80),
        clampStr(e.username, 120),
        normalizeKind(e.userKind),
        clampStr(e.userRole, 40),
        clampStr(e.sessionId, 80),
        duration,
        e.meta ? JSON.stringify(e.meta).slice(0, 4000) : null,
        clampStr(e.userAgent, 300),
        clampStr(e.surface, 40) || "crm",
      );
      inserted += 1;
    }
  };
  if (db.transaction) db.transaction(insertRows)(events);
  else insertRows(events);
  return inserted;
}

export function recordUsageEvent(event: UsageEventInput): void {
  try {
    insertUsageEvents([event]);
  } catch {
    /* ne jamais casser le flux métier */
  }
}

export function resolvePeriodFilters(
  period: UsagePeriod | string | undefined,
  from?: string,
  to?: string,
): UsageFilters {
  const p = (["day", "week", "month", "year"] as const).includes(period as UsagePeriod)
    ? (period as UsagePeriod)
    : "week";
  if (from || to) {
    return { from: from || undefined, to: to || undefined };
  }
  return periodBounds(p);
}

export type UsageOverview = {
  period: { from: string; to: string };
  totals: {
    events: number;
    pageViews: number;
    clicks: number;
    sessions: number;
    activeUsers: number;
    activeHumans: number;
    activeAi: number;
    totalTimeMs: number;
    avgSessionTimeMs: number;
  };
  byKind: Array<{ kind: string; events: number; users: number; timeMs: number }>;
};

export function getUsageOverview(filters: UsageFilters): UsageOverview {
  ensureUsageAnalyticsSchema();
  const { sql, params } = buildWhere(filters);
  const totals = queryOne<{
    events: number;
    page_views: number;
    clicks: number;
    sessions: number;
    active_users: number;
    active_humans: number;
    active_ai: number;
    total_time_ms: number;
  }>(
    `SELECT
       COUNT(*) AS events,
       SUM(CASE WHEN event_type = 'page.view' THEN 1 ELSE 0 END) AS page_views,
       SUM(CASE WHEN event_type = 'ui.click' THEN 1 ELSE 0 END) AS clicks,
       COUNT(DISTINCT session_id) AS sessions,
       COUNT(DISTINCT user_id) AS active_users,
       COUNT(DISTINCT CASE WHEN user_kind = 'human' THEN user_id END) AS active_humans,
       COUNT(DISTINCT CASE WHEN user_kind = 'ai' THEN user_id END) AS active_ai,
       COALESCE(SUM(CASE WHEN duration_ms IS NOT NULL THEN duration_ms ELSE 0 END), 0) AS total_time_ms
     FROM usage_events
     WHERE ${sql}`,
    params,
  );
  const byKind = queryAll<{ kind: string; events: number; users: number; time_ms: number }>(
    `SELECT
       user_kind AS kind,
       COUNT(*) AS events,
       COUNT(DISTINCT user_id) AS users,
       COALESCE(SUM(CASE WHEN duration_ms IS NOT NULL THEN duration_ms ELSE 0 END), 0) AS time_ms
     FROM usage_events
     WHERE ${sql}
     GROUP BY user_kind
     ORDER BY events DESC`,
    params,
  );
  const sessions = totals?.sessions ?? 0;
  const totalTimeMs = totals?.total_time_ms ?? 0;
  return {
    period: { from: filters.from || "", to: filters.to || "" },
    totals: {
      events: totals?.events ?? 0,
      pageViews: totals?.page_views ?? 0,
      clicks: totals?.clicks ?? 0,
      sessions,
      activeUsers: totals?.active_users ?? 0,
      activeHumans: totals?.active_humans ?? 0,
      activeAi: totals?.active_ai ?? 0,
      totalTimeMs,
      avgSessionTimeMs: sessions > 0 ? Math.round(totalTimeMs / sessions) : 0,
    },
    byKind: byKind.map((r) => ({
      kind: r.kind,
      events: r.events,
      users: r.users,
      timeMs: r.time_ms,
    })),
  };
}

export type TimelineBucket = {
  bucket: string;
  events: number;
  pageViews: number;
  clicks: number;
  humans: number;
  ai: number;
  timeMs: number;
};

function bucketExpr(period: UsagePeriod): string {
  if (period === "day") return `strftime('%Y-%m-%d %H:00', created_at)`;
  if (period === "year") return `strftime('%Y-%m', created_at)`;
  return `strftime('%Y-%m-%d', created_at)`;
}

export function getUsageTimeline(
  filters: UsageFilters,
  period: UsagePeriod = "week",
): TimelineBucket[] {
  ensureUsageAnalyticsSchema();
  const { sql, params } = buildWhere(filters);
  const bucket = bucketExpr(period);
  return queryAll<{
    bucket: string;
    events: number;
    page_views: number;
    clicks: number;
    humans: number;
    ai: number;
    time_ms: number;
  }>(
    `SELECT
       ${bucket} AS bucket,
       COUNT(*) AS events,
       SUM(CASE WHEN event_type = 'page.view' THEN 1 ELSE 0 END) AS page_views,
       SUM(CASE WHEN event_type = 'ui.click' THEN 1 ELSE 0 END) AS clicks,
       SUM(CASE WHEN user_kind = 'human' THEN 1 ELSE 0 END) AS humans,
       SUM(CASE WHEN user_kind = 'ai' THEN 1 ELSE 0 END) AS ai,
       COALESCE(SUM(CASE WHEN duration_ms IS NOT NULL THEN duration_ms ELSE 0 END), 0) AS time_ms
     FROM usage_events
     WHERE ${sql}
     GROUP BY bucket
     ORDER BY bucket ASC`,
    params,
  ).map((r) => ({
    bucket: r.bucket,
    events: r.events,
    pageViews: r.page_views,
    clicks: r.clicks,
    humans: r.humans,
    ai: r.ai,
    timeMs: r.time_ms,
  }));
}

export type PageStat = {
  path: string;
  views: number;
  uniqueUsers: number;
  avgTimeMs: number;
  totalTimeMs: number;
};

export function getTopPages(filters: UsageFilters, limit = 25): PageStat[] {
  ensureUsageAnalyticsSchema();
  const { sql, params } = buildWhere(filters);
  return queryAll<{
    path: string;
    views: number;
    unique_users: number;
    avg_time_ms: number;
    total_time_ms: number;
  }>(
    `SELECT
       COALESCE(path, '(inconnu)') AS path,
       SUM(CASE WHEN event_type = 'page.view' THEN 1 ELSE 0 END) AS views,
       COUNT(DISTINCT user_id) AS unique_users,
       COALESCE(AVG(CASE WHEN event_type IN ('page.hide','page.dwell') AND duration_ms IS NOT NULL THEN duration_ms END), 0) AS avg_time_ms,
       COALESCE(SUM(CASE WHEN duration_ms IS NOT NULL THEN duration_ms ELSE 0 END), 0) AS total_time_ms
     FROM usage_events
     WHERE ${sql} AND path IS NOT NULL AND path != ''
     GROUP BY path
     HAVING views > 0
     ORDER BY views DESC
     LIMIT ?`,
    [...params, Math.min(Math.max(limit, 1), 200)],
  ).map((r) => ({
    path: r.path,
    views: r.views,
    uniqueUsers: r.unique_users,
    avgTimeMs: Math.round(r.avg_time_ms || 0),
    totalTimeMs: r.total_time_ms,
  }));
}

export type ClickStat = {
  label: string;
  clicks: number;
  uniqueUsers: number;
  paths: number;
};

export function getTopClicks(filters: UsageFilters, limit = 25): ClickStat[] {
  ensureUsageAnalyticsSchema();
  const { sql, params } = buildWhere(filters);
  return queryAll<{
    label: string;
    clicks: number;
    unique_users: number;
    paths: number;
  }>(
    `SELECT
       COALESCE(NULLIF(TRIM(label), ''), '(sans label)') AS label,
       COUNT(*) AS clicks,
       COUNT(DISTINCT user_id) AS unique_users,
       COUNT(DISTINCT path) AS paths
     FROM usage_events
     WHERE ${sql} AND event_type = 'ui.click'
     GROUP BY label
     ORDER BY clicks DESC
     LIMIT ?`,
    [...params, Math.min(Math.max(limit, 1), 200)],
  ).map((r) => ({
    label: r.label,
    clicks: r.clicks,
    uniqueUsers: r.unique_users,
    paths: r.paths,
  }));
}

export type UserStat = {
  userId: string;
  username: string;
  kind: string;
  role: string | null;
  events: number;
  pageViews: number;
  clicks: number;
  sessions: number;
  timeMs: number;
  lastSeen: string | null;
};

export function getUserStats(filters: UsageFilters, limit = 50): UserStat[] {
  ensureUsageAnalyticsSchema();
  const { sql, params } = buildWhere(filters);
  return queryAll<{
    user_id: string;
    username: string;
    kind: string;
    role: string | null;
    events: number;
    page_views: number;
    clicks: number;
    sessions: number;
    time_ms: number;
    last_seen: string | null;
  }>(
    `SELECT
       COALESCE(user_id, 'anonymous') AS user_id,
       COALESCE(MAX(username), user_id, 'anonymous') AS username,
       MAX(user_kind) AS kind,
       MAX(user_role) AS role,
       COUNT(*) AS events,
       SUM(CASE WHEN event_type = 'page.view' THEN 1 ELSE 0 END) AS page_views,
       SUM(CASE WHEN event_type = 'ui.click' THEN 1 ELSE 0 END) AS clicks,
       COUNT(DISTINCT session_id) AS sessions,
       COALESCE(SUM(CASE WHEN duration_ms IS NOT NULL THEN duration_ms ELSE 0 END), 0) AS time_ms,
       MAX(created_at) AS last_seen
     FROM usage_events
     WHERE ${sql}
     GROUP BY COALESCE(user_id, 'anonymous')
     ORDER BY events DESC
     LIMIT ?`,
    [...params, Math.min(Math.max(limit, 1), 200)],
  ).map((r) => ({
    userId: r.user_id,
    username: r.username,
    kind: r.kind,
    role: r.role,
    events: r.events,
    pageViews: r.page_views,
    clicks: r.clicks,
    sessions: r.sessions,
    timeMs: r.time_ms,
    lastSeen: r.last_seen,
  }));
}

export function listUsageEvents(
  filters: UsageFilters & { limit?: number; offset?: number },
): { events: UsageEventRow[]; total: number } {
  ensureUsageAnalyticsSchema();
  const { sql, params } = buildWhere(filters);
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  const total =
    queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM usage_events WHERE ${sql}`, params)?.c ??
    0;
  const events = queryAll<UsageEventRow>(
    `SELECT * FROM usage_events WHERE ${sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { events, total };
}

export function purgeUsageEvents(opts: { before?: string; all?: boolean } = {}): number {
  ensureUsageAnalyticsSchema();
  const db = getWriteDb();
  if (opts.all) {
    const info = db.prepare(`DELETE FROM usage_events`).run();
    return info.changes;
  }
  if (opts.before) {
    const info = db.prepare(`DELETE FROM usage_events WHERE created_at < ?`).run(opts.before);
    return info.changes;
  }
  return 0;
}

