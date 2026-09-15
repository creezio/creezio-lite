#!/usr/bin/env node
/**
 * Gate — module billing admin (@creezio/admin) : webhook + réconciliation.
 *
 * Prouve, sur une DB brand réelle (better-sqlite3, migrations admin) :
 *  1. webhook Stripe signé → projections admin_billing_* (client, abonnement
 *     avec prochaine échéance `periode_fin`, facture payée, journal events) ;
 *  2. GET /billing/overview → clients joints à leur abonnement, factures,
 *     événements, stats (MRR / actifs / impayées) ;
 *  3. réconciliation ACTIVE : POST /billing/reconcile relit l'API Stripe
 *     (mock HTTP local via STRIPE_API_BASE) et resynchronise l'état réel —
 *     y compris une facture jamais reçue par webhook (webhook manqué) et un
 *     changement de statut d'abonnement ;
 *  4. sans STRIPE_API_KEY → 503 explicite (doc de branchement en hint).
 */
import http from "node:http";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";

const { adminMigrations, createBillingWebhookMount, createBillingAdminMount } =
  await import("../packages/admin/dist/index.js");
const { default: Database } = await import("better-sqlite3");

const WHSEC = "whsec_gate_admin_billing";

function makeDb() {
  const db = new Database(":memory:");
  for (const m of adminMigrations()) db.exec(m.sql);
  return db;
}

function signedReq(event) {
  const rawBody = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto
    .createHmac("sha256", WHSEC)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  return {
    method: "POST",
    rawBody,
    body: event,
    query: {},
    headers: { "stripe-signature": `t=${t},v1=${v1}` },
  };
}

const EPOCH_NEXT = Math.floor(new Date("2026-09-01T00:00:00Z").getTime() / 1000);

const EV_CUSTOMER = {
  id: "evt_gate_cus_1",
  type: "customer.created",
  data: {
    object: {
      id: "cus_gate_1",
      name: "Le Petit Marseillais",
      email: "contact@petit-marseillais.example",
    },
  },
};

const EV_SUB = {
  id: "evt_gate_sub_1",
  type: "customer.subscription.created",
  data: {
    object: {
      id: "sub_gate_1",
      customer: "cus_gate_1",
      status: "active",
      current_period_end: EPOCH_NEXT,
      items: {
        data: [
          {
            price: { nickname: "Standard", unit_amount: 4900, currency: "eur" },
          },
        ],
      },
    },
  },
};

const EV_INVOICE = {
  id: "evt_gate_inv_1",
  type: "invoice.paid",
  data: {
    object: {
      id: "in_gate_1",
      customer: "cus_gate_1",
      subscription: "sub_gate_1",
      paid: true,
      amount_paid: 4900,
      currency: "eur",
      period_start: Math.floor(new Date("2026-08-01T00:00:00Z").getTime() / 1000),
    },
  },
};

