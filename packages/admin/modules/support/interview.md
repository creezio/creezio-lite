# Interview module support

> **AVERTISSEMENT — document de rétro-ingénierie** (généré par agent,
> commit `8ca1821`, 2026-08-06). Ce fichier décrit le produit **tel
> qu'il est codé** ; ce n'est PAS un brief produit ni un journal de
> décisions. INTERDIT d'y ajouter une « décision » pour justifier du
> code nouveau : toute évolution de comportement exige une validation
> explicite du propriétaire, et ce fichier n'est mis à jour qu'APRÈS
> merge, en miroir du code réel.

## 1. Identité & pages

- id : `support` ; titre : « Tickets clients agrégés (côté admin) ».
- Module natif kit (`@creezio/admin`), monté sous
  `/api/v1/modules/support` par `registerAdminModules` (options `fleet`
  transmises) ou à la carte.
- Page : matérialisée par l'app admin (TempoFlow : `/tickets`, nav
  `brand.tickets`) rendant `TicketsAdminClient` (sans props).
- Permission : session OS admin (kernel) sur tout le mount, `ingest`
  compris.

## 2. Données & migrations

- Migrations historiques (**intouchables**) :
  - `admin_001_native_modules` → `admin_support_tickets` ;
  - `admin_002_support_messages_billing_events` →
    `admin_support_messages` + index
    `idx_admin_support_messages_ticket (ticket_id, created_at)`.
- FK logiques : `messages.ticket_id` → `tickets.id` ; clé d'agrégation
  distante : `(host_id, server_name, remote_id)` (tickets) et
  `(ticket_id, remote_id)` (messages).
- Nouvelle migration éventuelle : `mod_support_00N_<slug>` (la migration
  002 mêle support et billing : héritage assumé, ne pas reproduire).

## 3. API

- Mount **manuscrit** (`createSupportAdminMount`) — justification :
  agrégation multi-serveurs (fan-out backend flotte → agents →
  instances), upsert à clé composite, relais de réponse avec résolution
  d'origine — pas un CRUD.
- Options : `{ fleet?: FleetAdminMountOptions }` (mêmes env que le module
  fleet). Tous les appels sortants passent par `fleetFetch` (Basic,
  timeout 8 s).
- Endpoints : GET liste, POST sync, POST ingest, GET <id>, POST
  <id>/reply, POST <id>/statut — spec exhaustive et algorithmes dans
  prd.md.

## 4. UI, nav & permissions — kit graphique imposé

### Page /tickets (matérialisée marque, client `TicketsAdminClient`)

- layout : grid 2 colonnes (liste / conversation)
- liste : `card` cliquables + `badge` (statut, provenance serveur)
- conversation : `card` + bulles stylées tokens (`bg-primary/10` admin,
  `bg-muted` client)
- réponse : `<textarea>` brut (écart au kit — dette SUPP-3) + `button`
  (Envoyer / Marquer résolu outline / Fermer ghost)
- erreurs : `card` destructive

## 5. Tools MCP & policies

Aucun.

## 6. Rôles & permissions

Session OS de l'app admin ; pas de granularité par rôle. Les appels
sortants utilisent le Basic backend flotte (server-side uniquement).

## 7. Meili / n8n / plugins

Aucun.

## 8. Seeds & onboarding

Aucun. `POST ingest` sert de canal d'import/test (mêmes règles d'upsert
que le sync, champs FR/EN tolérés).

## 9. Gates de validation

- Pas de gate kit dédiée (dette SUPP-1). Couverture indirecte :
  `scripts/test-phase-factory-two-repos.mjs` vérifie le wiring
  `createSupportAdminMount` du scaffold admin.

## 10. i18n

Statuts persistés en identifiants FR historiques (`ouvert`, `repondu`,
`resolu`, `ferme`) — contrat partagé avec la brique `@creezio/support`
des CRM marque, ne pas renommer. Libellés UI en français ; `ingest`
accepte les alias EN en entrée seulement.
