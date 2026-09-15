"use client";

/**
 * Écran admin « Navigation » — masquer / réordonner / renommer les
 * entrées du catalogue sidebar. Consomme `/api/v1/modules/nav/*`.
 * Réorder = boutons haut/bas + input `order` (pas de lib DnD).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  RotateCcw,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@creezio/shell-ui/ui/kit";

type CatalogEntry = {
  id: string;
  href: string;
  label: string;
  icon: string;
  group: string;
  order: number;
  permission?: string;
  source: string;
  available: boolean;
  hidden: boolean;
};

type CatalogPayload = {
  ok: true;
  entries: CatalogEntry[];
  overrides: Array<{ entryId: string }>;
};

function sourceLabel(source: string): string {
  if (source === "os") return "OS";
  if (source === "module") return "Module";
  if (source === "plugin") return "Plugin";
  if (source === "extra") return "Extra";
  return source;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || res.statusText;
  } catch {
    return res.statusText;
  }
}

export function NavAdminClient() {
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draftLabels, setDraftLabels] = useState<Record<string, string>>({});
  const [draftOrders, setDraftOrders] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/v1/modules/nav/catalog");
      if (!res.ok) {
        setError(await readError(res));
        setEntries(null);
        return;
      }
      const data = (await res.json()) as CatalogPayload;
      const list = [...(data.entries ?? [])].sort(
        (a, b) => a.order - b.order || a.id.localeCompare(b.id),
      );
      setEntries(list);
      const labels: Record<string, string> = {};
      const orders: Record<string, string> = {};
      for (const e of list) {
        labels[e.id] = e.label;
        orders[e.id] = String(e.order);
      }
      setDraftLabels(labels);
      setDraftOrders(orders);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEntries(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const overrideIds = useMemo(() => {
    if (!entries) return new Set<string>();
    return new Set(entries.filter((e) => e.hidden).map((e) => e.id));
  }, [entries]);

  async function putOverride(body: Record<string, unknown>) {
    const res = await fetch("/api/v1/modules/nav/overrides", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await readError(res));
  }

  async function toggleVisible(entry: CatalogEntry) {
    if (!entry.available) return;
    setBusyId(entry.id);
    try {
      await putOverride({ entryId: entry.id, hidden: !entry.hidden });
      toast.success(entry.hidden ? "Entrée affichée" : "Entrée masquée");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function saveLabel(entry: CatalogEntry) {
    const label = (draftLabels[entry.id] ?? "").trim();
    if (!label || label === entry.label) return;
    setBusyId(entry.id);
    try {
      await putOverride({ entryId: entry.id, label });
      toast.success("Libellé enregistré");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function saveOrder(entry: CatalogEntry) {
    const raw = draftOrders[entry.id];
    const order = Number(raw);
    if (!Number.isFinite(order) || order === entry.order) return;
    setBusyId(entry.id);
    try {
      await putOverride({ entryId: entry.id, order });
      toast.success("Ordre enregistré");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function move(entry: CatalogEntry, direction: -1 | 1) {
    if (!entries) return;
    const idx = entries.findIndex((e) => e.id === entry.id);
    const swap = entries[idx + direction];
    if (!swap) return;
    const ids = entries.map((e) => e.id);
    const tmp = ids[idx]!;
    ids[idx] = ids[idx + direction]!;
    ids[idx + direction] = tmp;
    setBusyId(entry.id);
    try {
      const res = await fetch("/api/v1/modules/nav/overrides/reorder", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(await readError(res));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function reset(entry: CatalogEntry) {
    setBusyId(entry.id);
    try {
      const res = await fetch(
        `/api/v1/modules/nav/overrides/${encodeURIComponent(entry.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(await readError(res));
      toast.success("Retour aux défauts");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Navigation</CardTitle>
        <CardDescription>
          Masquer, réordonner ou renommer les entrées de la barre latérale.
          Le catalogue vient des modules OS et métier — ce n&apos;est pas un
          CMS de routes. Owner : les entrées masquées restent masquées.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : entries == null ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Chargement du catalogue…
          </p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune entrée enregistrée.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="py-2 pr-3 text-left font-medium text-slate-500">
                    Source
                  </th>
                  <th className="py-2 pr-3 text-left font-medium text-slate-500">
                    Lien
                  </th>
                  <th className="py-2 pr-3 text-left font-medium text-slate-500">
                    Libellé
                  </th>
                  <th className="py-2 pr-3 text-left font-medium text-slate-500">
                    Visible
                  </th>
                  <th className="py-2 pr-3 text-left font-medium text-slate-500">
                    Permission
                  </th>
                  <th className="py-2 pr-3 text-left font-medium text-slate-500">
                    Ordre
                  </th>
                  <th className="py-2 text-left font-medium text-slate-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => {
                  const disabled = !entry.available;
                  const busy = busyId === entry.id;
                  return (
                    <tr
                      key={entry.id}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="py-2 pr-3">
                        <Badge variant="outline">{sourceLabel(entry.source)}</Badge>
                      </td>
                      <td className="py-2 pr-3 font-mono text-[12px] text-slate-600">
                        {entry.href}
                      </td>
                      <td className="py-2 pr-3">
                        <Label htmlFor={`nav-label-${entry.id}`} className="sr-only">
                          Libellé {entry.id}
                        </Label>
                        <Input
                          id={`nav-label-${entry.id}`}
                          value={draftLabels[entry.id] ?? entry.label}
                          disabled={disabled || busy}
                          onChange={(ev) =>
                            setDraftLabels((prev) => ({
                              ...prev,
                              [entry.id]: ev.target.value,
                            }))
                          }
                          onBlur={() => void saveLabel(entry)}
                          className="h-8 w-[180px]"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        {disabled ? (
                          <Badge variant="secondary">indisponible</Badge>
                        ) : (
                          <label className="flex items-center gap-2 text-[13px]">
                            <input
                              type="checkbox"
                              checked={!entry.hidden}
                              disabled={busy}
                              onChange={() => void toggleVisible(entry)}
                              aria-label={`Visible ${entry.label}`}
                            />
                            {entry.hidden ? "Masquée" : "Oui"}
                          </label>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono text-[12px] text-slate-500">
                        {entry.permission || "—"}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={idx === 0 || busy || disabled}
                            onClick={() => void move(entry, -1)}
                            aria-label={`Monter ${entry.label}`}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={idx === entries.length - 1 || busy || disabled}
                            onClick={() => void move(entry, 1)}
                            aria-label={`Descendre ${entry.label}`}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                          <Label htmlFor={`nav-order-${entry.id}`} className="sr-only">
                            Ordre {entry.id}
                          </Label>
                          <Input
                            id={`nav-order-${entry.id}`}
                            value={draftOrders[entry.id] ?? String(entry.order)}
                            disabled={disabled || busy}
                            onChange={(ev) =>
                              setDraftOrders((prev) => ({
                                ...prev,
                                [entry.id]: ev.target.value,
                              }))
                            }
                            onBlur={() => void saveOrder(entry)}
                            className="h-8 w-[72px]"
                            inputMode="numeric"
                          />
                        </div>
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy || disabled}
                            onClick={() => void saveLabel(entry)}
                          >
                            <Save className="mr-1 h-3.5 w-3.5" />
                            Enregistrer
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => void reset(entry)}
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" />
                            Défaut
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {overrideIds.size > 0 ? (
          <p className="mt-3 text-[12px] text-slate-500">
            {overrideIds.size} entrée{overrideIds.size > 1 ? "s" : ""} masquée
            {overrideIds.size > 1 ? "s" : ""} par override admin.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
