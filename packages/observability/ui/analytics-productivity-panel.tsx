"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Coffee, Flame, Gauge, Timer } from "lucide-react";
import { Badge } from "./primitives/badge";
import { cn } from "./primitives/cn";
import { formatDuration } from "../dist/usage/usage-analytics-shared.js";

export type ProductivityPayload = {
  summary: {
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
  } | null;
  heatmap: Array<{ weekday: number; hour: number; events: number; activeMs: number }>;
  daily: Array<{
    date: string;
    activeMs: number;
    idleMs: number;
    breakMs: number;
    breaksCount: number;
    events: number;
    clicks: number;
    pageViews: number;
    productivityScore: number;
    firstSeen: string | null;
    lastSeen: string | null;
  }>;
  breaks: Array<{
    startedAt: string;
    endedAt: string;
    durationMs: number;
    day: string;
  }>;
  focusBlocks: Array<{
    startedAt: string;
    endedAt: string;
    durationMs: number;
    events: number;
  }>;
  leaderboard: Array<{
    userId: string;
    username: string;
    kind: string;
    activeMs: number;
    breakMs: number;
    breaksCount: number;
    productivityScore: number;
    avgActivePerDayMs: number;
    focusRatio: number;
    events: number;
  }>;
};

const WEEKDAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function scoreTone(score: number): string {
  if (score >= 75) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (score >= 45) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-rose-700 bg-rose-50 border-rose-200";
}

