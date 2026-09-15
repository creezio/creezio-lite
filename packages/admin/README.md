# @creezio/admin

Modules natifs des apps admin de marque (« l'OS qui gère l'entreprise de la
marque ») — voir [ADR-admin-app-os](../../docs/adr/ADR-admin-app-os.md).
Câblé en prod dans l'app admin TempoFlow (repo `tempoflow3-admin`,
`admin.tempoflow.fr`).

| Module | Route | Rôle |
|--------|-------|------|
| `fleet` | `/api/v1/modules/fleet/*` | Pilotage flotte (proxy vers le backend flotte @creezio/fleet) |
| `fleet-registry` | `/api/v1/modules/fleet-registry/*` | DB centrale de la flotte (`admin_fleet_servers`) — sync, poller, auto-inscription + heartbeat des serveurs |
| `fleet-releases` | `/api/v1/modules/fleet-releases/*` | Updates en **pull** : releases, directives par serveur, slots de téléchargement, rapports |
| `prospects` | `/api/v1/modules/prospects` | CRM prospection kanban générique |
| `roadmap` | `/api/v1/modules/roadmap` | Roadmap produit |
| `support` | `/api/v1/modules/support` | Tickets clients agrégés (sync flotte) |
| `billing-customers` / `billing-subscriptions` | `/api/v1/modules/billing-*` | Facturation : rapprochement client ↔ serveur ↔ abonnement (Stripe via config marque) |
| `billing-webhook` | `/api/v1/modules/billing-webhook/stripe` | Webhook Stripe signé (`STRIPE_WEBHOOK_SECRET`) → projections `admin_billing_*` |
| `billing` | `/api/v1/modules/billing/overview\|reconcile` | Section Facturation (stats, clients+abonnements, factures, événements) + réconciliation active API Stripe (`STRIPE_API_KEY`, `STRIPE_API_BASE` pour les tests) |

## Usage (app admin)

```ts
import { adminMigrations, registerAdminModules } from "@creezio/admin";

await startBrandKernelHarness({
  brandId: "tempoflowadmin",
  brandMigrations: adminMigrations(),
  registerModuleApi: (api) => registerAdminModules(api),
  // …
});
```

Migrations : `admin_001` (modules natifs) → `admin_002` (support/Stripe) →
`admin_003` (échéances billing) → `admin_004` (fleet-registry) →
`admin_005` (fleet-releases). Tables `admin_*` dans la brand.db de l'app
admin.

UI : `import { FleetAdminClient, TicketsAdminClient, ProspectsKanbanClient, BillingAdminClient } from "@creezio/admin/ui"`
dans les pages Next de l'app admin (labels/naming côté marque).

Env backend flotte : `CREEZIO_FLEET_BACKEND_URL` (défaut
`http://127.0.0.1:18800`), `CREEZIO_FLEET_BACKEND_BASIC` (`user:pass`) —
résolus par le client typé de `@creezio/fleet` (`server-admin-client`, T4) :
les modules `fleet-registry` / `fleet-releases` importent directement
`fetchFleetBackendServers` / `verifyFleetHostCredential` au lieu d'un fetch
HTTP artisanal (le transport Basic loopback demeure, backend = container
séparé).

## Permissions par module (P4)

Chaque mount déclare sa permission (`ADMIN_MODULE_PERMISSIONS` : `nav.fleet`,
`nav.support`, `nav.prospects`, `nav.roadmap`, `nav.clients`, `nav.billing`,
`nav.landing`) — gardée fail-closed par `authorizeModuleAccess`
(app-runtime) : un compte sans la permission reçoit **403**, l'owner passe
toujours. Les routes machine (webhook Stripe signé, `register`/`heartbeat`
serveurs, `next`/`slots`/`report`/`maintenance` agents) gardent leur propre
auth, sans permission session.

L'attribution par compte passe par `@creezio/access-control` :

