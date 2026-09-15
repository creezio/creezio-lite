"use client";

import type { CockpitServiceHealth } from "@creezio/cockpit";
import { StatusDot, type CockpitVisualVariant } from "./status-dot";

export function ServiceCard({
  label,
  health,
  variant = "light",
}: {
  label: string;
  health: CockpitServiceHealth | null;
  variant?: CockpitVisualVariant;
}) {
  const muted = !health || !health.configured;
  const cardCls =
    variant === "dark"
      ? "flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-3"
      : "flex items-center gap-2 rounded border p-3";
  const titleCls =
    variant === "dark"
      ? "text-sm font-medium text-slate-100"
      : "text-sm font-medium";
  const subCls =
    variant === "dark"
      ? "truncate text-xs text-slate-400"
      : "truncate text-xs text-muted-foreground";
  return (
    <div className={cardCls}>
      <StatusDot ok={Boolean(health?.ok)} muted={muted} variant={variant} />
      <div className="min-w-0">
        <div className={titleCls}>{label}</div>
        <div className={subCls}>
          {muted
            ? "Non configuré"
            : health?.ok
              ? health.url || "OK"
              : health?.error || "Injoignable"}
        </div>
      </div>
    </div>
  );
}
