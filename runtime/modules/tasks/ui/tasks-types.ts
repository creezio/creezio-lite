/** Types + méta UI du kanban unifié « Tâches » (API /api/v1/tasks). */

export type TaskAssignee = {
  id: string;
  username: string;
  kind: "human" | "ai";
};

export type TaskCard = {
  id: string;
  title: string;
  body: string;
  status: string;
  position: number;
  executor_kind: "human" | "ai" | "hermes";
  assignee_user_id: string | null;
  assignee?: TaskAssignee | null;
  parent_task_id: string | null;
  created_by: string | null;
  priority: number;
  hermes_task_id: string | null;
  hermes_status: string | null;
  recurring_schedule: string | null;
  source: string;
  result: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export const KANBAN_COLUMNS = [
  { key: "backlog", label: "Backlog" },
  { key: "in_progress", label: "En cours" },
  { key: "blocked", label: "Bloqué" },
  { key: "done", label: "Terminé" },
] as const;

export type ColumnKey = (typeof KANBAN_COLUMNS)[number]["key"];

export const STATUS_META: Record<
  string,
  { label: string; badgeClass: string; barClass: string; colTint: string }
> = {
  backlog: {
    label: "Backlog",
    badgeClass: "bg-slate-200 text-slate-800",
    barClass: "bg-slate-400",
    colTint: "from-slate-50 to-white",
  },
  in_progress: {
    label: "En cours",
    badgeClass: "bg-amber-100 text-amber-900",
    barClass: "bg-amber-500",
    colTint: "from-amber-50/80 to-white",
  },
  blocked: {
    label: "Bloqué",
    badgeClass: "bg-rose-100 text-rose-900",
    barClass: "bg-rose-500",
    colTint: "from-rose-50/70 to-white",
  },
  done: {
    label: "Terminé",
    badgeClass: "bg-emerald-100 text-emerald-900",
    barClass: "bg-emerald-500",
    colTint: "from-emerald-50/70 to-white",
  },
  cancelled: {
    label: "Annulé",
    badgeClass: "bg-slate-100 text-slate-500",
    barClass: "bg-slate-300",
    colTint: "from-slate-50 to-white",
  },
};

export const EXECUTOR_META: Record<
  TaskCard["executor_kind"],
  { label: string; short: string; badgeClass: string }
> = {
  human: {
    label: "Humain",
    short: "Humain",
    badgeClass: "bg-slate-100 text-slate-700",
  },
  ai: {
    label: "Collaborateur IA",
    short: "IA",
    badgeClass: "bg-violet-100 text-violet-900",
  },
  hermes: {
    label: "Agent Hermes",
    short: "Hermes",
    badgeClass: "bg-sky-100 text-sky-900",
  },
};

export function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    assistant: "Assistant",
    ui: "Manuel",
    hermes: "Hermes",
    sync: "Sync",
  };
  return map[source] || source;
}

/** Extrait le brief « humain » (sans footer technique CRM). */
export function previewBrief(body: string, max = 120): string {
  if (!body.trim()) return "";
  const cleaned = body
    .split(/\n—\n|\n---\n/)[0]!
    .replace(/^Source:.*$/gim, "")
    .replace(/^Conversation:.*$/gim, "")
    .replace(/^CRM task:.*$/gim, "")
    .replace(/^CRM todo:.*$/gim, "")
    .replace(/^Récurrence:.*$/gim, "")
    .trim();
  if (!cleaned) return "";
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}
