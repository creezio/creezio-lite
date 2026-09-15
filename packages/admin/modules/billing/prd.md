# Module billing — facturation Stripe (webhook + admin)

## Vision

La facturation de la marque **projetée en local** dans la brand.db de
l'app admin : les webhooks Stripe signés (plan passif) et une
réconciliation active par l'API Stripe (rattrapage) alimentent des tables
`admin_billing_*` ; l'admin voit MRR, abonnements, factures, événements,
et **rapproche chaque client Stripe d'un serveur de la flotte**
(`host_id`/`server_name`). Aucune dépendance au SDK `stripe` : signature
vérifiée localement, API appelée en HTTP nu.

Le module couvre 4 mounts enregistrés par `registerAdminModules` :
`billing-webhook`, `billing` (overview + reconcile), `billing-customers`
et `billing-subscriptions` (CRUD de rapprochement).

## Utilisateurs & parcours

- **Stripe** (machine) : POSTe les webhooks signés sur
  `/api/v1/modules/billing-webhook/stripe`.
- **Opérateur admin** : ouvre `/billing` → stats (MRR, abonnements
  actifs, impayés), tableau clients + abonnement + prochaine échéance +
  serveur rapproché, factures, journal d'événements ; bouton
  « Resynchroniser Stripe » (réconciliation active) ; édite le
  rapprochement client ↔ serveur via les CRUD `billing-customers` /
  `billing-subscriptions`.

## Capacités (fonctionnel)

- Webhook Stripe signé (HMAC-SHA256, tolérance horodatage), idempotent
  (dédup par id d'événement), journalisé.
- Projections : customers, subscriptions (avec prochaine échéance),
  invoices.
- Vue d'ensemble agrégée (stats + jointures).
- Réconciliation active : relit customers/subscriptions/invoices via
  l'API Stripe et resynchronise les projections (webhooks manqués,
  démarrage à froid).
- CRUD manuel des clients/abonnements (rapprochement flotte).

## Modèle de données

Migration `admin_001_native_modules` :

```sql
CREATE TABLE IF NOT EXISTS admin_billing_customers (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  nom TEXT NOT NULL,
  email TEXT,
  -- rapprochement flotte : quel serveur appartient à ce client
  host_id TEXT,
  server_name TEXT,
  stripe_customer_id TEXT
);

CREATE TABLE IF NOT EXISTS admin_billing_subscriptions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  plan TEXT,
  montant_mensuel REAL,
  devise TEXT DEFAULT 'EUR',
  statut TEXT NOT NULL DEFAULT 'active',
  stripe_subscription_id TEXT
);

CREATE TABLE IF NOT EXISTS admin_billing_invoices (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  subscription_id TEXT,
  periode TEXT,
  montant REAL,
  devise TEXT DEFAULT 'EUR',
  statut TEXT NOT NULL DEFAULT 'draft',
  stripe_invoice_id TEXT
);
```

Migration `admin_002_support_messages_billing_events` (part billing) :

```sql
CREATE TABLE IF NOT EXISTS admin_billing_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  stripe_event_id TEXT UNIQUE,
  type TEXT NOT NULL,
  payload TEXT
);
```

Migration `admin_003_billing_periode_fin` :

```sql
ALTER TABLE admin_billing_subscriptions ADD COLUMN periode_fin TEXT;
```

## API

### `billing-webhook` — `createBillingWebhookMount(opts?)`

`dbLayer: "brand"`. Une seule route : `POST /api/v1/modules/
billing-webhook/stripe` (tout autre sous-chemin/méthode → 404). **Auth =
signature Stripe** (pas de session : Stripe appelle directement).

1. `503` sans secret (`opts.webhookSecret` puis env
   `STRIPE_WEBHOOK_SECRET`).
2. Vérification `verifyStripeSignature(rawBody, header, secret,
   tolerance=300 s)` : header `stripe-signature: t=…,v1=…`, schéma
   officiel `HMAC-SHA256(secret, "{t}.{rawBody}")`, `|now - t| ≤
   tolérance`, plusieurs `v1` acceptés, comparaison temps constant →
   `400 { error: "signature invalide" }` sinon.
3. Journal idempotent : `stripe_event_id` déjà vu →
   `200 { ok, duplicate:true }` sans re-projection ; sinon insert
   (`payload` = rawBody tronqué à 100 000 caractères).
4. Projections par type :
   - `customer.created` / `customer.updated` → customers ;
   - `customer.subscription.*` → subscriptions
     (`customer.subscription.deleted` force `statut='canceled'`) ;
   - `invoice.*` → invoices avec statut :
     `invoice.paid` ou `obj.paid === true` → `paid` ;
     `invoice.payment_failed` → `payment_failed` ; sinon `obj.status`
     (défaut `open`).
5. Réponse `200 { ok, received: type }`.

### `billing` — `createBillingAdminMount(opts?)`

`dbLayer: "brand"`, session OS admin.

