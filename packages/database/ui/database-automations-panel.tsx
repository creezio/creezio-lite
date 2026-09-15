"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Plus,
  Trash2,
  Zap,
  Play,
  RefreshCw,
} from "lucide-react";
import { Badge } from "./primitives/badge";
import { Button } from "./primitives/button";
import { Input } from "./primitives/input";
import type { Automation } from "./types";

type Props = {
  table: string;
  /** Store SQLite (`?db=`). */
  db?: string;
  canAutomate: boolean;
  columns: string[];
};

function withDb(url: string, dbId?: string): string {
  if (!dbId) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}db=${encodeURIComponent(dbId)}`;
}

const TRIGGERS = [
  { value: "row_added", label: "Ligne ajoutée" },
  { value: "row_updated", label: "Ligne modifiée" },
  { value: "row_deleted", label: "Ligne supprimée" },
  { value: "button_pressed", label: "Bouton manuel" },
] as const;

export function DatabaseAutomationsPanel({
  table,
  db,
  canAutomate,
  columns,
}: Props) {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [runs, setRuns] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    triggerType: "row_updated" as Automation["triggerType"],
    watchColumn: "",
    field: "",
    cmp: "changed_to",
    value: "",
    actionType: "webhook" as "webhook" | "plugin_event" | "n8n_webhook",
    url: "",
    event: "database.automation",
    n8nPath: "",
  });
  const [testUrl, setTestUrl] = useState("");
  const [testResult, setTestResult] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        withDb(
          `/api/v1/admin/database/tables/${encodeURIComponent(table)}/automations`,
          db,
        ),
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Chargement impossible");
      setAutomations(body.automations || []);
      if (body.automations?.[0]?.id) {
        const runsRes = await fetch(
          withDb(
            `/api/v1/admin/database/automations/${body.automations[0].id}/runs?limit=20`,
            db,
          ),
        );
        const runsBody = await runsRes.json();
        setRuns(runsBody.runs || []);
      } else {
        setRuns([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, [db, table]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createAutomation() {
    setCreating(true);
    setError("");
    try {
      const conditions =
        form.field && form.cmp
          ? {
              op: "and" as const,
              rules: [
                {
                  field: form.field,
                  cmp: form.cmp,
                  value: form.value,
                },
              ],
            }
          : { op: "and" as const, rules: [] };

      let action: Record<string, unknown>;
      if (form.actionType === "webhook") {
        action = { type: "webhook", url: form.url, bodyTemplate: "event" };
      } else if (form.actionType === "plugin_event") {
        action = { type: "plugin_event", event: form.event };
      } else {
        action = { type: "n8n_webhook", path: form.n8nPath };
      }

      const res = await fetch(
        withDb(
          `/api/v1/admin/database/tables/${encodeURIComponent(table)}/automations`,
          db,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name || `Quand ${form.triggerType}`,
            triggerType: form.triggerType,
            watchColumns: form.watchColumn ? [form.watchColumn] : null,
            conditions,
            actions: [action],
            enabled: true,
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Création impossible");
      setForm((f) => ({ ...f, name: "", url: "", value: "" }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Création impossible");
    } finally {
      setCreating(false);
    }
  }

  async function toggle(auto: Automation) {
    await fetch(withDb(`/api/v1/admin/database/automations/${auto.id}`, db), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !auto.enabled }),
    });
    await load();
  }

  async function remove(id: string) {
    await fetch(withDb(`/api/v1/admin/database/automations/${id}`, db), {
      method: "DELETE",
    });
    await load();
  }

  async function processNow() {
    await fetch(withDb("/api/v1/admin/database/automations/process", db), {
      method: "POST",
    });
    await load();
  }

  async function testWebhook() {
    setTestResult("");
    const res = await fetch("/api/v1/admin/database/automations/test-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: testUrl }),
    });
    const body = await res.json();
    setTestResult(JSON.stringify(body.result || body, null, 2));
  }

  if (!canAutomate) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-900">
        Cette table n’est pas automatisable (tables système / auth protégées).
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Automations</h3>
          <p className="text-xs text-slate-500">
            Déclencheurs, conditions et webhooks — esprit Notion
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void processNow()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Traiter la file
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : automations.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune automation sur cette base.</p>
        ) : (
          automations.map((auto) => (
            <div
              key={auto.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-sm font-medium text-slate-900">{auto.name}</span>
                  <Badge variant={auto.enabled ? "success" : "muted"}>
                    {auto.enabled ? "Active" : "Off"}
                  </Badge>
                  <Badge variant="outline">{auto.triggerType}</Badge>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-slate-500">
                  {JSON.stringify(auto.actions)}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="outline" onClick={() => void toggle(auto)}>
                  {auto.enabled ? "Désactiver" : "Activer"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void remove(auto.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Plus className="h-4 w-4" /> Nouvelle automation
        </h4>
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            placeholder="Nom"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
            value={form.triggerType}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                triggerType: e.target.value as Automation["triggerType"],
              }))
            }
          >
            {TRIGGERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
            value={form.watchColumn}
            onChange={(e) => setForm((f) => ({ ...f, watchColumn: e.target.value }))}
          >
            <option value="">Toutes les colonnes (watch)</option>
            {columns.map((col) => (
              <option key={col} value={col}>
                {col}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
            value={form.field}
            onChange={(e) => setForm((f) => ({ ...f, field: e.target.value }))}
          >
            <option value="">Condition — champ (optionnel)</option>
            {columns.map((col) => (
              <option key={col} value={col}>
                {col}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
            value={form.cmp}
            onChange={(e) => setForm((f) => ({ ...f, cmp: e.target.value }))}
          >
            <option value="changed_to">a changé vers</option>
            <option value="changed_from">a changé depuis</option>
            <option value="changed">a changé</option>
            <option value="equals">égal</option>
            <option value="contains">contient</option>
            <option value="gt">&gt;</option>
            <option value="gte">≥</option>
            <option value="is_empty">est vide</option>
          </select>
          <Input
            placeholder="Valeur condition"
            value={form.value}
            onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
          />
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
            value={form.actionType}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                actionType: e.target.value as typeof form.actionType,
              }))
            }
          >
            <option value="webhook">Webhook HTTP</option>
            <option value="plugin_event">Événement plugin</option>
            <option value="n8n_webhook">Webhook n8n</option>
          </select>
          {form.actionType === "webhook" ? (
            <Input
              placeholder="https://hooks.example.com/…"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            />
          ) : null}
          {form.actionType === "plugin_event" ? (
            <Input
              placeholder="nom.evenement"
              value={form.event}
              onChange={(e) => setForm((f) => ({ ...f, event: e.target.value }))}
            />
          ) : null}
          {form.actionType === "n8n_webhook" ? (
            <Input
              placeholder="chemin webhook n8n"
              value={form.n8nPath}
              onChange={(e) => setForm((f) => ({ ...f, n8nPath: e.target.value }))}
            />
          ) : null}
        </div>
        <div className="mt-3">
          <Button
            size="sm"
            disabled={creating || (form.actionType === "webhook" && !form.url)}
            onClick={() => void createAutomation()}
          >
            {creating ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-3.5 w-3.5" />
            )}
            Créer
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h4 className="mb-2 text-sm font-semibold">Tester un webhook</h4>
        <div className="flex gap-2">
          <Input
            placeholder="URL de test"
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
          />
          <Button size="sm" variant="outline" onClick={() => void testWebhook()}>
            <Play className="mr-1 h-3.5 w-3.5" />
            Tester
          </Button>
        </div>
        {testResult ? (
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] text-slate-100">
            {testResult}
          </pre>
        ) : null}
      </div>

      {runs.length ? (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Derniers runs</h4>
          <ul className="space-y-1 text-xs text-slate-600">
            {runs.slice(0, 10).map((run) => (
              <li key={String(run.id)} className="font-mono">
                {String(run.status)} · attempt {String(run.attempt)} ·{" "}
                {String(run.started_at || "")}
                {run.error ? ` — ${String(run.error)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
