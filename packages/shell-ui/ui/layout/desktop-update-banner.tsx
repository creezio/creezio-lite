"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";

/**
 * Bannière quand une mise à jour desktop est disponible.
 * Pas de toast : la barre suffit (évite le doublon coin haut-droit).
 * Invisible hors app Electron.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowUpCircle, Loader2, X } from "lucide-react";
import { Button } from "../primitives/button";
import type { DesktopUpdateStatus } from "../desktop-types";

export function DesktopUpdateBanner() {
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const api = getShellDesktopApi();
    if (!api?.getUpdateStatus) return;
    void api.getUpdateStatus().then(setStatus);
    const unsub = api.onUpdateChanged?.(setStatus);
    return () => unsub?.();
  }, []);

  if (!status) return null;
  if (status.state === "disabled" || status.state === "not-available") return null;
  if (!status.updateAvailable && status.state !== "downloading" && status.state !== "ready") {
    return null;
  }
  if (
    dismissed &&
    status.availableVersion &&
    dismissed === status.availableVersion &&
    status.state === "available"
  ) {
    return null;
  }

  async function onInstall() {
    const api = getShellDesktopApi();
    if (!api?.downloadAndInstallUpdate) return;
    setBusy(true);
    try {
      const s = await api.downloadAndInstallUpdate();
      setStatus(s);
      if (s.state === "error") toast.error(s.error || "Échec de la mise à jour");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la mise à jour");
    } finally {
      setBusy(false);
    }
  }

  const downloading = status.state === "downloading";
  const version = status.availableVersion ?? "?";

  return (
    <div
      role="status"
      className="relative z-[55] flex flex-wrap items-center justify-center gap-2 bg-sky-600 px-3 py-2 text-center text-[13px] text-white"
    >
      <ArrowUpCircle className="h-4 w-4 shrink-0" />
      <span className="font-medium">
        {downloading
          ? `Téléchargement de la mise à jour ${version}… ${Math.floor(status.percent ?? 0)} %`
          : status.state === "ready"
            ? `Mise à jour ${version} prête — redémarrage…`
            : `Mise à jour ${version} disponible`}
      </span>
      {!downloading && status.state !== "ready" ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 bg-white text-sky-800 hover:bg-sky-50"
          disabled={busy}
          onClick={() => void onInstall()}
        >
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          Mettre à jour
        </Button>
      ) : null}
      {status.state === "available" ? (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-white/80 hover:bg-white/10 hover:text-white"
          aria-label="Masquer"
          onClick={() => setDismissed(status.availableVersion ?? "x")}
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