| Méthode | Chemin | Comportement |
|---|---|---|
| GET | `overview` | `{ ok, customers, invoices, events, stats }` : customers LEFT JOIN leur **dernier** abonnement (sous-requête `ORDER BY updated_at DESC LIMIT 1`), tri nom NOCASE ; invoices (LIMIT 200, + `client_nom`) ; events (LIMIT 100, sans payload) ; stats : `mrr` = SUM(montant_mensuel) des abonnements `active`/`trialing`, `abonnements_actifs` (même filtre), `factures_impayees` = COUNT statut IN (`open`,`payment_failed`,`uncollectible`) |
| POST | `reconcile` | Réconciliation ACTIVE : clé `opts.stripeApiKey` puis env `STRIPE_API_KEY` — absente → `503` avec `hint` de branchement ; base `opts.apiBase` puis env `STRIPE_API_BASE` puis `https://api.stripe.com` (override = mock de test) ; liste en parallèle `/v1/customers`, `/v1/subscriptions?status=all`, `/v1/invoices` (pagination `starting_after`, `limit=100`, cap 10 pages, timeout 20 s/appel) puis projette tout (subscription `status==="canceled"` → forceCanceled) → `{ ok, source, customers, subscriptions, invoices, at }` ; erreur Stripe → `502` |

### `billing-customers` / `billing-subscriptions` — CRUD

`createAdminCrudMount(...)` : mêmes routes que prospects/roadmap (GET
liste `ORDER BY created_at DESC` — pas de colonne position —, POST,
GET/PUT/PATCH/DELETE `<id>`). Colonnes écrivables :

- customers : `nom`, `email`, `host_id`, `server_name`,
  `stripe_customer_id` ;
- subscriptions : `customer_id`, `plan`, `montant_mensuel`, `devise`,
  `statut`, `stripe_subscription_id`.

## UI

Client `BillingAdminClient` (`ui/billing-admin-client.tsx`), exporté par
`@creezio/admin/ui`, matérialisé par l'app admin (TempoFlow : `/billing`).
Props `labels?: { title?, subtitle?, serverLabel? }` (défauts
« Facturation », sous-titre générique, « Serveur »).

- 3 cartes stats : MRR (format devise fr-FR), abonnements actifs,
  factures impayées (rouge si > 0).
- Tableau « Clients & abonnements » : client (nom + email/id Stripe),
  serveur rapproché (`Badge outline` ou « non rapproché »), plan, montant
  `/mois`, statut (labels FR : Actif, Essai, Impayé, Résilié, Incomplet),
  prochaine échéance (`periode_fin`).
- Tableau « Factures » : client, période (`YYYY-MM`), montant, statut
  (Payée, En attente, Échouée, Irrécouvrable, Annulée, Brouillon), id
  facture Stripe.
- Liste « Événements Stripe reçus » (type mono + id + date).
- Bouton « Resynchroniser Stripe » → `POST reconcile`, résumé ou erreur
  (+ hint).

Composants kit : `Badge`, `Button`, `Card` (`@creezio/shell-ui/ui/kit`) ;
tableaux en `<table>` HTML brut (écart au kit — dette BILL-3).

## Tools MCP

Aucun.

## Logique métier non triviale

- **Projections partagées** webhook (passif) / réconciliation (active) —
  mêmes fonctions, mêmes règles :
  - `projectStripeCustomer` : upsert par `stripe_customer_id` ; `nom` =
    `name || email || id` ;
  - `projectStripeSubscription` : upsert par `stripe_subscription_id` ;
    client inconnu → **customer placeholder auto-créé** (nom = id
    Stripe) ; `plan` = `price.nickname || price.id` du premier item ;
    `montant_mensuel` = `unit_amount / 100` ; `devise` upper ; `statut` =
    `obj.status` (ou `canceled` forcé) ; `periode_fin` =
    `current_period_end` **au niveau subscription (API historique) ou du
    premier item (API Stripe 2025+)**, epoch s → ISO ; en update,
    `periode_fin = COALESCE(nouvelle, existante)` (jamais effacée par un
    événement sans échéance) ;
  - `projectStripeInvoice` : upsert par `stripe_invoice_id` ; `montant` =
    `amount_paid` si > 0 sinon `amount_due`, /100 ; `periode` =
    `period_start` → `YYYY-MM` ; liens `customer_id`/`subscription_id`
    résolus par ids Stripe (vides si inconnus).
- **Signature webhook maison** (`verifyStripeSignature`, exportée) : pas
  de SDK, parsing k=v multiple, tolérance ±300 s, `timingSafeEqual`.
- **MRR naïf assumé** : somme brute des `montant_mensuel` actifs/trialing
  (pas de normalisation annuel→mensuel — dette BILL-2).

## Seeds & données initiales

Aucun.

## Cas limites & règles de gestion

- Webhook rejoué par Stripe → `duplicate:true`, aucune double projection.
- Événement sans id → projeté quand même mais non journalisé (pas de
  dédup possible).
- Secret webhook absent → 503 (Stripe retentera) ; clé API absente → 503
  avec hint d'exploitation (Dashboard → Développeurs → Clés API, `.env`
  gitignoré, skill creezio-fleet-ops §5).
- `subscription.deleted` force `canceled` même si l'objet Stripe porte un
  autre statut.
- Facture jamais reçue par webhook : rattrapée par `reconcile` (cas testé
  par la gate).
- Rapprochement client ↔ serveur : purement manuel (PUT
  billing-customers `<id>` avec `host_id`/`server_name`) — aucune
  auto-détection.
- Pagination Stripe cap 10 pages × 100 : au-delà de 1000 objets par
  collection, la réconciliation est partielle (dette BILL-4).

## Hors périmètre

- Création/édition d'objets **dans** Stripe (checkout, portail client,
  changements de plan) : le module est en lecture/projection seulement.
- Relances d'impayés, dunning, e-mails.
- Le naming (« Restaurant »…) : labels de l'app admin.
