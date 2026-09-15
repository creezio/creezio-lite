/**
 * Agrégations productivité : heatmap, heures actives, pauses, score.
 * Basé sur les événements usage_events (heartbeats, clics, pages, idle…).
 */
import { uaQueryAll as queryAll } from "./adapters.js";
import {
  ensureUsageAnalyticsSchema,
  type UsageFilters,
} from "./usage-analytics.js";

/** Seuil pause courte (gap activité). */
export const BREAK_MIN_MS = 5 * 60_000;
/** Au-delà → coupure de journée / session, pas une pause. */
export const BREAK_MAX_MS = 4 * 60 * 60_000;
/** Granularité activité (fallback sans heartbeat). */
const BUCKET_MS = 5 * 60_000;

type RawEvent = {
  created_at: string;
  event_type: string;
  duration_ms: number | null;
  user_id: string | null;
  username: string | null;
  user_kind: string;
};

export type HeatmapCell = {
  weekday: number; // 0=dim … 6=sam (ISO-ish via JS getUTCDay)
  hour: number; // 0-23
  events: number;
  activeMs: number;
};

export type DailyProductivity = {
  date: string;
  activeMs: number;
  idleMs: number;
  breakMs: number;
  breaksCount: number;
  events: number;
  clicks: number;
  pageViews: number;
  heartbeats: number;
  firstSeen: string | null;
  lastSeen: string | null;
  productivityScore: number;
};

export type BreakSpan = {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  day: string;
};

export type FocusBlock = {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  events: number;
};

export type ProductivitySummary = {
  userId: string;
  username: string;
  kind: string;
  activeMs: number;
  idleMs: number;
  breakMs: number;
  avgActivePerDayMs: number;
  avgBreakMs: number;
  breaksCount: number;
  focusBlocksCount: number;
  avgFocusBlockMs: number;
  peakHour: number | null;
  peakWeekday: number | null;
  eventsPerActiveHour: number;
  focusRatio: number;
  productivityScore: number;
  daysActive: number;
  events: number;
  clicks: number;
  pageViews: number;
};

export type ProductivityReport = {
  period: { from: string; to: string };
  summary: ProductivitySummary | null;
  heatmap: HeatmapCell[];
  daily: DailyProductivity[];
  breaks: BreakSpan[];
  focusBlocks: FocusBlock[];
  leaderboard: ProductivitySummary[];
};

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
  return { sql: parts.join(" AND "), params };
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function scoreProductivity(input: {
  activeMs: number;
  idleMs: number;
  events: number;
  clicks: number;
  daysActive: number;
}): number {
  const activeHours = input.activeMs / 3_600_000;
  const expectedPerDay = 6.5; // journée type CRM
  const coverage =
    input.daysActive > 0
      ? Math.min(1, activeHours / (expectedPerDay * input.daysActive))
      : 0;
  const focus =
    input.activeMs + input.idleMs > 0
      ? input.activeMs / (input.activeMs + input.idleMs)
      : 0;
  const density =
    activeHours > 0 ? Math.min(1, (input.clicks + input.events * 0.15) / (activeHours * 40)) : 0;
  const raw = coverage * 0.45 + focus * 0.35 + density * 0.2;
  return Math.round(Math.max(0, Math.min(100, raw * 100)));
}

