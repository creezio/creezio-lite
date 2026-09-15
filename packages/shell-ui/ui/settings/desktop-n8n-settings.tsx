"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";

/**
 * n8n — stack native Creezio.
 * Statut + paramètres verrouillés (tunnel/webhooks) + actions.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Workflow,
  Wrench,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "../primitives/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../primitives/card";
import { useTabWorkspaceOptional } from "../workspace/tab-workspace-host";
import { openN8nUiInWorkspace } from "../lib/n8n-ui";
import { LockedConfigField } from "./locked-config-field";
import { DesktopEmbedEnvPanel } from "./desktop-embed-env-panel";
import { ServerServiceStatusCard } from "./server-mode-cards";

type N8nStatus = {
  status: string;
  mode: string;
  uiUrl: string | null;
  entryFound: boolean;
  entryPath: string | null;
  version: string | null;
  detail: string;
  homeDir: string | null;
  bootstrapPhase: string;
  bootstrapError: string | null;
  installing: boolean;
  ownerReady: boolean;
  logs: string[];
  localUiUrl?: string | null;
  publicWebhookUrl?: string | null;
  listenHost?: string;
  listenPort?: number;
};

type TunnelStatus = {
  configured?: boolean;
  publicUrls?: { n8n?: string | null } | null;
};

function statusTone(status: string): string {
  if (status === "running") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (status === "installing") {
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
      return "Premier démarrage…";
    case "installing":
      return "Préparation…";
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

export function DesktopN8nSettings() {
  const workspace = useTabWorkspaceOptional();
  const [desktop, setDesktop] = useState(false);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState<N8nStatus | null>(null);
  const [tunnelN8n, setTunnelN8n] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);

  const refresh = useCallback(async () => {
    const api = getShellDesktopApi();
    if (!api?.getN8nStatus) return;
    setLoading(true);
    try {
      setStatus((await api.getN8nStatus()) as N8nStatus);
      if (api.getTunnelStatus) {
        const t = (await api.getTunnelStatus()) as TunnelStatus;
        setTunnelN8n(t.publicUrls?.n8n || null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const api = getShellDesktopApi();
    if (!api?.getN8nStatus) return;
    setDesktop(true);
    void refresh();
  }, [refresh]);

  // Web (serveur headless) : statut via /api/v1/os/n8n/status.
  if (!desktop) return <ServerServiceStatusCard kind="n8n" />;

  async function onOpenUiTab() {
    const r = await openN8nUiInWorkspace({
      openExternalSite: workspace?.openExternalSite
        ? (o) => workspace.openExternalSite(o)
        : undefined,
      openTab: getShellDesktopApi()?.openTab
        ? (siteId, url) => getShellDesktopApi()!.openTab!(siteId, url)
        : undefined,
    });
    if (r.ok) toast.success("Onglet n8n ouvert");
    else toast.error(r.error);
  }

  async function onRepairRuntime() {
    const api = getShellDesktopApi();
    if (!api?.ensureN8nRuntime) return;
    setInstalling(true);
    try {
      const r = await api.ensureN8nRuntime();
      if (r.ok) toast.success(r.detail || "Runtime n8n OK");
      else toast.error(r.detail || "Réparation échouée");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setInstalling(false);
    }
  }

  const busy = installing || Boolean(status?.installing);
  const localUrl =
    status?.localUiUrl || status?.uiUrl || "http://127.0.0.1:15678";
  const webhookUrl =
    status?.publicWebhookUrl ||
    (tunnelN8n ? `${tunnelN8n.replace(/\/$/, "")}/` : null);
  const webhookOk =
    Boolean(webhookUrl) && !webhookUrl!.includes("127.0.0.1");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Workflow className="h-4 w-4" /> n8n
        </CardTitle>
        <CardDescription>
          Automatisations natives Creezio. Les webhooks doivent utiliser
          l’URL tunnel (pas l’IP locale).
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
              {status.ownerReady ? (
                <div className="mt-1 text-xs opacity-90">
                  Connexion automatique active
                </div>
              ) : null}
              {status.bootstrapError && status.status !== "running" ? (
                <div className="mt-1 text-xs text-amber-800">
                  {status.bootstrapError}
                </div>
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
              hint="Toujours actif sur Héberger — non dissociable."
            />
            <LockedConfigField
              label="Écoute locale"
              value={`${status?.listenHost || "127.0.0.1"}:${status?.listenPort || 15678}`}
              hint="Loopback uniquement — jamais exposé directement."
            />
            <LockedConfigField
              label="URL locale (onglet desktop)"
              value={localUrl}
            />
            <LockedConfigField
              label="URL publique webhooks / editor"
              value={webhookUrl || "Tunnel non réservé"}
              hint={
                webhookOk
                  ? "WEBHOOK_URL et N8N_EDITOR_BASE_URL — c’est cette adresse que les webhooks doivent afficher."
                  : "Réservez un slug dans Accès distant, puis redémarrez si besoin. Sans tunnel = IP locale uniquement."
              }
            />
            <LockedConfigField
              label="Dossier données"
              value={status?.homeDir || "…/n8n-home"}
              hint="Sous le profil Creezio (OS sandbox)."
            />
            <LockedConfigField
              label="Auth"
              value="Owner silencieux (cookie session)"
              hint="Pas de mot de passe à saisir dans l’UI."
            />
            <LockedConfigField
              label="MCP instance"
              value="Activé (N8N_MCP_ACCESS_ENABLED)"
              hint="Géré par Creezio — Hermes utilise aussi l’API key REST."
            />
            <LockedConfigField
              label="API key Hermes"
              value="Provisionnée silencieusement"
              hint="Fichier n8n-home/.creezio-n8n-api-key.json — injectée dans Hermes."
            />
          </div>
        </div>

        <DesktopEmbedEnvPanel service="n8n" />

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void onOpenUiTab()}
            disabled={busy || status?.status === "skipped-remote-client"}
          >
            {installing || status?.installing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
            )}
            Ouvrir dans un onglet
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onRepairRuntime()}
            disabled={busy || status?.status === "skipped-remote-client"}
          >
            {installing || status?.installing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wrench className="mr-1 h-3.5 w-3.5" />
            )}
            Réparer
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
