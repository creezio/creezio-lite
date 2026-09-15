"use client";

/**
 * Module Support (côté admin) — tickets agrégés de toute la flotte.
 *
 * Sync pull au chargement + bouton manuel ; fil de messages ; réponse admin
 * relayée au serveur marque (visible par le client sur sa page /support).
 *
 * API : /api/v1/modules/support/*
 */

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "@creezio/shell-ui/ui/kit";

const API = "/api/v1/modules/support";

type Ticket = {
  id: string;
  created_at: string;
  updated_at: string;
  host_id: string | null;
  server_name: string | null;
  remote_id: string | null;
  sujet: string;
  corps: string | null;
  auteur: string | null;
  statut: string;
  derniere_reponse: string | null;
  messages_count?: number;
};

type Message = {
  id: string;
  created_at: string;
  origine: string;
  auteur: string | null;
  corps: string;
};

const STATUT_LABEL: Record<string, string> = {
  ouvert: "Ouvert",
  repondu: "Répondu",
  resolu: "Résolu",
  ferme: "Fermé",
};

function statutVariant(
  statut: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (statut === "repondu") return "default";
  if (statut === "resolu" || statut === "ferme") return "secondary";
  return "destructive";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function TicketsAdminClient() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reponse, setReponse] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(API, { cache: "no-store" });
      const j = await r.json();
      if (j?.ok) setTickets(j.items || []);
    } finally {
      setLoading(false);
    }
  }, []);

  const openTicket = useCallback(async (id: string) => {
    setOpenId(id);
    setMessages([]);
    const r = await fetch(`${API}/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    const j = await r.json();
    if (j?.ok) setMessages(j.messages || []);
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const r = await fetch(`${API}/sync`, { method: "POST" });
      const j = await r.json();
      if (j?.ok) {
        setLastSync(
          `${j.scanned} serveur(s) scanné(s), ${j.tickets} ticket(s), ${j.messages} nouveau(x) message(s)`,
        );
      } else {
        setError(j?.error || "sync KO");
      }
      await refresh();
      if (openId) await openTicket(openId);
    } catch {
      setError("sync injoignable");
    } finally {
      setSyncing(false);
    }
  }, [refresh, openId, openTicket]);

  useEffect(() => {
    void refresh().then(() => void sync());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reply = useCallback(async () => {
    if (!openId || !reponse.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API}/${encodeURIComponent(openId)}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ corps: reponse.trim() }),
      });
      const j = await r.json();
      if (!j?.ok) setError(j?.error || "envoi KO");
      else {
        setReponse("");
        await openTicket(openId);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }, [openId, reponse, openTicket, refresh]);

  const setStatut = useCallback(
    async (id: string, statut: string) => {
      await fetch(`${API}/${encodeURIComponent(id)}/statut`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statut }),
      });
      await refresh();
      if (openId === id) await openTicket(id);
    },
    [refresh, openId, openTicket],
  );

  const open = tickets.find((t) => t.id === openId) || null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Tickets support</h1>
          <p className="text-sm text-muted-foreground">
            Tickets remontés depuis tous les serveurs de la flotte.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastSync ? (
            <span className="text-xs text-muted-foreground">{lastSync}</span>
          ) : null}
          <Button size="sm" onClick={sync} disabled={syncing}>
            {syncing ? "Synchronisation…" : "Synchroniser la flotte"}
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border-destructive p-3 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-2">
          {loading ? (
            <Card className="p-4 text-sm text-muted-foreground">Chargement…</Card>
          ) : null}
          {!loading && tickets.length === 0 ? (
            <Card className="p-4 text-sm text-muted-foreground">
              Aucun ticket — lancez une synchronisation.
            </Card>
          ) : null}
          {tickets.map((t) => (
            <Card
              key={t.id}
              className={`cursor-pointer p-3 transition-colors hover:bg-accent ${
                openId === t.id ? "border-primary" : ""
              }`}
              onClick={() => void openTicket(t.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{t.sujet}</span>
                <Badge variant={statutVariant(t.statut)}>
                  {STATUT_LABEL[t.statut] || t.statut}
                </Badge>
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {t.corps || "—"}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <Badge variant="outline">
                  {t.server_name || "?"}
                  {t.host_id && t.host_id !== "local" ? ` @ ${t.host_id}` : ""}
                </Badge>
                <span>{fmtDate(t.updated_at)}</span>
                <span>· {t.messages_count ?? 0} msg</span>
              </div>
            </Card>
          ))}
        </div>

        <div>
          {open ? (
            <Card className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold">{open.sujet}</h2>
                  <div className="text-xs text-muted-foreground">
                    Serveur {open.server_name}
                    {open.host_id && open.host_id !== "local"
                      ? ` (hôte ${open.host_id})`
                      : " (local)"}{" "}
                    · ouvert le {fmtDate(open.created_at)}
                  </div>
                </div>
                <Badge variant={statutVariant(open.statut)}>
                  {STATUT_LABEL[open.statut] || open.statut}
                </Badge>
              </div>

              <div className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-md p-2 text-sm ${
                      m.origine === "admin"
                        ? "bg-primary/10"
                        : "bg-muted"
                    }`}
                  >
                    <div className="mb-1 text-[11px] text-muted-foreground">
                      {m.origine === "admin"
                        ? `Support${m.auteur ? ` (${m.auteur})` : ""}`
                        : `Client${m.auteur ? ` (${m.auteur})` : ""}`}{" "}
                      · {fmtDate(m.created_at)}
                    </div>
                    <div className="whitespace-pre-wrap">{m.corps}</div>
                  </div>
                ))}
                {messages.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    Aucun message synchronisé.
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <textarea
                  className="min-h-16 w-full rounded-md border bg-transparent p-2 text-sm outline-none"
                  placeholder="Répondre au client…"
                  value={reponse}
                  onChange={(e) => setReponse(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={reply}
                    disabled={busy || !reponse.trim()}
                  >
                    {busy ? "Envoi…" : "Envoyer la réponse"}
                  </Button>
                  {open.statut !== "resolu" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void setStatut(open.id, "resolu")}
                    >
                      Marquer résolu
                    </Button>
                  ) : null}
                  {open.statut !== "ferme" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void setStatut(open.id, "ferme")}
                    >
                      Fermer
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-4 text-sm text-muted-foreground">
              Sélectionnez un ticket pour voir la conversation et répondre.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
