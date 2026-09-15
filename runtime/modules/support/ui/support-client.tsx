"use client";

/**
 * Page /support côté serveur marque — le détenteur du serveur (ex.
 * restaurateur) ouvre des tickets et lit les réponses de l'admin de marque.
 *
 * API : /api/v1/platform/platform-support/* (mount natif @lite/support).
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, Button, Card, Input } from "@lite/shell-ui/ui/kit";

const API = "/api/v1/platform/platform-support";

type Ticket = {
  id: string;
  created_at: string;
  updated_at: string;
  sujet: string;
  statut: string;
  auteur: string | null;
  messages_count?: number;
  dernier_message?: string | null;
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

function statutVariant(statut: string): "default" | "secondary" | "danger" | "outline" {
  if (statut === "repondu") return "default";
  if (statut === "resolu" || statut === "ferme") return "secondary";
  return "danger";
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function SupportClient() {
  const selectedFromSearch=useSearchParams().get('ticket');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sujet, setSujet] = useState("");
  const [corps, setCorps] = useState("");
  const [reponse, setReponse] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(API, { cache: "no-store" });
      const j = await r.json();
      if (j?.ok) {
        setTickets(j.items || []);
        setError(null);
      } else {
        setError("Réponse inattendue du serveur");
      }
    } catch {
      setError("Support injoignable");
    } finally {
      setLoading(false);
    }
  }, []);

  const openTicket = useCallback(async (id: string) => {
    setOpenId(id);
    setMessages([]);
    try {
      const r = await fetch(`${API}/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (j?.ok) setMessages(j.messages || []);
    } catch {
      /* refresh visuel au prochain poll */
    }
  }, []);
  useEffect(()=>{if(selectedFromSearch)void openTicket(selectedFromSearch);},[selectedFromSearch,openTicket]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      void refresh();
      if (openId) void openTicket(openId);
    }, 15000);
    return () => clearInterval(t);
  }, [refresh, openId, openTicket]);

  const createTicket = useCallback(async () => {
    if (!sujet.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sujet: sujet.trim(), corps: corps.trim() }),
      });
      const j = await r.json();
      if (j?.ok) {
        setSujet("");
        setCorps("");
        await refresh();
        if (j.item?.id) await openTicket(j.item.id);
      }
    } finally {
      setBusy(false);
    }
  }, [sujet, corps, refresh, openTicket]);

  const sendMessage = useCallback(async () => {
    if (!openId || !reponse.trim()) return;
    setBusy(true);
    try {
      await fetch(`${API}/${encodeURIComponent(openId)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ corps: reponse.trim() }),
      });
      setReponse("");
      await openTicket(openId);
      await refresh();
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
    },
    [refresh],
  );

  const open = tickets.find((t) => t.id === openId) || null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Support</h1>
        <p className="text-sm text-muted-foreground">
          Une question, un problème ? Ouvrez un ticket — l'équipe vous répond
          directement ici.
        </p>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3">
          <Input
            placeholder="Sujet (ex. : impossible d'imprimer les commandes)"
            value={sujet}
            onChange={(e) => setSujet(e.target.value)}
          />
          <textarea
            className="min-h-24 w-full rounded-md border bg-transparent p-3 text-sm outline-none"
            placeholder="Décrivez le problème…"
            value={corps}
            onChange={(e) => setCorps(e.target.value)}
          />
          <div>
            <Button onClick={createTicket} disabled={busy || !sujet.trim()}>
              Ouvrir un ticket
            </Button>
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="border-destructive p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Mes tickets {loading ? "…" : `(${tickets.length})`}
          </h2>
          {tickets.length === 0 && !loading ? (
            <Card className="p-4 text-sm text-muted-foreground">
              Aucun ticket pour l'instant.
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
                {t.dernier_message || "—"}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {fmtDate(t.updated_at)} · {t.messages_count ?? 0} message(s)
              </div>
            </Card>
          ))}
        </div>

        <div>
          {open ? (
            <Card className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">{open.sujet}</h2>
                <Badge variant={statutVariant(open.statut)}>
                  {STATUT_LABEL[open.statut] || open.statut}
                </Badge>
              </div>
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-md p-2 text-sm ${
                      m.origine === "admin"
                        ? "bg-primary/10 text-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <div className="mb-1 text-[11px] text-muted-foreground">
                      {m.origine === "admin" ? "Équipe support" : "Vous"} ·{" "}
                      {fmtDate(m.created_at)}
                    </div>
                    <div className="whitespace-pre-wrap">{m.corps}</div>
                  </div>
                ))}
                {messages.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    Aucun message.
                  </div>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <textarea
                  className="min-h-16 w-full rounded-md border bg-transparent p-2 text-sm outline-none"
                  placeholder="Votre message…"
                  value={reponse}
                  onChange={(e) => setReponse(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={sendMessage}
                    disabled={busy || !reponse.trim()}
                  >
                    Envoyer
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
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-4 text-sm text-muted-foreground">
              Sélectionnez un ticket pour voir la conversation.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
