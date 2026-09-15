"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Skeleton } from "./primitives/skeleton";
import { cn } from "@creezio/shell-ui";

/** Clés query effacées au changement de preset — injectables marque. */
const DEFAULT_PRESET_CLEAR_KEYS = [
  "status",
  "alerts",
  "alertType",
  "platform",
  "hasClient",
  "fleet",
  "risk",
  "declaration",
  "infraction",
  "toDeclare",
  "topic",
  "type",
  "declared",
  "repaired",
  "category",
  "openOnly",
  "settledOnly",
  "company",
  "coverage",
  "hasAttestation",
  "hasSub",
  "year",
  "month",
  "productType",
  "hasPdf",
  "amountRange",
  "pipeline",
  "source",
  "priceMin",
  "priceMax",
  "amountMin",
  "amountMax",
  "dateFrom",
  "dateTo",
  "payment_status",
  "currency",
  "invoiceMatched",
  "sort",
  "sens",
  "period",
  "varMin",
  "varMax",
  "deltaMin",
  "deltaMax",
  "docsIncomplete",
] as const;

let presetClearKeys: string[] = [...DEFAULT_PRESET_CLEAR_KEYS];

/** Ajoute / remplace les clés métier marque (ex. TF: fournisseur, promo). */
export function configureListToolbarClearKeys(keys: string[]): void {
  presetClearKeys = Array.from(new Set([...DEFAULT_PRESET_CLEAR_KEYS, ...keys]));
}

export function getListToolbarClearKeys(): readonly string[] {
  return presetClearKeys;
}

export type PresetDef = {
  id: string;
  label: string;
  params: Record<string, string>;
};

export type ViewOption = {
  /** Valeur logique (ex. table, company). */
  id: string;
  label: string;
  /** Valeur du searchParam `view` ; omit/undefined = vue par défaut (param retiré). */
  param?: string;
};

const DEFAULT_VIEW_OPTIONS: ViewOption[] = [
  { id: "table", label: "Liste" },
  { id: "kanban", label: "Kanban", param: "kanban" },
];

export function ViewToggle({
  view,
  tableLabel = "Liste",
  kanbanLabel = "Kanban",
  options,
}: {
  view: string;
  tableLabel?: string;
  kanbanLabel?: string;
  /** Options custom (sinon Liste / Kanban classiques). */
  options?: ViewOption[];
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [pendingView, setPendingView] = useState<string | null>(null);
  const activeView = pendingView ?? view;
  const opts =
    options ??
    DEFAULT_VIEW_OPTIONS.map((o) =>
      o.id === "table"
        ? { ...o, label: tableLabel }
        : o.id === "kanban"
          ? { ...o, label: kanbanLabel }
          : o,
    );

  useEffect(() => {
    setPendingView(null);
  }, [view]);

  function hrefFor(opt: ViewOption) {
    const sp = new URLSearchParams(params.toString());
    if (!opt.param) sp.delete("view");
    else sp.set("view", opt.param);
    sp.delete("page");
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <div
      className="flex flex-wrap gap-2 text-sm"
      aria-busy={pendingView != null && pendingView !== view ? true : undefined}
    >
      {opts.map((opt) => {
        const selected = activeView === opt.id;
        const pending = pendingView === opt.id && pendingView !== view;
        return (
          <Link
            key={opt.id}
            href={hrefFor(opt)}
            aria-current={selected ? "true" : undefined}
            onClick={() => {
              if (opt.id !== activeView) setPendingView(opt.id);
            }}
            className={cn(
              "rounded-lg px-3 py-1.5 transition-colors",
              selected ? "bg-slate-900 text-white" : "border bg-white hover:bg-slate-50",
              pending && "ring-2 ring-sky-300 ring-offset-1",
            )}
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Placeholder toggle pendant loading.tsx ou navigation lente. */
export function ViewToggleSkeleton({
  options,
}: {
  options?: readonly Pick<ViewOption, "label">[];
}) {
  const labels = options?.map((o) => o.label) ?? ["Liste", "Kanban"];
  return (
    <div className="flex flex-wrap gap-2 text-sm" aria-hidden>
      {labels.map((label) => (
        <Skeleton key={label} className="h-8 w-20 rounded-lg" />
      ))}
    </div>
  );
}

export function PresetChips({
  presets,
  activeId,
  clearHref,
}: {
  presets: PresetDef[];
  activeId?: string | null;
  clearHref?: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  function hrefFor(preset: PresetDef) {
    const sp = new URLSearchParams(params.toString());
    // Remplace les filtres métier courants, conserve view/q
    for (const key of presetClearKeys) {
      sp.delete(key);
    }
    Object.entries(preset.params).forEach(([k, v]) => {
      if (!v) sp.delete(k);
      else sp.set(k, v);
    });
    sp.set("preset", preset.id);
    sp.delete("page");
    return `${pathname}?${sp.toString()}`;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {presets.map((p) => (
        <Link
          key={p.id}
          href={hrefFor(p)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition",
            activeId === p.id
              ? "border-sky-700 bg-sky-50 text-sky-900"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
          )}
        >
          {p.label}
        </Link>
      ))}
      {clearHref ? (
        <Link
          href={clearHref}
          className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500 hover:bg-slate-50"
        >
          Réinitialiser
        </Link>
      ) : null}
    </div>
  );
}

export function KpiStrip({
  items,
  columns = 4,
}: {
  items: {
    label: string;
    value: number;
    /** Affichage custom (ex. montants €) — sinon `value` localisé. */
    display?: string;
    href: string;
    tone?: "danger" | "warning" | "ok" | "neutral";
  }[];
  /** Nombre de colonnes desktop (défaut 4). */
  columns?: 3 | 4 | 5 | 6;
}) {
  const colsClass =
    columns === 6
      ? "sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6"
      : columns === 5
        ? "sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5"
        : columns === 3
          ? "sm:grid-cols-2 lg:grid-cols-3"
          : "sm:grid-cols-2 lg:grid-cols-4";

  return (
    <div className={cn("grid gap-3", colsClass)}>
      {items.map((item) => {
        const tone =
          item.tone === "danger"
            ? "border-red-200 bg-red-50/80 hover:bg-red-50"
            : item.tone === "warning"
              ? "border-amber-200 bg-amber-50/80 hover:bg-amber-50"
              : item.tone === "ok"
                ? "border-emerald-200 bg-emerald-50/60 hover:bg-emerald-50"
                : "border-slate-200 bg-white hover:bg-slate-50";
        return (
          <Link
            key={item.label}
            href={item.href}
            className={cn(
              "rounded-xl border px-3 py-3 shadow-sm transition",
              tone,
            )}
          >
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {item.label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              {item.display ?? item.value.toLocaleString("fr-FR")}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export function AlertChips({
  chips,
}: {
  chips: { key: string; short: string; tone: "danger" | "warning" }[];
}) {
  if (!chips.length) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span
          key={c.key}
          className={
            c.tone === "danger"
              ? "rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"
              : "rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
          }
        >
          {c.short}
        </span>
      ))}
    </div>
  );
}
