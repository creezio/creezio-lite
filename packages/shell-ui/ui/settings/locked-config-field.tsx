"use client";

/**
 * Champ de configuration visible mais non modifiable (OS Creezio pré-configuré).
 */

import { Lock } from "lucide-react";

export function LockedConfigField(props: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
        <Lock className="h-3 w-3 shrink-0" />
        {props.label}
      </div>
      <div className="mt-1 break-all font-mono text-xs text-slate-900">
        {props.value || "—"}
      </div>
      {props.hint ? (
        <div className="mt-1 text-[11px] leading-snug text-slate-500">
          {props.hint}
        </div>
      ) : null}
    </div>
  );
}
