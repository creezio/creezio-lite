"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";

import { useCallback, useEffect, useState } from "react";
import { Minus, Square, X } from "lucide-react";
import { cn } from "@creezio/shell-ui";

/** Icône « restaurer » (deux carrés superposés, style Windows). */
function RestoreIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={className}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
    >
      <rect x="3.25" y="1.75" width="7" height="7" rx="0.5" />
      <path d="M1.75 3.75v6.5h6.5" />
    </svg>
  );
}

/**
 * Boutons min / max-restore / close — chrome Notion-like (frameless Windows).
 * Rendu uniquement si `getShellDesktopApi().customWindowChrome` (sync preload).
 */
export function WindowChromeControls({
  tone = "light",
}: {
  tone?: "light" | "dark";
} = {}) {
  const [visible, setVisible] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const api = getShellDesktopApi();
    if (!api?.customWindowChrome) return;
    setVisible(true);
    void api.isWindowMaximized?.().then((v: boolean) => setMaximized(Boolean(v)));
    return api.onWindowMaximizedChanged?.((v: boolean) => setMaximized(v));
  }, []);

  const onMinimize = useCallback(() => {
    void getShellDesktopApi()?.minimizeWindow?.();
  }, []);

  const onToggleMax = useCallback(() => {
    void getShellDesktopApi()?.toggleMaximizeWindow?.().then((r: { isMaximized?: boolean } | void) => {
      if (r && typeof r.isMaximized === "boolean") setMaximized(r.isMaximized);
    });
  }, []);

  const onClose = useCallback(() => {
    void getShellDesktopApi()?.closeWindow?.();
  }, []);

  if (!visible) return null;

  const btnTone =
    tone === "dark"
      ? "text-slate-300 hover:bg-white/10 hover:text-white active:bg-white/15"
      : "text-slate-600 hover:bg-black/[0.08] hover:text-slate-900 active:bg-black/[0.12]";

  return (
    <div
      className={`${getShellUiBrand().titlebarNoDragClass} flex h-10 shrink-0 items-stretch self-stretch`}
      role="group"
      aria-label="Contrôles de la fenêtre"
    >
      <button
        type="button"
        onClick={onMinimize}
        aria-label="Réduire"
        title="Réduire"
        className={cn(
          "flex w-[46px] cursor-default items-center justify-center transition-colors",
          btnTone,
        )}
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={onToggleMax}
        aria-label={maximized ? "Restaurer" : "Agrandir"}
        title={maximized ? "Restaurer" : "Agrandir"}
        className={cn(
          "flex w-[46px] cursor-default items-center justify-center transition-colors",
          btnTone,
        )}
      >
        {maximized ? (
          <RestoreIcon className="h-3 w-3" />
        ) : (
          <Square className="h-3 w-3" strokeWidth={2} />
        )}
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer"
        title="Fermer"
        className={cn(
          "flex w-[46px] cursor-default items-center justify-center transition-colors",
          tone === "dark" ? "text-slate-300" : "text-slate-600",
          "hover:bg-[#e81123] hover:text-white active:bg-[#c50f1f] active:text-white",
        )}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
