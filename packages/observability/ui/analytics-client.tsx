"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  Bot,
  Clock3,
  Eye,
  Filter,
  MousePointerClick,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";
import { Badge } from "./primitives/badge";
import { Button } from "./primitives/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./primitives/tabs";
import {
  AnalyticsProductivityPanel,
  type ProductivityPayload,
} from "./analytics-productivity-panel";
import { cn } from "./primitives/cn";
import { formatDuration, type UsagePeriod } from "../dist/usage/usage-analytics-shared.js";

type KindFilter = "all" | "human" | "ai";

type OverviewResponse = {
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

type TimelinePoint = {
  bucket: string;
  events: number;
  pageViews: number;
  clicks: number;
  humans: number;
  ai: number;
  timeMs: number;
};

type PageStat = {
  path: string;
  views: number;
  uniqueUsers: number;
  avgTimeMs: number;
  totalTimeMs: number;
};

type ClickStat = {
  label: string;
  clicks: number;
  uniqueUsers: number;
  paths: number;
};

type UserStat = {
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

type EventRow = {
  id: number;
  created_at: string;
  event_type: string;
  category: string;
  label: string | null;
  path: string | null;
  username: string | null;
  user_kind: string;
  duration_ms: number | null;
};

const PERIODS: Array<{ id: UsagePeriod; label: string }> = [
  { id: "day", label: "24 h" },
  { id: "week", label: "7 j" },
  { id: "month", label: "30 j" },
  { id: "year", label: "12 mois" },
];

const KINDS: Array<{ id: KindFilter; label: string }> = [
  { id: "all", label: "Tous" },
  { id: "human", label: "Humains" },
  { id: "ai", label: "IA" },
];

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatBucket(bucket: string, period: UsagePeriod): string {
  if (period === "day") return bucket.slice(11, 16) || bucket;
  if (period === "year") return bucket;
  return bucket.slice(5);
}

function kindBadge(kind: string) {
  if (kind === "ai") {
    return (
      <Badge variant="warning" className="gap-1">
        <Bot className="h-3 w-3" />
        IA
      </Badge>
    );
  }
  if (kind === "human") {
    return <Badge variant="success">Humain</Badge>;
  }
  return <Badge variant="muted">{kind || "—"}</Badge>;
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div
        className={cn(
          "pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-[0.12]",
          accent,
        )}
      />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
            {value}
          </p>
          {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
        </div>
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-sm",
            accent,
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function RankBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full bg-sky-500 transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function AnalyticsClient() {
  const [period, setPeriod] = useState<UsagePeriod>("week");
  const [kind, setKind] = useState<KindFilter>("all");
  const [userId, setUserId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [pages, setPages] = useState<PageStat[]>([]);
  const [clicks, setClicks] = useState<ClickStat[]>([]);
  const [users, setUsers] = useState<UserStat[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [productivity, setProductivity] = useState<ProductivityPayload | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [tab, setTab] = useState("overview");
  const [directory, setDirectory] = useState<
    Array<{ id: string; username: string; kind: string }>
  >([]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ period, kind });
    if (userId) p.set("userId", userId);
    return p.toString();
  }, [period, kind, userId]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v1/users");
        if (!res.ok) return;
        const body = (await res.json()) as {
          users?: Array<{ id: string; username: string; kind?: string }>;
        };
        setDirectory(
          (body.users || []).map((u) => ({
            id: u.id,
            username: u.username,
            kind: u.kind || "human",
          })),
        );
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, tl, pg, ck, us, ev, prod] = await Promise.all([
        fetch(`/api/v1/admin/analytics/overview?${query}`),
        fetch(`/api/v1/admin/analytics/timeline?${query}`),
        fetch(`/api/v1/admin/analytics/pages?${query}&limit=20`),
        fetch(`/api/v1/admin/analytics/clicks?${query}&limit=20`),
        fetch(`/api/v1/admin/analytics/users?${query}&limit=40`),
        fetch(`/api/v1/admin/analytics/events?${query}&limit=80`),
        fetch(`/api/v1/admin/analytics/productivity?${query}`),
      ]);
      for (const r of [ov, tl, pg, ck, us, ev, prod]) {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${r.status}`);
        }
      }
      const ovj = (await ov.json()) as OverviewResponse;
      const tlj = (await tl.json()) as { points: TimelinePoint[] };
      const pgj = (await pg.json()) as { pages: PageStat[] };
      const ckj = (await ck.json()) as { clicks: ClickStat[] };
      const usj = (await us.json()) as { users: UserStat[] };
      const evj = (await ev.json()) as { events: EventRow[]; total: number };
      const prodj = (await prod.json()) as ProductivityPayload;
      setOverview(ovj);
      setTimeline(tlj.points || []);
      setPages(pgj.pages || []);
      setClicks(ckj.clicks || []);
      setUsers(usj.users || []);
      setEvents(evj.events || []);
      setEventsTotal(evj.total ?? 0);
      setProductivity(prodj);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(id);
  }, [autoRefresh, load]);

  async function purgeAll() {
    if (!window.confirm("Purger tous les événements analytics ?")) return;
    try {
      const res = await fetch("/api/v1/admin/analytics/events", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec purge");
    }
  }

  const chartData = useMemo(
    () =>
      timeline.map((p) => ({
        ...p,
        label: formatBucket(p.bucket, period),
        timeMin: Math.round((p.timeMs || 0) / 60000),
      })),
    [timeline, period],
  );

  const maxPageViews = pages[0]?.views || 1;
  const maxClicks = clicks[0]?.clicks || 1;
  const totals = overview?.totals;

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-sky-50/60 p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriod(p.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  period === p.id
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  kind === k.id
                    ? "bg-sky-600 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 shadow-sm outline-none focus:ring-2 focus:ring-sky-200"
            >
              <option value="">Tous les collaborateurs</option>
              {(directory.length
                ? directory
                : users.map((u) => ({
                    id: u.userId,
                    username: u.username,
                    kind: u.kind,
                  }))
              ).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username} ({u.kind})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-slate-300"
            />
            Auto-refresh
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Actualiser
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void purgeAll()}
            className="gap-1.5 text-rose-600 hover:text-rose-700"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Purger
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Pages vues"
          value={(totals?.pageViews ?? 0).toLocaleString("fr-FR")}
          hint={`${totals?.sessions ?? 0} sessions`}
          icon={Eye}
          accent="bg-sky-500"
        />
        <KpiCard
          label="Clics"
          value={(totals?.clicks ?? 0).toLocaleString("fr-FR")}
          hint={`${totals?.events ?? 0} événements`}
          icon={MousePointerClick}
          accent="bg-violet-500"
        />
        <KpiCard
          label="Utilisateurs actifs"
          value={(totals?.activeUsers ?? 0).toLocaleString("fr-FR")}
          hint={`${totals?.activeHumans ?? 0} humains · ${totals?.activeAi ?? 0} IA`}
          icon={Users}
          accent="bg-emerald-500"
        />
        <KpiCard
          label="Temps passé"
          value={formatDuration(totals?.totalTimeMs ?? 0)}
          hint={`moy. session ${formatDuration(totals?.avgSessionTimeMs ?? 0)}`}
          icon={Clock3}
          accent="bg-amber-500"
        />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Vue d&apos;ensemble</TabsTrigger>
          <TabsTrigger value="productivity">Productivité</TabsTrigger>
          <TabsTrigger value="pages">Pages</TabsTrigger>
          <TabsTrigger value="clicks">Clics</TabsTrigger>
          <TabsTrigger value="users">Collaborateurs</TabsTrigger>
          <TabsTrigger value="logs">Journal</TabsTrigger>
        </TabsList>

        <TabsContent value="productivity">
          <AnalyticsProductivityPanel
            data={productivity}
            selectedUserId={userId}
            onSelectUser={setUserId}
          />
        </TabsContent>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Activité</h2>
                  <p className="text-xs text-slate-500">
                    Pages vues, clics et répartition humain / IA
                  </p>
                </div>
                <Activity className="h-4 w-4 text-slate-400" />
              </div>
              <div className="h-72 w-full">
                {chartData.length < 1 ? (
                  <p className="flex h-full items-center justify-center text-sm text-slate-400">
                    Aucune donnée sur cette période
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="fillViews" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="fillClicks" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={36} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 12 }}
                        labelFormatter={(l) => String(l)}
                      />
                      <Area
                        type="monotone"
                        dataKey="pageViews"
                        name="Pages"
                        stroke="#0ea5e9"
                        fill="url(#fillViews)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="clicks"
                        name="Clics"
                        stroke="#8b5cf6"
                        fill="url(#fillClicks)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Répartition</h2>
              <p className="mb-4 text-xs text-slate-500">Événements par type d&apos;acteur</p>
              <div className="space-y-3">
                {(overview?.byKind || []).length === 0 ? (
                  <p className="text-sm text-slate-400">Pas encore de données</p>
                ) : (
                  overview?.byKind.map((row) => {
                    const total = totals?.events || 1;
                    const pct = Math.round((row.events / total) * 100);
                    return (
                      <div key={row.kind} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {kindBadge(row.kind)}
                            <span className="text-xs text-slate-500">
                              {row.users} user{row.users > 1 ? "s" : ""}
                            </span>
                          </div>
                          <span className="text-sm font-semibold tabular-nums text-slate-800">
                            {row.events.toLocaleString("fr-FR")}
                            <span className="ml-1 text-xs font-normal text-slate-400">
                              ({pct}%)
                            </span>
                          </span>
                        </div>
                        <RankBar value={row.events} max={total} />
                        <p className="text-[11px] text-slate-400">
                          Temps {formatDuration(row.timeMs)}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <TopList
              title="Pages les plus vues"
              empty="Aucune page trackée"
              rows={pages.slice(0, 8).map((p) => ({
                key: p.path,
                primary: p.path,
                secondary: `${p.uniqueUsers} users · ${formatDuration(p.avgTimeMs)} moy.`,
                value: p.views,
                max: maxPageViews,
              }))}
            />
            <TopList
              title="Boutons les plus cliqués"
              empty="Aucun clic tracké"
              rows={clicks.slice(0, 8).map((c) => ({
                key: c.label,
                primary: c.label,
                secondary: `${c.uniqueUsers} users · ${c.paths} pages`,
                value: c.clicks,
                max: maxClicks,
              }))}
            />
          </div>
        </TabsContent>

        <TabsContent value="pages">
          <DataTable
            headers={["Page", "Vues", "Users", "Temps moy.", "Temps total"]}
            empty="Aucune page"
            rows={pages.map((p) => [
              <span key="p" className="font-medium text-slate-800">
                {p.path}
              </span>,
              p.views.toLocaleString("fr-FR"),
              p.uniqueUsers.toLocaleString("fr-FR"),
              formatDuration(p.avgTimeMs),
              formatDuration(p.totalTimeMs),
            ])}
          />
        </TabsContent>

        <TabsContent value="clicks">
          <DataTable
            headers={["Élément", "Clics", "Users", "Pages"]}
            empty="Aucun clic"
            rows={clicks.map((c) => [
              <span key="l" className="font-medium text-slate-800">
                {c.label}
              </span>,
              c.clicks.toLocaleString("fr-FR"),
              c.uniqueUsers.toLocaleString("fr-FR"),
              c.paths.toLocaleString("fr-FR"),
            ])}
          />
        </TabsContent>

        <TabsContent value="users">
          <DataTable
            headers={[
              "Collaborateur",
              "Type",
              "Événements",
              "Pages",
              "Clics",
              "Sessions",
              "Temps",
              "Dernière activité",
            ]}
            empty="Aucun utilisateur"
            rows={users.map((u) => [
              <button
                key="u"
                type="button"
                className="text-left font-medium text-sky-700 hover:underline"
                onClick={() => setUserId(u.userId === userId ? "" : u.userId)}
              >
                {u.username}
              </button>,
              kindBadge(u.kind),
              u.events.toLocaleString("fr-FR"),
              u.pageViews.toLocaleString("fr-FR"),
              u.clicks.toLocaleString("fr-FR"),
              u.sessions.toLocaleString("fr-FR"),
              formatDuration(u.timeMs),
              u.lastSeen ? formatTs(u.lastSeen) : "—",
            ])}
          />
        </TabsContent>

        <TabsContent value="logs">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
            <span>
              {eventsTotal.toLocaleString("fr-FR")} événement
              {eventsTotal > 1 ? "s" : ""} — affichage des {events.length} plus récents
            </span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Quand</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Acteur</th>
                    <th className="px-3 py-2 font-medium">Label</th>
                    <th className="px-3 py-2 font-medium">Path</th>
                    <th className="px-3 py-2 font-medium">Durée</th>
                  </tr>
                </thead>
                <tbody>
                  {events.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-slate-400">
                        Journal vide — naviguez dans l&apos;app pour générer des événements
                      </td>
                    </tr>
                  ) : (
                    events.map((e) => (
                      <tr
                        key={e.id}
                        className="border-t border-slate-100 hover:bg-slate-50/80"
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-slate-500">
                          {formatTs(e.created_at)}
                        </td>
                        <td className="px-3 py-2">
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                            {e.event_type}
                          </code>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {kindBadge(e.user_kind)}
                            <span className="text-xs text-slate-700">
                              {e.username || "—"}
                            </span>
                          </div>
                        </td>
                        <td className="max-w-[220px] truncate px-3 py-2 text-slate-800">
                          {e.label || "—"}
                        </td>
                        <td className="max-w-[180px] truncate px-3 py-2 text-xs text-slate-500">
                          {e.path || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-slate-500">
                          {e.duration_ms != null ? formatDuration(e.duration_ms) : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TopList({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: Array<{
    key: string;
    primary: string;
    secondary: string;
    value: number;
    max: number;
  }>;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <div className="mt-3 space-y-3">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">{empty}</p>
        ) : (
          rows.map((r, i) => (
            <div key={r.key} className="space-y-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    <span className="mr-2 text-xs text-slate-400">{i + 1}.</span>
                    {r.primary}
                  </p>
                  <p className="truncate text-[11px] text-slate-400">{r.secondary}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                  {r.value.toLocaleString("fr-FR")}
                </span>
              </div>
              <RankBar value={r.value} max={r.max} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DataTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: React.ReactNode[][];
  empty: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {headers.map((h) => (
                <th key={h} className="px-3 py-2.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={headers.length}
                  className="px-3 py-10 text-center text-slate-400"
                >
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/70">
                  {row.map((cell, j) => (
                    <td key={j} className="px-3 py-2.5 align-middle text-slate-700">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