```ts
// server/src/electron/brand-platform-bindings.ts (généré par la factory)
import { configureAccessControl } from "@creezio/access-control";
import { adminAccessControlPreset } from "@creezio/admin";

export function applyBrandPlatformBindings(): void {
  configureAccessControl(adminAccessControlPreset());
}
```

Politique de migration **sans lockout** : le rôle `collaborator` reçoit tous
les modules par défaut — l'owner restreint ensuite compte par compte
(OS → Admin → Rôles & accès → Comptes) ou pour tout le rôle (matrice).
Bootstrap sans UI : `creezio server-docker access <nom> --brand-root <admin>
--user <email> --reset --grant nav.billing,nav.clients`.

Côté pages, `AdminModuleGate` (export `@creezio/admin/ui`) affiche un état
explicite « Accès refusé » en accès URL direct sans la permission (la
sidebar kit filtre déjà les entrées de nav sur `me.permissions`).

## Registre central de flotte (`fleet-registry`, F2/F3)

La table `admin_fleet_servers` est une **vue matérialisée** : les JSON
(`servers.json`, `fleet-hosts.json`) restent la SoT des gestes Docker.
Trois sources d'alimentation :

- `POST /api/v1/modules/fleet-registry/sync` (session admin) — backfill
  depuis le backend flotte ;
- `startFleetRegistryPoller` (60-120 s) — couvre serveurs arrêtés et
  instances legacy, et appelle le janitor releases (`POST maintenance`) ;
- **auto-inscription** des serveurs marque au boot :
  `POST register` (Bearer = secret partagé `CREEZIO_FLEET_REGISTER_SECRET`)
  puis `POST heartbeat` ~90 s (Bearer = `serverKey` propre au serveur,
  stocké **hashé** ; `accessToken` chiffré AES-GCM via
  `@creezio/integrations`).

Le statut `online` est **dérivé** de `last_heartbeat_at`/`last_polled_at`
(< 3× l'intervalle), jamais stocké.

## Updates en pull + rollout piloté (`fleet-releases`, F5/F6)

L'admin déclare des releases (`creezio server-docker publish --release`
→ status `draft`) ; les agents hôtes **pollent** — aucun push admin→agent :

1. `GET next?hostId=…` (Bearer `hostId:agentToken`, vérifié via le backend
   `POST /admin/api/hosts/verify` + cache) → directives par serveur :
   release `rolling` ∧ channel ∧ ¬hold ∧ pin prioritaire ∧ vague
   (`hash(server_id) mod 100 < wave_pct`, bucket stable par serveur) ;
2. slot de téléchargement (sémaphore, lease TTL 15 min) → pull par digest
   si présent → `updateServer` local (backup/recreate/rollback intacts) ;
3. `POST report` (`done|failed|rolled_back`, upsert par release+serveur).

Cycle : `draft` → `rolling` (canary `wave_pct`) → promotion par vagues
**monotones** → `done` ; `paused` (kill-switch doux) / `aborted`
(kill-switch définitif) — toute sortie de `rolling` révoque les leases.
Garde-fou `autoPauseFleetReleases` : ≥ N échecs (défaut 2,
`CREEZIO_FLEET_AUTO_PAUSE_FAILURES`) → auto-pause + événement
`release_auto_paused`. Par serveur : `PUT servers/<id>/rollout`
(pin/hold/channel), UI `/flotte` section « Releases ».

Gestes opérateur pas-à-pas : skill
[creezio-fleet-ops](../../.cursor/skills/creezio-fleet-ops/SKILL.md).

## Tests

```bash
node --test scripts/test-phase-admin-fleet-registry.mjs
node --test scripts/test-phase-fleet-releases.mjs
node --test scripts/test-phase-fleet-rollout.mjs
node --test scripts/test-phase-admin-billing.mjs
```

## Liens

- [AGENTS.md](./AGENTS.md)
- [docs/FILES.md](./docs/FILES.md)
- [../../docs/agents/CREATE-ADMIN-MODULE.md](../../docs/agents/CREATE-ADMIN-MODULE.md)