function analyzeUserEvents(
  userId: string,
  username: string,
  kind: string,
  events: RawEvent[],
  period: { from: string; to: string },
): Omit<ProductivityReport, "leaderboard" | "period"> {
  const sorted = [...events].sort((a, b) => a.created_at.localeCompare(b.created_at));

  const heatmapMap = new Map<string, HeatmapCell>();
  const dailyMap = new Map<
    string,
    {
      activeBuckets: Set<number>;
      heartbeatMs: number;
      idleMs: number;
      events: number;
      clicks: number;
      pageViews: number;
      heartbeats: number;
      firstSeen: string | null;
      lastSeen: string | null;
      times: number[];
    }
  >();

  const ensureDay = (date: string) => {
    let d = dailyMap.get(date);
    if (!d) {
      d = {
        activeBuckets: new Set(),
        heartbeatMs: 0,
        idleMs: 0,
        events: 0,
        clicks: 0,
        pageViews: 0,
        heartbeats: 0,
        firstSeen: null,
        lastSeen: null,
        times: [],
      };
      dailyMap.set(date, d);
    }
    return d;
  };

  for (const e of sorted) {
    const t = new Date(e.created_at);
    if (Number.isNaN(t.getTime())) continue;
    const date = dayKey(t);
    const day = ensureDay(date);
    day.events += 1;
    day.times.push(t.getTime());
    if (!day.firstSeen) day.firstSeen = e.created_at;
    day.lastSeen = e.created_at;

    if (e.event_type === "ui.click") day.clicks += 1;
    if (e.event_type === "page.view") day.pageViews += 1;
    if (e.event_type === "presence.heartbeat") {
      day.heartbeats += 1;
      day.heartbeatMs += Math.min(e.duration_ms || 60_000, 120_000);
    }
    if (e.event_type === "presence.idle" && e.duration_ms) {
      day.idleMs += e.duration_ms;
    }

    // Bucket activité 5 min
    const bucket = Math.floor(t.getTime() / BUCKET_MS);
    day.activeBuckets.add(bucket);

    const weekday = t.getUTCDay();
    const hour = t.getUTCHours();
    const hk = `${weekday}:${hour}`;
    let cell = heatmapMap.get(hk);
    if (!cell) {
      cell = { weekday, hour, events: 0, activeMs: 0 };
      heatmapMap.set(hk, cell);
    }
    cell.events += 1;
    if (e.event_type === "presence.heartbeat") {
      cell.activeMs += Math.min(e.duration_ms || 60_000, 120_000);
    }
  }

  // Pauses + focus blocks depuis timestamps
  const allTimes = sorted
    .map((e) => new Date(e.created_at).getTime())
    .filter((n) => !Number.isNaN(n));
  const breaks: BreakSpan[] = [];
  const focusBlocks: FocusBlock[] = [];
  let blockStart = allTimes[0] ?? 0;
  let blockEvents = 0;
  let last = allTimes[0] ?? 0;

  for (let i = 0; i < allTimes.length; i++) {
    const cur = allTimes[i]!;
    if (i === 0) {
      blockStart = cur;
      blockEvents = 1;
      last = cur;
      continue;
    }
    const gap = cur - last;
    if (gap >= BREAK_MIN_MS && gap <= BREAK_MAX_MS) {
      // clôturer focus block
      if (last > blockStart) {
        focusBlocks.push({
          startedAt: new Date(blockStart).toISOString(),
          endedAt: new Date(last).toISOString(),
          durationMs: last - blockStart,
          events: blockEvents,
        });
      }
      breaks.push({
        startedAt: new Date(last).toISOString(),
        endedAt: new Date(cur).toISOString(),
        durationMs: gap,
        day: dayKey(new Date(last)),
      });
      blockStart = cur;
      blockEvents = 1;
    } else if (gap > BREAK_MAX_MS) {
      if (last > blockStart) {
        focusBlocks.push({
          startedAt: new Date(blockStart).toISOString(),
          endedAt: new Date(last).toISOString(),
          durationMs: last - blockStart,
          events: blockEvents,
        });
      }
      blockStart = cur;
      blockEvents = 1;
    } else {
      blockEvents += 1;
    }
    last = cur;
  }
  if (allTimes.length && last > blockStart) {
    focusBlocks.push({
      startedAt: new Date(blockStart).toISOString(),
      endedAt: new Date(last).toISOString(),
      durationMs: last - blockStart,
      events: blockEvents,
    });
  }

  const breakMsByDay = new Map<string, { ms: number; n: number }>();
  for (const b of breaks) {
    const cur = breakMsByDay.get(b.day) || { ms: 0, n: 0 };
    cur.ms += b.durationMs;
    cur.n += 1;
    breakMsByDay.set(b.day, cur);
  }

  const daily: DailyProductivity[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => {
      const bucketActive = d.activeBuckets.size * BUCKET_MS;
      const activeMs = d.heartbeatMs > 0 ? d.heartbeatMs : bucketActive;
      const br = breakMsByDay.get(date) || { ms: 0, n: 0 };
      return {
        date,
        activeMs,
        idleMs: d.idleMs,
        breakMs: br.ms,
        breaksCount: br.n,
        events: d.events,
        clicks: d.clicks,
        pageViews: d.pageViews,
        heartbeats: d.heartbeats,
        firstSeen: d.firstSeen,
        lastSeen: d.lastSeen,
        productivityScore: scoreProductivity({
          activeMs,
          idleMs: d.idleMs,
          events: d.events,
          clicks: d.clicks,
          daysActive: 1,
        }),
      };
    });

  const activeMs = daily.reduce((s, d) => s + d.activeMs, 0);
  const idleMs = daily.reduce((s, d) => s + d.idleMs, 0);
  const breakMs = breaks.reduce((s, b) => s + b.durationMs, 0);
  const clicks = daily.reduce((s, d) => s + d.clicks, 0);
  const pageViews = daily.reduce((s, d) => s + d.pageViews, 0);
  const eventsCount = daily.reduce((s, d) => s + d.events, 0);
  const daysActive = daily.filter((d) => d.activeMs > 0 || d.events > 0).length;

  const heatmap = Array.from(heatmapMap.values()).sort(
    (a, b) => a.weekday - b.weekday || a.hour - b.hour,
  );
  let peakHour: number | null = null;
  let peakWeekday: number | null = null;
  let peakVal = -1;
  for (const c of heatmap) {
    const v = c.activeMs + c.events * 1000;
    if (v > peakVal) {
      peakVal = v;
      peakHour = c.hour;
      peakWeekday = c.weekday;
    }
  }

  const activeHours = activeMs / 3_600_000;
  const summary: ProductivitySummary = {
    userId,
    username,
    kind,
    activeMs,
    idleMs,
    breakMs,
    avgActivePerDayMs: daysActive > 0 ? Math.round(activeMs / daysActive) : 0,
    avgBreakMs: breaks.length ? Math.round(breakMs / breaks.length) : 0,
    breaksCount: breaks.length,
    focusBlocksCount: focusBlocks.length,
    avgFocusBlockMs: focusBlocks.length
      ? Math.round(focusBlocks.reduce((s, f) => s + f.durationMs, 0) / focusBlocks.length)
      : 0,
    peakHour,
    peakWeekday,
    eventsPerActiveHour: activeHours > 0 ? Math.round((eventsCount / activeHours) * 10) / 10 : 0,
    focusRatio:
      activeMs + idleMs > 0
        ? Math.round((activeMs / (activeMs + idleMs)) * 1000) / 1000
        : 0,
    productivityScore: scoreProductivity({
      activeMs,
      idleMs,
      events: eventsCount,
      clicks,
      daysActive: Math.max(daysActive, 1),
    }),
    daysActive,
    events: eventsCount,
    clicks,
    pageViews,
  };

  // Cap listes pour l'API
  const recentBreaks = breaks.slice(-40).reverse();
  const topFocus = [...focusBlocks].sort((a, b) => b.durationMs - a.durationMs).slice(0, 20);

  return {
    summary,
    heatmap,
    daily,
    breaks: recentBreaks,
    focusBlocks: topFocus,
  };
}

