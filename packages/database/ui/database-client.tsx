"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Eye,
  Filter,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  Workflow,
  Activity,
} from "lucide-react";
import { Badge } from "./primitives/badge";
import { Button } from "./primitives/button";
import { Input } from "./primitives/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./primitives/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./primitives/tabs";
import { DatabaseAutomationsPanel } from "./database-automations-panel";
import {
  columnTypeLabel,
  displayValue,
  type CatalogEntry,
  type SavedView,
  type TableDetail,
} from "./types";

type ActivityPayload = {
  accessLog: Array<{
    id: number;
    actor: string;
    action: string;
    tableName: string | null;
    createdAt: string;
  }>;
  runs: Array<Record<string, unknown>>;
};

type DbStoreInfo = {
  id: string;
  label: string;
  layer: "core" | "brand" | "plugin";
  path?: string;
};

function withDb(url: string, dbId: string): string {
  if (!dbId) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}db=${encodeURIComponent(dbId)}`;
}

export function DatabaseClient() {
  const [dbs, setDbs] = useState<DbStoreInfo[]>([]);
  const [dbId, setDbId] = useState("");
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [filter, setFilter] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<string | undefined>();
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("data");
  const [rowOpen, setRowOpen] = useState(false);
  const [activeRow, setActiveRow] = useState<Record<string, unknown> | null>(null);
  const [activeRowid, setActiveRowid] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [views, setViews] = useState<SavedView[]>([]);
  const [activity, setActivity] = useState<ActivityPayload | null>(null);
  const [relationTarget, setRelationTarget] = useState<{
    table: string;
    value: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const loadDbs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/admin/database/dbs");
      const body = (await response.json()) as {
        dbs?: DbStoreInfo[];
        defaultStoreId?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Chargement impossible");
      const next = body.dbs || [];
      setDbs(next);
      setDbId((current) => {
        if (current && next.some((d) => d.id === current)) return current;
        return (
          body.defaultStoreId ||
          next.find((d) => d.id === "brand")?.id ||
          next[0]?.id ||
          ""
        );
      });
      if (next.length === 0) {
        throw new Error("not_found");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chargement impossible");
      setDbs([]);
      setDbId("");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    if (!dbId) {
      setCatalog([]);
      setSelected("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        withDb(
          `/api/v1/admin/database/tables?includeSystem=${showSystem ? "1" : "0"}`,
          dbId,
        ),
      );
      const body = (await response.json()) as {
        tables?: CatalogEntry[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Chargement impossible");
      const next = body.tables || [];
      setCatalog(next);
      setSelected((current) =>
        current && next.some((t) => t.name === current)
          ? current
          : (next.find((t) => t.group === "metier")?.name ?? next[0]?.name ?? ""),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [dbId, showSystem]);

  const loadTable = useCallback(async () => {
    if (!selected || !dbId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "50",
        db: dbId,
      });
      if (sort) params.set("sort", sort);
      if (sortDir) params.set("sortDir", sortDir);
      if (q.trim()) params.set("q", q.trim());
      const response = await fetch(
        `/api/v1/admin/database/tables/${encodeURIComponent(selected)}?${params}`,
      );
      const body = (await response.json()) as TableDetail & { error?: string };
      if (!response.ok) throw new Error(body.error || "Lecture impossible");
      setDetail(body);

      const viewsRes = await fetch(
        withDb(
          `/api/v1/admin/database/tables/${encodeURIComponent(selected)}/views`,
          dbId,
        ),
      );
      const viewsBody = await viewsRes.json();
      setViews(viewsBody.views || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lecture impossible");
    } finally {
      setLoading(false);
    }
  }, [dbId, page, q, selected, sort, sortDir]);

  const loadActivity = useCallback(async () => {
    if (!dbId) return;
    const res = await fetch(
      withDb("/api/v1/admin/database/activity?limit=40", dbId),
    );
    if (!res.ok) return;
    setActivity((await res.json()) as ActivityPayload);
  }, [dbId]);

  useEffect(() => {
    void loadDbs();
  }, [loadDbs]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    void loadTable();
  }, [loadTable]);

  useEffect(() => {
    if (tab === "activity") void loadActivity();
  }, [tab, loadActivity]);

  const visibleGroups = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const filtered = query
      ? catalog.filter((t) => t.name.toLowerCase().includes(query))
      : catalog;
    return {
      metier: filtered.filter((t) => t.group === "metier"),
      vues: filtered.filter((t) => t.group === "vues"),
      systeme: filtered.filter((t) => t.group === "systeme"),
    };
  }, [catalog, filter]);

  const fkMap = useMemo(() => {
    const map = new Map<string, { table: string; to: string }>();
    for (const fk of detail?.table.foreignKeys || []) {
      const from = String(fk.from ?? "");
      const table = String(fk.table ?? "");
      const to = String(fk.to ?? "id");
      if (from && table) map.set(from, { table, to });
    }
    return map;
  }, [detail]);

  function openRow(row: Record<string, unknown>) {
    setActiveRow(row);
    const rowid = Number(row.__rowid__);
    setActiveRowid(Number.isFinite(rowid) ? rowid : null);
    const values: Record<string, string> = {};
    for (const col of detail?.table.columns || []) {
      const v = row[col.name];
      values[col.name] = v === null || v === undefined ? "" : String(v);
    }
    setEditValues(values);
    setRowOpen(true);
  }

  async function saveRow() {
    if (!detail?.table.canCrud || !selected) return;
    setSaving(true);
    setError("");
    try {
      const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(editValues)) {
        values[k] = v === "" ? null : v;
      }
      const url = withDb(
        activeRowid != null
          ? `/api/v1/admin/database/tables/${encodeURIComponent(selected)}/rows/${activeRowid}`
          : `/api/v1/admin/database/tables/${encodeURIComponent(selected)}/rows`,
        dbId,
      );
      const res = await fetch(url, {
        method: activeRowid != null ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible");
      setRowOpen(false);
      await loadTable();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  async function deleteActiveRow() {
    if (!detail?.table.canCrud || activeRowid == null || !selected) return;
    if (!confirm("Supprimer cette ligne ?")) return;
    setSaving(true);
    try {
      const res = await fetch(
        withDb(
          `/api/v1/admin/database/tables/${encodeURIComponent(selected)}/rows/${activeRowid}`,
          dbId,
        ),
        { method: "DELETE" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Suppression impossible");
      setRowOpen(false);
      await loadTable();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Suppression impossible");
    } finally {
      setSaving(false);
    }
  }

  async function runButton() {
    if (activeRowid == null || !selected) return;
    await fetch(
      withDb(
        `/api/v1/admin/database/tables/${encodeURIComponent(selected)}/rows/${activeRowid}/run-button`,
        dbId,
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
  }

  async function saveCurrentView() {
    if (!selected) return;
    const name = prompt("Nom de la vue", "Ma vue");
    if (!name) return;
    await fetch(
      withDb(
        `/api/v1/admin/database/tables/${encodeURIComponent(selected)}/views`,
        dbId,
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          config: { sort, sortDir, q },
        }),
      },
    );
    await loadTable();
  }

  function applyView(view: SavedView) {
    setSort(view.config.sort);
    setSortDir(view.config.sortDir || "asc");
    setQ(view.config.q || "");
    setQDraft(view.config.q || "");
    setPage(1);
  }

  async function followRelation(table: string, column: string, value: unknown) {
    if (value === null || value === undefined || value === "") return;
    setRelationTarget({ table, value: String(value) });
    setSelected(table);
    setPage(1);
    setQ(String(value));
    setQDraft(String(value));
    setSort(column);
    setTab("data");
  }

  const exportUrl = selected
    ? withDb(
        `/api/v1/admin/database/tables/${encodeURIComponent(selected)}/export?format=csv${q ? `&q=${encodeURIComponent(q)}` : ""}`,
        dbId,
      )
    : "#";

  const activeDbLabel =
    dbs.find((d) => d.id === dbId)?.label || dbId || "Aucune base";

  function renderGroup(title: string, items: CatalogEntry[]) {
    if (!items.length) return null;
    return (
      <div className="mb-4">
        <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </div>
        <div className="space-y-0.5">
          {items.map((table) => (
            <button
              key={table.name}
              type="button"
              onClick={() => {
                setSelected(table.name);
                setPage(1);
                setTab("data");
                setSort(undefined);
                setQ("");
                setQDraft("");
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                selected === table.name
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-700 hover:bg-white/80"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                {table.kind === "view" ? (
                  <Eye className="h-3.5 w-3.5 shrink-0 opacity-70" />
                ) : (
                  <Table2 className="h-3.5 w-3.5 shrink-0 opacity-70" />
                )}
                <span className="truncate text-[13px] font-medium">{table.name}</span>
              </span>
              <span className="shrink-0 text-[10px] opacity-70">
                {table.rowCount.toLocaleString("fr-FR")}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-[calc(100vh-9rem)] gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_40%)] shadow-sm lg:grid-cols-[17rem_minmax(0,1fr)]">
      {/* Rail gauche */}
      <aside className="border-r border-slate-200/80 bg-slate-50/90 p-3">
        <div className="mb-3 flex items-center gap-2 px-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
            <Database className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">Bases</div>
            <div className="text-[11px] text-slate-500">
              {dbs.length} base{dbs.length === 1 ? "" : "s"} · {catalog.length}{" "}
              objets
            </div>
          </div>
        </div>
        {dbs.length > 0 ? (
          <div className="mb-3 space-y-1">
            {dbs.map((db) => (
              <button
                key={db.id}
                type="button"
                onClick={() => {
                  setDbId(db.id);
                  setSelected("");
                  setDetail(null);
                  setPage(1);
                  setFilter("");
                  setQ("");
                  setQDraft("");
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                  dbId === db.id
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-700 hover:bg-white/80"
                }`}
              >
                <span className="truncate text-[13px] font-medium">
                  {db.label}
                </span>
                <span className="shrink-0 text-[10px] uppercase opacity-70">
                  {db.layer}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Rechercher…"
          className="mb-3 h-8 bg-white"
        />
        <label className="mb-3 flex cursor-pointer items-center gap-2 px-1 text-[11px] text-slate-500">
          <input
            type="checkbox"
            checked={showSystem}
            onChange={(e) => setShowSystem(e.target.checked)}
          />
          Afficher système
        </label>
        <div className="max-h-[calc(100vh-16rem)] overflow-y-auto pr-1">
          {renderGroup("Métier", visibleGroups.metier)}
          {renderGroup("Vues", visibleGroups.vues)}
          {renderGroup("Système", visibleGroups.systeme)}
        </div>
      </aside>

      {/* Zone principale */}
      <section className="flex min-w-0 flex-col">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                {selected || (dbId ? activeDbLabel : "Aucune base")}
              </h2>
              {detail ? (
                <>
                  <Badge variant="secondary">{detail.table.kind}</Badge>
                  {detail.table.canCrud ? (
                    <Badge variant="success">CRUD</Badge>
                  ) : null}
                  {detail.table.canAutomate ? (
                    <Badge variant="info">Automations</Badge>
                  ) : null}
                </>
              ) : null}
            </div>
            {detail ? (
              <p className="mt-1 text-sm text-slate-500">
                {detail.pagination.total.toLocaleString("fr-FR")} lignes
                {relationTarget && selected === relationTarget.table
                  ? ` · filtre relation « ${relationTarget.value} »`
                  : ""}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {detail?.table.canCrud ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setActiveRow(null);
                  setActiveRowid(null);
                  const values: Record<string, string> = {};
                  for (const col of detail.table.columns) {
                    if (!col.pk) values[col.name] = "";
                  }
                  setEditValues(values);
                  setRowOpen(true);
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Nouvelle ligne
              </Button>
            ) : null}
            <Button size="sm" variant="outline" asChild>
              <a href={exportUrl}>
                <Download className="mr-1 h-3.5 w-3.5" />
                CSV
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadTable()}
              disabled={!selected || loading}
            >
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Actualiser
            </Button>
          </div>
        </header>

        {error ? (
          <div className="mx-5 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col px-5 pb-5">
          <TabsList className="mt-3 w-fit">
            <TabsTrigger value="data">
              <Table2 className="mr-1.5 h-3.5 w-3.5" />
              Données
            </TabsTrigger>
            <TabsTrigger value="schema">Schéma</TabsTrigger>
            <TabsTrigger value="automations">
              <Workflow className="mr-1.5 h-3.5 w-3.5" />
              Automations
            </TabsTrigger>
            <TabsTrigger value="activity">
              <Activity className="mr-1.5 h-3.5 w-3.5" />
              Activité
            </TabsTrigger>
          </TabsList>

          <TabsContent value="data" className="mt-3 min-h-0 flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[16rem] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <Input
                  className="h-9 pl-8"
                  placeholder="Filtrer les lignes…"
                  value={qDraft}
                  onChange={(e) => setQDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setQ(qDraft);
                      setPage(1);
                    }
                  }}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setQ(qDraft);
                  setPage(1);
                }}
              >
                <Filter className="mr-1 h-3.5 w-3.5" />
                Filtrer
              </Button>
              <Button size="sm" variant="outline" onClick={() => void saveCurrentView()}>
                Sauver la vue
              </Button>
              {views.map((view) => (
                <Button
                  key={view.id}
                  size="sm"
                  variant="secondary"
                  onClick={() => applyView(view)}
                >
                  {view.name}
                </Button>
              ))}
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="max-h-[55vh] overflow-auto">
                <table className="min-w-full border-separate border-spacing-0 text-left text-[12px]">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      {(detail?.columns || []).map((column) => {
                        const meta = detail?.table.columns.find((c) => c.name === column);
                        const active = sort === column;
                        return (
                          <th
                            key={column}
                            className="cursor-pointer whitespace-nowrap border-b border-slate-200 bg-slate-50/95 px-3 py-2.5 font-medium text-slate-600 backdrop-blur"
                            onClick={() => {
                              if (active) {
                                setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                              } else {
                                setSort(column);
                                setSortDir("asc");
                              }
                              setPage(1);
                            }}
                          >
                            <span className="mr-1.5">{column}</span>
                            <Badge variant="muted" className="font-normal">
                              {columnTypeLabel(meta?.type || "")}
                            </Badge>
                            {active ? (
                              <span className="ml-1 text-slate-400">
                                {sortDir === "asc" ? "↑" : "↓"}
                              </span>
                            ) : null}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {(detail?.rows || []).map((row, index) => (
                      <tr
                        key={index}
                        className="cursor-pointer border-b border-slate-100 transition hover:bg-sky-50/60"
                        onClick={() => openRow(row)}
                      >
                        {(detail?.columns || []).map((column) => {
                          const fk = fkMap.get(column);
                          const value = row[column];
                          return (
                            <td
                              key={column}
                              className="max-w-[18rem] truncate px-3 py-2 align-middle text-slate-800"
                            >
                              {fk && value != null && value !== "" ? (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-sky-700 hover:underline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void followRelation(fk.table, fk.to, value);
                                  }}
                                >
                                  <Link2 className="h-3 w-3" />
                                  {displayValue(value)}
                                </button>
                              ) : (
                                <span
                                  className={
                                    value === null ? "italic text-slate-400" : ""
                                  }
                                >
                                  {displayValue(value)}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {!detail?.rows.length ? (
                      <tr>
                        <td
                          colSpan={Math.max(1, detail?.columns.length || 1)}
                          className="px-4 py-12 text-center text-slate-500"
                        >
                          {loading ? (
                            <span className="inline-flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
                            </span>
                          ) : (
                            "Aucune ligne"
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            {detail ? (
              <div className="mt-3 flex items-center justify-end gap-2 text-sm text-slate-600">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span>
                  Page {detail.pagination.page} / {detail.pagination.pages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= detail.pagination.pages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="schema" className="mt-3">
            {detail ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {detail.table.columns.map((col) => (
                    <div
                      key={col.name}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-900">
                          {col.name}
                        </span>
                        <Badge variant="outline">{columnTypeLabel(col.type)}</Badge>
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-slate-500">
                        {col.type || "ANY"}
                        {col.pk ? " · PK" : ""}
                        {col.notnull ? " · NOT NULL" : ""}
                      </p>
                    </div>
                  ))}
                </div>
                {detail.table.foreignKeys.length ? (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Relations</h3>
                    <ul className="space-y-1 text-sm text-slate-600">
                      {detail.table.foreignKeys.map((fk, i) => (
                        <li key={i} className="font-mono text-xs">
                          {String(fk.from)} → {String(fk.table)}.{String(fk.to)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <details className="rounded-xl border bg-white p-4">
                  <summary className="cursor-pointer text-sm font-semibold">
                    SQL brut
                  </summary>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-100">
                    {detail.table.sql || "indisponible"}
                  </pre>
                </details>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="automations" className="mt-3">
            {selected && detail ? (
              <DatabaseAutomationsPanel
                table={selected}
                db={dbId}
                canAutomate={detail.table.canAutomate}
                columns={detail.table.columns.map((c) => c.name)}
              />
            ) : null}
          </TabsContent>

          <TabsContent value="activity" className="mt-3">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold">Journal d’accès</h3>
                <ul className="max-h-80 space-y-2 overflow-y-auto text-xs text-slate-600">
                  {(activity?.accessLog || []).map((entry) => (
                    <li key={entry.id} className="border-b border-slate-50 pb-2">
                      <span className="font-medium text-slate-800">{entry.action}</span>
                      {entry.tableName ? ` · ${entry.tableName}` : ""}
                      <div className="text-slate-400">
                        {entry.actor} · {entry.createdAt}
                      </div>
                    </li>
                  ))}
                  {!activity?.accessLog?.length ? (
                    <li className="text-slate-400">Aucune activité</li>
                  ) : null}
                </ul>
              </div>
              <div className="rounded-xl border bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold">Runs automations</h3>
                <ul className="max-h-80 space-y-2 overflow-y-auto font-mono text-[11px] text-slate-600">
                  {(activity?.runs || []).map((run) => (
                    <li key={String(run.id)}>
                      {String(run.status)} · {String(run.automation_id).slice(0, 8)}…
                      {run.error ? ` — ${String(run.error)}` : ""}
                    </li>
                  ))}
                  {!activity?.runs?.length ? (
                    <li className="font-sans text-slate-400">Aucun run</li>
                  ) : null}
                </ul>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </section>

      <Sheet open={rowOpen} onOpenChange={setRowOpen}>
        <SheetContent className="w-full max-w-lg overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {activeRowid != null ? `Ligne #${activeRowid}` : "Nouvelle ligne"}
            </SheetTitle>
            <SheetDescription>
              {selected} — propriétés de la ligne
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4 py-4">
            {Object.keys(editValues).map((key) => (
              <label key={key} className="block">
                <span className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-600">
                  {key}
                  {fkMap.has(key) ? (
                    <Badge variant="info" className="font-normal">
                      relation
                    </Badge>
                  ) : null}
                </span>
                <Input
                  value={editValues[key] ?? ""}
                  disabled={!detail?.table.canCrud}
                  onChange={(e) =>
                    setEditValues((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                />
              </label>
            ))}
            <div className="flex flex-wrap gap-2 pt-2">
              {detail?.table.canCrud ? (
                <Button size="sm" disabled={saving} onClick={() => void saveRow()}>
                  {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                  Enregistrer
                </Button>
              ) : null}
              {detail?.table.canCrud && activeRowid != null ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  onClick={() => void deleteActiveRow()}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Supprimer
                </Button>
              ) : null}
              {activeRowid != null ? (
                <Button size="sm" variant="outline" onClick={() => void runButton()}>
                  <Workflow className="mr-1 h-3.5 w-3.5" />
                  Lancer bouton
                </Button>
              ) : null}
            </div>
            {activeRow ? (
              <details className="pt-2">
                <summary className="cursor-pointer text-xs font-semibold text-slate-500">
                  JSON brut
                </summary>
                <pre className="mt-2 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] text-slate-100">
                  {JSON.stringify(activeRow, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
