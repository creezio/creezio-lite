"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Loader2, Maximize2, MonitorPlay, Play, RotateCcw, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@creezio/shell-ui/ui/kit";
import { cn } from "@creezio/shell-ui";

type LogRow = {
  id: string;
  seq: number;
  level: string;
  event_type: string;
  message: string;
  created_at: string;
  payload_json?: string | null;
};

type RunRow = {
  id: string;
  status: string;
  step_count: number;
  last_error?: string | null;
  hitl_prompt?: string | null;
};

type Props = {
  /** userId IA à observer, ou runId direct */
  userId?: string;
  runId?: string;
  className?: string;
  compact?: boolean;
  title?: string;
};

function parseSseChunk(
  buffer: string,
): { events: { event: string; data: string }[]; rest: string } {
  const events: { event: string; data: string }[] = [];
  let rest = buffer;
  let idx: number;
  while ((idx = rest.indexOf("\n\n")) !== -1) {
    const raw = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    let event = "message";
    const dataLines: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length) {
      events.push({ event, data: dataLines.join("\n") });
    }
  }
  return { events, rest };
}

/**
 * Vue live (lecture seule) : frames JPEG du screencast de l'espace IA,
 * reçues en SSE (/api/v1/tasks/screencast/:aiUserId/stream). Le flux desktop
 * démarre au 1er spectateur et s'arrête au dernier — monter/démonter ce
 * composant suffit.
 */
function AiLiveView({ userId }: { userId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Connexion au flux…");
  const [frames, setFrames] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSrc(null);
    setFrames(0);
    setStatus("Connexion au flux…");
    if (typeof window === "undefined" || !window.EventSource) {
      setStatus("SSE non supporté par ce navigateur");
      return;
    }
    const es = new EventSource(
      `/api/v1/tasks/screencast/${encodeURIComponent(userId)}/stream`,
    );
    const onFrame = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(String(ev.data)) as { data?: string };
        if (data.data) {
          setSrc(`data:image/jpeg;base64,${data.data}`);
          setFrames((n) => n + 1);
          setStatus("");
        }
      } catch {
        /* ignore */
      }
    };
    const onStatus = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(String(ev.data)) as {
          ok?: boolean;
          error?: string;
        };
        if (data.ok === false) {
          setStatus(data.error || "Screencast indisponible");
        } else {
          setStatus((prev) => (prev === "Connexion au flux…" ? "En attente d’image…" : prev));
        }
      } catch {
        /* ignore */
      }
    };
    es.addEventListener("frame", onFrame);
    es.addEventListener("status", onStatus);
    es.onerror = () => {
      setStatus("Flux interrompu — reconnexion…");
    };
    return () => {
      es.close();
    };
  }, [userId]);

  function goFullscreen() {
    const el = containerRef.current;
    if (el && el.requestFullscreen) void el.requestFullscreen();
  }

  return (
    <div className="flex flex-col">
      <div
        ref={containerRef}
        className="relative flex min-h-48 items-center justify-center bg-slate-950"
        data-creezio-tasks-ai-live-frames={frames}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={`Vue live de l’espace IA ${userId}`}
            className="max-h-[min(70vh,32rem)] w-full object-contain"
          />
        ) : (
          <p className="px-4 py-10 text-center text-xs text-slate-400">
            {status || "En attente d’image…"}
          </p>
        )}
        {src ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="absolute right-2 top-2 h-7 px-2 text-[11px] opacity-80"
            onClick={goFullscreen}
          >
            <Maximize2 className="mr-1 h-3 w-3" />
            Plein écran
          </Button>
        ) : null}
      </div>
      <p className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
        Lecture seule — l’IA garde la main. {status && src ? status : ""}
      </p>
    </div>
  );
}

