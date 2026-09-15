"use client";

/**
 * Admin → Plugins → détail produit : tableau de bord métier lisible
 * (PRD par sections, Kanban, tickets, tests, versions Git, changelog)
 * avec l'outillage technique replié dans « Diagnostic (avancé) ».
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  Play,
  RefreshCw,
  RotateCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  getDesktopApi,
  getProductHubUiBrand,
  isRemoteDesktopClient,
  notifyPluginsChanged,
} from "../dist/plugin-ui/index.js";
import { HostManagedNotice } from "./host-managed-notice";
import { Badge } from "./primitives/badge";
import { Button } from "./primitives/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./primitives/card";
import { Input } from "./primitives/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./primitives/tabs";

type Row = Record<string, unknown>;
type Details = {
  product: {
    id: string;
    plugin_id: string | null;
    name: string;
    description: string;
    lifecycle_state: string;
    conversation_id: string;
    decision: "create" | "evolve" | null;
  };
  prdRevisions: Row[];
  tasks: Row[];
  impactReports: Row[];
  documents: Row[];
  tickets: Row[];
  tests: Row[];
  n8nResources: Row[];
  changelog: Row[];
  gates: Row[];
};

type N8nSnapshot = {
  connection: {
    connected: boolean;
    apiUrl: string | null;
    version: string | null;
    mode: "tag-registry";
    modeLabel: string;
    usersApiSupported: boolean;
    dedicatedUserSupported: boolean;
    projectsSupported: boolean;
    reason: string;
  };
  tag: string;
  workflows: Row[];
  executions: Row[];
  registry: Row[];
};

type VersionCommit = { sha: string; shortSha: string; subject: string; date: string };

/** Sections structurées du PRD étendu (P1.1) — mêmes clés que le serveur. */
type PrdSections = {
  data_inputs?: Array<{ data?: string; sourceEndpoint?: string }>;
  data_outputs?: Array<{ data?: string; destination?: string }>;
  db_schema?: Array<{
    table?: string;
    columns?: Array<{ name?: string; type?: string; description?: string }>;
  }>;
  user_stories?: string[];
  screens?: Array<{ name?: string; kind?: string; description?: string }>;
  wireframes?: Array<{ screen?: string; ascii?: string }>;
};

const tabs = [
  ["overview", "Vue d’ensemble"],
  ["prd", "PRD"],
  ["kanban", "Kanban"],
  ["tickets", "Tickets"],
  ["documents", "Documents"],
  ["tests", "Tests"],
  ["data", "Données"],
  ["n8n", "n8n"],
  ["versions", "Versions"],
  ["changelog", "Changelog"],
  ["runtime", "Module"],
] as const;

const columns = [
  ["backlog", "Backlog"],
  ["specification", "Spécification"],
  ["ready", "Prêt"],
  ["in_progress", "En cours"],
  ["automated_tests", "Tests auto"],
  ["human_qa", "QA humaine"],
  ["done", "Terminé"],
] as const;