export function getProductivityReport(filters: UsageFilters): ProductivityReport {
  ensureUsageAnalyticsSchema();
  const { sql, params } = buildWhere(filters);
  const rows = queryAll<RawEvent>(
    `SELECT created_at, event_type, duration_ms, user_id, username, user_kind
     FROM usage_events
     WHERE ${sql}
       AND user_id IS NOT NULL
       AND event_type NOT IN ('session.context')
     ORDER BY created_at ASC
     LIMIT 50000`,
    params,
  );

  const period = { from: filters.from || "", to: filters.to || "" };
  const byUser = new Map<string, RawEvent[]>();
  for (const r of rows) {
    if (!r.user_id) continue;
    const list = byUser.get(r.user_id) || [];
    list.push(r);
    byUser.set(r.user_id, list);
  }

  const leaderboard: ProductivitySummary[] = [];
  let detail: Omit<ProductivityReport, "leaderboard" | "period"> | null = null;

  for (const [uid, evs] of Array.from(byUser.entries())) {
    const username = evs.find((e: RawEvent) => e.username)?.username || uid;
    const kind = evs.find((e: RawEvent) => e.user_kind)?.user_kind || "human";
    const analyzed = analyzeUserEvents(uid, username, kind, evs, period);
    if (analyzed.summary) leaderboard.push(analyzed.summary);
    if (filters.userId && uid === filters.userId) detail = analyzed;
  }

  leaderboard.sort((a, b) => b.productivityScore - a.productivityScore || b.activeMs - a.activeMs);

  // Sans userId : rapport du top user pour la heatmap, + leaderboard
  if (!detail && leaderboard[0]) {
    const topId = leaderboard[0].userId;
    const evs = byUser.get(topId) || [];
    detail = analyzeUserEvents(
      topId,
      leaderboard[0].username,
      leaderboard[0].kind,
      evs,
      period,
    );
  }

  return {
    period,
    summary: detail?.summary || null,
    heatmap: detail?.heatmap || [],
    daily: detail?.daily || [],
    breaks: detail?.breaks || [],
    focusBlocks: detail?.focusBlocks || [],
    leaderboard,
  };
}
