"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";

/**
 * Chrome fenêtre frameless sur les écrans hors workspace (login, setup,
 * server-cockpit, …). Sans ça, Windows n’a plus de min/max/close (la
 * titlebar vit uniquement dans WorkspaceTabBar).
 */

import { useEffect, useState, type ReactNode } from "react";
import { WindowChromeControls } from "../workspace/window-chrome-controls";
import { cn } from "@creezio/shell-ui";

export function AuthWindowChrome({
  children,
  variant = "light",
}: {
  children: ReactNode;
  /** `dark` = cockpit serveur (#0b1020). */
  variant?: "light" | "dark";
}) {
  const [chrome, setChrome] = useState(false);

  useEffect(() => {
    setChrome(Boolean(getShellDesktopApi()?.customWindowChrome));
    // Belt-and-suspenders : pas de FAB Electron topmost hors session.
    void getShellDesktopApi()?.setAssistantChrome?.("hidden");
  }, []);

  return (
    <>
      {chrome ? (
        <div
          className={cn(
            "fixed inset-x-0 top-0 z-[100] flex h-10 items-stretch border-b backdrop-blur-sm",
            variant === "dark"
              ? "border-white/10 bg-[#0b1020]/95"
              : "border-slate-200/80 bg-slate-100/95",
          )}
          role="banner"
          aria-label="Barre de titre"
        >
          <div className={`${getShellUiBrand().titlebarDragClass} min-w-0 flex-1 self-stretch`} />
          <WindowChromeControls tone={variant === "dark" ? "dark" : "light"} />
        </div>
      ) : null}
      <div className={chrome ? "pt-10" : undefined}>{children}</div>
    </>
  );
}
