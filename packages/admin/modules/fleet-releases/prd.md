# Module fleet-releases — updates en pull & rollout piloté

## Vision

Déployer une version sur N serveurs marque **sans geste par serveur** et
**sans push admin → agent** (F5), avec un rollout **piloté** (F6) : canary
par vagues monotones, pause/reprise, kill-switch, garde-fou d'auto-pause.
L'admin déclare des releases (`creezio server-docker publish --release`
→ status `draft`) ; les agents hôtes **pollent** ce module, prennent un
slot de téléchargement (sémaphore à lease TTL), tirent l'image (par digest
si disponible) via le registre pull-only (F4), appliquent l'update via leur
`updateServer` local (backup/recreate/rollback intacts) puis POSTent un
rapport. Le geste manuel existant (`POST /agent/api/…/update`) reste
disponible.

## Utilisateurs & parcours

- **Opérateur admin** (`/flotte`, section « Releases ») : voit les releases
  et leurs agrégats (✓ done / ✗ failed+rolled_back / téléchargements
  actifs) ; démarre un rollout (canary %), promeut par vagues, met en
  pause/reprend, kill-switch STOP (aborted), termine (done), supprime
  (draft/aborted) ; par serveur : hold / pin / bascule de canal.
- **Agent hôte** (`@creezio/fleet` host-agent, machine) : boucle
  `GET next` → `POST slots` → pull → update local → `DELETE slots/<lease>`
  → `POST report`, toutes les ~5 min.
- **Poller de fond de l'app admin** : appelle `POST maintenance` (janitor)
  à chaque cycle.

## Capacités (fonctionnel)

- CRUD releases (idempotent par `(brand_id, tag, variant)`).
- Directives d'update par hôte : hold exclu, pin prioritaire, sinon
  release `rolling` filtrée marque ∧ canal ∧ variante ∧ vague.
