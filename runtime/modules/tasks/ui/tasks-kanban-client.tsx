"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Repeat2,
  Search,
  Sparkles,
  User,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import { Badge } from "@lite/shell-ui/ui/kit";
import { Button } from "@lite/shell-ui/ui/kit";
import { Input } from "@lite/shell-ui/ui/kit";
import { cn } from "@lite/shell-ui";
import { TaskDetailSheet } from "./task-detail-sheet";
import {
  EXECUTOR_META,
  KANBAN_COLUMNS,
  previewBrief,
  STATUS_META,
  sourceLabel,
  type ColumnKey,
  type TaskAssignee,
  type TaskCard,
} from "./tasks-types";

type ExecutorFilter = "all" | TaskCard["executor_kind"];

const EXECUTOR_FILTERS: Array<{ id: ExecutorFilter; label: string }> = [
  { id: "all", label: "Tous" },
  { id: "human", label: "Humains" },
  { id: "ai", label: "IA" },
  { id: "hermes", label: "Hermes" },
];

export function TasksKanbanClient({executors = ["human", "ai", "hermes"]}: {executors?: readonly TaskCard["executor_kind"][]} = {}) {
  const [columns, setColumns] = useState<Record<string, TaskCard[]>>({});
  const [hermesConfigured, setHermesConfigured] = useState(false);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Composer
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [executor, setExecutor] = useState<TaskCard["executor_kind"]>("human");
  const [assigneeId, setAssigneeId] = useState("");
  const [schedule, setSchedule] = useState("");
  const [launchNow, setLaunchNow] = useState(true);
  const [creating, setCreating] = useState(false);

  // Board
  const [filter, setFilter] = useState("");
  const [executorFilter, setExecutorFilter] = useState<ExecutorFilter>("all");
  // Inbox missions d'un collaborateur (P4) : ?assignee=<userId> — utilisé par
  // le workspace IA (atterrissage) et les liens « Ses tâches ».
  const [assigneeFilterId, setAssigneeFilterId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const selectedFromSearch=useSearchParams().get('record');
  useEffect(()=>{if(selectedFromSearch){setSelectedId(selectedFromSearch);setSheetOpen(true);}},[selectedFromSearch]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<ColumnKey | null>(null);

  const load = useCallback(async (sync = true) => {
    try {
      const res = await fetch(`/api/v1/tasks?sync=${sync ? "1" : "0"}`);
      const data = (await res.json()) as {
        columns?: Record<string, TaskCard[]>;
        hermes_configured?: boolean;
        host_bridge_ready?: boolean;
        error?: string;
        sync?: { errors?: string[] } | null;
      };
      if (!res.ok) {
        toast.error(data.error || `Erreur ${res.status}`);
        return;
      }
      setColumns(data.columns || {});
      setHermesConfigured(Boolean(data.hermes_configured));
      setBridgeReady(Boolean(data.host_bridge_ready));
      if (data.sync?.errors?.length) {
        toast.message(`Sync Hermes : ${data.sync.errors[0]}`);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Filtre initial via ?q= (ex. lien « Ses tâches » depuis Collaborateurs).
    const sp = new URLSearchParams(window.location.search);
    const q = sp.get("q");
    if (q) setFilter(q);
    const assignee = sp.get("assignee");
    if (assignee) setAssigneeFilterId(assignee);
  }, []);

  useEffect(() => {
    void load();
    void fetch("/api/v1/tasks/meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { assignable_users?: TaskAssignee[] } | null) => {
        if (d?.assignable_users) setAssignees(d.assignable_users);
      })
      .catch(() => {});
    // Poll léger sans re-sync Hermes à chaque fois (sync toutes les 3 itérations).
    let tick = 0;
    const t = setInterval(() => {
      tick += 1;
      void load(tick % 3 === 0);
    }, 15000);
    return () => clearInterval(t);
  }, [load]);

  const eligibleAssignees = useMemo(() => {
    if (executor === "hermes") return [];
    return assignees.filter((a) => a.kind === (executor === "ai" ? "ai" : "human"));
  }, [assignees, executor]);

  useEffect(() => {
    // L'assigné doit rester cohérent avec l'exécutant choisi.
    if (executor === "hermes") {
      setAssigneeId("");
      return;
    }
    if (assigneeId && !eligibleAssignees.some((a) => a.id === assigneeId)) {
      setAssigneeId("");
    }
    if (executor === "ai" && !assigneeId && eligibleAssignees.length === 1) {
      setAssigneeId(eligibleAssignees[0]!.id);
    }
  }, [executor, assigneeId, eligibleAssignees]);

  const filteredColumns = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const out: Record<string, TaskCard[]> = {};
    for (const [k, list] of Object.entries(columns)) {
      out[k] = (list || []).filter((t) => {
        if (executorFilter !== "all" && t.executor_kind !== executorFilter) {
          return false;
        }
        if (assigneeFilterId && t.assignee?.id !== assigneeFilterId) {
          return false;
        }
        if (!q) return true;
        return (
          t.title.toLowerCase().includes(q) ||
          t.body.toLowerCase().includes(q) ||
          (t.assignee?.username || "").toLowerCase().includes(q)
        );
      });
    }
    return out;
  }, [columns, filter, executorFilter, assigneeFilterId]);

  const totalCount = useMemo(
    () =>
      Object.values(columns).reduce((acc, list) => acc + (list?.length || 0), 0),
    [columns],
  );

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await fetch("/api/v1/tasks/sync", { method: "POST" });
      const data = (await res.json()) as {
        columns?: Record<string, TaskCard[]>;
        sync?: { updated: number; created: number };
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error || "Sync impossible");
        return;
      }
      setColumns(data.columns || {});
      toast.success(
        `Sync Hermes : +${data.sync?.created ?? 0} créées · ${data.sync?.updated ?? 0} mises à jour`,
      );
    } finally {
      setSyncing(false);
    }
  }

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (executor === "ai" && !assigneeId) {
      toast.error("Choisissez le collaborateur IA qui exécutera la tâche");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim() || undefined,
          executor_kind: executor,
          assignee_user_id: assigneeId || null,
          recurring_schedule:
            executor === "hermes" && schedule.trim() ? schedule.trim() : null,
          // Hermes : envoi immédiat. IA : lancement optionnel du run.
          dispatch: executor === "hermes",
          launch: executor === "ai" && launchNow,
        }),
      });
      const data = (await res.json()) as {
        task?: TaskCard;
        warning?: string | null;
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error || "Création impossible");
        return;
      }
      if (data.warning) toast.message(data.warning);
      else if (executor === "hermes") toast.success("Tâche envoyée à Hermes");
      else if (executor === "ai" && launchNow) toast.success("Tâche créée — run IA en file");
      else toast.success("Tâche créée");
      setTitle("");
      setBody("");
      setSchedule("");
      setComposerOpen(false);
      await load(false);
      if (data.task?.id) {
        setSelectedId(data.task.id);
        setSheetOpen(true);
      }
    } finally {
      setCreating(false);
    }
  }

  const setStatus = useCallback(
    async (id: string, status: string) => {
      const res = await fetch(`/api/v1/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error || "Mise à jour impossible");
        return;
      }
      await load(false);
    },
    [load],
  );

  function onDropTo(col: ColumnKey) {
    setDropCol(null);
    if (!dragId) return;
    const current = Object.values(columns)
      .flat()
      .find((t) => t.id === dragId);
    setDragId(null);
    if (!current || current.status === col) return;
    void setStatus(current.id, col);
  }

  function openTask(id: string) {
    setSelectedId(id);
    setSheetOpen(true);
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-[linear-gradient(135deg,#f8fafc_0%,#ffffff_45%,#f0f9ff_100%)] p-4 shadow-sm shadow-slate-900/5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white">
                <Bot className="h-3 w-3" />
                {totalCount} tâche{totalCount !== 1 ? "s" : ""}
              </span>
              {executors.includes("hermes") && <Badge
                variant="outline"
                className={cn(
                  "gap-1 border-0 text-[11px]",
                  hermesConfigured
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-amber-100 text-amber-900",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    hermesConfigured ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
                {hermesConfigured ? "Hermes connecté" : "Hermes hors ligne"}
              </Badge>}
              {executors.includes("ai") && <Badge
                variant="outline"
                className={cn(
                  "gap-1 border-0 text-[11px]",
                  bridgeReady
                    ? "bg-violet-100 text-violet-900"
                    : "bg-slate-100 text-slate-500",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    bridgeReady ? "bg-violet-500" : "bg-slate-400",
                  )}
                />
                {bridgeReady ? "Workspaces IA prêts" : "Desktop IA hors ligne"}
              </Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {EXECUTOR_FILTERS.filter(f => f.id === "all" || executors.includes(f.id)).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setExecutorFilter(f.id)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                    executorFilter === f.id
                      ? "bg-slate-900 text-white"
                      : "bg-white/80 text-slate-600 hover:bg-slate-100",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtrer…"
                className="h-9 w-44 border-slate-200 bg-white/90 pl-8 text-xs shadow-none"
              />
            </div>
            {hermesConfigured ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 bg-white/90"
                disabled={syncing || loading}
                onClick={() => void syncNow()}
              >
                {syncing ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Sync Hermes
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              className="h-9"
              onClick={() => setComposerOpen((v) => !v)}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Nouvelle tâche
            </Button>
          </div>
        </div>

        {composerOpen ? (
          <form
            onSubmit={(e) => void createTask(e)}
            className="grid gap-2 rounded-xl border border-slate-200 bg-white/90 p-3 shadow-sm animate-in fade-in slide-in-from-top-1"
          >
            <Input
              placeholder="Titre de la tâche"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="border-slate-200 text-sm font-medium"
              autoFocus
            />
            <textarea
              placeholder="Brief (contexte, contraintes, livrable attendu)…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-offset-white placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-sky-400"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Exécutant
              </span>
              {executors.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setExecutor(k)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    executor === k
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {EXECUTOR_META[k].label}
                </button>
              ))}
            </div>
            {executor !== "hermes" ? (
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800"
              >
                <option value="">
                  {executor === "ai"
                    ? "— Choisir le collaborateur IA —"
                    : "Non assignée"}
                </option>
                {eligibleAssignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.username}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                placeholder="Récurrence optionnelle (every 1d, 0 9 * * 1…)"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                className="border-slate-200 text-xs"
              />
            )}
            {executor === "ai" ? (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={launchNow}
                  onChange={(e) => setLaunchNow(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
                Lancer le run IA immédiatement
              </label>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setComposerOpen(false)}
              >
                Annuler
              </Button>
              <Button type="submit" size="sm" disabled={creating || !title.trim()}>
                {creating ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                )}
                {executor === "hermes"
                  ? "Créer & envoyer à Hermes"
                  : executor === "ai" && launchNow
                    ? "Créer & lancer"
                    : "Créer"}
              </Button>
            </div>
          </form>
        ) : null}
      </div>

      {/* Board */}
      {loading && totalCount === 0 ? (
        <div className="flex items-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement du board…
        </div>
      ) : (
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 md:grid md:grid-cols-4 md:overflow-visible">
          {KANBAN_COLUMNS.map((col) => {
            const meta = STATUS_META[col.key];
            const items = filteredColumns[col.key] || [];
            return (
              <section
                key={col.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropCol(col.key);
                }}
                onDragLeave={() =>
                  setDropCol((c) => (c === col.key ? null : c))
                }
                onDrop={(e) => {
                  e.preventDefault();
                  onDropTo(col.key);
                }}
                className={cn(
                  "flex w-[270px] shrink-0 flex-col rounded-2xl border bg-gradient-to-b shadow-sm transition-colors md:w-auto",
                  meta?.colTint || "from-slate-50 to-white",
                  dropCol === col.key && dragId
                    ? "border-sky-400 ring-2 ring-sky-200"
                    : "border-slate-200/80",
                )}
              >
                <header className="flex items-center justify-between px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        meta?.barClass || "bg-slate-400",
                      )}
                    />
                    <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600">
                      {col.label}
                    </h2>
                  </div>
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-slate-500 shadow-sm">
                    {items.length}
                  </span>
                </header>

                <ul className="flex min-h-[320px] flex-1 flex-col gap-2 px-2 pb-3">
                  {items.length === 0 ? (
                    <li className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200/80 px-3 py-8 text-center text-[11px] text-slate-400">
                      {dragId ? "Déposer ici" : "Vide"}
                    </li>
                  ) : (
                    items.map((t) => {
                      const preview = previewBrief(t.body);
                      const exec = EXECUTOR_META[t.executor_kind];
                      const running =
                        t.executor_kind !== "human" &&
                        t.status === "in_progress";
                      return (
                        <li key={t.id}>
                          <button
                            type="button"
                            draggable
                            onDragStart={() => setDragId(t.id)}
                            onDragEnd={() => {
                              setDragId(null);
                              setDropCol(null);
                            }}
                            onClick={() => openTask(t.id)}
                            className={cn(
                              "group w-full cursor-grab rounded-xl border border-slate-200/90 bg-white p-3 text-left shadow-sm transition active:cursor-grabbing",
                              "hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md hover:shadow-sky-900/5",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
                              dragId === t.id && "opacity-50",
                              selectedId === t.id && sheetOpen
                                ? "border-sky-400 ring-2 ring-sky-200"
                                : null,
                            )}
                          >
                            <div
                              className={cn(
                                "mb-2 h-0.5 w-10 rounded-full",
                                meta?.barClass || "bg-slate-300",
                              )}
                            />
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-semibold leading-snug text-slate-900">
                                {t.title}
                              </p>
                              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-sky-500" />
                            </div>
                            {preview ? (
                              <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-slate-600">
                                {preview}
                              </p>
                            ) : null}

                            <div className="mt-2.5 flex flex-wrap items-center gap-1">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                                  exec.badgeClass,
                                )}
                              >
                                {t.executor_kind === "human" ? (
                                  <User className="h-3 w-3" />
                                ) : (
                                  <Bot className="h-3 w-3" />
                                )}
                                {t.assignee?.username || exec.short}
                                {running ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : null}
                              </span>
                              {t.result ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Rapport
                                </span>
                              ) : null}
                              {t.recurring_schedule ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-800">
                                  <Repeat2 className="h-3 w-3" />
                                  Récurrente
                                </span>
                              ) : null}
                              <span className="rounded-md bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">
                                {sourceLabel(t.source)}
                              </span>
                            </div>

                            <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                              <span>
                                {formatDistanceToNow(new Date(t.updated_at), {
                                  addSuffix: true,
                                  locale: fr,
                                })}
                              </span>
                              <span className="font-medium text-sky-600 opacity-0 transition group-hover:opacity-100">
                                Voir le détail
                              </span>
                            </div>
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <TaskDetailSheet
        taskId={selectedId}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onStatusChange={setStatus}
        onChanged={() => void load(false)}
      />
    </div>
  );
}
