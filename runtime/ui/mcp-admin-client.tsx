"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, Download, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { ReactNode } from "react";
import { Badge } from "../modules/observability/ui/primitives/badge";
import { Button } from "../modules/observability/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "../modules/observability/ui/primitives/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../modules/observability/ui/primitives/tabs";

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
  version: number;
  custom: boolean;
  method: string;
  path: string;
  description: string;
  inputSchema: Record<string,unknown>;
  category: string;
  access: "read" | "write";
  requiredScope: string;
  enabled: boolean;
  allowedRoles: string[];
  annotations?: Record<string, boolean>;
};

type Client={id:string;name:string;mode:string;owner_name:string;expires_at:string;revoked_at:string|null};
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
  if (!response.ok) throw new Error((typeof body.error === 'string' ? body.error : (body.error as any)?.message) || `HTTP ${response.status}`);
  return body;
}

export function McpAdminClient({ logsSlot }: { logsSlot?: ReactNode } = {}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [query,setQuery]=useState('');
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
        body: JSON.stringify({ enabled: !tool.enabled,version:tool.version }),
      });
      toast.success(`${tool.name} ${tool.enabled ? "désactivé" : "activé"}`);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Échec");
    }
  }

  async function revokeClient(client:Client){
    if(!window.confirm(`Révoquer ${client.name} ?`))return;
    try{await api(`/api/v1/admin/mcp/clients/${client.id}`,{method:'DELETE'});await load();}catch(e){toast.error((e as Error).message);}
  }
  async function deleteTool(tool:Tool){
    if(!window.confirm(`Supprimer l’outil ${tool.name} ?`))return;
    try{await api(`/api/v1/admin/mcp/tools/${tool.name}`,{method:'DELETE'});await load();}catch(e){toast.error((e as Error).message);}
  }
  async function copy(value: string | null) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast.success("URL copiée");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Pilotage du serveur, des outils et des connexions.</p>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </Button>
      </div>
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      <Tabs defaultValue="overview">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="overview">Vue d’ensemble</TabsTrigger>
          <TabsTrigger value="tools">Outils</TabsTrigger>
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
            <Stat label="Outils actifs" value={`${status?.enabledToolCount || 0}/${status?.toolCount || 0}`} />
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
            <CardHeader><CardTitle className="text-base">Performance des appels</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3 text-sm">
              <div>Erreur : {((metrics?.errorRate || 0) * 100).toFixed(1)} %</div>
              <div>Moyenne : {metrics?.averageDurationMs || 0} ms</div>
              <div>P95 : {metrics?.p95DurationMs || 0} ms</div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tools" className="space-y-4">
          <McpToolCreator onCreated={load}/>
          <input className="h-10 w-full rounded-md border px-3 text-sm" aria-label="Rechercher un outil" placeholder="Nom, module ou API…" value={query} onChange={e=>setQuery(e.target.value)}/>
          <p className="text-sm text-slate-500">{tools.length} outils · Les droits API de chaque utilisateur s’appliquent aussi à ses appels MCP.</p>
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Tool</th><th className="p-3">Catégorie</th><th className="p-3">Scope</th><th className="p-3">Annotations</th><th className="p-3">État</th></tr></thead>
              <tbody>{tools.filter(t=>(t.name+' '+t.category+' '+t.path).toLowerCase().includes(query.toLowerCase())).map((tool) => <tr key={tool.name} className="border-b last:border-0">
                <td className="p-3"><details><summary className="cursor-pointer font-mono text-xs">{tool.name}</summary><p className="mt-2 text-sm">{tool.description}</p><code className="block mt-2 text-xs">{tool.method} {tool.path}</code><pre className="mt-2 max-w-xl overflow-auto rounded bg-slate-50 p-3 text-xs">{JSON.stringify(tool.inputSchema,null,2)}</pre></details></td>
                <td className="p-3">{tool.category}</td>
                <td className="p-3"><Badge variant={tool.access === "read" ? "secondary" : "warning"}>{tool.requiredScope}</Badge></td>
                <td className="p-3 text-xs text-slate-500">{tool.annotations?.readOnlyHint ? "lecture" : "mutation"}{tool.annotations?.destructiveHint ? " · destructif" : ""}</td>
                <td className="p-3"><Button size="sm" variant={tool.enabled ? "outline" : "destructive"} onClick={() => void toggleTool(tool)}>{tool.enabled ? "Actif" : "Désactivé"}</Button>{tool.custom&&<Button size="sm" variant="ghost" onClick={()=>void deleteTool(tool)}>Supprimer</Button>}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="access"><div className="space-y-3">{clients.map(client=><Card key={client.id}><CardContent className="p-4 flex flex-wrap items-center justify-between gap-3"><div><strong>{client.name}</strong><p className="text-sm text-slate-500">{client.owner_name} · {client.mode==='read'?'Lecture':'Lecture et écriture'} · {client.revoked_at?'Révoquée':Date.parse(client.expires_at)<Date.now()?'Expirée':`Expire le ${new Date(client.expires_at).toLocaleDateString('fr-FR')}`}</p></div>{!client.revoked_at&&<Button variant="destructive" size="sm" onClick={()=>void revokeClient(client)}>Révoquer</Button>}</CardContent></Card>)}{!clients.length&&<p className="p-6 text-sm text-slate-500">Aucune connexion enregistrée.</p>}<a className="text-sm text-sky-700 underline" href="/admin/connections">Gérer mes clés personnelles</a></div></TabsContent>

        <TabsContent value="logs">{logsSlot ?? <div className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">Slot logs — passez logsSlot=&lt;RequestLogsClient /&gt; depuis la marque.</div>}</TabsContent>

        <TabsContent value="connection" className="space-y-4">
          <Card><CardHeader><CardTitle className="text-base">URL MCP</CardTitle></CardHeader><CardContent>
            <div className="flex gap-2"><code className="min-w-0 flex-1 truncate rounded bg-slate-100 p-3 text-sm">{status?.mcpUrl || "Tunnel non configuré"}</code><Button variant="outline" onClick={() => void copy(status?.mcpUrl || null)} disabled={!status?.mcpUrl}><Copy className="h-4 w-4" /></Button></div>
            {!status?.publicUrl ? <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><ShieldAlert className="h-4 w-4 shrink-0" />Configurez APP_PUBLIC_URL ou MCP_PUBLIC_URL pour ChatGPT, Claude et Cursor. Hermes loopback continue d’utiliser sa clé API locale.</div> : null}
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Clients compatibles</CardTitle></CardHeader><CardContent className="text-sm text-slate-600">Utilisez cette URL dans un client MCP HTTP qui accepte une clé Bearer. Créez votre clé personnelle dans « Clés et connexions ». WebMCP utilise votre session dans l’application.</CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="p-4"><div className="text-2xl font-semibold tabular-nums">{value}</div><div className="text-xs text-slate-500">{label}</div></CardContent></Card>;
}

function McpToolCreator({onCreated}:{onCreated:()=>Promise<void>}){
  const [operations,setOperations]=useState<Array<{id:string;description:string;method:string;path:string;mcp:boolean}>>([]),[name,setName]=useState('custom_'),[operationId,setOperationId]=useState(''),[description,setDescription]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{void api<{operations:typeof operations}>('/api/v1/admin/mcp/tools').then(r=>setOperations(r.operations.filter(o=>o.mcp))).catch(e=>setError(e.message));},[]);
  return <details className="rounded-lg border bg-white p-4"><summary className="cursor-pointer font-medium">Créer un outil à partir d’une API</summary><form className="mt-4 space-y-3" onSubmit={e=>{e.preventDefault();setBusy(true);setError('');void api('/api/v1/admin/mcp/tools',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,operationId,description})}).then(async()=>{setName('custom_');setDescription('');await onCreated();toast.success('Outil créé');}).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}><label className="block text-sm">Nom de l’outil<input className="mt-1 block w-full rounded border p-2" required pattern="custom_[a-z][a-z0-9_]{1,80}" value={name} onChange={e=>setName(e.target.value)}/></label><label className="block text-sm">API<select className="mt-1 block w-full rounded border p-2" required value={operationId} onChange={e=>{setOperationId(e.target.value);setDescription(operations.find(o=>o.id===e.target.value)?.description??'');}}><option value="">Choisir une opération</option>{operations.map(o=><option key={o.id} value={o.id}>{o.method} {o.path} — {o.description}</option>)}</select></label><label className="block text-sm">Description<input className="mt-1 block w-full rounded border p-2" required maxLength={1000} value={description} onChange={e=>setDescription(e.target.value)}/></label>{error&&<p role="alert" className="text-sm text-red-600">{error}</p>}<Button disabled={busy} type="submit">{busy?'Création…':'Créer l’outil'}</Button></form></details>;
}