test("billing admin : webhook signé → projections + overview + réconciliation active", async () => {
  const db = makeDb();
  const webhook = createBillingWebhookMount({ webhookSecret: WHSEC });

  for (const ev of [EV_CUSTOMER, EV_SUB, EV_INVOICE]) {
    const res = await webhook.handle({ req: signedReq(ev), subPath: "stripe", db });
    assert.equal(res.status, 200, `webhook ${ev.type}`);
  }

  // 1. Projections.
  const cus = db
    .prepare(`SELECT * FROM admin_billing_customers WHERE stripe_customer_id = 'cus_gate_1'`)
    .get();
  assert.equal(cus.nom, "Le Petit Marseillais");
  const sub = db
    .prepare(`SELECT * FROM admin_billing_subscriptions WHERE stripe_subscription_id = 'sub_gate_1'`)
    .get();
  assert.equal(sub.montant_mensuel, 49);
  assert.equal(sub.statut, "active");
  assert.ok(
    String(sub.periode_fin || "").startsWith("2026-09-01"),
    `prochaine échéance projetée (periode_fin=${sub.periode_fin})`,
  );
  const inv = db
    .prepare(`SELECT * FROM admin_billing_invoices WHERE stripe_invoice_id = 'in_gate_1'`)
    .get();
  assert.equal(inv.statut, "paid");
  assert.equal(inv.montant, 49);

  // 2. Overview.
  const billing = createBillingAdminMount({});
  const ov = await billing.handle({
    req: { method: "GET", query: {}, headers: {} },
    subPath: "overview",
    db,
  });
  assert.equal(ov.status, 200);
  assert.equal(ov.body.ok, true);
  const row = ov.body.customers.find((c) => c.stripe_customer_id === "cus_gate_1");
  assert.ok(row, "client dans l'overview");
  assert.equal(row.plan, "Standard");
  assert.equal(row.montant_mensuel, 49);
  assert.equal(row.sub_statut, "active");
  assert.ok(String(row.periode_fin || "").startsWith("2026-09-01"));
  assert.equal(ov.body.invoices.length, 1);
  assert.equal(ov.body.events.length, 3);
  assert.equal(ov.body.stats.mrr, 49);
  assert.equal(ov.body.stats.abonnements_actifs, 1);
  assert.equal(ov.body.stats.factures_impayees, 0);

  // 3. Sans clé → 503 documenté.
  delete process.env.STRIPE_API_KEY;
  const noKey = await billing.handle({
    req: { method: "POST", query: {}, headers: {} },
    subPath: "reconcile",
    db,
  });
  assert.equal(noKey.status, 503);
  assert.match(noKey.body.error, /STRIPE_API_KEY/);
  assert.match(noKey.body.hint, /Dashboard Stripe/);

  // 4. Réconciliation active contre un mock de l'API Stripe : l'abonnement est
  //    passé past_due côté Stripe et une facture a été manquée par webhook.
  const mock = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    assert.match(String(req.headers.authorization), /^Bearer sk_test_mock$/);
    let data = [];
    if (url.pathname === "/v1/customers") {
      data = [EV_CUSTOMER.data.object];
    } else if (url.pathname === "/v1/subscriptions") {
      assert.equal(url.searchParams.get("status"), "all");
      data = [{ ...EV_SUB.data.object, status: "past_due" }];
    } else if (url.pathname === "/v1/invoices") {
      data = [
        EV_INVOICE.data.object,
        {
          id: "in_gate_missed",
          customer: "cus_gate_1",
          subscription: "sub_gate_1",
          status: "open",
          amount_due: 4900,
          currency: "eur",
          period_start: Math.floor(new Date("2026-09-01T00:00:00Z").getTime() / 1000),
        },
      ];
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data, has_more: false }));
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const port = mock.address().port;

  const billingLive = createBillingAdminMount({
    stripeApiKey: "sk_test_mock",
    apiBase: `http://127.0.0.1:${port}`,
  });
  const rec = await billingLive.handle({
    req: { method: "POST", query: {}, headers: {} },
    subPath: "reconcile",
    db,
  });
  mock.close();
  assert.equal(rec.status, 200, JSON.stringify(rec.body));
  assert.equal(rec.body.ok, true);
  assert.equal(rec.body.customers, 1);
  assert.equal(rec.body.subscriptions, 1);
  assert.equal(rec.body.invoices, 2);

  // L'état réel Stripe a rattrapé les projections.
  const sub2 = db
    .prepare(`SELECT statut FROM admin_billing_subscriptions WHERE stripe_subscription_id = 'sub_gate_1'`)
    .get();
  assert.equal(sub2.statut, "past_due", "statut resynchronisé depuis Stripe");
  const missed = db
    .prepare(`SELECT statut, montant FROM admin_billing_invoices WHERE stripe_invoice_id = 'in_gate_missed'`)
    .get();
  assert.ok(missed, "facture manquée par webhook récupérée par reconcile");
  assert.equal(missed.statut, "open");
  assert.equal(missed.montant, 49);
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS n FROM admin_billing_invoices`).get().n,
    2,
    "reconcile idempotent (pas de doublon in_gate_1)",
  );

  // Overview post-reconcile : l'impayé apparaît dans les stats.
  const ov2 = await billing.handle({
    req: { method: "GET", query: {}, headers: {} },
    subPath: "overview",
    db,
  });
  assert.equal(ov2.body.stats.factures_impayees, 1);
});
