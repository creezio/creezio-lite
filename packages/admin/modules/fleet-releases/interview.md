# Interview module fleet-releases

> **AVERTISSEMENT — document de rétro-ingénierie** (généré par agent,
> commit `8ca1821`, 2026-08-06). Ce fichier décrit le produit **tel
> qu'il est codé** ; ce n'est PAS un brief produit ni un journal de
> décisions. INTERDIT d'y ajouter une « décision » pour justifier du
> code nouveau : toute évolution de comportement exige une validation
> explicite du propriétaire, et ce fichier n'est mis à jour qu'APRÈS
> merge, en miroir du code réel.

## 1. Identité & pages

- id : `fleet-releases` ; titre : « Updates en pull + rollout piloté (F5/F6) ».
- Module natif kit (`@creezio/admin`, `src/fleet-releases.ts`), monté sous
  `/api/v1/modules/fleet-releases` par les apps admin.
- Pas de route UI propre : section « Releases » et boutons rollout par
  serveur dans la page `/flotte` des apps admin (`FleetAdminClient`).
- Permission : session OS admin pour le plan releases/rollout ; Bearer
  machine `hostId:agentToken` pour le plan agents ; `POST maintenance`
  sans auth (janitor idempotent et inoffensif).

## 2. Données & migrations

- Migration historique : `admin_005_fleet_releases` — **intouchable**.
  Tables : `admin_fleet_releases` (UNIQUE(brand_id, tag, variant)),
  `admin_fleet_update_reports` (UNIQUE(release_id, server_id), index
  `(release_id, status)`), `admin_fleet_download_slots` (PK lease_id,
  index `(release_id, expires_at)`). Schéma complet : prd.md (copie de la
  migration).
- FK logiques : `reports.release_id` / `slots.release_id` →
  `admin_fleet_releases.id` ; `reports.server_id` / `slots.server_id` →
  `admin_fleet_servers.id` (module fleet-registry).
- Cas cross-module assumé et tracé : `PUT servers/<id>/rollout` écrit les
  colonnes `pinned_image`/`hold`/`channel` de `admin_fleet_servers` —
  colonnes créées par `admin_004` (module fleet-registry) précisément pour
  ce module ; toute évolution de ces colonnes = tâche du module
  fleet-registry.
- Nouvelle migration éventuelle : `mod_fleet-releases_00N_<slug>`.

## 3. API

- Mount **manuscrit** (`createFleetReleasesMount`) — justification : deux
  plans d'auth, sémaphore à leases, upsert idempotents spécifiques,
  transitions d'état avec effets de bord (révocation de leases) — pas un
  CRUD EntitySpec.
- Options `FleetReleasesMountOptions` : `fleet` (backend pour la vérif
  credentials), `verifyFleetCredential` (injectable, tests),
  `maxDownloadSlots` (défaut 5, env `CREEZIO_FLEET_DOWNLOAD_SLOTS`),
  `slotTtlSeconds` (défaut 900), `pollIntervalSeconds` annoncé aux agents
  (défaut 300), `autoPauseFailures` (défaut 2, env
  `CREEZIO_FLEET_AUTO_PAUSE_FAILURES`), `nowMs` (horloge injectable).
- Endpoints exhaustifs : voir prd.md §API (agents : next/slots/report ;
  admin : releases CRUD + rollout par serveur ; maintenance).
- Exports purs testables : `fleetWaveBucket`, `fleetWaveIncludes`,
  `fleetImageRefWithDigest`, `fleetImageMatchesTarget`,
  `computeFleetUpdateDirectives`, `purgeExpiredFleetSlots`,
  `autoPauseFleetReleases`, `createBackendFleetCredentialVerifier`.

## 4. UI, nav & permissions — kit graphique imposé

### Section « Releases » de /flotte (client `FleetAdminClient`)

- conteneur : `card`
- statuts : `badge` (status coloré, vague %, compteurs de rapports)
- actions : `button` (Démarrer/Promouvoir/Pause/Terminer/Reprendre/STOP
  destructive/Supprimer ghost)
- saisies % et image : `window.prompt` (écart au kit — dette FLEET-2 du
  module fleet, partagée)

### Boutons rollout par serveur

- `button` outline : Hold/Unhold, Pin…, → canary/→ stable
- `badge` : hold (rouge), pin (violet), canal ≠ stable (bleu)

## 5. Tools MCP & policies

Aucun.

## 6. Rôles & permissions

- Plan admin (CRUD releases, rollout serveur) : session OS admin — même
  posture que les autres modules admin.
- Plan agents : Bearer `hostId:agentToken`, credential d'enrôlement de
  l'hôte (SoT `fleet-hosts.json` du backend) ; vérification déléguée
  `POST /admin/api/hosts/verify` (Basic) + cache 60 s / négatif 15 s ;
  hint hostId incohérent → 401.
- `POST maintenance` : volontairement sans auth (idempotent, aucune
  donnée exposée, appelé par le poller interne via `api.handle`).

## 7. Meili / n8n / plugins

Aucun.

## 8. Seeds & onboarding

Aucun. Entrée des données : `creezio server-docker publish --release`
(`declareFleetRelease`) déclare la release en `draft` (image + digest +
variante + canal), idempotent.

## 9. Gates de validation

- `scripts/test-phase-fleet-releases.mjs` (F5) : migration admin_005,
  directives filtrées (rolling ∧ channel ∧ ¬hold ∧ pin prioritaire ∧
  vague, skip si à jour), auth agents (401 credential invalide / hostId
  incohérent), sémaphore (N slots, position/retryAfter, idempotence,
  lease expirée purgée avec horloge injectée, DELETE libère), report
  upserté + événement, boucle agent complète (mock updateServer : done,
  rolled_back, mutex manuel), publish --release idempotent.
- `scripts/test-phase-fleet-rollout.mjs` (F6) : kill-switch
  (aborted/paused → plus de directives + leases révoquées, re-rolling →
  directives), vagues monotones, auto-pause (seuil, événement, slots
  purgés, idempotent), POST maintenance, poller → maintenance
  (désactivable), présence UI (Démarrer/Promouvoir/Pause/STOP,
  hold/pin/canal dans fleet-admin-client.tsx).

## 10. i18n

Messages d'erreur serveur et libellés UI en français ; statuts techniques
en anglais (`draft`/`rolling`/`paused`/`done`/`aborted`,
`done`/`failed`/`rolled_back`) — contrat machine avec les agents, ne pas
traduire.