function heatColor(intensity: number, max: number): string {
  if (max <= 0 || intensity <= 0) return "bg-slate-50";
  const t = intensity / max;
  if (t < 0.15) return "bg-sky-100";
  if (t < 0.35) return "bg-sky-200";
  if (t < 0.55) return "bg-sky-300";
  if (t < 0.75) return "bg-sky-400";
  if (t < 0.9) return "bg-sky-500";
  return "bg-sky-600";
}

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}h`;
}

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function AnalyticsProductivityPanel({
  data,
  selectedUserId,
  onSelectUser,
}: {
  data: ProductivityPayload | null;
  selectedUserId: string;
  onSelectUser: (userId: string) => void;
}) {
  const summary = data?.summary || null;

  const heatMax = useMemo(() => {
    let m = 0;
    for (const c of data?.heatmap || []) {
      const v = c.activeMs > 0 ? c.activeMs : c.events * 30_000;
      if (v > m) m = v;
    }
    return m;
  }, [data?.heatmap]);

  const heatLookup = useMemo(() => {
    const map = new Map<string, { events: number; activeMs: number }>();
    for (const c of data?.heatmap || []) {
      map.set(`${c.weekday}:${c.hour}`, { events: c.events, activeMs: c.activeMs });
    }
    return map;
  }, [data?.heatmap]);

  const dailyChart = useMemo(
    () =>
      (data?.daily || []).map((d) => ({
        date: d.date.slice(5),
        activeH: Math.round((d.activeMs / 3_600_000) * 100) / 100,
        breakH: Math.round((d.breakMs / 3_600_000) * 100) / 100,
        idleH: Math.round((d.idleMs / 3_600_000) * 100) / 100,
        score: d.productivityScore,
      })),
    [data?.daily],
  );

  if (!data) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center text-sm text-slate-400">
        Chargement productivité…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Explication méthodo */}
      <div className="rounded-2xl border border-sky-100 bg-gradient-to-r from-sky-50/80 to-white px-4 py-3 text-xs leading-relaxed text-slate-600">
        <strong className="text-slate-800">Comment c’est calculé — </strong>
        présence active via heartbeats (60s) + interactions ; idle après 2 min sans
        activité ; pauses = trous d’activité entre 5 min et 4 h ; score 0–100 =
        couverture horaire × focus (actif vs idle) × densité d’actions. Aucune frappe
        clavier n’est enregistrée.
      </div>

      {/* Leaderboard */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Classement collaborateurs</h2>
            <p className="text-xs text-slate-500">
              Cliquez un employé pour ouvrir sa heatmap et ses pauses
            </p>
          </div>
          <Gauge className="h-4 w-4 text-slate-400" />
        </div>
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">Collaborateur</th>
                <th className="px-2 py-2 font-medium">Score</th>
                <th className="px-2 py-2 font-medium">Actif / jour</th>
                <th className="px-2 py-2 font-medium">Pauses</th>
                <th className="px-2 py-2 font-medium">Focus</th>
              </tr>
            </thead>
            <tbody>
              {(data.leaderboard || []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-8 text-center text-slate-400">
                    Pas encore assez de données de présence — naviguez dans l’app quelques
                    minutes (heartbeats).
                  </td>
                </tr>
              ) : (
                data.leaderboard.map((u, i) => (
                  <tr
                    key={u.userId}
                    className={cn(
                      "cursor-pointer border-t border-slate-100 transition-colors hover:bg-sky-50/60",
                      selectedUserId === u.userId && "bg-sky-50",
                    )}
                    onClick={() =>
                      onSelectUser(selectedUserId === u.userId ? "" : u.userId)
                    }
                  >
                    <td className="px-2 py-2 text-xs text-slate-400">{i + 1}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800">{u.username}</span>
                        <Badge variant={u.kind === "ai" ? "warning" : "success"}>
                          {u.kind === "ai" ? "IA" : "Humain"}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={cn(
                          "inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums",
                          scoreTone(u.productivityScore),
                        )}
                      >
                        {u.productivityScore}
                      </span>
                    </td>
                    <td className="px-2 py-2 tabular-nums text-slate-700">
                      {formatDuration(u.avgActivePerDayMs)}
                    </td>
                    <td className="px-2 py-2 text-slate-700">
                      {u.breaksCount}{" "}
                      <span className="text-xs text-slate-400">
                        ({formatDuration(u.breakMs)})
                      </span>
                    </td>
                    <td className="px-2 py-2 tabular-nums text-slate-700">
                      {Math.round((u.focusRatio || 0) * 100)}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MiniKpi
              icon={Gauge}
              label={`Score · ${summary.username}`}
              value={String(summary.productivityScore)}
              hint={`${summary.daysActive} jour${summary.daysActive > 1 ? "s" : ""} actif${summary.daysActive > 1 ? "s" : ""}`}
              accent="bg-emerald-500"
            />
            <MiniKpi
              icon={Timer}
              label="Temps actif / jour"
              value={formatDuration(summary.avgActivePerDayMs)}
              hint={`Total ${formatDuration(summary.activeMs)}`}
              accent="bg-sky-500"
            />
            <MiniKpi
              icon={Coffee}
              label="Pauses"
              value={String(summary.breaksCount)}
              hint={`Moy. ${formatDuration(summary.avgBreakMs)} · total ${formatDuration(summary.breakMs)}`}
              accent="bg-amber-500"
            />
            <MiniKpi
              icon={Flame}
              label="Pic d'activité"
              value={
                summary.peakHour != null && summary.peakWeekday != null
                  ? `${WEEKDAYS[summary.peakWeekday]} ${formatHour(summary.peakHour)}`
                  : "—"
              }
              hint={`${summary.eventsPerActiveHour} evt/h actif · focus ${Math.round(summary.focusRatio * 100)}%`}
              accent="bg-violet-500"
            />
          </div>

          {/* Heatmap */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-slate-900">
                Heatmap d’activité — {summary.username}
              </h2>
              <p className="text-xs text-slate-500">
                Intensité par jour de la semaine × heure (UTC). Plus c’est foncé, plus
                l’employé est actif.
              </p>
            </div>
            <div className="overflow-x-auto">
              <div className="inline-block min-w-full">
                <div
                  className="grid gap-1"
                  style={{ gridTemplateColumns: `48px repeat(24, minmax(18px, 1fr))` }}
                >
                  <div />
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="text-center text-[9px] tabular-nums text-slate-400"
                    >
                      {h % 3 === 0 ? h : ""}
                    </div>
                  ))}
                  {WEEKDAYS.map((label, weekday) => (
                    <div key={label} className="contents">
                      <div className="flex items-center text-[11px] font-medium text-slate-500">
                        {label}
                      </div>
                      {HOURS.map((hour) => {
                        const cell = heatLookup.get(`${weekday}:${hour}`);
                        const intensity = cell
                          ? cell.activeMs > 0
                            ? cell.activeMs
                            : cell.events * 30_000
                          : 0;
                        const title = cell
                          ? `${label} ${formatHour(hour)} — ${cell.events} evt · ${formatDuration(cell.activeMs)}`
                          : `${label} ${formatHour(hour)} — aucune activité`;
                        return (
                          <div
                            key={`${weekday}-${hour}`}
                            title={title}
                            className={cn(
                              "aspect-square rounded-sm transition-colors",
                              heatColor(intensity, heatMax),
                            )}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-400">
                  <span>Faible</span>
                  <div className="flex gap-0.5">
                    {["bg-slate-50", "bg-sky-100", "bg-sky-300", "bg-sky-500", "bg-sky-600"].map(
                      (c) => (
                        <div key={c} className={cn("h-3 w-4 rounded-sm", c)} />
                      ),
                    )}
                  </div>
                  <span>Fort</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Heures actives / jour</h2>
              <p className="mb-3 text-xs text-slate-500">
                Temps actif vs pauses détectées (heures)
              </p>
              <div className="h-56">
                {dailyChart.length < 1 ? (
                  <p className="flex h-full items-center justify-center text-sm text-slate-400">
                    Pas de série quotidienne
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={28} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 12 }}
                        formatter={(v: number, name: string) => [
                          `${v} h`,
                          name === "activeH"
                            ? "Actif"
                            : name === "breakH"
                              ? "Pauses"
                              : "Idle",
                        ]}
                      />
                      <Bar dataKey="activeH" name="activeH" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="breakH" name="breakH" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Pauses détectées</h2>
              <p className="mb-3 text-xs text-slate-500">
                Gaps d’activité 5 min – 4 h (au-delà = coupure de journée)
              </p>
              <div className="max-h-56 space-y-2 overflow-auto">
                {(data.breaks || []).length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">
                    Aucune pause détectée sur la période
                  </p>
                ) : (
                  data.breaks.map((b, i) => (
                    <div
                      key={`${b.startedAt}-${i}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {formatTs(b.startedAt)} → {formatTs(b.endedAt)}
                        </p>
                        <p className="text-[11px] text-slate-400">{b.day}</p>
                      </div>
                      <span className="shrink-0 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-800">
                        {formatDuration(b.durationMs)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Blocs de focus</h2>
            <p className="mb-3 text-xs text-slate-500">
              Plus longs segments d’activité continue (sans pause ≥ 5 min)
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(data.focusBlocks || []).length === 0 ? (
                <p className="col-span-full py-6 text-center text-sm text-slate-400">
                  Pas encore de blocs de focus
                </p>
              ) : (
                data.focusBlocks.map((f, i) => (
                  <div
                    key={`${f.startedAt}-${i}`}
                    className="rounded-xl border border-slate-100 bg-gradient-to-br from-white to-sky-50/40 px-3 py-2.5"
                  >
                    <p className="text-sm font-semibold tabular-nums text-slate-900">
                      {formatDuration(f.durationMs)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {formatTs(f.startedAt)} · {f.events} événements
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      ) : (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white py-10 text-center text-sm text-slate-400">
          Sélectionnez un collaborateur dans le classement pour voir sa heatmap détaillée.
        </p>
      )}
    </div>
  );
}

function MiniKpi({
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
