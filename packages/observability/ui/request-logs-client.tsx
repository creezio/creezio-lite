"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "./primitives/badge";
import { Button } from "./primitives/button";
import { cn } from "./primitives/cn";
import type { RequestLogEntry, RequestLogSource } from "../dist/request-logs/request-logs.js";

type SourceFilter = "all" | RequestLogSource;

type ApiResponse = {
  logs: RequestLogEntry[];
  total: number;
  capacity: number;
};

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function methodLabel(entry: RequestLogEntry): string {
  if (entry.source === "mcp") {
    if (entry.detail.tool) return entry.detail.tool;
    if (entry.detail.jsonrpcMethod) return entry.detail.jsonrpcMethod;
  }
  return entry.method;
}

function isErrorEntry(entry: RequestLogEntry): boolean {
  return (
    entry.status >= 400 ||
    entry.detail.ok === false ||
    Boolean(entry.detail.error)
  );
}

function statusVariant(
  entry: RequestLogEntry,
): "success" | "danger" | "warning" | "muted" {
  if (isErrorEntry(entry)) return "danger";
  if (entry.status >= 300) return "warning";
  if (entry.status > 0) return "success";
  return "muted";
}

export function RequestLogsClient() {
  const [logs, setLogs] = useState<RequestLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [capacity, setCapacity] = useState(1000);
  const [source, setSource] = useState<SourceFilter>("all");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (source !== "all") params.set("source", source);
      if (errorsOnly) params.set("errorsOnly", "1");
      if (qDebounced) params.set("q", qDebounced);
      const res = await fetch(`/api/v1/admin/request-logs?${params}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ApiResponse;
      setLogs(data.logs || []);
      setTotal(data.total ?? 0);
      setCapacity(data.capacity ?? 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [source, errorsOnly, qDebounced]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(id);
  }, [autoRefresh, load]);

  async function clearLogs() {
    if (!window.confirm("Vider tous les logs en mémoire ?")) return;
    try {
      const res = await fetch("/api/v1/admin/request-logs", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setExpanded({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec purge");
    }
  }

  function toggle(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const filters: { id: SourceFilter; label: string }[] = [
    { id: "all", label: "Tous" },
    { id: "mcp", label: "MCP" },
    { id: "api", label: "API" },
  ];

  return (
    <div className="mt-2 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border bg-white p-0.5 shadow-sm">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSource(f.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                source === f.id
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 rounded-lg border bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm">
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(e) => setErrorsOnly(e.target.checked)}
            className="rounded border-slate-300"
          />
          Erreurs seulement
        </label>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher (tool, path, erreur…)"
          className="min-w-[14rem] flex-1 rounded-lg border bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
        />
        <label className="flex items-center gap-2 rounded-lg border bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="rounded border-slate-300"
          />
          Auto-refresh
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
          Actualiser
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void clearLogs()}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Vider
        </Button>
      </div>

      <div className="text-xs text-slate-500">
        {total.toLocaleString("fr-FR")} entrée(s) affichable(s) — buffer{" "}
        {capacity.toLocaleString("fr-FR")} (mémoire processus local)
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="min-w-[960px] w-full text-left text-sm">
          <thead className="sticky top-0 border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-8 px-2 py-3" />
              <th className="px-3 py-3">Horodatage</th>
              <th className="px-3 py-3">Source</th>
              <th className="px-3 py-3">Méthode / tool</th>
              <th className="px-3 py-3">Path</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Durée</th>
              <th className="px-3 py-3">Erreur</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((entry) => {
              const open = Boolean(expanded[entry.id]);
              const err = isErrorEntry(entry);
              return (
                <Fragment key={entry.id}>
                  <tr
                    className={cn(
                      "border-b last:border-0 hover:bg-slate-50/80",
                      err && "bg-red-50/40",
                    )}
                  >
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => toggle(entry.id)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-expanded={open}
                        aria-label={open ? "Masquer le détail" : "Afficher le détail"}
                      >
                        {open ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-600">
                      {formatTs(entry.ts)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={entry.source === "mcp" ? "info" : "secondary"}>
                        {entry.source.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900">
                      <button
                        type="button"
                        onClick={() => toggle(entry.id)}
                        className="text-left hover:underline"
                      >
                        {methodLabel(entry)}
                      </button>
                      {entry.source === "mcp" &&
                      entry.detail.tool &&
                      entry.detail.jsonrpcMethod ? (
                        <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                          {entry.detail.jsonrpcMethod}
                        </div>
                      ) : null}
                    </td>
                    <td className="max-w-[16rem] truncate px-3 py-2 font-mono text-xs text-slate-600">
                      {entry.path}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={statusVariant(entry)}>
                        {entry.status || "—"}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">
                      {entry.durationMs.toLocaleString("fr-FR")} ms
                    </td>
                    <td
                      className={cn(
                        "max-w-[20rem] truncate px-3 py-2 text-xs",
                        err ? "text-red-700" : "text-slate-400",
                      )}
                      title={entry.detail.error || ""}
                    >
                      {entry.detail.error || (err ? "erreur" : "—")}
                    </td>
                  </tr>
                  {open ? (
                    <tr className="border-b bg-slate-50/60">
                      <td colSpan={8} className="px-4 py-3">
                        <pre className="max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">
                          {JSON.stringify(
                            {
                              id: entry.id,
                              ts: entry.ts,
                              source: entry.source,
                              method: entry.method,
                              path: entry.path,
                              status: entry.status,
                              durationMs: entry.durationMs,
                              detail: entry.detail,
                            },
                            null,
                            2,
                          )}
                        </pre>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {!logs.length ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  Aucun log pour ces filtres. Lancez un appel MCP (ChatGPT) ou une
                  action API, puis actualisez.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
