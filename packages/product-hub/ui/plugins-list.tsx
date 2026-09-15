"use client";

/**
 * Admin → Plugins — sidecars, accept-check, suppression, versions Git.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  getDesktopApi,
  getProductHubUiBrand,
  isRemoteDesktopClient,
  notifyPluginsChanged,
  openPluginPanelInWorkspace,
} from "../dist/plugin-ui/index.js";
import { HostManagedNotice } from "./host-managed-notice";
import { useTabWorkspaceOptional } from "./tab-workspace-shim";
import {
  CheckCircle2,
  ExternalLink,
  GitBranch,
  History,
  Loader2,
  Plus,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "./primitives/button";
import { Input } from "./primitives/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./primitives/card";

type GitStatus = {
  ok: boolean;
  available: boolean;
  head: string | null;
  shortHead: string | null;
  dirty: boolean;
  commits: number;
  error?: string;
};

type PluginRow = {
  dir: string;
  manifest: {
    id: string;
    name: string;
    version: string;
    description?: string;
    main: string;
    port?: number;
    permissions: string[];
    hooks?: string[];
    panel?: { title?: string; path?: string };
    source?: string;
  };
  enabled: boolean;
  error?: string;
  git?: GitStatus;
};

type Status = {
  root: string;
  plugins: PluginRow[];
  running: Array<{
    id: string;
    port: number | null;
    version: string;
    siteId: number;
    panelUrl: string | null;
    n8nWebhookUrl: string | null;
  }>;
  logs: string[];
};

type AcceptResult = {
  ok: boolean;
  pluginId: string;
  checks: Array<{
    name: string;
    ok: boolean;
    status?: number;
    detail?: string;
  }>;
  hint?: string;
};

type VersionCommit = {
  sha: string;
  shortSha: string;
  subject: string;
  date: string;
};

type PluginProduct = {
  id: string;
  plugin_id: string | null;
  name: string;
  description: string;
  lifecycle_state: string;
  decision: "create" | "evolve" | null;
};

const PROCESS_GATES = [
  ["G1", "Intent", "Besoin reformulé + critères d’acceptation"],
  ["G2", "Données", "Endpoints (stack = Mes produits) + permissions"],
  ["G3", "Smoke", "CRM / proxy répond avant le panel"],
  ["G4", "Proxy", "Panel → /api/crm/* (pas de clé dans le HTML)"],
  ["G5", "UI", "Kit plugin-ui.css"],
  ["G6", "IA", "llm:use + modèle, ou feature sans IA"],
  ["G7", "Accept", "POST accept-check OK avant « done »"],
] as const;

/** Fallback navigateur/Docker — `GET /api/v1/os/plugins` (pas d'IPC Electron). */
async function fetchOsPluginsStatus(): Promise<Status | null> {
  try {
    const r = await fetch("/api/v1/os/plugins");
    if (!r.ok) return null;
    const data = (await r.json()) as {
      root?: string;
      plugins?: Status["plugins"];
      status?: Status | null;
    };
    if (data.status && Array.isArray(data.status.plugins)) {
      return data.status;
    }
    if (Array.isArray(data.plugins)) {
      return {
        root: data.root || "…/plugins",
        plugins: data.plugins,
        running: data.status?.running || [],
        logs: data.status?.logs || [],
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function AdminPluginsList() {
  const router = useRouter();
  const workspace = useTabWorkspaceOptional();
  const [desktop, setDesktop] = useState(false);
  const [webStatusApi, setWebStatusApi] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);
  const [newId, setNewId] = useState("");
  const [busy, setBusy] = useState(false);
  const [acceptById, setAcceptById] = useState<Record<string, AcceptResult>>(
    {},
  );
  const [versionsById, setVersionsById] = useState<
    Record<string, VersionCommit[]>
  >({});
  const [versionsOpen, setVersionsOpen] = useState<Record<string, boolean>>({});
  const [products, setProducts] = useState<PluginProduct[]>([]);
  // Client distant : runtimes gérés par l'app Serveur — section masquée.
  const [remoteClient, setRemoteClient] = useState(false);

  useEffect(() => {
    void isRemoteDesktopClient().then(setRemoteClient);
  }, []);

  const refresh = useCallback(async () => {
    const api = getDesktopApi();
    setLoading(true);
    try {
      const [runtime, hub] = await Promise.all([
        api?.getPluginsStatus
          ? api.getPluginsStatus()
          : fetchOsPluginsStatus(),
        fetch("/api/v1/plugin-products").then((r) => (r.ok ? r.json() : null)),
      ]);
      if (!api?.getPluginsStatus) {
        setWebStatusApi(runtime != null);
      }
      if (runtime) setStatus(runtime as Status);
      else if (!api?.getPluginsStatus) setStatus(null);
      if (hub?.products) setProducts(hub.products as PluginProduct[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setDesktop(Boolean(getDesktopApi()?.getPluginsStatus));
    void refresh();
  }, [refresh]);

  const canManageRuntime = desktop;

  async function onToggle(id: string, enabled: boolean) {
    const api = getDesktopApi();
    if (!api?.setPluginEnabled) return;
    setBusy(true);
    try {
      const r = await api.setPluginEnabled(id, enabled);
      setStatus(r.status as Status);
      notifyPluginsChanged();
      toast.success(enabled ? `${id} activé` : `${id} désactivé`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function onScaffold() {
    const name = newId.trim();
    if (name.length < 2) {
      toast.error("Décris la demande en au moins 2 caractères");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/v1/plugin-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: name }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Création impossible");
      setNewId("");
      toast.success("Demande créée — analyse d’impact terminée");
      router.push(`/admin/plugins/${result.product.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur demande");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    const api = getDesktopApi();
    if (!api?.deletePlugin) {
      toast.error(`Suppression indisponible — mets à jour ${getProductHubUiBrand().productName}`);
      return;
    }
    const ok = window.confirm(
      `Supprimer définitivement « ${id} » ?\n\nLe dossier plugins/${id} (fichiers, git, clé locale) sera effacé. Irréversible.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.deletePlugin(id);
      setStatus(r.status as Status);
      notifyPluginsChanged();
      setAcceptById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setVersionsById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      toast.success(`${id} supprimé — aucune trace locale`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Suppression impossible");
    } finally {
      setBusy(false);
    }
  }

  async function onToggleVersions(id: string) {
    const open = !versionsOpen[id];
    setVersionsOpen((prev) => ({ ...prev, [id]: open }));
    if (!open) return;
    const api = getDesktopApi();
    if (!api?.getPluginVersions) {
      toast.error("Historique git indisponible");
      return;
    }
    setBusy(true);
    try {
      const r = await api.getPluginVersions(id);
      if (!r.ok) {
        toast.error(r.error || "Impossible de lister les versions");
        return;
      }
      setVersionsById((prev) => ({ ...prev, [id]: r.commits }));
      if (!r.available) {
        toast.message("Git introuvable sur cette machine");
      } else if (!r.commits.length) {
        toast.message("Aucun commit encore");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur versions");
    } finally {
      setBusy(false);
    }
  }

  async function onRestore(id: string, ref: string, label: string) {
    const api = getDesktopApi();
    if (!api?.restorePluginVersion) return;
    const ok = window.confirm(
      `Restaurer « ${id} » vers ${label} ?\n\nLes fichiers actuels seront remplacés (un commit de restore sera créé).`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.restorePluginVersion(id, ref);
      setStatus(r.status as Status);
      notifyPluginsChanged();
      toast.success(r.detail || `Restauré ${label}`);
      const versions = api.getPluginVersions
        ? await api.getPluginVersions(id)
        : null;
      if (versions?.ok) {
        setVersionsById((prev) => ({ ...prev, [id]: versions.commits }));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore impossible");
    } finally {
      setBusy(false);
    }
  }

  async function onOpenPanel(id: string) {
    setBusy(true);
    try {
      const openExternalSite = workspace?.openExternalSite;
      const r = await openPluginPanelInWorkspace({
        pluginId: id,
        openExternalSite: openExternalSite
          ? (o) => openExternalSite(o)
          : undefined,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Panel ${id} ouvert`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ouverture panel impossible");
    } finally {
      setBusy(false);
    }
  }

  async function onAcceptCheck(id: string) {
    const api = getDesktopApi();
    if (!api?.runPluginAcceptCheck) {
      toast.error(`accept-check indisponible — mets à jour ${getProductHubUiBrand().productName}`);
      return;
    }
    setBusy(true);
    try {
      const r = await api.runPluginAcceptCheck(id);
      setAcceptById((prev) => ({ ...prev, [id]: r }));
      if (r.ok) toast.success(`${id} : accept-check OK`);
      else toast.error(r.hint || `${id} : accept-check échoué`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "accept-check erreur");
    } finally {
      setBusy(false);
    }
  }

  const runningIds = new Set(status?.running.map((r) => r.id) || []);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Puzzle className="h-4 w-4" /> Product Hub
          </CardTitle>
          <CardDescription>
            Toute création ou évolution passe par l’impact, le PRD et une validation explicite.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Ex. Ajouter un générateur de fiches techniques"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
            />
            <Button size="sm" onClick={() => void onScaffold()} disabled={busy}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Nouvelle demande
            </Button>
          </div>
          {products.length ? (
            <div className="space-y-2">
              {products.map((product) => (
                <Link
                  key={product.id}
                  href={`/admin/plugins/${product.id}`}
                  className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-slate-50"
                >
                  <span>
                    <span className="font-medium">{product.name}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {product.decision === "evolve" ? "Évolution" : "Création"}
                    </span>
                  </span>
                  <span className="font-mono text-xs text-slate-500">
                    {product.lifecycle_state}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Aucune demande Product Hub.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> Process qualité Hermes
          </CardTitle>
          <CardDescription>
            Chaque évolution Hermes est versionnée en Git local. Tu peux
            restaurer un commit ou supprimer le plugin sans trace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-sm">
            {PROCESS_GATES.map(([id, name, detail]) => (
              <li key={id} className="flex gap-2 text-slate-600">
                <span className="w-8 shrink-0 font-mono text-xs text-slate-400">
                  {id}
                </span>
                <span>
                  <span className="font-medium text-slate-800">{name}</span>
                  {" — "}
                  {detail}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Puzzle className="h-4 w-4" /> Plugins
          </CardTitle>
          <CardDescription>
            Sidecars Node + Git. Dossier :{" "}
            <code className="text-xs">{status?.root || "…/plugins"}</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {remoteClient ? (
            <HostManagedNotice label="les runtimes plugins (installation, versions, tests)" />
          ) : (
            <>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refresh()}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
              )}
              Actualiser
            </Button>
          </div>

          {!status?.plugins.length ? (
            <p className="text-sm text-slate-500">
              {desktop || webStatusApi
                ? "Aucun runtime installé. Crée d’abord une demande Product Hub."
                : loading
                  ? "Chargement des runtimes…"
                  : `Impossible de lister les runtimes (API /api/v1/os/plugins).`}
            </p>
          ) : (
            <ul className="space-y-2">
              {status.plugins.map((p) => {
                const run = status.running.find(
                  (r) => r.id === p.manifest.id,
                );
                const canPanel =
                  p.manifest.permissions?.includes("ui:panel") &&
                  (Boolean(run?.panelUrl) ||
                    (runningIds.has(p.manifest.id) &&
                      Boolean(p.manifest.panel)));
                const acc = acceptById[p.manifest.id];
                const versions = versionsById[p.manifest.id] || [];
                const showVersions = Boolean(versionsOpen[p.manifest.id]);
                return (
                  <li
                    key={p.manifest.id}
                    className="rounded-md border border-slate-200 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          {p.manifest.name}{" "}
                          <span className="font-mono text-xs text-slate-400">
                            {p.manifest.id}@v{p.manifest.version}
                          </span>
                          {acc ? (
                            acc.ok ? (
                              <CheckCircle2 className="ml-1 inline h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <XCircle className="ml-1 inline h-3.5 w-3.5 text-red-500" />
                            )
                          ) : null}
                        </div>
                        {p.manifest.description ? (
                          <div className="text-[11px] text-slate-500">
                            {p.manifest.description}
                          </div>
                        ) : null}
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                          <span>
                            {p.error
                              ? `Erreur : ${p.error}`
                              : runningIds.has(p.manifest.id)
                                ? `En cours${run?.port ? ` · :${run.port}` : ""}`
                                : p.enabled
                                  ? "Activé (arrêté)"
                                  : "Désactivé"}
                          </span>
                          {p.git?.shortHead ? (
                            <span className="inline-flex items-center gap-1 font-mono">
                              <GitBranch className="h-3 w-3" />
                              {p.git.shortHead}
                              {p.git.commits
                                ? ` · ${p.git.commits} commit(s)`
                                : ""}
                              {p.git.dirty ? " · dirty" : ""}
                            </span>
                          ) : p.git && !p.git.available ? (
                            <span>Git embarqué manquant — mets à jour {getProductHubUiBrand().productName}</span>
                          ) : null}
                        </div>
                        {acc ? (
                          <div className="mt-2 space-y-1 rounded border border-slate-100 bg-slate-50 p-2 text-[11px]">
                            <div
                              className={
                                acc.ok ? "text-emerald-700" : "text-red-600"
                              }
                            >
                              {acc.hint ||
                                (acc.ok
                                  ? "Accept-check OK"
                                  : "Accept-check échoué")}
                            </div>
                            {acc.checks.map((c) => (
                              <div key={c.name} className="text-slate-600">
                                {c.ok ? "✓" : "✗"} {c.name}
                                {c.detail ? ` — ${c.detail.slice(0, 120)}` : ""}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {showVersions ? (
                          <div className="mt-2 max-h-48 space-y-1 overflow-auto rounded border border-slate-100 bg-slate-50 p-2 text-[11px]">
                            {!versions.length ? (
                              <div className="text-slate-500">
                                Aucun historique
                              </div>
                            ) : (
                              versions.map((c) => (
                                <div
                                  key={c.sha}
                                  className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1 last:border-0"
                                >
                                  <div className="min-w-0">
                                    <span className="font-mono text-slate-700">
                                      {c.shortSha}
                                    </span>{" "}
                                    <span className="text-slate-600">
                                      {c.subject}
                                    </span>
                                    <div className="text-[10px] text-slate-400">
                                      {c.date}
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-[11px]"
                                    disabled={
                                      busy ||
                                      !canManageRuntime ||
                                      c.sha === p.git?.head
                                    }
                                    onClick={() =>
                                      void onRestore(
                                        p.manifest.id,
                                        c.sha,
                                        c.shortSha,
                                      )
                                    }
                                  >
                                    Restaurer
                                  </Button>
                                </div>
                              ))
                            )}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {canManageRuntime ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || Boolean(p.error)}
                              onClick={() => void onAcceptCheck(p.manifest.id)}
                            >
                              <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                              Vérifier
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || Boolean(p.error)}
                              onClick={() => void onToggleVersions(p.manifest.id)}
                            >
                              <History className="mr-1 h-3.5 w-3.5" />
                              Versions
                            </Button>
                          </>
                        ) : null}
                        {canPanel ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void onOpenPanel(p.manifest.id)}
                          >
                            <ExternalLink className="mr-1 h-3.5 w-3.5" />
                            Ouvrir
                          </Button>
                        ) : null}
                        {canManageRuntime ? (
                          <>
                            <Button
                              size="sm"
                              variant={p.enabled ? "outline" : "secondary"}
                              disabled={busy || Boolean(p.error)}
                              onClick={() =>
                                void onToggle(p.manifest.id, !p.enabled)
                              }
                            >
                              {p.enabled ? "Désactiver" : "Activer"}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busy}
                              onClick={() => void onDelete(p.manifest.id)}
                            >
                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                              Supprimer
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {!canManageRuntime && status?.plugins.length ? (
            <p className="text-xs text-slate-500">
              Liste et ouverture des panels via le navigateur. Activation,
              versions Git et accept-check restent dans{" "}
              {getProductHubUiBrand().productName} Desktop.
            </p>
          ) : null}

          {status?.logs?.length ? (
            <pre className="max-h-40 overflow-auto rounded-md border bg-slate-950 p-2 font-mono text-[11px] text-slate-100">
              {status.logs.join("\n")}
            </pre>
          ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default AdminPluginsList;