/** Date SQLite / ISO → format court lisible fr. */
function fmtDate(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const date = new Date(raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  open: { label: "Ouvert", className: "bg-amber-100 text-amber-800" },
  closed: { label: "Fermé", className: "bg-slate-100 text-slate-600" },
  resolved: { label: "Résolu", className: "bg-emerald-100 text-emerald-800" },
  passed: { label: "Réussi", className: "bg-emerald-100 text-emerald-800" },
  failed: { label: "Échoué", className: "bg-red-100 text-red-700" },
  done: { label: "Terminé", className: "bg-emerald-100 text-emerald-800" },
  ready: { label: "Prêt", className: "bg-sky-100 text-sky-800" },
  in_progress: { label: "En cours", className: "bg-sky-100 text-sky-800" },
};

function StatusBadge({ value }: { value: unknown }) {
  const key = String(value || "");
  const meta = STATUS_LABELS[key] || { label: key || "—", className: "bg-slate-100 text-slate-600" };
  return <Badge variant="secondary" className={meta.className}>{meta.label}</Badge>;
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>;
}

/** Petit tableau lisible générique (P2.3). */
function SimpleTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: Array<Array<React.ReactNode>>;
  empty: string;
}) {
  if (!rows.length) return <EmptyHint>{empty}</EmptyHint>;
  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 font-medium">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, index) => (
            <tr key={index} className="border-t">
              {cells.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 align-top">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Rendu PRD par sections (P1.1) avec fallback texte pour les anciennes révisions. */
function PrdView({ revision }: { revision: Row }) {
  const sections = useMemo<PrdSections>(() => {
    try {
      const parsed = JSON.parse(String(revision.sections_json || "{}"));
      return parsed && typeof parsed === "object" ? (parsed as PrdSections) : {};
    } catch {
      return {};
    }
  }, [revision]);
  const hasSections = Boolean(
    sections.data_inputs?.length ||
      sections.data_outputs?.length ||
      sections.db_schema?.length ||
      sections.user_stories?.length ||
      sections.screens?.length ||
      sections.wireframes?.length,
  );

  const textBlocks = [
    ["Problème utilisateur", revision.problem],
    ["Utilisateurs concernés", revision.users],
    ["Périmètre", revision.scope],
    ["Hors périmètre", revision.out_of_scope],
    ["Critères d’acceptation", revision.acceptance_criteria],
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Badge variant="secondary">Révision v{String(revision.version)}</Badge>
        <span>Créée le {fmtDate(revision.created_at)}</span>
        {revision.validated_at ? (
          <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
            Validée le {fmtDate(revision.validated_at)}
          </Badge>
        ) : (
          <Badge variant="secondary" className="bg-amber-100 text-amber-800">
            En attente de validation
          </Badge>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {textBlocks.map(([label, value]) =>
          String(value || "").trim() ? (
            <Card key={label}>
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">{label}</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0">
                <p className="whitespace-pre-line text-sm text-slate-700">{String(value)}</p>
              </CardContent>
            </Card>
          ) : null,
        )}
      </div>

      {hasSections ? (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Données en entrée</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0">
                <SimpleTable
                  headers={["Donnée", "Source (endpoint)"]}
                  rows={(sections.data_inputs || []).map((input) => [
                    String(input.data || ""),
                    <code key="s" className="text-xs">{String(input.sourceEndpoint || "")}</code>,
                  ])}
                  empty="Aucune donnée en entrée."
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Données en sortie</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0">
                <SimpleTable
                  headers={["Donnée", "Destination"]}
                  rows={(sections.data_outputs || []).map((output) => [
                    String(output.data || ""),
                    String(output.destination || ""),
                  ])}
                  empty="Aucune donnée en sortie."
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">User stories</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              {sections.user_stories?.length ? (
                <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
                  {sections.user_stories.map((story, index) => <li key={index}>{story}</li>)}
                </ol>
              ) : (
                <EmptyHint>Aucune user story.</EmptyHint>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Schéma de base de données</CardTitle></CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              {sections.db_schema?.length ? (
                sections.db_schema.map((table, index) => (
                  <div key={index}>
                    <p className="mb-1 font-mono text-xs font-medium text-slate-700">{String(table.table || "")}</p>
                    <SimpleTable
                      headers={["Colonne", "Type", "Description"]}
                      rows={(table.columns || []).map((column) => [
                        <code key="n" className="text-xs">{String(column.name || "")}</code>,
                        String(column.type || "—"),
                        String(column.description || "—"),
                      ])}
                      empty="Aucune colonne."
                    />
                  </div>
                ))
              ) : (
                <EmptyHint>Aucune table définie.</EmptyHint>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Écrans</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              <SimpleTable
                headers={["Écran", "Type", "Description"]}
                rows={(sections.screens || []).map((screen) => [
                  String(screen.name || ""),
                  screen.kind === "tab" ? "Onglets" : "Page simple",
                  String(screen.description || ""),
                ])}
                empty="Aucun écran défini."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Wireframes</CardTitle></CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              {sections.wireframes?.length ? (
                sections.wireframes.map((wireframe, index) => (
                  <div key={index}>
                    <p className="mb-1 text-xs font-medium text-slate-600">{String(wireframe.screen || "")}</p>
                    <pre className="overflow-auto rounded border bg-slate-50 p-3 font-mono text-xs leading-tight">
                      {String(wireframe.ascii || "")}
                    </pre>
                  </div>
                ))
              ) : (
                <EmptyHint>Aucun wireframe.</EmptyHint>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-xs text-slate-500">
          Révision antérieure au PRD étendu — sections structurées absentes.
        </p>
      )}
    </div>
  );
}

export function AdminPluginDetail({ params }: { params: { id: string } }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [users, setUsers] = useState("");
  const [scope, setScope] = useState("");
  const [outOfScope, setOutOfScope] = useState("");
  const [criteria, setCriteria] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [pluginId, setPluginId] = useState("");
  const [executionGrant, setExecutionGrant] = useState<string | null>(null);
  const [dataRows, setDataRows] = useState<Row[]>([]);
  const [n8nSnapshot, setN8nSnapshot] = useState<N8nSnapshot | null>(null);
  const [versions, setVersions] = useState<VersionCommit[] | null>(null);
  const [versionsHead, setVersionsHead] = useState<string | null>(null);
  const [runtimeInfo, setRuntimeInfo] = useState<{
    installed: boolean;
    running: boolean;
    version: string | null;
    enabled: boolean;
  } | null>(null);
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  // Client distant : le runtime plugin vit sur l'app Serveur — les actions
  // IPC (tests, versions, install/désinstall) y sont refusées, on masque.
  const [remoteClient, setRemoteClient] = useState(false);

  useEffect(() => {
    void isRemoteDesktopClient().then(setRemoteClient);
  }, []);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/v1/plugin-products/${params.id}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Chargement impossible");
    setDetails(body as Details);
    setPluginId((current) => current || body.product.plugin_id || "");
  }, [params.id]);

  useEffect(() => {
    void refresh().catch((error) => toast.error(error.message));
  }, [refresh]);

  const runtimePluginId = details?.product.plugin_id || null;

  /** État runtime métier (installé / actif / version) via l'IPC desktop. */
  const loadRuntimeInfo = useCallback(async () => {
    const api = getDesktopApi();
    if (!api?.getPluginsStatus || !runtimePluginId) {
      setRuntimeInfo(null);
      return;
    }
    if (await isRemoteDesktopClient()) {
      setRuntimeInfo(null);
      return;
    }
    try {
      const status = (await api.getPluginsStatus()) as {
        plugins: Array<{
          manifest: { id: string; version: string };
          enabled: boolean;
        }>;
        running: Array<{ id: string }>;
      };
      const plugin = status.plugins.find((p) => p.manifest.id === runtimePluginId);
      setRuntimeInfo({
        installed: Boolean(plugin),
        running: status.running.some((r) => r.id === runtimePluginId),
        version: plugin?.manifest.version || null,
        enabled: Boolean(plugin?.enabled),
      });
    } catch {
      setRuntimeInfo(null);
    }
  }, [runtimePluginId]);

  useEffect(() => {
    void loadRuntimeInfo();
  }, [loadRuntimeInfo]);

  /** Versions Git du runtime (P0.2) — même IPC que la page liste. */
  const loadVersions = useCallback(async () => {
    const api = getDesktopApi();
    if (!api?.getPluginVersions || !runtimePluginId) return;
    if (await isRemoteDesktopClient()) return;
    try {
      const result = await api.getPluginVersions(runtimePluginId);
      if (!result.ok) {
        toast.error(result.error || "Impossible de lister les versions");
        return;
      }
      setVersions(result.commits);
      setVersionsHead(result.head);
      if (!result.available) toast.message("Git introuvable sur cette machine");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur versions");
    }
  }, [runtimePluginId]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const latestPrd = details?.prdRevisions[0];
  const impact = details?.impactReports[0];
  const evidence = useMemo(() => {
    try {
      return JSON.parse(String(impact?.evidence_json || "[]")) as Row[];
    } catch {
      return [];
    }
  }, [impact]);

  async function post(path: string, body?: unknown) {
    const response = await fetch(`/api/v1/plugin-products/${params.id}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Action impossible");
    await refresh();
    return result;
  }

  async function savePrd() {
    setBusy(true);
    try {
      await post("/prd", {
        problem,
        users,
        scope,
        outOfScope,
        acceptanceCriteria: criteria,
      });
      toast.success("PRD enregistré, validation requise");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "PRD invalide");
    } finally {
      setBusy(false);
    }
  }

  async function approvePrd() {
    if (!latestPrd) return;
    setBusy(true);
    try {
      await post(`/prd/${latestPrd.id}/approve`);
      toast.success("PRD validé explicitement");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Validation impossible");
    } finally {
      setBusy(false);
    }
  }

  async function prepareExecution() {
    setBusy(true);
    try {
      if (details?.product.lifecycle_state === "planning") {
        await post("/transition", { state: "ready_for_execution" });
      }
      toast.success("Produit prêt pour exécution");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Transition impossible");
    } finally {
      setBusy(false);
    }
  }

  async function createRuntime() {
    const api = getDesktopApi();
    if (!api?.createPluginExecutionGrant || !api.scaffoldPlugin || !latestPrd || !Boolean(latestPrd.validated_at)) {
      toast.error("Desktop requis et PRD validé obligatoire");
      return;
    }
    if (!/^[a-z][a-z0-9-]{1,62}$/.test(pluginId)) {
      toast.error("Identifiant runtime invalide (kebab-case)");
      return;
    }
    setBusy(true);
    try {
      const grant = await api.createPluginExecutionGrant({
        productId: params.id,
        prdRevisionId: String(latestPrd.id),
        pluginId,
      });
      setExecutionGrant(grant.token);
      await api.scaffoldPlugin({
        id: pluginId,
        name: details?.product.name,
        description: details?.product.description,
        executionGrant: grant.token,
      });
      await fetch(`/api/v1/plugin-products/${params.id}/runtime-link`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pluginId }),
      });
      if (details?.product.lifecycle_state === "ready_for_execution") {
        await post("/transition", { state: "executing" });
      } else {
        await refresh();
      }
      notifyPluginsChanged();
      toast.success(`Runtime ${pluginId} créé avec execution_grant`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Création runtime impossible");
    } finally {
      setBusy(false);
    }
  }

  async function addTask() {
    if (!taskTitle.trim()) return;
    setBusy(true);
    try {
      await post("/tasks", { title: taskTitle, status: "backlog" });
      setTaskTitle("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Tâche invalide");
    } finally {
      setBusy(false);
    }
  }

  async function uploadDocument(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("contextEnabled", "true");
      const response = await fetch(`/api/v1/plugin-products/${params.id}/documents`, {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Upload impossible");
      await refresh();
      toast.success(`Document ajouté · SHA-256 ${String(result.document.sha256).slice(0, 12)}…`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload impossible");
    } finally {
      setBusy(false);
    }
  }

  async function runTests() {
    const api = getDesktopApi();
    if (!api?.runPluginTests || !runtimePluginId) {
      toast.error("Runtime desktop requis");
      return;
    }
    setBusy(true);
    try {
      const result = await api.runPluginTests(runtimePluginId);
      const response = await fetch(`/api/v1/plugin-products/${params.id}/test-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: result.ok,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Historisation impossible");
      await refresh();
      result.ok ? toast.success("Tests plugin réussis") : toast.error("Tests plugin échoués");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Tests impossibles");
    } finally {
      setBusy(false);
    }
  }

  async function loadData() {
    const response = await fetch(`/api/v1/plugin-products/${params.id}/data/tables`);
    const result = await response.json();
    if (!response.ok) {
      toast.error(result.error || "Base plugin indisponible");
      return;
    }
    setDataRows(result.tables || []);
  }

  async function humanQa(approved: boolean) {
    setBusy(true);
    try {
      await post("/human-qa", { approved });
      toast.success(approved ? "QA validée, release créée" : "QA refusée, retour en exécution");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "QA impossible");
    } finally {
      setBusy(false);
    }
  }

  async function loadN8n() {
    const response = await fetch(`/api/v1/plugin-products/${params.id}/n8n`);
    const result = await response.json();
    if (!response.ok) {
      toast.error(result.error || "n8n indisponible");
      return;
    }
    setN8nSnapshot(result as N8nSnapshot);
  }

  /** P0.2 : restaurer une version Git du runtime depuis l'onglet Versions. */
  async function restoreVersion(sha: string, label: string) {
    const api = getDesktopApi();
    if (!api?.restorePluginVersion || !runtimePluginId) return;
    const ok = window.confirm(
      `Restaurer « ${runtimePluginId} » vers ${label} ?\n\nLes fichiers actuels seront remplacés (un commit de restore sera créé).`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const result = await api.restorePluginVersion(runtimePluginId, sha);
      notifyPluginsChanged();
      toast.success(result.detail || `Restauré ${label}`);
      await loadVersions();
      await loadRuntimeInfo();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Restore impossible");
    } finally {
      setBusy(false);
    }
  }

  /** P2.2 : « Mettre à jour » = migrations DB auto + redémarrage du module. */
  async function updateModule() {
    const api = getDesktopApi();
    if (!api?.restartPlugin || !runtimePluginId) {
      toast.error(`Mise à jour indisponible — mets à jour ${getProductHubUiBrand().productName} Desktop`);
      return;
    }
    setBusy(true);
    try {
      await api.restartPlugin(runtimePluginId);
      notifyPluginsChanged();
      await loadRuntimeInfo();
      toast.success("Module mis à jour et redémarré (migrations appliquées)");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Mise à jour impossible");
    } finally {
      setBusy(false);
    }
  }

  async function archive(mode: "product" | "runtime" | "purge") {
    if (
      mode === "runtime" &&
      !window.confirm(
        "Désinstaller ce module ?\n\nIl ne sera plus utilisable, mais le projet, le PRD et les documents sont conservés. Vous pourrez le réinstaller plus tard.",
      )
    ) {
      return;
    }
    if (
      mode === "purge" &&
      !window.confirm(
        "Supprimer définitivement ce module ?\n\nLe code, le PRD, les documents et les données seront effacés. Cette action est irréversible.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      if (mode === "runtime" && runtimePluginId) {
        const result = await getDesktopApi()?.archivePluginRuntime?.(runtimePluginId);
        if (!result?.ok) throw new Error(result?.error || "Archivage runtime indisponible");
      }
      const response = await fetch(`/api/v1/plugin-products/${params.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Archivage impossible");
      if (mode !== "purge") await refresh();
      notifyPluginsChanged();
      toast.success(
        mode === "product"
          ? "Produit archivé"
          : mode === "runtime"
            ? "Module désinstallé, données produit conservées"
            : "Module supprimé définitivement",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Archivage impossible");
    } finally {
      setBusy(false);
    }
  }

  if (!details) {
    return <div className="p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/plugins" className="mb-2 inline-flex items-center text-sm text-slate-500">
            <ArrowLeft className="mr-1 h-4 w-4" /> Plugins
          </Link>
          <h1 className="text-2xl font-semibold">{details.product.name}</h1>
          <p className="text-sm text-slate-500">
            {details.product.lifecycle_state} · conversation {details.product.conversation_id}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          <RefreshCw className="mr-1 h-4 w-4" /> Actualiser
        </Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="h-auto max-w-full flex-wrap">
          {tabs.map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader><CardTitle>Décision d’impact</CardTitle></CardHeader><CardContent>
              <p className="font-medium">{impact?.recommendation === "evolve" ? "Faire évoluer" : "Créer"}</p>
              <p className="mt-1 text-sm text-slate-600">{String(impact?.summary || "")}</p>
              <p className="mt-3 text-xs text-slate-500">{evidence.length} preuve(s) : manifests, PRD, tables et n8n.</p>
            </CardContent></Card>
            <Card><CardHeader><CardTitle>Workflow Hermes Work</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
              <p>Identifiant multi-tours : <code>{details.product.conversation_id}</code></p>
              <p>G1/G2 restent en lecture seule. Les credentials d’écriture ne sont émis qu’après validation du PRD.</p>
            </CardContent></Card>
          </div>
        </TabsContent>

        <TabsContent value="prd">
          <Card>
            <CardHeader>
              <CardTitle>Product Requirements Document</CardTitle>
              <CardDescription>Une validation explicite émet ensuite un grant court.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {latestPrd ? (
                <PrdView revision={latestPrd} />
              ) : (
                <>
                  <Input placeholder="Problème utilisateur" value={problem} onChange={(e) => setProblem(e.target.value)} />
                  <Input placeholder="Utilisateurs concernés" value={users} onChange={(e) => setUsers(e.target.value)} />
                  <textarea className="min-h-24 w-full rounded-md border p-3 text-sm" placeholder="Périmètre" value={scope} onChange={(e) => setScope(e.target.value)} />
                  <textarea className="min-h-20 w-full rounded-md border p-3 text-sm" placeholder="Hors périmètre" value={outOfScope} onChange={(e) => setOutOfScope(e.target.value)} />
                  <textarea className="min-h-24 w-full rounded-md border p-3 text-sm" placeholder="Critères d’acceptation" value={criteria} onChange={(e) => setCriteria(e.target.value)} />
                  <Button onClick={() => void savePrd()} disabled={busy}>Soumettre le PRD</Button>
                </>
              )}
              {latestPrd && !Boolean(latestPrd.validated_at) ? <Button onClick={() => void approvePrd()} disabled={busy}><CheckCircle2 className="mr-1 h-4 w-4" /> Valider explicitement le PRD</Button> : null}
              {Boolean(latestPrd?.validated_at) && details.product.lifecycle_state === "planning" ? <Button onClick={() => void prepareExecution()} disabled={busy}>Finaliser le planning</Button> : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="kanban">
          <div className="mb-3 flex gap-2"><Input placeholder="Nouvelle tâche" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} /><Button onClick={() => void addTask()} disabled={busy}>Ajouter</Button></div>
          <div className="grid gap-3 xl:grid-cols-7">
            {columns.map(([status, label]) => <Card key={status}><CardHeader className="p-3"><CardTitle className="text-sm">{label}</CardTitle></CardHeader><CardContent className="space-y-2 p-3 pt-0">
              {details.tasks.filter((task) => task.status === status).map((task) => <div key={String(task.id)} className="rounded border bg-white p-2 text-xs"><p className="font-medium">{String(task.title)}</p>{task.blocked ? <p className="mt-1 text-red-600">Bloqué : {String(task.blocked_reason || "")}</p> : null}</div>)}
            </CardContent></Card>)}
          </div>
        </TabsContent>

        <TabsContent value="tickets">
          <SimpleTable
            headers={["Titre", "Statut", "Priorité", "Créé le", "Mis à jour"]}
            rows={details.tickets.map((ticket) => [
              <div key="t">
                <p className="font-medium">{String(ticket.title)}</p>
                {String(ticket.body || "").trim() ? (
                  <p className="mt-0.5 whitespace-pre-line text-xs text-slate-500">{String(ticket.body)}</p>
                ) : null}
              </div>,
              <StatusBadge key="s" value={ticket.status} />,
              String(ticket.priority ?? 0),
              fmtDate(ticket.created_at),
              fmtDate(ticket.updated_at),
            ])}
            empty="Aucun ticket."
          />
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardContent className="space-y-3 p-4">
              <Input type="file" accept="image/*,.pdf,.md,.txt,.doc,.docx" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadDocument(file); }} />
              <SimpleTable
                headers={["Fichier", "Taille", "Contexte agent", "Ajouté le", ""]}
                rows={details.documents.map((doc) => [
                  String(doc.filename),
                  `${Math.max(1, Math.round(Number(doc.size_bytes || 0) / 1024))} Ko`,
                  doc.context_enabled ? <Badge key="c" variant="secondary" className="bg-emerald-100 text-emerald-800">Partagé</Badge> : "—",
                  fmtDate(doc.created_at),
                  <a
                    key="l"
                    className="text-sm text-sky-700 underline-offset-2 hover:underline"
                    href={`/api/v1/plugin-products/${params.id}/documents/${String(doc.id)}/content`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ouvrir
                  </a>,
                ])}
                empty="Aucun document."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tests">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap gap-2">
                {!remoteClient ? (
                  <Button onClick={() => void runTests()} disabled={busy}>Exécuter les tests</Button>
                ) : null}
                {details.product.lifecycle_state === "awaiting_human_qa" ? (
                  <>
                    <Button onClick={() => void humanQa(true)} disabled={busy}>Valider la QA humaine</Button>
                    <Button variant="destructive" onClick={() => void humanQa(false)} disabled={busy}>Refuser</Button>
                  </>
                ) : null}
              </div>
              {!details.tests.length ? (
                <EmptyHint>Aucun test exécuté.</EmptyHint>
              ) : (
                <div className="space-y-2">
                  {details.tests.map((run) => (
                    <details key={String(run.id)} className="rounded-md border">
                      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-3 py-2 text-sm">
                        <StatusBadge value={run.status} />
                        <span className="text-slate-600">{fmtDate(run.started_at)}</span>
                        <span className="text-xs text-slate-500">code sortie {String(run.exit_code ?? "—")}</span>
                        {run.git_sha ? <span className="font-mono text-xs text-slate-400">{String(run.git_sha).slice(0, 10)}</span> : null}
                      </summary>
                      <div className="space-y-2 border-t px-3 py-2">
                        {String(run.stdout || "").trim() ? (
                          <pre className="max-h-48 overflow-auto rounded bg-slate-50 p-2 text-xs">{String(run.stdout)}</pre>
                        ) : null}
                        {String(run.stderr || "").trim() ? (
                          <pre className="max-h-48 overflow-auto rounded bg-red-50 p-2 text-xs text-red-800">{String(run.stderr)}</pre>
                        ) : null}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data">
          <Card>
            <CardContent className="space-y-3 p-4 text-sm">
              <p>La base du plugin est résolue côté serveur depuis son identifiant validé. Le viewer est strictement en lecture seule.</p>
              <Button variant="outline" onClick={() => void loadData()}>Lister les tables</Button>
              <SimpleTable
                headers={["Table", "Définition"]}
                rows={dataRows.map((table) => [
                  <code key="n" className="text-xs">{String(table.name)}</code>,
                  <pre key="s" className="max-w-xl overflow-auto whitespace-pre-wrap text-xs text-slate-500">{String(table.sql || "")}</pre>,
                ])}
                empty="Aucune table chargée."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="n8n">
          <Card>
            <CardHeader>
              <CardTitle>Automatisations n8n</CardTitle>
              <CardDescription>
                Isolation réelle par tag dédié et registre {getProductHubUiBrand().productName} synchronisé.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <div className="rounded border p-3">
                  <p className="text-xs text-slate-500">Connexion</p>
                  <p className={n8nSnapshot?.connection.connected ? "font-medium text-emerald-700" : "font-medium text-slate-700"}>
                    {n8nSnapshot ? (n8nSnapshot.connection.connected ? "Connecté" : "Indisponible") : "À vérifier"}
                  </p>
                  {n8nSnapshot?.connection.apiUrl ? <p className="mt-1 break-all text-xs text-slate-500">{n8nSnapshot.connection.apiUrl}</p> : null}
                </div>
                <div className="rounded border p-3">
                  <p className="text-xs text-slate-500">Mode d’identité</p>
                  <p className="font-medium">{n8nSnapshot?.connection.modeLabel || `Tag dédié + registre ${getProductHubUiBrand().productName}`}</p>
                  <p className="mt-1 break-all text-xs text-slate-500">
                    {n8nSnapshot?.tag || "Chargement requis"}
                  </p>
                </div>
                <div className="rounded border p-3">
                  <p className="text-xs text-slate-500">Capacités licence</p>
                  <p className="font-medium">
                    Utilisateurs {n8nSnapshot?.connection.usersApiSupported ? "disponibles" : "non vérifiés"} · projets {n8nSnapshot?.connection.projectsSupported ? "disponibles" : "indisponibles"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {n8nSnapshot?.connection.reason || `La clé globale ${getProductHubUiBrand().productName} applique et contrôle le tag du plugin.`}
                  </p>
                </div>
              </div>
              <Button variant="outline" onClick={() => void loadN8n()}>
                Vérifier et synchroniser n8n
              </Button>
              <div>
                <h3 className="mb-2 text-sm font-medium">Workflows</h3>
                <SimpleTable
                  headers={["Nom", "Actif", "Mis à jour"]}
                  rows={(n8nSnapshot?.workflows || []).map((workflow) => [
                    String(workflow.name || workflow.id || ""),
                    workflow.active ? <Badge key="a" variant="secondary" className="bg-emerald-100 text-emerald-800">Actif</Badge> : <Badge key="a" variant="secondary">Inactif</Badge>,
                    fmtDate(workflow.updatedAt || workflow.createdAt),
                  ])}
                  empty="Aucun workflow taggé."
                />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">Exécutions</h3>
                <SimpleTable
                  headers={["Workflow", "Statut", "Démarrée le"]}
                  rows={(n8nSnapshot?.executions || []).map((execution) => [
                    String(execution.workflowId || execution.workflowName || execution.id || ""),
                    <StatusBadge key="s" value={execution.status || (execution.finished ? "passed" : "open")} />,
                    fmtDate(execution.startedAt),
                  ])}
                  empty="Aucune exécution pour ces workflows."
                />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">Registre {getProductHubUiBrand().productName}</h3>
                <SimpleTable
                  headers={["Type", "Nom", "Identifiant externe", "Créé le"]}
                  rows={(n8nSnapshot?.registry || details.n8nResources).map((resource) => [
                    String(resource.resource_type || ""),
                    String(resource.name || ""),
                    <code key="e" className="text-xs">{String(resource.external_id || "")}</code>,
                    fmtDate(resource.created_at),
                  ])}
                  empty="Aucune ressource enregistrée."
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="versions">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" /> Historique des versions</CardTitle>
              <CardDescription>
                Chaque évolution du module est enregistrée. Vous pouvez revenir à une version précédente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {remoteClient ? (
                <HostManagedNotice label="l'historique des versions du module" />
              ) : !runtimePluginId ? (
                <EmptyHint>Aucun module installé pour ce projet — l’historique apparaîtra après la création du runtime.</EmptyHint>
              ) : versions === null ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Chargement de l’historique…
                  <Button size="sm" variant="outline" onClick={() => void loadVersions()}>Réessayer</Button>
                </div>
              ) : !versions.length ? (
                <EmptyHint>Aucune version enregistrée pour l’instant.</EmptyHint>
              ) : (
                <div className="space-y-1">
                  {versions.map((commit) => (
                    <div
                      key={commit.sha}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <span className="font-mono text-xs text-slate-500">{commit.shortSha}</span>{" "}
                        <span className="text-sm text-slate-700">{commit.subject}</span>
                        {commit.sha === versionsHead ? (
                          <Badge variant="secondary" className="ml-2 bg-emerald-100 text-emerald-800">Version actuelle</Badge>
                        ) : null}
                        <div className="text-xs text-slate-400">{fmtDate(commit.date)}</div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={busy || commit.sha === versionsHead}
                        onClick={() => void restoreVersion(commit.sha, commit.shortSha)}
                      >
                        Restaurer
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="changelog">
          {!details.changelog.length ? (
            <EmptyHint>Aucune version publiée.</EmptyHint>
          ) : (
            <div className="space-y-3">
              {details.changelog.map((entry) => (
                <Card key={String(entry.id)}>
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="secondary">{String(entry.version)}</Badge>
                      {String(entry.title)}
                      <span className="text-xs font-normal text-slate-400">{fmtDate(entry.released_at)}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <p className="whitespace-pre-line text-sm text-slate-700">{String(entry.body || "")}</p>
                    {entry.git_sha ? <p className="mt-2 font-mono text-xs text-slate-400">{String(entry.git_sha).slice(0, 12)}</p> : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="runtime">
          {remoteClient ? (
            <HostManagedNotice label="le module (installation, mise à jour, désinstallation)" />
          ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Votre module</CardTitle>
                <CardDescription>État du module et actions courantes en langage clair.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 text-sm md:grid-cols-3">
                  <div className="rounded border p-3">
                    <p className="text-xs text-slate-500">Installation</p>
                    <p className="font-medium">
                      {!runtimePluginId
                        ? "Pas encore installé"
                        : runtimeInfo === null
                          ? `Visible dans ${getProductHubUiBrand().productName} Desktop`
                          : runtimeInfo.installed
                            ? "Installé"
                            : "Introuvable sur ce poste"}
                    </p>
                    {runtimePluginId ? <p className="mt-1 font-mono text-xs text-slate-400">{runtimePluginId}</p> : null}
                  </div>
                  <div className="rounded border p-3">
                    <p className="text-xs text-slate-500">État</p>
                    <p className={runtimeInfo?.running ? "font-medium text-emerald-700" : "font-medium text-slate-700"}>
                      {runtimeInfo?.running ? "Actif" : runtimeInfo?.enabled ? "Activé (arrêté)" : runtimeInfo ? "Désactivé" : "—"}
                    </p>
                  </div>
                  <div className="rounded border p-3">
                    <p className="text-xs text-slate-500">Version</p>
                    <p className="font-medium">{runtimeInfo?.version || "—"}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void updateModule()}
                    disabled={busy || !runtimePluginId || !runtimeInfo?.installed}
                  >
                    <RotateCw className="mr-1 h-4 w-4" /> Mettre à jour
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void archive("runtime")}
                    disabled={busy || !runtimePluginId}
                  >
                    Désinstaller
                  </Button>
                  <Button variant="destructive" onClick={() => void archive("purge")} disabled={busy}>
                    <Trash2 className="mr-1 h-4 w-4" /> Supprimer définitivement
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  « Mettre à jour » applique automatiquement les mises à jour de données puis redémarre le module.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                className="cursor-pointer select-none"
                onClick={() => setDiagnosticOpen((open) => !open)}
              >
                <CardTitle className="flex items-center gap-2 text-sm text-slate-600">
                  {diagnosticOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Diagnostic (avancé)
                </CardTitle>
                <CardDescription>Outillage technique — réservé au support et aux utilisateurs avertis.</CardDescription>
              </CardHeader>
              {diagnosticOpen ? (
                <CardContent className="space-y-3">
                  <p className="text-xs text-slate-500">Création manuelle du runtime (refus automatique sans execution_grant lié au PRD validé).</p>
                  <Input placeholder="identifiant-plugin" value={pluginId} onChange={(e) => setPluginId(e.target.value)} />
                  <Button onClick={() => void createRuntime()} disabled={busy || details.product.lifecycle_state !== "ready_for_execution"}>
                    <Play className="mr-1 h-4 w-4" /> Créer le runtime
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || !runtimePluginId || !getDesktopApi()?.migratePluginData}
                    onClick={() => {
                      if (runtimePluginId) {
                          void getDesktopApi()?.migratePluginData?.(runtimePluginId)
                            .then(() => toast.success("Migrations plugin appliquées"))
                            .catch((error: unknown) =>
                              toast.error(
                                error instanceof Error ? error.message : "Migration impossible",
                              ),
                            );
                      }
                    }}
                  >
                    Appliquer les migrations DB
                  </Button>
                  {executionGrant ? <p className="text-xs text-emerald-700">Grant émis et consommable pendant 10 minutes. Il n’est pas persisté dans l’UI.</p> : null}
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    <Button variant="outline" onClick={() => void archive("product")} disabled={busy}>Archiver le produit</Button>
                  </div>
                </CardContent>
              ) : null}
            </Card>
          </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default AdminPluginDetail;
