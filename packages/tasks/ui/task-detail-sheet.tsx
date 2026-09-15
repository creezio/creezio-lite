"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock3,
  Eye,
  FileText,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import { Badge } from "@creezio/shell-ui/ui/kit";
import { Button } from "@creezio/shell-ui/ui/kit";
import { ScrollArea } from "@creezio/shell-ui/ui/kit";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@creezio/shell-ui/ui/kit";
import { openAiWorkspaceView } from "@creezio/shell-ui/ui/kit";
import { cn } from "@creezio/shell-ui";
import { AiActivityPanel } from "./ai-activity-panel";
import {
  EXECUTOR_META,
  STATUS_META,
  sourceLabel,
  type TaskCard,
} from "./tasks-types";

type RunRow = {
  id: string;
  status: string;
  step_count: number;
  last_error?: string | null;
  hitl_prompt?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
};

type HermesDetail = {
  task: {
    id: string;
    title: string;
    body?: string | null;
    status: string;
    result?: string | null;
    last_failure_error?: string | null;
    age_seconds?: {
      created_age_seconds?: number | null;
      time_to_complete_seconds?: number | null;
    } | null;
  };
  comments: { id?: number | string; body?: string; author?: string }[];
  events: {
    id?: number;
    kind?: string;
    payload?: Record<string, unknown>;
    created_at?: number;
  }[];
  runs: {
    id?: string;
    status?: string;
    summary?: string | null;
    error?: string | null;
    started_at?: number | null;
    finished_at?: number | null;
  }[];
};

type DetailPayload = {
  task: TaskCard;
  hermes: HermesDetail | null;
  hermesError: string | null;
  runs: RunRow[];
  subtasks: TaskCard[];
};

type TabId = "brief" | "activite" | "rapport" | "timeline";

function formatTs(isoOrUnix: string | number | null | undefined): string {
  if (isoOrUnix == null || isoOrUnix === "") return "—";
  const d =
    typeof isoOrUnix === "number"
      ? new Date(isoOrUnix * 1000)
      : new Date(isoOrUnix);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDistanceToNow(d, { addSuffix: true, locale: fr });
}

function eventLabel(kind?: string): string {
  const map: Record<string, string> = {
    created: "Créée",
    status_changed: "Statut modifié",
    claimed: "Prise en charge",
    completed: "Terminée",
    blocked: "Bloquée",
    unblocked: "Débloquée",
    comment: "Commentaire",
    dispatched: "Dispatch",
  };
  return kind ? map[kind] || kind : "Événement";
}

