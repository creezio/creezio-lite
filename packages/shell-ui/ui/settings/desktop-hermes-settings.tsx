"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";

/**
 * Hermes — stack native Creezio (toujours embarqué sur Héberger).
 * Statut + ouverture WebUI + logs. Pas de mode distant/désactivé.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Bot, Download, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "../primitives/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../primitives/card";
import { useTabWorkspaceOptional } from "../workspace/tab-workspace-host";
import {
  isHermesWebuiOpenTarget,
  resolveHermesWebuiOpenTarget,
} from "../lib/hermes-ui";
import { LockedConfigField } from "./locked-config-field";
import { DesktopEmbedEnvPanel } from "./desktop-embed-env-panel";
import { ServerServiceStatusCard } from "./server-mode-cards";

type HermesStatus = {
  status: string;
  mode: string;
  apiUrl: string | null;
  webuiUrl: string | null;
  webuiStatus: string;
  binaryFound: boolean;
  binaryPath: string | null;
  version: string | null;
  detail: string;
  homeDir: string | null;
  bootstrapPhase: string;
  bootstrapError: string | null;
  installing: boolean;
  logs: string[];
};

function statusTone(status: string): string {
  if (status === "running") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (status === "installing" || status === "starting") {
    return "border-sky-200 bg-sky-50 text-sky-900";
  }
  if (status === "missing" || status === "error") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  if (status === "skipped-remote-client" || status === "remote") {
    return "border-sky-200 bg-sky-50 text-sky-900";
  }
  return "border-slate-200 bg-slate-50 text-slate-800";
}

function statusLabel(status: string): string {
  switch (status) {
    case "running":
      return "En cours";
    case "stopped":
      return "Arrêté";
    case "missing":
      return "Runtime absent";
    case "installing":
      return "Installation…";
    case "starting":
      return "Démarrage…";
    case "error":
      return "Erreur";
    case "skipped-remote-client":
      return "Via l’hôte (Rejoindre)";
    case "remote":
      return "Via tunnel hôte";
    default:
      return status;
  }
}

function webuiLabel(status: string): string {
  switch (status) {
    case "running":
      return "WebUI kanban actif";
    case "missing":
      return "WebUI absent";
    case "error":
      return "WebUI erreur";
    case "skipped":
      return "WebUI via tunnel";
    case "stopped":
      return "WebUI arrêté";
    default:
      return status || "—";
  }
}

export function DesktopHermesSettings() {
  const workspace = useTabWorkspaceOptional();
  const [desktop, setDesktop] = useState(false);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState<HermesStatus | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [tunnelHermes, setTunnelHermes] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const api = getShellDesktopApi();
    if (!api?.getHermesStatus) return;
    setLoading(true);
    try {
      setStatus((await api.getHermesStatus()) as HermesStatus);
      if (api.getTunnelStatus) {
        const t = (await api.getTunnelStatus()) as {
          publicUrls?: { hermes?: string | null };
        };
        setTunnelHermes(t.publicUrls?.hermes || null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const api = getShellDesktopApi();
    if (!api?.getHermesStatus) return;
    setDesktop(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!status?.installing && status?.status !== "starting" && !installing) return;
    const t = setInterval(() => {
      void refresh();
    }, 2500);
    return () => clearInterval(t);
  }, [status?.installing, status?.status, installing, refresh]);

  // Web (serveur headless) : statut via /api/v1/os/hermes/status.
  if (!desktop) return <ServerServiceStatusCard kind="hermes" />;

  async function onInstallRuntime() {
    const api = getShellDesktopApi();
    if (!api?.ensureHermesRuntime) {
      toast.error("API ensureHermesRuntime indisponible — recompilez Electron.");
      return;
    }
    setInstalling(true);
    try {
      const r = await api.ensureHermesRuntime();
      if (r.ok) {
        const restarted = api.retryHermes ? await api.retryHermes() : null;
        if (restarted?.webuiUrl) {
          toast.success("Hermes réparé et relancé.");
        } else {
          toast.error(
            restarted?.detail ||
              "Runtime réparé, mais Hermes ne répond pas. Consultez les logs.",
          );
        }
      } else {
        toast.error(r.detail || "Échec installation runtime");
      }
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur bootstrap");
    } finally {
      setInstalling(false);
    }
  }

  async function onOpenWebuiTab() {
    let retryToast: string | number | undefined;
    const target = await resolveHermesWebuiOpenTarget({
      onRetry: () => {
        retryToast = toast.loading("Relance de l’API et de la WebUI Hermes…");
      },
    });
    if (retryToast !== undefined) toast.dismiss(retryToast);
    if (!isHermesWebuiOpenTarget(target)) {
      toast.error(target.error);
      return;
    }
    if (workspace?.openExternalSite) {
      workspace.openExternalSite({
        siteId: target.siteId,
        url: target.url,
        title: target.title,
      });
      toast.success("Onglet Hermes ouvert");
      return;
    }
    const api = getShellDesktopApi();
    if (api?.openTab) {
      try {
        await api.openTab(target.siteId, target.url);
        toast.success("Onglet Hermes ouvert");
        return;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Ouverture impossible");
        return;
      }
    }
    window.open(target.url, "_blank", "noreferrer");
  }

  const busy = installing || Boolean(status?.installing);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4" /> Hermes Agent
        </CardTitle>
        <CardDescription>
          Agents natifs Creezio. Workspace et HOME confinés dans l’OS Creezio
          — jamais dans C:\Users\…
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={`rounded-md border px-3 py-2 text-sm ${statusTone(status?.status || "")}`}
        >
          {loading || !status ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement…
            </span>
          ) : (
            <>
              <div className="font-medium">
                {statusLabel(status.status)}
                {status.version ? ` · v${status.version}` : ""}
              </div>
              <div className="mt-0.5 text-xs opacity-90">{status.detail}</div>
              <div className="mt-1 text-xs opacity-90">
                {webuiLabel(status.webuiStatus)}
              </div>
              {status.bootstrapError ? (
                <div className="mt-1 text-xs text-amber-800">{status.bootstrapError}</div>
              ) : null}
            </>
          )}
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Service (pré-configuré)
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <LockedConfigField
              label="Mode"
              value="Embarqué (natif Creezio)"
            />
            <LockedConfigField
              label="home_mode"
              value="profile"
              hint="HOME outils = hermes-home/home (sandbox OS)."
            />
            <LockedConfigField
              label="Workspace agent"
              value={
                status?.homeDir
                  ? `${status.homeDir.replace(/[/\\]+$/, "")}/workspace`
                  : "…/hermes-home/workspace"
              }
              hint="Seul répertoire de travail autorisé."
            />
            <LockedConfigField
              label="HERMES_HOME"
              value={status?.homeDir || "…/hermes-home"}
            />
            <LockedConfigField
              label="API locale"
              value={status?.apiUrl || "http://127.0.0.1:18642"}
            />
            <LockedConfigField
              label="WebUI locale"
              value={status?.webuiUrl || "http://127.0.0.1:18797"}
            />
            <LockedConfigField
              label="URL publique tunnel"
              value={tunnelHermes || "Tunnel non réservé"}
            />
            <LockedConfigField
              label="GATEWAY_ALLOW_ALL_USERS"
              value="true"
              hint="Desktop local — messagerie multi-user non utilisée."
            />
          </div>
        </div>

        <DesktopEmbedEnvPanel service="hermes" />

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void onOpenWebuiTab()}
            disabled={busy}
          >
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            Ouvrir dans un onglet
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onInstallRuntime()}
            disabled={busy || status?.status === "skipped-remote-client"}
          >
            {installing || status?.installing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 h-3.5 w-3.5" />
            )}
            Réparer
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Actualiser
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowLogs((v) => !v)}
          >
            {showLogs ? "Masquer les logs" : "Logs"}
          </Button>
        </div>

        {showLogs && status?.logs?.length ? (
          <pre className="max-h-48 overflow-auto rounded-md border bg-slate-950 p-2 font-mono text-[11px] leading-relaxed text-slate-100">
            {status.logs.join("\n")}
          </pre>
        ) : null}
      </CardContent>
    </Card>
  );
}
