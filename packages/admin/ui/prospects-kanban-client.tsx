"use client";

/**
 * Module Prospection — kanban drag & drop générique (la marque nomme les
 * prospects : « restaurants » pour TempoFlow…).
 *
 * Colonnes = champ `colonne` de admin_prospects ; DnD HTML5 natif (pas de
 * dépendance) ; déplacement = PATCH { colonne, position }.
 *
 * API : /api/v1/modules/prospects
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Input } from "@creezio/shell-ui/ui/kit";

const API = "/api/v1/modules/prospects";

export type ProspectsKanbanLabels = {
  title?: string;
  subtitle?: string;
  addPlaceholder?: string;
};

type Prospect = {
  id: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  nom: string;
  contact: string | null;
  email: string | null;
  telephone: string | null;
  ville: string | null;
  site_web: string | null;
  notes: string | null;
  colonne: string;
  position: number;
};

const COLUMNS: Array<{ id: string; label: string }> = [
  { id: "a_contacter", label: "À contacter" },
  { id: "contacte", label: "Contacté" },
  { id: "rdv", label: "RDV / démo" },
  { id: "client", label: "Client 🎉" },
  { id: "perdu", label: "Perdu" },
];

export function ProspectsKanbanClient({
  labels,
}: {
  labels?: ProspectsKanbanLabels;
}) {
  const [items, setItems] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [nom, setNom] = useState("");
  const [ville, setVille] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(API, { cache: "no-store" });
      const j = await r.json();
      // Deux dialectes : mount kit ({ok:true, items}) et mount métier généré
      // --from-prd ({items} nu) — le client générique accepte les deux.
      if (j && Array.isArray(j.items))
        setItems((j.items as Prospect[]).filter((p) => !p.archived_at));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byColumn = useMemo(() => {
    const map = new Map<string, Prospect[]>();
    for (const c of COLUMNS) map.set(c.id, []);
    for (const p of items) {
      const col = map.has(p.colonne) ? p.colonne : COLUMNS[0]!.id;
      map.get(col)!.push(p);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          (a.position || 0) - (b.position || 0) ||
          (a.created_at < b.created_at ? -1 : 1),
      );
    }
    return map;
  }, [items]);

  const create = useCallback(async () => {
    if (!nom.trim()) return;
    await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nom: nom.trim(),
        ville: ville.trim() || null,
        colonne: COLUMNS[0]!.id,
        position: Date.now(),
      }),
    });
    setNom("");
    setVille("");
    await refresh();
  }, [nom, ville, refresh]);

  const moveTo = useCallback(
    async (id: string, colonne: string) => {
      const list = byColumn.get(colonne) || [];
      const position = list.length
        ? Math.max(...list.map((p) => p.position || 0)) + 1
        : 1;
      // Optimiste : déplacer localement avant la confirmation serveur.
      setItems((prev) =>
        prev.map((p) => (p.id === id ? { ...p, colonne, position } : p)),
      );
      await fetch(`${API}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ colonne, position }),
      });
      await refresh();
    },
    [byColumn, refresh],
  );

  const saveNotes = useCallback(async () => {
    if (!openId) return;
    await fetch(`${API}/${encodeURIComponent(openId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    setOpenId(null);
    await refresh();
  }, [openId, notes, refresh]);

  const archive = useCallback(
    async (id: string) => {
      // Mount kit : DELETE ; mount métier généré (archivable) : POST /:id/archive.
      const r = await fetch(`${API}/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        await fetch(`${API}/${encodeURIComponent(id)}/archive`, {
          method: "POST",
        });
      }
      setOpenId(null);
      await refresh();
    },
    [refresh],
  );

  const open = items.find((p) => p.id === openId) || null;

  return (
    <div className="flex w-full flex-col gap-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {labels?.title || "Prospection"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {labels?.subtitle ||
              "Glissez-déposez les cartes d'une colonne à l'autre."}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Input
            className="w-56"
            placeholder={labels?.addPlaceholder || "Nom du prospect"}
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
          />
          <Input
            className="w-36"
            placeholder="Ville"
            value={ville}
            onChange={(e) => setVille(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
          />
          <Button onClick={create} disabled={!nom.trim()}>
            Ajouter
          </Button>
        </div>
      </div>

      <div className="grid gap-3 overflow-x-auto md:grid-cols-5">
        {COLUMNS.map((col) => {
          const list = byColumn.get(col.id) || [];
          return (
            <div
              key={col.id}
              className={`flex min-h-64 flex-col gap-2 rounded-lg border p-2 transition-colors ${
                overCol === col.id ? "border-primary bg-primary/5" : "bg-muted/30"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setOverCol(col.id);
              }}
              onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                setOverCol(null);
                const id = e.dataTransfer.getData("text/plain") || dragId;
                if (id) void moveTo(id, col.id);
                setDragId(null);
              }}
            >
              <div className="flex items-center justify-between px-1">
                <span className="text-sm font-medium">{col.label}</span>
                <Badge variant="secondary">{list.length}</Badge>
              </div>
              {list.map((p) => (
                <Card
                  key={p.id}
                  draggable
                  onDragStart={(e) => {
                    setDragId(p.id);
                    e.dataTransfer.setData("text/plain", p.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => {
                    setOpenId(p.id);
                    setNotes(p.notes || "");
                  }}
                  className={`cursor-grab p-2 active:cursor-grabbing ${
                    dragId === p.id ? "opacity-50" : ""
                  }`}
                >
                  <div className="text-sm font-medium">{p.nom}</div>
                  <div className="text-xs text-muted-foreground">
                    {[p.ville, p.contact, p.telephone]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </div>
                  {p.notes ? (
                    <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                      {p.notes}
                    </div>
                  ) : null}
                </Card>
              ))}
              {list.length === 0 && !loading ? (
                <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                  Déposez ici
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {open ? (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">{open.nom}</h2>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpenId(null)}>
                Fermer
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void archive(open.id)}
              >
                Archiver
              </Button>
            </div>
          </div>
          <textarea
            className="min-h-20 w-full rounded-md border bg-transparent p-2 text-sm outline-none"
            placeholder="Notes (contact, contexte, prochaine action…)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div>
            <Button size="sm" onClick={saveNotes}>
              Enregistrer les notes
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
