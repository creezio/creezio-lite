"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";

/**
 * Fonctionnement en arrière-plan — desktop uniquement (IPC background:*).
 *
 * - « Fermer = réduire dans la zone de notification » : la fenêtre se masque,
 *   le serveur local + le bridge restent actifs → les collaborateurs IA
 *   restent joignables (MCP / API) même fenêtre fermée.
 * - « Lancer au démarrage » : app.setLoginItemSettings (Windows / macOS).
 */

import { useEffect, useState } from "react";
import { Power } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../primitives/card";

type BackgroundState = {
  closeToTray: boolean;
  launchAtStartup: boolean;
  trayActive: boolean;
  platform: string;
};

export function DesktopBackgroundSettings() {
  const [state, setState] = useState<BackgroundState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const api = getShellDesktopApi();
    if (!api?.getBackgroundSettings) return;
    void api
      .getBackgroundSettings()
      .then((s: BackgroundState) => setState(s))
      .catch(() => {});
  }, []);

  // Navigateur classique ou vieux desktop sans l'IPC : section masquée.
  if (!state) return null;

  async function apply(patch: {
    closeToTray?: boolean;
    launchAtStartup?: boolean;
  }) {
    const api = getShellDesktopApi();
    if (!api?.setBackgroundSettings) return;
    setBusy(true);
    try {
      const r = await api.setBackgroundSettings(patch);
      setState((prev) =>
        prev
          ? { ...prev, ...r.settings, trayActive: r.trayActive }
          : prev,
      );
      toast.success("Réglage enregistré");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  const launchSupported =
    state.platform === "win32" || state.platform === "darwin";
  const productName = getShellUiBrand().productName;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Power className="h-4 w-4" /> Fonctionnement en arrière-plan
        </CardTitle>
        <CardDescription>
          Pour que vos collaborateurs IA restent joignables (tâches, MCP, API)
          même quand la fenêtre est fermée, {productName} peut continuer de
          tourner dans la zone de notification.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <label className="flex items-start justify-between gap-4 leading-snug">
          <div>
            <span className="font-medium">
              Fermer la fenêtre = réduire dans la zone de notification
            </span>
            <p className="text-xs text-muted-foreground">
              {state.trayActive
                ? `Le serveur local et les IA restent actifs ; quittez vraiment via le menu de l’icône ${productName}.`
                : "Icône de notification indisponible sur ce système — fermer la fenêtre quittera l’application."}
            </p>
          </div>
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={state.closeToTray}
            disabled={busy || !state.trayActive}
            onChange={(e) => void apply({ closeToTray: e.target.checked })}
          />
        </label>
        <label className="flex items-start justify-between gap-4 leading-snug">
          <div>
            <span className="font-medium">
              Lancer {productName} au démarrage de l’ordinateur
            </span>
            <p className="text-xs text-muted-foreground">
              {launchSupported
                ? "L’application démarre avec votre session — vos IA sont opérationnelles sans intervention."
                : `Non géré automatiquement sur ce système (ajoutez ${productName} aux applications de démarrage de votre environnement).`}
            </p>
          </div>
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={state.launchAtStartup}
            disabled={busy || !launchSupported}
            onChange={(e) => void apply({ launchAtStartup: e.target.checked })}
          />
        </label>
      </CardContent>
    </Card>
  );
}
