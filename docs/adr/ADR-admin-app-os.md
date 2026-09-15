# ADR — L'admin de marque est une app Creezio (mode admin)

Statut : **accepté** (direction produit, 2026-08).
Remplace la vision « console technique » de `docker/server-admin`.

> Note 2026-08-10 : les mentions de `vendor/creezio` ci-dessous décrivent le mécanisme de distribution de l'époque — remplacé par les packages npm ([../NPM-DISTRIBUTION.md](../NPM-DISTRIBUTION.md)). La décision (2 repos, admin dédié) reste en vigueur.

## Contexte

Chaque marque (TempoFlow, Certivan, Fidu…) a besoin d'un **admin d'entreprise** :
l'OS qui permet de gérer la société éditrice de la marque elle-même
(TempoFlow SAS) — pas seulement de piloter des containers. L'admin actuel
(`creezio server-docker admin up`, `server-admin.mjs` + `admin.html`) est une
page technique : liste d'hôtes/serveurs et boutons. Ce n'est pas le produit
voulu.

## Décision

### 1. L'admin EST une app Creezio — même OS, mode `admin`

L'app admin d'une marque est bootée par le **même** runtime que les apps
marque : `startBrandKernelHarness` / `creezio server-docker` (headless) ou
`startBrandDesktop` (desktop). Elle bénéficie nativement de **tout** l'OS :
auth multi-comptes, SQLite multi-fichier, api-kernel, MCP, assistant (chat),
tasks kanban, mails, Meili, database admin, observability, sidebar sombre +
chrome + ⌘K (`shell-ui`), pages OS matérialisées (`os-ui`).

**On ne recrée PAS une autre structure.** La seule différence est un
**mode** : le manifest/brand-spec de l'app admin porte `appMode: "admin"`
(axe distinct de `AppKind` client/server, qui reste un axe packaging). Ce
mode pilote : le jeu de modules natifs admin câblés par la factory, les
rôles par défaut, les labels. Le kernel, lui, ne branche pas différemment.

### 2. Multi-comptes, multi-rôles (pas de « owner » unique)

L'admin utilise le système de comptes/rôles/permissions du kit (le même que
les CRM marque : `@creezio/auth`, rôles libres + permissions de nav
configurables). Exemples de rôles côté admin : `direction`,
`community-manager`, `comptable`, `rh`, `support`. Chaque module admin
déclare les rôles qui y accèdent (permissions nav), rien de spécifique au
mode admin dans `@creezio/auth`.

### 3. Layout — 2 repos, admin toujours privé

- **Monorepo marque** `<brand>` : `client/` + `server/` (+ `brand-spec/`,
  `vendor/creezio/`). Jamais de `admin/` dedans.
- **Repo admin dédié** `<brand>-admin` : **privé, jamais public**. C'est un
  repo d'app Creezio complet (layout `server/` + `brand-spec/` +
  `vendor/creezio/`, sans `client/` desktop obligatoire) + la config flotte
  versionnée sans secrets (`server-admin.json`, `fleet-hosts.json`).
- La **factory crée les 2 repos** (`creezio brand apply` / `new-app` +
  `github-repos.ts`) — le repo admin est généré sur le modèle app-admin
  (modules natifs + slot modules admin métier).

### 4. Modules natifs admin (`@creezio/admin`)

Package kit `@creezio/admin` (générique, zéro domaine marque — la marque ne
fait que nommer/configurer), modules montés via `registerModuleApi` +
pages Next + nav, comme n'importe quel métier :

| Module | Rôle | Backend |
|--------|------|---------|
| `fleet` | Pilotage flotte : hôtes VPS enrôlés, serveurs (create/start/stop/update/rm), boot-status live, logs docker, ops, disque, tags registre, tokens d'enrôlement | Le service `server-admin.mjs` actuel devient le **backend flotte** (loopback, Basic) ; le module proxifie `/api/v1/modules/fleet/*` → backend. Cible : port natif TS dans `@creezio/admin` (le backend HTTP reste pour compat agents) |
| `support` | Tickets clients (détenteurs de serveurs) : liste, détail, réponse, statut | Sync pull depuis les serveurs marque (voir §5) |
| `prospection` | CRM prospection **kanban générique** : « prospects » (colonnes configurables, cartes société/contact/notes) ; la marque nomme (« restaurants ») | SQLite brand layer de l'app admin |
| `logs` | Visualisation logs de la flotte (docker logs + ops JSONL agrégés par hôte/serveur) | via backend flotte / host-agents |
| `roadmap` | Roadmap produit de la marque (jalons, statuts) | SQLite brand layer |
| `billing` | Facturation/comptabilité clients : abonnements, factures, état paiements, rapprochement **client ↔ serveur ↔ abonnement** | Stripe derrière une config marque (clé API dans l'env de l'app admin, jamais commitée). Le modèle local (`billing_customers`, `billing_subscriptions`, `billing_invoices`) est la projection ; Stripe la SoT paiement. Chaque customer référence un `hostId`/`serverName` de la flotte |