export function TaskDetailSheet({
  taskId,
  open,
  onOpenChange,
  onStatusChange,
  onChanged,
}: {
  taskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusChange: (id: string, status: string) => Promise<void>;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<TabId>("brief");
  const [acting, setActing] = useState(false);

  async function load() {
    if (!taskId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}`);
      const json = (await res.json()) as DetailPayload & { error?: string };
      if (!res.ok) {
        setData(null);
        return;
      }
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && taskId) void load();
    if (!open) {
      setData(null);
      setTab("brief");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskId]);

  const task = data?.task;
  const hermes = data?.hermes;
  const runs = data?.runs || [];
  const latestRun = runs[0] || null;
  const status = task ? STATUS_META[task.status] || STATUS_META.backlog : null;
  const exec = task ? EXECUTOR_META[task.executor_kind] : null;

  // À l'ouverture : onglet le plus pertinent selon l'exécutant et l'état.
  useEffect(() => {
    if (!task) return;
    if (task.result || hermes?.task?.result) setTab("rapport");
    else if (task.executor_kind === "ai" && latestRun) setTab("activite");
    else setTab("brief");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.task?.id]);

  const reportText = useMemo(() => {
    if (!task) return "";
    const parts: string[] = [];
    if (task.result) parts.push(task.result);
    else if (hermes?.task?.result) parts.push(hermes.task.result);
    for (const run of hermes?.runs || []) {
      if (run.summary) parts.push(run.summary);
      if (run.error) parts.push(`Erreur run : ${run.error}`);
    }
    for (const c of hermes?.comments || []) {
      if (c.body) parts.push(c.body);
    }
    if (hermes?.task?.last_failure_error) {
      parts.push(`Dernière erreur : ${hermes.task.last_failure_error}`);
    }
    return parts.filter(Boolean).join("\n\n---\n\n");
  }, [task, hermes]);

  const tabs = useMemo(() => {
    const list: Array<{ id: TabId; label: string; icon: typeof FileText }> = [
      { id: "brief", label: "Brief", icon: FileText },
    ];
    if (task?.executor_kind === "ai") {
      list.push({ id: "activite", label: "Activité IA", icon: Activity });
    }
    list.push({ id: "rapport", label: "Rapport", icon: Bot });
    if (task?.executor_kind === "hermes") {
      list.push({ id: "timeline", label: "Timeline", icon: Clock3 });
    }
    return list;
  }, [task?.executor_kind]);

  async function act(statusNext: string) {
    if (!task) return;
    setActing(true);
    try {
      await onStatusChange(task.id, statusNext);
      await load();
    } finally {
      setActing(false);
    }
  }

  async function launchRun() {
    if (!task) return;
    setActing(true);
    try {
      const res = await fetch(`/api/v1/tasks/${task.id}/launch`, {
        method: "POST",
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error || "Lancement impossible");
        return;
      }
      toast.success("Run IA en file");
      setTab("activite");
      await load();
      onChanged?.();
    } finally {
      setActing(false);
    }
  }

  async function viewAsAi() {
    if (!task?.assignee) return;
    const result = await openAiWorkspaceView(
      task.assignee.id,
      task.assignee.username,
    );
    if (!result.ok) toast.error(result.error || "Workspace IA indisponible");
  }

  const activeRun = runs.find(
    (r) => r.status === "queued" || r.status === "running",
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-xl sm:max-w-xl md:max-w-2xl"
      >
        {loading && !task ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement du détail…
          </div>
        ) : !task ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            Tâche introuvable
          </div>
        ) : (
          <>
            <SheetHeader className="border-b border-slate-100 bg-[linear-gradient(180deg,#f8fafc_0%,#fff_100%)]">
              <div className="flex flex-wrap items-center gap-2">
                {status ? (
                  <Badge className={cn("border-0 font-medium", status.badgeClass)}>
                    {status.label}
                  </Badge>
                ) : null}
                {exec ? (
                  <Badge className={cn("border-0 gap-1 font-medium", exec.badgeClass)}>
                    <Bot className="h-3 w-3" />
                    {task.assignee?.username
                      ? `${exec.short} · ${task.assignee.username}`
                      : exec.label}
                  </Badge>
                ) : null}
                {task.recurring_schedule ? (
                  <Badge variant="outline" className="gap-1 text-[11px]">
                    <RefreshCw className="h-3 w-3" />
                    {task.recurring_schedule}
                  </Badge>
                ) : null}
                <Badge variant="outline" className="text-[11px]">
                  {sourceLabel(task.source)}
                </Badge>
              </div>
              <SheetTitle className="text-lg leading-snug tracking-tight">
                {task.title}
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span>Màj {formatTs(task.updated_at)}</span>
                {task.executor_kind === "hermes" ? (
                  task.hermes_task_id ? (
                    <span className="font-mono text-slate-400">
                      {task.hermes_task_id}
                    </span>
                  ) : (
                    <span className="text-amber-700">Non liée à Hermes</span>
                  )
                ) : null}
                {activeRun ? (
                  <span className="inline-flex items-center gap-1 text-violet-700">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Run {activeRun.status}
                  </span>
                ) : null}
              </SheetDescription>
            </SheetHeader>

            <div className="flex shrink-0 gap-1 border-b border-slate-100 px-3 py-2">
              {tabs.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                const dot =
                  (t.id === "rapport" && Boolean(reportText)) ||
                  (t.id === "activite" && Boolean(activeRun));
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                      active
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-100",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t.label}
                    {dot && !active ? (
                      <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    ) : null}
                  </button>
                );
              })}
              <button
                type="button"
                className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
                onClick={() => void load()}
                disabled={loading}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </button>
            </div>

            <ScrollArea className="min-h-0 flex-1 px-4 py-4">
              {tab === "brief" ? (
                <div className="space-y-4">
                  <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <Sparkles className="h-3.5 w-3.5 text-sky-600" />
                      Brief
                    </div>
                    {(hermes?.task?.body || task.body || "").trim() ? (
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-800">
                        {(hermes?.task?.body || task.body).trim()}
                      </pre>
                    ) : (
                      <p className="text-sm text-slate-500">
                        Aucun brief détaillé — seul le titre est renseigné.
                      </p>
                    )}
                  </section>

                  <dl className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-xl border border-slate-100 p-3">
                      <dt className="text-slate-400">Exécutant</dt>
                      <dd className="mt-1 font-medium text-slate-800">
                        {exec?.label}
                        {task.assignee ? ` — ${task.assignee.username}` : ""}
                      </dd>
                    </div>
                    <div className="rounded-xl border border-slate-100 p-3">
                      <dt className="text-slate-400">Créée</dt>
                      <dd className="mt-1 font-medium text-slate-800">
                        {formatTs(task.created_at)}
                      </dd>
                    </div>
                    <div className="rounded-xl border border-slate-100 p-3">
                      <dt className="text-slate-400">Priorité</dt>
                      <dd className="mt-1 font-medium text-slate-800">
                        {task.priority}
                      </dd>
                    </div>
                    <div className="rounded-xl border border-slate-100 p-3">
                      <dt className="text-slate-400">Runs IA</dt>
                      <dd className="mt-1 font-medium text-slate-800">
                        {runs.length || "—"}
                      </dd>
                    </div>
                  </dl>

                  {(data?.subtasks?.length || 0) > 0 ? (
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Sous-tâches déléguées
                      </h3>
                      {data!.subtasks.map((st) => {
                        const stExec = EXECUTOR_META[st.executor_kind];
                        const stStatus = STATUS_META[st.status];
                        return (
                          <div
                            key={st.id}
                            className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2 text-xs"
                          >
                            <span className="min-w-0 truncate font-medium text-slate-800">
                              {st.title}
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              <span
                                className={cn(
                                  "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                                  stExec.badgeClass,
                                )}
                              >
                                {stExec.short}
                              </span>
                              <span
                                className={cn(
                                  "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                                  stStatus?.badgeClass,
                                )}
                              >
                                {stStatus?.label || st.status}
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </section>
                  ) : null}

                  {data?.hermesError ? (
                    <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Détail Hermes indisponible : {data.hermesError}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {tab === "activite" ? (
                <div className="space-y-4">
                  {latestRun ? (
                    <AiActivityPanel
                      runId={activeRun?.id || latestRun.id}
                      title={`Run ${(activeRun || latestRun).status}`}
                    />
                  ) : (
                    <section className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center">
                      <Bot className="h-8 w-8 text-slate-300" />
                      <p className="text-sm font-medium text-slate-700">
                        Aucun run IA pour l&apos;instant
                      </p>
                      <p className="max-w-sm text-xs text-slate-500">
                        Lancez la tâche pour que le collaborateur IA travaille
                        dans son workspace.
                      </p>
                    </section>
                  )}

                  {runs.length > 1 ? (
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Historique des runs
                      </h3>
                      {runs.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-xs"
                        >
                          <span
                            className={cn(
                              "font-medium",
                              r.status === "succeeded" && "text-emerald-700",
                              r.status === "failed" && "text-rose-700",
                              (r.status === "running" || r.status === "queued") &&
                                "text-violet-700",
                            )}
                          >
                            {r.status} · {r.step_count} étapes
                          </span>
                          <span className="text-slate-400">
                            {formatTs(r.finished_at || r.started_at || r.created_at)}
                          </span>
                        </div>
                      ))}
                    </section>
                  ) : null}
                </div>
              ) : null}

              {tab === "rapport" ? (
                <div className="space-y-4">
                  {reportText ? (
                    <section className="rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50/80 to-white p-4">
                      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Rapport
                      </div>
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-800">
                        {reportText}
                      </pre>
                    </section>
                  ) : (
                    <section className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center">
                      <Bot className="h-8 w-8 text-slate-300" />
                      <p className="text-sm font-medium text-slate-700">
                        Pas encore de rapport
                      </p>
                      <p className="max-w-sm text-xs text-slate-500">
                        {task.executor_kind === "hermes"
                          ? "Dès que Hermes termine la mission, le résultat apparaît ici."
                          : task.executor_kind === "ai"
                            ? "Le rapport du collaborateur IA apparaît ici quand il clôture la tâche."
                            : "Renseignez un résultat en terminant la tâche."}
                      </p>
                    </section>
                  )}

                  {(hermes?.runs?.length || 0) > 0 ? (
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Runs Hermes
                      </h3>
                      {hermes!.runs.map((run, i) => (
                        <div
                          key={run.id || i}
                          className="rounded-xl border border-slate-100 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-slate-800">
                              {run.status || "run"}
                            </span>
                            <span className="text-slate-400">
                              {formatTs(run.finished_at || run.started_at)}
                            </span>
                          </div>
                          {run.summary ? (
                            <p className="mt-1 text-slate-600">{run.summary}</p>
                          ) : null}
                          {run.error ? (
                            <p className="mt-1 text-rose-600">{run.error}</p>
                          ) : null}
                        </div>
                      ))}
                    </section>
                  ) : null}
                </div>
              ) : null}

              {tab === "timeline" ? (
                <div className="space-y-0">
                  {(hermes?.events?.length || 0) === 0 ? (
                    <p className="text-sm text-slate-500">
                      Aucun événement Hermes pour l&apos;instant.
                    </p>
                  ) : (
                    <ol className="relative space-y-0 border-l border-slate-200 pl-4">
                      {[...(hermes?.events || [])]
                        .slice()
                        .reverse()
                        .map((ev, i) => (
                          <li key={ev.id ?? i} className="relative pb-4">
                            <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-sky-500 shadow" />
                            <p className="text-xs font-medium text-slate-800">
                              {eventLabel(ev.kind)}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {formatTs(ev.created_at)}
                            </p>
                            {ev.payload && Object.keys(ev.payload).length ? (
                              <pre className="mt-1 max-h-28 overflow-auto rounded-lg bg-slate-50 p-2 font-mono text-[10px] text-slate-600">
                                {JSON.stringify(ev.payload, null, 2)}
                              </pre>
                            ) : null}
                          </li>
                        ))}
                    </ol>
                  )}
                </div>
              ) : null}
            </ScrollArea>

            <div className="flex shrink-0 flex-wrap gap-2 border-t border-slate-100 bg-white px-4 py-3">
              {task.executor_kind === "ai" ? (
                <>
                  {!activeRun ? (
                    <Button size="sm" disabled={acting} onClick={() => void launchRun()}>
                      <Play className="mr-1.5 h-3.5 w-3.5" />
                      {runs.length ? "Relancer" : "Lancer"}
                    </Button>
                  ) : null}
                  {task.assignee ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={acting}
                      onClick={() => void viewAsAi()}
                    >
                      <Eye className="mr-1.5 h-3.5 w-3.5" />
                      Voir comme IA
                    </Button>
                  ) : null}
                </>
              ) : null}
              {task.executor_kind === "hermes" &&
              task.status !== "in_progress" &&
              task.status !== "done" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={acting}
                  onClick={() => void act("in_progress")}
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Envoyer à Hermes
                </Button>
              ) : null}
              {task.executor_kind === "human" && task.status === "backlog" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={acting}
                  onClick={() => void act("in_progress")}
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Commencer
                </Button>
              ) : null}
              {task.status !== "done" ? (
                <Button size="sm" disabled={acting} onClick={() => void act("done")}>
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  Marquer terminée
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={acting}
                  onClick={() => void act("backlog")}
                >
                  Rouvrir
                </Button>
              )}
              {task.status !== "blocked" && task.status !== "done" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={acting}
                  onClick={() => void act("blocked")}
                >
                  Bloquer
                </Button>
              ) : null}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
