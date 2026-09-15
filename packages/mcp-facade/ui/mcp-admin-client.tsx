"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, Download, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { ReactNode } from "react";
import { Badge } from "./primitives/badge";
import { Button } from "./primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "./primitives/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./primitives/tabs";

type Status = {
  ready: boolean;
  publicUrl: string | null;
  mcpUrl: string | null;
  oauthReady: boolean;
  jwtConfigured: boolean;
  toolCount: number;
  enabledToolCount: number;
  clientCount: number;
  enabledClientCount: number;
};

type Tool = {
  name: string;
  category: string;
  access: "read" | "write";
  requiredScope: string;
  enabled: boolean;
  allowedRoles: string[];
  annotations?: Record<string, boolean>;
};

type Client = {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  scope: string | null;
  created_at: string;
  enabled: boolean;
  revoked_at: string | null;
  last_used_at: string | null;
  active_refresh_tokens: number;
};

type Diagnostics = {
  healthy: boolean;
  checks: Array<{ id: string; ok: boolean; message: string }>;
};

type Metrics = {
  requests: number;
  errors: number;
  errorRate: number;
  averageDurationMs: number;
  p95DurationMs: number;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

export function McpAdminClient({ logsSlot }: { logsSlot?: ReactNode } = {}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextStatus, toolData, clientData, nextDiagnostics, nextMetrics] =
        await Promise.all([
          api<Status>("/api/v1/admin/mcp/status"),
          api<{ tools: Tool[] }>("/api/v1/admin/mcp/tools"),
          api<{ clients: Client[] }>("/api/v1/admin/mcp/clients"),
          api<Diagnostics>("/api/v1/admin/mcp/diagnostics"),
          api<Metrics>("/api/v1/admin/mcp/metrics"),
        ]);
      setStatus(nextStatus);
      setTools(toolData.tools);
      setClients(clientData.clients);
      setDiagnostics(nextDiagnostics);
      setMetrics(nextMetrics);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleTool(tool: Tool) {
    try {
      await api(`/api/v1/admin/mcp/policies/${encodeURIComponent(tool.name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !tool.enabled }),
      });
      toast.success(`${tool.name} ${tool.enabled ? "désactivé" : "activé"}`);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Échec");
    }
  }

  async function toggleClient(client: Client) {
    try {
      await api(`/api/v1/admin/mcp/clients/${encodeURIComponent(client.client_id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !client.enabled }),
      });
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Échec");
    }
  }

  async function revokeClient(client: Client) {
    if (!window.confirm(`Révoquer définitivement ${client.client_name || client.client_id} ?`)) return;
    try {
      await api(`/api/v1/admin/mcp/clients/${encodeURIComponent(client.client_id)}`, {
        method: "DELETE",
      });
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Échec");
    }
  }

  async function rotateSecret(client: Client) {
    if (!window.confirm("Tourner le secret et révoquer les refresh tokens existants ?")) return;
    try {
      const result = await api<{ clientSecret: string }>(
        `/api/v1/admin/mcp/clients/${encodeURIComponent(client.client_id)}/rotate-secret`,
        { method: "POST" },
      );
      window.prompt("Nouveau secret — copiez-le maintenant, il ne sera plus affiché :", result.clientSecret);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Échec");
    }
  }

  async function copy(value: string | null) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast.success("URL copiée");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Pilotage du serveur, des tools et des accès OAuth.</p>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </Button>
      </div>
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      <Tabs defaultValue="overview">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="overview">Vue d’ensemble</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="access">Accès/clients</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="connection">Connexion</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" asChild>
              <a href="/api/v1/admin/mcp/diagnostics/export" download>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Export diagnostic expurgé
              </a>
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Tools actifs" value={`${status?.enabledToolCount || 0}/${status?.toolCount || 0}`} />
            <Stat label="Clients actifs" value={`${status?.enabledClientCount || 0}/${status?.clientCount || 0}`} />
            <Stat label="Appels MCP" value={String(metrics?.requests || 0)} />
            <Stat label="Erreurs" value={String(metrics?.errors || 0)} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Diagnostics</CardTitle></CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {diagnostics?.checks.map((check) => (
                <div key={check.id} className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                  {check.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
                  {check.message}
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Performance processus</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3 text-sm">
              <div>Erreur : {((metrics?.errorRate || 0) * 100).toFixed(1)} %</div>
              <div>Moyenne : {metrics?.averageDurationMs || 0} ms</div>
              <div>P95 : {metrics?.p95DurationMs || 0} ms</div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tools">
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Tool</th><th className="p-3">Catégorie</th><th className="p-3">Scope</th><th className="p-3">Annotations</th><th className="p-3">État</th></tr></thead>
              <tbody>{tools.map((tool) => <tr key={tool.name} className="border-b last:border-0">
                <td className="p-3 font-mono text-xs">{tool.name}</td>
                <td className="p-3">{tool.category}</td>
                <td className="p-3"><Badge variant={tool.access === "read" ? "secondary" : "warning"}>{tool.requiredScope}</Badge></td>
                <td className="p-3 text-xs text-slate-500">{tool.annotations?.readOnlyHint ? "lecture" : "mutation"}{tool.annotations?.destructiveHint ? " · destructif" : ""}</td>
                <td className="p-3"><Button size="sm" variant={tool.enabled ? "outline" : "destructive"} onClick={() => void toggleTool(tool)}>{tool.enabled ? "Actif" : "Désactivé"}</Button></td>
              </tr>)}</tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="access">
          <div className="space-y-3">{clients.map((client) => (
            <Card key={client.client_id}>
              <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><strong>{client.client_name || "Client sans nom"}</strong><Badge variant={client.enabled ? "success" : "muted"}>{client.revoked_at ? "Révoqué" : client.enabled ? "Actif" : "Désactivé"}</Badge></div>
                  <div className="mt-1 truncate font-mono text-xs text-slate-500">{client.client_id}</div>
                  <div className="mt-1 text-xs text-slate-500">{client.scope} · {client.active_refresh_tokens} refresh token(s) actif(s) · dernier usage {client.last_used_at || "jamais"}</div>
                </div>
                <div className="flex gap-2">
                  {!client.revoked_at && client.token_endpoint_auth_method !== "none" ? <Button variant="outline" size="sm" onClick={() => void rotateSecret(client)}>Tourner le secret</Button> : null}
                  {!client.revoked_at ? <Button variant="outline" size="sm" onClick={() => void toggleClient(client)}>{client.enabled ? "Désactiver" : "Activer"}</Button> : null}
                  {!client.revoked_at ? <Button variant="destructive" size="sm" onClick={() => void revokeClient(client)}>Révoquer</Button> : null}
                </div>
              </CardContent>
            </Card>
          ))}
          {!clients.length ? <div className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">Aucun client OAuth enregistré.</div> : null}</div>
        </TabsContent>

        <TabsContent value="logs">{logsSlot ?? <div className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">Slot logs — passez logsSlot=&lt;RequestLogsClient /&gt; depuis la marque.</div>}</TabsContent>

        <TabsContent value="connection" className="space-y-4">
          <Card><CardHeader><CardTitle className="text-base">URL MCP</CardTitle></CardHeader><CardContent>
            <div className="flex gap-2"><code className="min-w-0 flex-1 truncate rounded bg-slate-100 p-3 text-sm">{status?.mcpUrl || "Tunnel non configuré"}</code><Button variant="outline" onClick={() => void copy(status?.mcpUrl || null)} disabled={!status?.mcpUrl}><Copy className="h-4 w-4" /></Button></div>
            {!status?.publicUrl ? <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><ShieldAlert className="h-4 w-4 shrink-0" />Configurez APP_PUBLIC_URL ou MCP_PUBLIC_URL pour ChatGPT, Claude et Cursor. Hermes loopback continue d’utiliser sa clé API locale.</div> : null}
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Clients compatibles</CardTitle></CardHeader><CardContent className="text-sm text-slate-600">Dans Cursor, ChatGPT ou Claude, ajoutez l’URL ci-dessus comme serveur MCP HTTP. OAuth 2.1, PKCE S256 et l’enregistrement dynamique sont détectés automatiquement.</CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="p-4"><div className="text-2xl font-semibold tabular-nums">{value}</div><div className="text-xs text-slate-500">{label}</div></CardContent></Card>;
}
