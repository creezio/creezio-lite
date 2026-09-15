"use client";

import { useCallback, useEffect, useState } from "react";
import { Bug, ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "./primitives/button";
import { cn } from "./primitives/cn";

type TraceToolCall = {
  id: string;
  runId: string;
  round: number;
  toolName: string;
  arguments: unknown;
  result: unknown;
  resultOk: boolean;
  mode: string | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  summary?: {
    tool?: string;
    sql?: string;
    rowsPreview?: unknown[];
    rowCount?: number | null;
    totalMatching?: unknown;
    query?: string;
    hitCount?: number | null;
    mode?: string | null;
    kind?: unknown;
    id?: unknown;
    internal_vehicle_status?: unknown;
    ok?: unknown;
    resultError?: string;
  };
};

type TraceLlmRound = {
  id: string;
  runId: string;
  round: number;
  provider: string;
  model: string;
  httpStatus: number | null;
  finishReason: string | null;
  toolCallCount: number;
  durationMs: number | null;
  error: string | null;
  responsePreview?: string | null;
};

type TraceRun = {
  id: string;
  provider: string;
  model: string;
  status: string;
  error: string | null;
  durationMs: number | null;
  startedAt: string;
  userMessagePreview: string | null;
};

type TracePayload = {
  runs: TraceRun[];
  llmRounds: TraceLlmRound[];
  toolCalls: TraceToolCall[];
};

function previewJson(value: unknown, max = 400): string {
  try {
    const raw = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (!raw) return "—";
    return raw.length > max ? `${raw.slice(0, max)}…` : raw;
  } catch {
    return String(value);
  }
}

function extractSql(t: TraceToolCall): string | null {
  if (t.summary?.sql) return t.summary.sql;
  const a = t.arguments && typeof t.arguments === "object"
    ? (t.arguments as Record<string, unknown>)
    : null;
  if (a && typeof a.sql === "string") return a.sql;
  const r = t.result && typeof t.result === "object"
    ? (t.result as Record<string, unknown>)
    : null;
  if (r && typeof r.sql === "string") return r.sql;
  return null;
}

function extractRowsPreview(t: TraceToolCall): unknown[] | null {
  if (Array.isArray(t.summary?.rowsPreview)) return t.summary.rowsPreview;
  const r = t.result && typeof t.result === "object"
    ? (t.result as Record<string, unknown>)
    : null;
  if (r && Array.isArray(r.rows)) return r.rows.slice(0, 8);
  return null;
}

function toolHeadline(t: TraceToolCall): string {
  if (t.toolName === "run_sql") {
    const sql = extractSql(t);
    if (sql) return sql.replace(/\s+/g, " ").trim();
  }
  if (t.toolName === "search_knowledge") {
    const q =
      t.summary?.query ||
      (t.arguments && typeof t.arguments === "object"
        ? (t.arguments as Record<string, unknown>).query
        : null);
    if (typeof q === "string") return `query: ${q}`;
  }
  if (t.toolName === "get_entity") {
    return `${t.summary?.kind ?? "?"} / ${t.summary?.id ?? "?"}`;
  }
  return previewJson(t.arguments, 120);
}

export function AssistantTracePanel({
  conversationId,
  refreshKey,
}: {
  conversationId: string | null;
  /** Incrémenter après chaque réponse pour recharger la trace. */
  refreshKey: number;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<TracePayload | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!conversationId) {
      setTrace(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/assistant/conversations/${conversationId}/trace`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as TracePayload;
      setTrace({
        runs: data.runs || [],
        llmRounds: data.llmRounds || [],
        toolCalls: data.toolCalls || [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur trace");
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!open || !conversationId) return;
    void load();
  }, [open, conversationId, refreshKey, load]);

  if (!conversationId) return null;

  const lastRun = trace?.runs?.[trace.runs.length - 1];
  const toolCount = trace?.toolCalls?.length ?? 0;

  return (
    <div className="border-t border-slate-100 bg-slate-50/60">
      <div className="flex items-center gap-1 px-2 py-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] text-slate-600 hover:bg-slate-100"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <Bug className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          <span className="font-medium">Debug tools</span>
          {lastRun ? (
            <span className="truncate text-slate-400">
              · {lastRun.status} · {toolCount} call{toolCount === 1 ? "" : "s"}
              {lastRun.durationMs != null ? ` · ${lastRun.durationMs}ms` : ""}
            </span>
          ) : (
            <span className="text-slate-400">· SQL exact · rounds LLM · résultats</span>
          )}
          {open ? (
            <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0" />
          )}
        </button>
        {open ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            title="Rafraîchir la trace"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="max-h-80 space-y-2 overflow-y-auto px-2.5 pb-2 text-[10px] leading-relaxed text-slate-700">
          {loading && !trace ? (
            <div className="flex items-center gap-1.5 text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Chargement…
            </div>
          ) : null}
          {error ? <p className="text-rose-600">{error}</p> : null}
          {!loading && !error && trace && toolCount === 0 && (!trace.runs || !trace.runs.length) ? (
            <p className="text-slate-500">
              Aucune trace pour cette conversation (messages antérieurs au tracing).
            </p>
          ) : null}

          {trace?.runs?.map((run) => {
            const rounds = (trace.llmRounds || []).filter((r) => r.runId === run.id);
            const tools = (trace.toolCalls || []).filter((t) => t.runId === run.id);
            return (
              <div
                key={run.id}
                className="rounded-md border border-slate-200 bg-white p-1.5"
              >
                <div className="flex flex-wrap items-center gap-1 font-medium text-slate-800">
                  <span
                    className={cn(
                      "rounded px-1 py-0.5",
                      run.status === "ok"
                        ? "bg-emerald-50 text-emerald-700"
                        : run.status === "running"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-rose-50 text-rose-700",
                    )}
                  >
                    {run.status}
                  </span>
                  <span>
                    {run.provider}/{run.model}
                  </span>
                  {run.durationMs != null ? <span>· {run.durationMs}ms</span> : null}
                  <span className="font-normal text-slate-400">
                    · {tools.length} tool{tools.length === 1 ? "" : "s"} · {rounds.length} round
                    {rounds.length === 1 ? "" : "s"}
                  </span>
                </div>
                {run.userMessagePreview ? (
                  <p className="mt-0.5 truncate text-slate-500">user: {run.userMessagePreview}</p>
                ) : null}
                {run.error ? <p className="mt-0.5 text-rose-600">{run.error}</p> : null}

                {rounds.length > 0 ? (
                  <div className="mt-1 space-y-0.5">
                    <p className="font-medium text-slate-500">LLM rounds</p>
                    {rounds.map((r) => (
                      <div key={r.id} className="text-slate-600">
                        #{r.round} {r.finishReason || "—"} · tools={r.toolCallCount}
                        {r.durationMs != null ? ` · ${r.durationMs}ms` : ""}
                        {r.httpStatus != null ? ` · HTTP ${r.httpStatus}` : ""}
                        {r.error ? ` · ${r.error}` : ""}
                      </div>
                    ))}
                  </div>
                ) : null}

                {tools.length > 0 ? (
                  <div className="mt-1 space-y-1">
                    <p className="font-medium text-slate-500">Tool calls (SQL / RAG / entity)</p>
                    {tools.map((t) => {
                      const isOpen = Boolean(expanded[t.id]);
                      const sql = extractSql(t);
                      const rows = extractRowsPreview(t);
                      return (
                        <div key={t.id} className="rounded border border-slate-100 bg-slate-50/80">
                          <button
                            type="button"
                            className="flex w-full items-start gap-1 px-1.5 py-1 text-left"
                            onClick={() =>
                              setExpanded((prev) => ({ ...prev, [t.id]: !prev[t.id] }))
                            }
                          >
                            {isOpen ? (
                              <ChevronDown className="mt-0.5 h-3 w-3 shrink-0" />
                            ) : (
                              <ChevronRight className="mt-0.5 h-3 w-3 shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="font-semibold text-slate-800">{t.toolName}</span>
                                <span
                                  className={cn(
                                    "rounded px-1",
                                    t.resultOk
                                      ? "bg-emerald-50 text-emerald-700"
                                      : "bg-rose-50 text-rose-700",
                                  )}
                                >
                                  {t.resultOk ? "ok" : "fail"}
                                </span>
                                {t.mode ? <span className="text-slate-500">mode={t.mode}</span> : null}
                                {t.durationMs != null ? (
                                  <span className="text-slate-500">{t.durationMs}ms</span>
                                ) : null}
                                <span className="text-slate-400">round {t.round}</span>
                              </div>
                              <p
                                className={cn(
                                  "mt-0.5 font-mono text-slate-600",
                                  isOpen ? "whitespace-pre-wrap break-all" : "truncate",
                                )}
                              >
                                {toolHeadline(t)}
                              </p>
                              {!isOpen && rows && rows.length > 0 ? (
                                <p className="mt-0.5 truncate font-mono text-emerald-800">
                                  → {previewJson(rows, 160)}
                                </p>
                              ) : null}
                            </div>
                          </button>
                          {isOpen ? (
                            <div className="space-y-1 border-t border-slate-100 px-1.5 py-1 font-mono">
                              {sql ? (
                                <div>
                                  <p className="text-slate-400">sql</p>
                                  <pre className="whitespace-pre-wrap break-all text-slate-800">
                                    {sql}
                                  </pre>
                                </div>
                              ) : (
                                <div>
                                  <p className="text-slate-400">args</p>
                                  <pre className="whitespace-pre-wrap break-all text-slate-700">
                                    {previewJson(t.arguments, 2000)}
                                  </pre>
                                </div>
                              )}
                              {rows && rows.length > 0 ? (
                                <div>
                                  <p className="text-slate-400">
                                    result rows
                                    {t.summary?.rowCount != null
                                      ? ` (${t.summary.rowCount})`
                                      : ""}
                                  </p>
                                  <pre className="whitespace-pre-wrap break-all text-emerald-900">
                                    {previewJson(rows, 4000)}
                                  </pre>
                                </div>
                              ) : null}
                              <div>
                                <p className="text-slate-400">result (brut)</p>
                                <pre className="whitespace-pre-wrap break-all text-slate-700">
                                  {previewJson(t.result, 4000)}
                                </pre>
                              </div>
                              {t.error ? <p className="text-rose-600">{t.error}</p> : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
