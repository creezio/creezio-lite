"use client";

import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import { cn } from "./primitives/cn";

export type AssistantToolStep = {
  id: string;
  toolName: string;
  status: "running" | "done" | "error";
  argsPreview?: string;
  summary?: string;
  durationMs?: number;
  round?: number;
};

const TOOL_LABELS: Record<string, string> = {
  list_tables: "Listing tables",
  describe_table: "Describe table",
  find_columns: "Find columns",
  list_distinct_values: "Distinct values",
  run_sql: "SQL",
  search_knowledge: "Recherche",
  get_entity: "Fiche",
  surface_list_targets: "Surface · repérage",
  surface_click: "Surface · clic",
  surface_type: "Surface · saisie",
  surface_scroll: "Surface · défilement",
  surface_read: "Surface · lecture",
  ui_list_targets: "CRM · repérage",
  ui_click: "CRM · clic",
  ui_type: "CRM · saisie",
  ui_scroll: "CRM · défilement",
  supplier_list_tabs: "Site · onglets",
  supplier_open_tab: "Site · ouvrir",
  supplier_list_targets: "Site · repérage",
  supplier_click: "Site · clic",
  supplier_type: "Site · saisie",
  supplier_scroll: "Site · défilement",
  supplier_read: "Site · lecture",
  create_task: "Tâche",
  list_tasks: "Tâches",
};

function labelFor(name: string) {
  return TOOL_LABELS[name] || name;
}

export function AssistantToolSteps({
  steps,
  thinking,
}: {
  steps?: AssistantToolStep[];
  thinking?: string;
}) {
  if ((!steps || steps.length === 0) && !thinking) return null;

  return (
    <div className="mb-2 space-y-1.5">
      {thinking ? (
        <div className="rounded-lg border border-violet-100 bg-violet-50/70 px-2 py-1.5 text-[11px] leading-relaxed text-violet-900/90">
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600/80">
            Raisonnement
          </div>
          <div className="whitespace-pre-wrap">{thinking}</div>
        </div>
      ) : null}

      {steps && steps.length > 0 ? (
        <ul className="space-y-1">
          {steps.map((s) => {
            const Icon =
              s.status === "running"
                ? Loader2
                : s.status === "error"
                  ? XCircle
                  : CheckCircle2;
            return (
              <li
                key={s.id}
                className={cn(
                  "rounded-lg border px-2 py-1.5 text-[11px]",
                  s.status === "running"
                    ? "border-sky-200 bg-sky-50/80"
                    : s.status === "error"
                      ? "border-rose-200 bg-rose-50/70"
                      : "border-slate-200 bg-white",
                )}
              >
                <div className="flex items-start gap-1.5">
                  <Icon
                    className={cn(
                      "mt-0.5 h-3.5 w-3.5 shrink-0",
                      s.status === "running" && "animate-spin text-sky-600",
                      s.status === "done" && "text-emerald-600",
                      s.status === "error" && "text-rose-600",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="font-semibold text-slate-800">
                        {labelFor(s.toolName)}
                      </span>
                      {s.status === "running" ? (
                        <span className="text-sky-700">en cours…</span>
                      ) : null}
                      {typeof s.durationMs === "number" && s.status !== "running" ? (
                        <span className="text-[10px] text-slate-400">
                          {s.durationMs} ms
                        </span>
                      ) : null}
                    </div>
                    {s.argsPreview ? (
                      <pre className="mt-0.5 max-h-16 overflow-hidden whitespace-pre-wrap break-all font-mono text-[10px] text-slate-600">
                        {s.argsPreview}
                      </pre>
                    ) : null}
                    {s.summary ? (
                      <p className="mt-0.5 text-[10px] text-slate-500">{s.summary}</p>
                    ) : s.status === "running" ? (
                      <p className="mt-0.5 flex items-center gap-1 text-[10px] text-sky-700">
                        <CircleDashed className="h-3 w-3" />
                        Exécution…
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