Les **modules admin métier** d'une marque s'ajoutent exactement comme les
pages métier d'un CRM marque : `registerModuleApi` + pages `server/ui/app/*`
+ nav `brand.*` dans le repo `<brand>-admin`.

### 5. Support côté serveur marque (`@creezio/support`)

Package natif kit, présent sur **tous les serveurs marque** :

- Table `support_tickets` (+ `support_messages`) en layer core, montée via
  les platform services (comme tasks/mails).
- Page OS `/support` (wrapper os-ui) : l'admin d'un serveur (ex. le
  restaurateur) ouvre un ticket, suit les réponses.
- **Transport** (implémenté) : l'admin de marque **initie tous les appels**
  (modèle flotte existant — jamais de push serveur → admin). Chemins :
  - Instance : mount natif `platform-support`
    (`/api/v1/platform/platform-support/*`, `create-brand-kernel.ts`).
  - Host-agent (Bearer) : `/agent/api/servers/:brand/:name/support[/*]` →
    relais loopback `127.0.0.1:<port>` (`proxyInstanceSupport`).
  - Backend flotte (Basic) : `/admin/api/servers/:b/:n/support[/*]` (local)
    et `/admin/api/hosts/:h/servers/:b/:n/support[/*]` (proxy agent générique).
  - App admin : module `support` (`@creezio/admin`) — `POST sync` (pull toute
    la flotte, upsert `admin_support_tickets` + `admin_support_messages`),
    `POST <id>/reply` (relais réponse : le client la voit sur `/support`),
    propagation statut best-effort.
  Pas de nouveau service, pas de nouveau canal réseau : tunnels + tokens
  agents existants.

### 5bis. Billing Stripe (implémenté — webhook)

- Endpoint `POST /api/v1/modules/billing-webhook/stripe` (app admin) — auth
  par **signature Stripe** (`stripe-signature`, HMAC-SHA256 sur corps brut,
  `verifyStripeSignature` sans dépendance SDK ; `rawBody` ajouté au contrat
  `ApiRequest` de l'api-kernel).
- Secrets : `STRIPE_WEBHOOK_SECRET` / `STRIPE_API_KEY` via env `.env`
  gitignoré de l'app admin.
- Projections idempotentes (journal `admin_billing_events`, dédup id Stripe) :
  customers / subscriptions / invoices → tables `admin_billing_*`,
  rapprochées flotte via `host_id`/`server_name` des customers.

### 6. Migration sans régression (TempoFlow)

1. Le backend flotte actuel (`creezio-server-admin`, port 18800 loopback)
   **reste en place** : c'est lui qui sert le module `fleet` (et l'ancienne
   UI `/admin` reste accessible en loopback pendant la transition).
2. L'app admin v2 (repo `tempoflow3-admin`, OS complet) tourne comme serveur
   headless en `--network host` (elle doit joindre le backend flotte + les
   boot-status loopback), port dédié.
3. `admin.tempoflow.fr` bascule vers l'app v2 quand les fonctions flotte
   sont vérifiées (hôtes visibles, update OK).
4. Les fichiers de config flotte (`server-admin.json`, `fleet-hosts.json`,
   `docker-data/`) ne bougent pas.

## Conséquences

- `docker/server-admin` n'est plus « l'admin » : c'est le **backend flotte**
  du module `fleet`. Sa doc le dit explicitement.
- La factory apprend à générer le repo admin comme app OS (`appMode: admin`)
  — gate à étendre (`test-phase-factory-two-repos.mjs`).
- Le skill `creezio-fleet-ops` documente les deux plans : backend flotte
  (inchangé) + app admin.
- `@creezio/admin` et `@creezio/support` entrent dans l'ordre de build des
  packages et dans la matrice native/métier/plugin.

## Non-buts

- Pas de dual-write : l'app admin ne duplique pas l'état flotte, elle le
  consomme.
- Pas d'implémentation Stripe complète imposée le jour 1 : le module
  `billing` pose le modèle + le rapprochement flotte, Stripe se branche par
  config marque.
- Pas de domaine marque dans `@creezio/admin` / `@creezio/support`
  (ADR-no-brand-domain-in-native-packages).