- Sémaphore de téléchargement par release (slots, lease TTL, file
  d'attente avec retry hint).
- Rapports d'update upsertés par `(release, serveur)` + journal
  d'événements.
- Cycle de vie : `draft → rolling → done`, `paused` (kill-switch doux),
  `aborted` (kill-switch définitif) — toute sortie de `rolling` révoque
  les leases.
- Auto-pause après ≥ N échecs (défaut 2).

## Modèle de données

Migration `admin_005_fleet_releases` (`ADMIN_SCHEMA_005_SQL`,
`src/fleet-releases.ts`) — copie exacte :

```sql
CREATE TABLE IF NOT EXISTS admin_fleet_releases (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  image TEXT NOT NULL,              -- référence pullable (registry.{zone}/… F4)
  digest TEXT,                      -- sha256:… → pull par digest si présent
  variant TEXT NOT NULL DEFAULT 'base',
  channel TEXT NOT NULL DEFAULT 'stable',
  status TEXT NOT NULL DEFAULT 'draft', -- draft|rolling|paused|done|aborted
  wave_pct INTEGER NOT NULL DEFAULT 0,  -- 0-100 : part de la flotte ciblée
  UNIQUE(brand_id, tag, variant)
);

CREATE TABLE IF NOT EXISTS admin_fleet_update_reports (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  release_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  host_id TEXT,
  status TEXT NOT NULL,             -- done|failed|rolled_back
  detail TEXT,
  UNIQUE(release_id, server_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_fleet_update_reports_release
  ON admin_fleet_update_reports (release_id, status);

CREATE TABLE IF NOT EXISTS admin_fleet_download_slots (
  lease_id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  host_id TEXT,
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_fleet_download_slots_release
  ON admin_fleet_download_slots (release_id, expires_at);
```

Le module lit/écrit aussi `admin_fleet_servers` (module fleet-registry) :
lecture pour les directives, écriture des colonnes `pinned_image` / `hold`
/ `channel` via `PUT servers/<id>/rollout`.

## API

Mount : `createFleetReleasesMount(opts?: FleetReleasesMountOptions)` —
`dbLayer: "brand"`, monté sous `/api/v1/modules/fleet-releases`.

### Plan agents — Bearer `hostId:agentToken`

Credential = celui émis à l'enrôlement de l'hôte (`fleet-hosts.json` du
backend flotte, SoT). Vérification déléguée au backend
(`POST /admin/api/hosts/verify`, Basic) via
`createBackendFleetCredentialVerifier` avec cache mémoire (positif 60 s,
négatif 15 s) ; verifier injectable pour les tests. Le `hostId` est extrait
du token (`avant le premier ":"`) ; si un hint (`?hostId=` ou body) est
fourni et ne correspond pas → 401 (anti-confusion inter-hôtes).

| Méthode | Chemin | Comportement |
|---|---|---|
| GET | `next?hostId=<id>` | 400 sans hostId ; 401 si auth KO ; sinon `{ ok, updates: FleetUpdateDirective[], pollIntervalSeconds }` (défaut 300) |
| POST | `slots` | body `{ releaseId, serverId }` requis (400) ; purge des leases expirées ; lease déjà active pour ce serveur → renvoyée telle quelle (idempotence des retries) ; sinon si `COUNT(slots release) >= max` (défaut 5, option `maxDownloadSlots` puis env `CREEZIO_FLEET_DOWNLOAD_SLOTS`) → `{ ok, granted:false, position, retryAfterSeconds: min(30×position, 300) }` ; sinon lease créée `{ ok, granted:true, leaseId, ttlSeconds (défaut 900), expiresAt }` |
| DELETE | `slots/<leaseId>` | libère la lease → `{ ok, released }` |
| POST | `report` | body `{ releaseId, serverId, status ∈ done\|failed\|rolled_back, detail? }` (400 sinon ; detail tronqué à 4000) ; **upsert** par (release, serveur) avec `host_id` de l'auth ; événement `update_done` (done) ou `update_failed` (failed/rolled_back) |

### Maintenance (janitor F6) — sans session

| Méthode | Chemin | Comportement |
|---|---|---|
| POST | `maintenance` | `purgeExpiredFleetSlots` + `autoPauseFleetReleases` → `{ ok, purgedSlots, autoPaused: string[] }` — idempotent, appelé par `startFleetRegistryPoller` à chaque cycle |

### Plan session admin (UI /flotte)

| Méthode | Chemin | Comportement |
|---|---|---|
| GET | `releases` | releases (created_at DESC) + agrégats sous-requêtes : `reports_done`, `reports_failed`, `reports_rolled_back`, `active_slots` |
| POST | `releases` | `{ brandId, tag, image }` requis (400) ; `status` défaut `draft` (validé contre draft/rolling/paused/done/aborted) ; `variant` défaut `base`, `channel` défaut `stable`, `wavePct` clamp 0-100, `digest?` ; **idempotence publish** : même (brand, tag, variant) → UPDATE image/digest et `200 { updated:true }`, sinon INSERT `201` + événement `release_created` |
| PUT/PATCH | `releases/<id>` | patch partiel `status` (validé) / `wavePct` (clamp) / `channel` / `digest` ; 404 si inconnu ; si `status` changé : événement `release_status` **et si nouveau status ≠ `rolling` → DELETE de toutes les leases de la release** (kill-switch immédiat) |
| DELETE | `releases/<id>` | 404 si absente ; **409** si status ∉ {draft, aborted} ; sinon delete release + ses slots |
| PUT/PATCH | `servers/<id…>/rollout` | patch partiel `pinnedImage` (null = retirer), `hold` (bool→0/1), `channel` sur `admin_fleet_servers` ; 404 si serveur inconnu ; événement `rollout_updated` (payload JSON tronqué 500) |

## UI

Section « Releases » + boutons par serveur de la page `/flotte`
(`FleetAdminClient`) :

- par release : badge status coloré (rolling vert, paused ambre, aborted
  rouge, done bleu, draft gris), badge « vague N% » (rolling/paused),
  compteurs `✓ done ✗ failed+rolled_back · N téléchargement(s)` ;
- actions selon status : draft → « Démarrer… » (prompt % canary →
  `PUT { status: rolling, wavePct }`) ; rolling → « Promouvoir… » (prompt
  nouveau %), « Pause », « Terminer » (done) ; paused → « Reprendre »
  (re-rolling) ; rolling|paused → « STOP » (confirm kill-switch →
  aborted) ; draft|aborted → « Supprimer » ;
- par serveur (si `registryId`) : « Hold/Unhold », « Pin… » (prompt image,
  vide = retirer), « → canary / → stable » (bascule de canal) ; badges
  `hold` / `pin` / canal.

Composants kit : `Badge`, `Button`, `Card`, `Input`
(`@creezio/shell-ui/ui/kit`).

## Tools MCP

Aucun.

## Logique métier non triviale

- **Vague stable et monotone** : `fleetWaveBucket(serverId) =
  readUInt32BE(sha256(serverId)[0..3]) % 100` ; inclusion si
  `bucket < clamp(wave_pct, 0, 100)`. Le bucket ne dépend que de
  `server_id` → un serveur inclus à N % reste inclus à tout M ≥ N (une
  promotion n'exclut jamais un serveur déjà servi).
- **Directives** (`computeFleetUpdateDirectives(db, hostId)`) — pour chaque
  serveur non orphelin de l'hôte :
  1. `hold` → aucun update, quoi qu'il arrive ;
  2. `pinned_image` → cible prioritaire (reason `pin`, sans digest ni
     releaseId) si l'image courante ne matche pas déjà ;
  3. sinon première release `rolling` (created_at DESC) telle que
     `brand_id` égal ∧ `channel` égal (serveur défaut `stable`) ∧
     `variant` égal (défaut `base` des deux côtés) ∧ vague inclusive ;
  4. cible identique à l'image courante (`fleetImageMatchesTarget`) →
     pas de directive.
- **Comparaison digest-aware** (`fleetImageMatchesTarget`) : à jour si
  `current === target` OU `current === repo@digest`
  (`fleetImageRefWithDigest` : le repo est l'image sans tag — un `:` avant
  le dernier `/` est un port de registre, pas un tag).
- **Auto-pause** (`autoPauseFleetReleases`) : pour chaque release
  `rolling`, si `COUNT(reports failed|rolled_back) ≥ seuil`
  (option `autoPauseFailures`, sinon env
  `CREEZIO_FLEET_AUTO_PAUSE_FAILURES`, sinon 2) → status `paused`
  (UPDATE conditionné `AND status='rolling'` → idempotent), leases
  supprimées, événement `release_auto_paused`
  (`<id> — N échec(s) ≥ seuil M`).
- **Horloge injectable** (`opts.nowMs`) pour tester l'expiration des
  leases.

## Seeds & données initiales

Aucun. Les releases sont déclarées par `publish --release`
(`declareFleetRelease`, `packages/factory` — POST releases, draft,
idempotent).

## Cas limites & règles de gestion

- Sortie de `rolling` (paused/done/aborted, manuelle ou auto-pause) →
  leases révoquées **immédiatement** ; les agents cessent au poll suivant
  (aucun canal de push).
- Serveurs déjà mis à jour lors d'un abort : laissés tels quels
  (pin/rollback manuels si besoin) — assumé, message UI explicite.
- Slot : re-POST du même (release, serveur) → même lease (idempotence des
  retries agent) ; lease expirée → purgée à chaque geste slot et par le
  janitor.
- File d'attente slots : `position = active - max + 1`,
  `retryAfterSeconds = min(30 × position, 300)`.
- Suppression restreinte aux releases `draft`/`aborted` (409 sinon) — on ne
  supprime pas l'historique d'un rollout servi.
- Rapport upserté : un serveur qui échoue puis réussit ne compte qu'une
  fois (le dernier statut gagne) ; l'auto-pause compte les statuts
  **courants**, pas l'historique.
- Verifier credentials : cache négatif court (15 s) — un token révoqué au
  backend est refusé au plus tard 60 s après.

## Hors périmètre

- Boucle agent (`runAgentUpdateCycle`, mutex avec update manuel, pull par
  digest, backup/recreate/rollback) : SoT
  `packages/fleet/src/agent-updates.ts` (couverte par
  la même gate releases).
- Registre d'images pull-only (F4) et `publish` : `packages/factory`
  (`server-docker-cli`).
- Le registre des serveurs lui-même : module
  [fleet-registry](../fleet-registry/prd.md).
