"use client";

import { cn } from "@creezio/shell-ui";

export type CockpitVisualVariant = "light" | "dark";

export function StatusDot({
  ok,
  muted,
  variant = "light",
}: {
  ok: boolean;
  muted?: boolean;
  variant?: CockpitVisualVariant;
}) {
  const mutedCls = variant === "dark" ? "bg-slate-500" : "bg-slate-300";
  const okCls = variant === "dark" ? "bg-emerald-400" : "bg-emerald-500";
  const badCls = variant === "dark" ? "bg-red-400" : "bg-red-500";
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
        muted ? mutedCls : ok ? okCls : badCls,
      )}
    />
  );
}
