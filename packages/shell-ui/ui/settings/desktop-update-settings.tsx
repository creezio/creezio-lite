"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";

/**
 * Mise à jour de l'app desktop — Configuration.
 * Check auto côté main ; téléchargement uniquement après clic.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowUpCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "../primitives/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../primitives/card";
import type { DesktopUpdateStatus } from "../desktop-types";
import { ServerVersionCard } from "./server-mode-cards";

function labelFor(status: DesktopUpdateStatus | null): string {
  if (!status) return "…";
  switch (status.state) {
    case "disabled":
      return status.error || "Auto-update désactivé";
    case "checking":
      return "Recherche d'une mise à jour…";
    case "available":
      return `Mise à jour disponible : ${status.availableVersion ?? "?"}`;
    case "not-available":
      return "Vous êtes à jour";
    case "downloading":
      return `Téléchargement… ${Math.floor(status.percent ?? 0)} %`;
    case "ready":
      return `Prêt à installer (${status.availableVersion ?? "?"}) — redémarrage…`;
    case "error":
      return status.error || "Erreur de mise à jour";
    case "idle":
    default:
      return status.updateAvailable
        ? `Mise à jour disponible : ${status.availableVersion ?? "?"}`
        : "Aucune vérification récente";
  }
}

export function DesktopUpdateSettings() {
  const [desktop, setDesktop] = useState(false);
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const api = getShellDesktopApi();
    if (!api?.getUpdateStatus) return;
    setStatus(await api.getUpdateStatus());
  }, []);

  useEffect(() => {
    const api = getShellDesktopApi();
    if (!api?.getUpdateStatus) return;
    setDesktop(true);
    void refresh();
    const unsub = api.onUpdateChanged?.(setStatus);
    return () => unsub?.();
  }, [refresh]);

  // Web (serveur headless) : version d'image — updates gérées par la flotte.
  if (!desktop) return <ServerVersionCard />;

  const canInstall =
    status?.state === "available" ||
    status?.state === "ready" ||
    (status?.updateAvailable && status.state !== "downloading");
  const downloading = status?.state === "downloading";

  async function onCheck() {
    const api = getShellDesktopApi();
    if (!api?.checkForUpdates) return;
    setBusy(true);
    try {
      const s = await api.checkForUpdates();
      setStatus(s);
      if (s.state === "not-available") toast.success("Vous êtes à jour");
      else if (s.state === "available") {
        toast.message(`Mise à jour ${s.availableVersion} disponible`, {
          description: "Cliquez sur « Mettre à jour » pour l'installer.",
        });
      } else if (s.state === "error") toast.error(s.error || "Erreur");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur de vérification");
    } finally {
      setBusy(false);
    }
  }

  async function onInstall() {
    const api = getShellDesktopApi();
    if (!api?.downloadAndInstallUpdate) return;
    setBusy(true);
    try {
      toast.message("Téléchargement de la mise à jour…", {
        description: "L'application redémarrera pour terminer l'installation.",
      });
      const s = await api.downloadAndInstallUpdate();
      setStatus(s);
      if (s.state === "error") toast.error(s.error || "Échec du téléchargement");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la mise à jour");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowUpCircle className="h-4 w-4" />
          Mises à jour
        </CardTitle>
        <CardDescription>
          Version installée {status?.currentVersion ?? "…"}. Les mises à jour
          ne se téléchargent qu&apos;après votre accord.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p
          className={
            status?.state === "error"
              ? "text-sm text-red-600"
              : status?.updateAvailable || status?.state === "available"
                ? "text-sm font-medium text-amber-700"
                : "text-sm text-muted-foreground"
          }
        >
          {labelFor(status)}
        </p>
        {downloading ? (
          <div className="h-2 w-full overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-amber-500 transition-all"
              style={{ width: `${Math.min(100, Math.max(0, status?.percent ?? 0))}%` }}
            />
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || downloading}
            onClick={() => void onCheck()}
          >
            {busy && !downloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Vérifier
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canInstall || busy || downloading || status?.state === "disabled"}
            onClick={() => void onInstall()}
          >
            {downloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowUpCircle className="mr-2 h-4 w-4" />
            )}
            Mettre à jour
            {status?.availableVersion ? ` (${status.availableVersion})` : ""}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
