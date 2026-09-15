# Interview module fleet-registry

> **AVERTISSEMENT — document de rétro-ingénierie** (généré par agent,
> commit `8ca1821`, 2026-08-06). Ce fichier décrit le produit **tel
> qu'il est codé** ; ce n'est PAS un brief produit ni un journal de
> décisions. INTERDIT d'y ajouter une « décision » pour justifier du
> code nouveau : toute évolution de comportement exige une validation
> explicite du propriétaire, et ce fichier n'est mis à jour qu'APRÈS
> merge, en miroir du code réel.

## 1. Identité & pages

- id : `fleet-registry` ; titre : « Registre central de la flotte (F2/F3) ».
- Module natif kit (`@creezio/admin`, `src/fleet-registry.ts`), monté sous
  `/api/v1/modules/fleet-registry` par les apps admin.
- Pas de route UI propre : la page `/flotte` des apps admin
  (`FleetAdminClient`) lit `GET servers` pour la liste. Permission =
  session OS admin, **sauf** `register`/`heartbeat` (auth machine par
  Bearer, voir §6).

## 2. Données & migrations

- Migration historique : `admin_004_fleet_registry` — **intouchable**
  (id + SQL). Tables `admin_fleet_servers` (PK `{host}/{brand}/{name}`,
  UNIQUE(host_id, brand_id, name)) et `admin_fleet_events` + index
  `idx_admin_fleet_events_server (server_id, created_at)`. Schéma complet :
  voir prd.md §Modèle de données (copie de la migration).
- FK logiques (non déclarées SQL) : `admin_fleet_events.server_id` →
  `admin_fleet_servers.id` (re-pointé lors d'une migration de row
  self-enroll ; peut être NULL pour les événements de release).
- Les colonnes `pinned_image` / `hold` / `channel` vivent ici (créées par
  `admin_004`) mais sont pilotées par le module fleet-releases — décision
  assumée : une seule row par serveur, pas de table satellite.
- Nouvelle migration éventuelle : `mod_fleet-registry_00N_<slug>` ; jamais
  renuméroter/renommer une migration appliquée ; jamais toucher les tables
  d'un autre module.

## 3. API

- Mount **manuscrit** (`createFleetRegistryMount`) — justification : deux
  plans d'auth différents (session admin vs Bearer machine), upsert avec
  dédup self-enroll, crypto (chiffrement token, hash timing-safe),
  rate-limit — hors du champ d'un `createEntityApiMount`.
- Options `FleetRegistryMountOptions` : `fleet` (config backend, mêmes env
  que le module fleet), `registerSecret` (défaut env
  `CREEZIO_FLEET_REGISTER_SECRET`), `heartbeatIntervalSeconds` (90),
  `pollIntervalSeconds` (90), `registerRatePerMinute` (10).
- Endpoints : `GET servers`, `GET events`, `POST sync`, `POST register`,
  `POST heartbeat`, `DELETE servers/<id…>` — spec exhaustive dans prd.md.
- Poller de fond : `startFleetRegistryPoller` fourni par le module,
  démarré par l'app admin (wiring marque) — passe par `api.handle()`
  (kernel), source `poller`, et déclenche le janitor fleet-releases.

## 4. UI, nav & permissions — kit graphique imposé

### Page /flotte (matérialisée par l'app admin, client `FleetAdminClient`)

- conteneurs : `card` (sections hôtes / releases / création / serveurs)
- statuts : `badge` (docker state, online/offline, inscrit, orphelin,
  hold/pin/canal)
- actions : `button` (variants outline/destructive/ghost/secondary)
- formulaires : `input` + labels (`<label>` stylé tailwind)
- polling : rafraîchissement `GET servers` toutes les 5 s ; backfill
  `POST sync` auto au premier chargement si registre vide
- Écarts constatés (dette, TODO du module fleet) : `window.prompt/confirm`,
  `<select>` brut, couleurs ad hoc.

## 5. Tools MCP & policies

Aucun.

## 6. Rôles & permissions

Trois postures d'auth distinctes — décision structurante du module :

| Endpoint | Auth | Secret |
|---|---|---|
| servers / events / sync / DELETE | session OS admin (kernel) | — |
| register | Bearer = secret **partagé** flotte | `CREEZIO_FLEET_REGISTER_SECRET` (même valeur dans le `.env` des marques) |
| heartbeat | Bearer = `serverKey` **propre au serveur** | stockée hashée `sha256:` |

- `accessToken` (consultation de l'instance par l'admin) : chiffré au repos
  AES-256-GCM (`sealIntegrationSecret`), déchiffrable par l'admin — reçu en
  clair une seule fois au register.
- `serverKey` : restituée une seule fois, jamais récupérable ensuite ;
  rotation par ré-inscription idempotente.
- Comparaisons en temps constant partout (`timingSafeEqual`).
- L'API ne restitue **jamais** `access_token_enc` / `server_key_hash`
  (assert de gate).

## 7. Meili / n8n / plugins

Aucun.

## 8. Seeds & onboarding

Aucun — alimentation par sync (backfill), poller (fond) et register
(auto-inscription au boot des serveurs marque, client kit
`startFleetHeartbeat` de `@creezio/app-runtime`).

## 9. Gates de validation

- `scripts/test-phase-admin-fleet-registry.mjs` : migration admin_004,
  POST sync (mock backend Basic, upsert idempotent), dédup self-enroll
  (migration local → hôte enrôlé, événements re-pointés), statut online
  dérivé (4 cas), poller via kernel (source=poller), non-fuite des
  colonnes sensibles.
- `scripts/test-phase-fleet-heartbeat.mjs` : register 401/OK, tokens
  chiffrés/hashés, rotation (ancienne clé refusée), heartbeat OK/401,
  rate-limit 429, client kit `startFleetHeartbeat` (no-op sans env, état
  0600 sans clair, ré-inscription auto sur 401, best-effort absolu admin
  down), mount `fleet-access`, forward env `--profile prod` (factory).

## 10. i18n

Messages serveur et libellés d'événements en français ; noms de colonnes
et statuts techniques en anglais (`online` dérivé, `source`,
`docker_state`) — conventions du package.