export function AiActivityPanel({
  userId,
  runId,
  className,
  compact,
  title,
}: Props) {
  const [view, setView] = useState<"logs" | "live">("logs");
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [run, setRun] = useState<RunRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [transport, setTransport] = useState<"sse" | "poll">("sse");
  const [busy, setBusy] = useState(false);
  const afterRef = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const prevStatus = useRef<string | null>(null);

  const mergeLogs = useCallback((incoming: LogRow[]) => {
    if (!incoming.length) return;
    setLogs((prev) => {
      const seen = new Set(prev.map((l) => l.id));
      const merged = [...prev];
      for (const l of incoming) {
        if (!seen.has(l.id)) merged.push(l);
      }
      return merged.slice(-300);
    });
    afterRef.current = Math.max(
      afterRef.current,
      ...incoming.map((l) => l.seq),
    );
  }, []);

  const applyRun = useCallback((next: RunRow | null | undefined) => {
    if (!next) return;
    setRun(next);
    const prev = prevStatus.current;
    if (prev && prev !== next.status) {
      if (next.status === "succeeded") {
        toast.success("Run IA terminé");
      } else if (next.status === "failed") {
        toast.error(next.last_error || "Run IA échoué");
      } else if (next.status === "cancelled") {
        toast.message("Run IA annulé");
      }
    }
    if (next.hitl_prompt && prev !== "hitl" && next.status === "running") {
      toast.message("Validation humaine requise", {
        description: next.hitl_prompt,
      });
    }
    prevStatus.current = next.hitl_prompt ? "hitl" : next.status;
  }, []);

  const poll = useCallback(async () => {
    try {
      const url = runId
        ? `/api/v1/tasks/runs/${runId}/logs?after=${afterRef.current}`
        : userId
          ? `/api/v1/tasks/activity/${userId}?after=${afterRef.current}`
          : null;
      if (!url) return;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as {
        run?: RunRow | null;
        logs?: LogRow[];
      };
      applyRun(data.run);
      mergeLogs(data.logs || []);
    } finally {
      setLoading(false);
    }
  }, [runId, userId, applyRun, mergeLogs]);

  useEffect(() => {
    afterRef.current = 0;
    setLogs([]);
    setRun(null);
    setLoading(true);
    prevStatus.current = null;

    const streamUrl = runId
      ? `/api/v1/tasks/runs/${runId}/stream?after=0`
      : userId
        ? `/api/v1/tasks/activity/${userId}/stream`
        : null;

    if (!streamUrl || typeof window === "undefined" || !window.EventSource) {
      setTransport("poll");
      void poll();
      const id = window.setInterval(() => void poll(), 1000);
      return () => window.clearInterval(id);
    }

    let closed = false;
    let pollFallback: number | null = null;
    const es = new EventSource(streamUrl);

    const onReady = () => {
      setTransport("sse");
      setLoading(false);
    };
    const onSnapshot = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(String(ev.data)) as {
          run?: RunRow | null;
          logs?: LogRow[];
        };
        applyRun(data.run);
        if (data.logs?.length) {
          setLogs(data.logs.slice(-300));
          afterRef.current = Math.max(
            0,
            ...data.logs.map((l) => l.seq),
          );
        }
      } catch {
        /* ignore */
      }
      setLoading(false);
    };
    const onLog = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(String(ev.data)) as {
          log?: LogRow;
          run?: RunRow;
        };
        if (data.run) applyRun(data.run);
        if (data.log) mergeLogs([data.log]);
      } catch {
        /* ignore */
      }
      setLoading(false);
    };
    const onRun = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(String(ev.data)) as { run?: RunRow };
        applyRun(data.run);
      } catch {
        /* ignore */
      }
    };

    es.addEventListener("ready", onReady);
    es.addEventListener("snapshot", onSnapshot);
    es.addEventListener("log", onLog);
    es.addEventListener("run", onRun);
    es.onerror = () => {
      if (closed) return;
      es.close();
      setTransport("poll");
      void poll();
      if (!pollFallback) {
        pollFallback = window.setInterval(() => void poll(), 1000);
      }
    };

    // Bootstrap immédiat au cas où le snapshot SSE tarde
    void poll();

    return () => {
      closed = true;
      es.close();
      if (pollFallback) window.clearInterval(pollFallback);
    };
  }, [runId, userId, poll, applyRun, mergeLogs]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  async function resumeHitl() {
    if (!run?.id) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/tasks/runs/${run.id}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: "ok" }),
      });
      const data = (await res.json()) as { error?: string; run?: RunRow };
      if (!res.ok) {
        toast.error(data.error || "Reprise impossible");
        return;
      }
      applyRun(data.run);
      toast.success("Run repris");
    } finally {
      setBusy(false);
    }
  }

  async function retryRun() {
    if (!run?.id) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/tasks/runs/${run.id}/retry`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string; run?: RunRow };
      if (!res.ok) {
        toast.error(data.error || "Retry impossible");
        return;
      }
      toast.success("Nouveau run en file");
      applyRun(data.run);
      afterRef.current = 0;
      setLogs([]);
    } finally {
      setBusy(false);
    }
  }

  async function cancelRun() {
    if (!run?.id) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/tasks/runs/${run.id}/cancel`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string; run?: RunRow };
      if (!res.ok) {
        toast.error(data.error || "Annulation impossible");
        return;
      }
      applyRun(data.run);
    } finally {
      setBusy(false);
    }
  }

  const hitl = Boolean(run?.hitl_prompt && run.status === "running");
  const canRetry = run?.status === "failed" || run?.status === "cancelled";
  const canCancel = run?.status === "queued" || run?.status === "running";

  return (
    <aside
      className={cn(
        "flex flex-col border border-slate-200 bg-white",
        compact ? "rounded-md" : "rounded-lg",
        className,
      )}
      data-creezio-tasks-ai-activity={run?.id || ""}
    >
      <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <Bot className="h-4 w-4 text-slate-600" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">
            {title || "Activité IA"}
          </p>
          <p className="truncate text-xs text-slate-500">
            {run
              ? `Run ${run.status}${hitl ? " · pause HITL" : ""} · ${run.step_count} étapes · ${transport}`
              : loading
                ? "Chargement…"
                : "Aucun run"}
          </p>
        </div>
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
        ) : null}
        {userId ? (
          <div className="flex gap-0.5 rounded-md border border-slate-200 p-0.5">
            <button
              type="button"
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px]",
                view === "logs"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100",
              )}
              onClick={() => setView("logs")}
            >
              Activité
            </button>
            <button
              type="button"
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
                view === "live"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100",
              )}
              onClick={() => setView("live")}
              data-creezio-tasks-aid="ai-live-view-tab"
            >
              <MonitorPlay className="h-3 w-3" />
              Vue live
            </button>
          </div>
        ) : null}
      </header>

      {userId && view === "live" ? <AiLiveView userId={userId} /> : null}

      {view === "live" ? null : hitl || canRetry || canCancel ? (
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-3 py-2">
          {hitl ? (
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={busy}
              onClick={() => void resumeHitl()}
            >
              <Play className="mr-1 h-3 w-3" />
              Reprendre
            </Button>
          ) : null}
          {canRetry ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={busy}
              onClick={() => void retryRun()}
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              Retry
            </Button>
          ) : null}
          {canCancel ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] text-red-600"
              disabled={busy}
              onClick={() => void cancelRun()}
            >
              <Square className="mr-1 h-3 w-3" />
              Annuler
            </Button>
          ) : null}
        </div>
      ) : null}

      {view !== "live" && hitl && run?.hitl_prompt ? (
        <p className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {run.hitl_prompt}
        </p>
      ) : null}

      <div
        ref={scroller}
        className={cn(
          "space-y-1.5 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-700",
          compact ? "max-h-56" : "max-h-[min(70vh,28rem)]",
          view === "live" && "hidden",
        )}
      >
        {logs.length === 0 ? (
          <p className="font-sans text-xs text-slate-500">
            En attente d’actions (tool calls, navigations, décisions)…
          </p>
        ) : (
          logs.map((l) => (
            <div
              key={l.id}
              className="border-b border-slate-50 pb-1.5 last:border-0"
              data-creezio-tasks-ai-log-seq={l.seq}
              data-creezio-tasks-ai-log-type={l.event_type}
            >
              <span
                className={cn(
                  "mr-1.5 uppercase",
                  l.level === "error" && "text-red-600",
                  l.level === "warn" && "text-amber-700",
                  l.level === "tool" && "text-sky-700",
                  l.level === "nav" && "text-emerald-700",
                  l.level === "decision" && "text-violet-700",
                )}
              >
                [{l.level}]
              </span>
              <span className="text-slate-400">{l.event_type}</span>
              <div className="whitespace-pre-wrap break-words text-slate-800">
                {l.message}
              </div>
            </div>
          ))
        )}
        {run?.last_error ? (
          <p className="font-sans text-xs text-red-600">{run.last_error}</p>
        ) : null}
      </div>
    </aside>
  );
}

/** Utilitaire testable : parse SSE (export pour scripts éventuels). */
export function __parseSseChunkForTests(buffer: string) {
  return parseSseChunk(buffer);
}
