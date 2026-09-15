"use client";

/**
 * Module Billing (côté admin) — section « Facturation / Abonnements ».
 *
 * Rend les projections `admin_billing_*` (alimentées par les webhooks Stripe
 * signés) : clients + abonnement (montant, statut, prochaine échéance),
 * factures, rapprochement client ↔ serveur, événements Stripe reçus.
 * Bouton « Resynchroniser Stripe » = réconciliation ACTIVE via STRIPE_API_KEY
 * (POST /api/v1/modules/billing/reconcile).
 *
 * Générique : le naming (« restaurant », « client »…) vient des labels marque.
 */

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "@creezio/shell-ui/ui/kit";

const API = "/api/v1/modules/billing";

export type BillingAdminLabels = {
  /** Titre de la page. Défaut « Facturation ». */
  title?: string;
  /** Sous-titre. */
  subtitle?: string;
  /** Nom d'un serveur client (ex. « Restaurant »). Défaut « Serveur ». */
  serverLabel?: string;
};

type CustomerRow = {
  id: string;
  nom: string;
  email: string | null;
  host_id: string | null;
  server_name: string | null;
  stripe_customer_id: string | null;
  updated_at: string;
  plan: string | null;
  montant_mensuel: number | null;
  sub_devise: string | null;
  sub_statut: string | null;
  periode_fin: string | null;
};

type InvoiceRow = {
  id: string;
  created_at: string;
  periode: string | null;
  montant: number | null;
  devise: string | null;
  statut: string;
  stripe_invoice_id: string | null;
  client_nom: string | null;
};

type EventRow = {
  id: string;
  created_at: string;
  stripe_event_id: string | null;
  type: string;
};

type Stats = {
  mrr: number;
  abonnements_actifs: number;
  factures_impayees: number;
};

const SUB_STATUT_LABEL: Record<string, string> = {
  active: "Actif",
  trialing: "Essai",
  past_due: "Impayé",
  canceled: "Résilié",
  unpaid: "Impayé",
  incomplete: "Incomplet",
};

const INVOICE_STATUT_LABEL: Record<string, string> = {
  paid: "Payée",
  open: "En attente",
  payment_failed: "Échouée",
  uncollectible: "Irrécouvrable",
  void: "Annulée",
  draft: "Brouillon",
};

function subVariant(
  statut: string | null,
): "default" | "secondary" | "destructive" | "outline" {
  if (statut === "active" || statut === "trialing") return "default";
  if (statut === "canceled") return "secondary";
  if (!statut) return "outline";
  return "destructive";
}

function invoiceVariant(
  statut: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (statut === "paid") return "default";
  if (statut === "void" || statut === "draft") return "secondary";
  return "destructive";
}

function fmtMontant(montant: number | null, devise?: string | null): string {
  if (montant == null) return "—";
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: devise || "EUR",
    }).format(montant);
  } catch {
    return `${montant} ${devise || ""}`;
  }
}

function fmtDate(iso: string | null, withTime = false): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      dateStyle: "short",
      ...(withTime ? { timeStyle: "short" as const } : {}),
    });
  } catch {
    return iso;
  }
}

export function BillingAdminClient({
  labels,
}: {
  labels?: BillingAdminLabels;
}) {
  const title = labels?.title || "Facturation";
  const subtitle =
    labels?.subtitle ||
    "Abonnements, factures et rapprochement client ↔ serveur (Stripe).";
  const serverLabel = labels?.serverLabel || "Serveur";

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileInfo, setReconcileInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${API}/overview`, { cache: "no-store" });
      const j = await r.json();
      if (j?.ok) {
        setCustomers(j.customers || []);
        setInvoices(j.invoices || []);
        setEvents(j.events || []);
        setStats(j.stats || null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reconcile = useCallback(async () => {
    setReconciling(true);
    setError(null);
    setReconcileInfo(null);
    try {
      const r = await fetch(`${API}/reconcile`, { method: "POST" });
      const j = await r.json();
      if (j?.ok) {
        setReconcileInfo(
          `Stripe resynchronisé : ${j.customers} client(s), ${j.subscriptions} abonnement(s), ${j.invoices} facture(s).`,
        );
        await refresh();
      } else {
        setError(
          [j?.error, j?.hint].filter(Boolean).join(" — ") ||
            "réconciliation KO",
        );
      }
    } catch {
      setError("réconciliation injoignable");
    } finally {
      setReconciling(false);
    }
  }, [refresh]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {reconcileInfo ? (
            <span className="text-xs text-muted-foreground">
              {reconcileInfo}
            </span>
          ) : null}
          <Button size="sm" onClick={reconcile} disabled={reconciling}>
            {reconciling ? "Resynchronisation…" : "Resynchroniser Stripe"}
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border-destructive p-3 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">
            Revenu mensuel (MRR)
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {stats ? fmtMontant(stats.mrr, "EUR") : "—"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">
            Abonnements actifs
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {stats ? stats.abonnements_actifs : "—"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">
            Factures impayées
          </div>
          <div
            className={`mt-1 text-2xl font-semibold ${
              stats && stats.factures_impayees > 0 ? "text-destructive" : ""
            }`}
          >
            {stats ? stats.factures_impayees : "—"}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-base font-semibold">
          Clients &amp; abonnements
        </h2>
        {loading ? (
          <div className="text-sm text-muted-foreground">Chargement…</div>
        ) : customers.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Aucun client facturé — les clients arrivent via les webhooks
            Stripe ou la resynchronisation.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">{serverLabel}</th>
                  <th className="py-2 pr-3">Plan</th>
                  <th className="py-2 pr-3">Montant</th>
                  <th className="py-2 pr-3">Statut</th>
                  <th className="py-2">Prochaine échéance</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{c.nom}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.email || c.stripe_customer_id || "—"}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      {c.server_name ? (
                        <Badge variant="outline">
                          {c.server_name}
                          {c.host_id && c.host_id !== "local"
                            ? ` @ ${c.host_id}`
                            : ""}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          non rapproché
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">{c.plan || "—"}</td>
                    <td className="py-2 pr-3">
                      {c.montant_mensuel != null
                        ? `${fmtMontant(c.montant_mensuel, c.sub_devise)}/mois`
                        : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant={subVariant(c.sub_statut)}>
                        {c.sub_statut
                          ? SUB_STATUT_LABEL[c.sub_statut] || c.sub_statut
                          : "Sans abonnement"}
                      </Badge>
                    </td>
                    <td className="py-2">{fmtDate(c.periode_fin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-base font-semibold">Factures</h2>
        {invoices.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Aucune facture projetée.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">Période</th>
                  <th className="py-2 pr-3">Montant</th>
                  <th className="py-2 pr-3">Statut</th>
                  <th className="py-2">Facture Stripe</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">
                      {i.client_nom || "—"}
                    </td>
                    <td className="py-2 pr-3">{i.periode || "—"}</td>
                    <td className="py-2 pr-3">
                      {fmtMontant(i.montant, i.devise)}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant={invoiceVariant(i.statut)}>
                        {INVOICE_STATUT_LABEL[i.statut] || i.statut}
                      </Badge>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {i.stripe_invoice_id || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-base font-semibold">
          Événements Stripe reçus
        </h2>
        {events.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Aucun événement webhook reçu.
          </div>
        ) : (
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {events.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs"
              >
                <span className="font-mono">{e.type}</span>
                <span className="text-muted-foreground">
                  {e.stripe_event_id || "—"} · {fmtDate(e.created_at, true)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
