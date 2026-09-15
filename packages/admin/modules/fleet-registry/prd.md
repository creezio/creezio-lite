# Module fleet-registry — DB centrale de la flotte

## Vision

Matérialiser la flotte de serveurs marque dans la **brand.db de l'app
admin** : une table `admin_fleet_servers` = **vue matérialisée** (les JSON
`servers.json` / `fleet-hosts.json` du backend flotte restent la SoT des
gestes Docker). La liste `/flotte` devient une lecture DB instantanée avec
un statut `online` **dérivé** (jamais stocké), et les serveurs marque
s'auto-inscrivent au boot (F3) — plus aucun geste opérateur pour voir une
instance apparaître.

## Utilisateurs & parcours

- **Opérateur admin** : ouvre `/flotte` → liste lue dans le registre
  (badges online/inscrit, heartbeat/poll en tooltip) ; bouton
  « Synchroniser » (backfill) ; retrait d'une row obsolète.
- **Serveur marque** (machine) : au boot, `startFleetHeartbeat` (kit
  `@creezio/app-runtime`) fait `POST register` avec le secret partagé puis
  `POST heartbeat` toutes les ~90 s avec sa `serverKey`.
- **Poller de fond de l'app admin** : toutes les 90 s, upsert du registre
  depuis le backend flotte (couvre serveurs arrêtés et instances sans
  heartbeat) + janitor du module fleet-releases.

## Capacités (fonctionnel)

- Registre persistant de tous les serveurs `{host}/{brand}/{name}` avec
  statut matérialisé (version, image, docker_state, health, boot headline,
  disque) et provenance (`source` : sync | poller | register).
- Journal d'événements flotte (`admin_fleet_events`) : registered, rotated,
  removed, release_created, release_status, release_auto_paused,
  rollout_updated, update_done, update_failed…
- Backfill manuel (`POST sync`) et périodique (poller).
- Auto-inscription sécurisée + heartbeat (tokens chiffrés/hachés, jamais en
  clair au repos, jamais restitués par l'API).
- Dédup self-enroll : un même serveur vu `local` puis via un hôte enrôlé ne
  produit qu'UNE row.

## Modèle de données

Migration `admin_004_fleet_registry` (`ADMIN_SCHEMA_004_SQL`,
`src/fleet-registry.ts`) — copie exacte :

```sql
CREATE TABLE IF NOT EXISTS admin_fleet_servers (
  id TEXT PRIMARY KEY,              -- "{host_id}/{brand_id}/{name}"
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- identité
  host_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  name TEXT NOT NULL,
  container_name TEXT,
  port INTEGER,
  tunnel_slug TEXT,
  server_url TEXT,
  variant TEXT,
  orphan INTEGER NOT NULL DEFAULT 0,
  -- statut matérialisé
  version TEXT,
  image TEXT,
  docker_state TEXT,
  health TEXT,
  boot_headline TEXT,
  disk_bytes INTEGER,
  last_heartbeat_at TEXT,
  last_polled_at TEXT,
  source TEXT NOT NULL DEFAULT 'poller',
  -- auto-inscription (F3)
  access_token_enc TEXT,
  server_key_hash TEXT,
  registered_at TEXT,
  -- pilotage rollout (F5/F6)
  pinned_image TEXT,
  hold INTEGER NOT NULL DEFAULT 0,
  channel TEXT NOT NULL DEFAULT 'stable',
  UNIQUE(host_id, brand_id, name)
);

CREATE TABLE IF NOT EXISTS admin_fleet_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  server_id TEXT,
  kind TEXT NOT NULL,               -- registered, rotated, heartbeat_lost, update_done, update_failed…
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_fleet_events_server
  ON admin_fleet_events (server_id, created_at);
```

Notes : `id = fleetServerId(hostId, brandId, name)` = concaténation
`{host}/{brand}/{name}` ; les colonnes rollout (`pinned_image`, `hold`,
`channel`) appartiennent à cette table mais sont **écrites** par le module
fleet-releases (`PUT servers/<id>/rollout`).

## API

Mount : `createFleetRegistryMount(opts?: FleetRegistryMountOptions)` —
`dbLayer: "brand"`, monté sous `/api/v1/modules/fleet-registry`.

| Méthode | Chemin | Auth | Comportement |
|---|---|---|---|
| GET | `servers` | session admin | Toutes les rows (tri host_id, brand_id, name) passées par `publicRow` : colonnes sensibles retirées, + `registered` (bool, dérivé de `server_key_hash`) + `online` (dérivé) ; réponse `{ ok, servers, heartbeatIntervalSeconds }` |
| GET | `events` | session admin | 200 derniers événements (created_at DESC) |
| POST | `sync` | session admin | Backfill : `GET {backend}/admin/api/servers` → upsert de chaque serveur ; body `{ source?: "poller" }` (toute autre valeur → `"sync"`) ; 502 si backend KO ; réponse `{ ok, upserted, source }` |
| POST | `register` | Bearer = `CREEZIO_FLEET_REGISTER_SECRET` | Auto-inscription serveur (détail ci-dessous) |
| POST | `heartbeat` | Bearer = `serverKey` du serveur | Battement (détail ci-dessous) |
| DELETE | `servers/<id…>` | session admin | Supprime la row (id URL-décodé, contient des `/`) ; événement `removed` ; 404 si absente |

### POST register (F3)

1. `503` si aucun secret configuré (option `registerSecret` puis env
   `CREEZIO_FLEET_REGISTER_SECRET`).
2. Rate-limit **par IP** (`x-forwarded-for`, premier élément, sinon
   `"local"`) : défaut 10 essais/min → `429 { error: "rate_limited" }`.
3. Bearer comparé au secret en **temps constant** (`timingSafeEqual`,
   longueur vérifiée avant) → `401` sinon.
4. Body : `brandId`, `name`, `accessToken` **requis** (400 sinon) ;
   `hostId` défaut `"local"` ; `containerName`, `serverUrl`, `variant`,
   `version` optionnels.
5. Upsert du statut (source `register`), puis :
   - `accessToken` stocké **chiffré** AES-256-GCM
     (`sealIntegrationSecret`, `@creezio/integrations`, clé dérivée
     `AUTH_SECRET`) — reçu en clair UNE seule fois ;
   - `serverKey` = 24 octets aléatoires hex, **restituée une seule fois**
     dans la réponse, stockée en `sha256:<hex>` ;
   - `registered_at`, `last_heartbeat_at`, `updated_at` = now.
6. Ré-inscription (row avec `registered_at` déjà posé) = **rotation**
   idempotente des deux tokens ; événement `rotated`, sinon `registered`
   (détail `version=… host=…`).
7. Réponse : `{ ok, serverId, serverKey, heartbeatIntervalSeconds, rotation }`.

### POST heartbeat (F3)

1. Body `serverId` requis (400).
2. `401` si row absente, pas de `server_key_hash`, Bearer absent ou hash
   Bearer ≠ hash stocké (comparaison temps constant, mismatch de longueur
   absorbé par un `timingSafeEqual(a,a)` factice).
3. Met à jour `last_heartbeat_at` + `updated_at`, et **seulement si
   présents dans le body** : `version`, `health`, `bootHeadline`
   (→ `boot_headline`, null accepté), `diskBytes` (→ `disk_bytes`,
   `Number(...) || null`).
4. Réponse : `{ ok, heartbeatIntervalSeconds }` (le serveur cale son
   intervalle dessus).

### Fonctions exportées (server-side)

- `upsertFleetServerStatus(db, input)` → id ; dédup self-enroll (voir
  Logique).
- `deriveFleetOnline(row, opts?)` → bool.
- `syncFleetRegistryFromBackend(db, opts, source)` → `{ ok, upserted, error? }`.
- `startFleetRegistryPoller({ api, intervalMs?, releasesMaintenance?, onError? })`
  → `{ stop, tick }`.
- `recordFleetEvent(db, serverId|null, kind, detail?)` (best-effort,
  n'échoue jamais).
- `createRateLimiter(max=10, windowMs=60000)` ; `fleetServerId(h,b,n)`.

## UI

Pas de page propre : consommé par `FleetAdminClient`
(`ui/fleet-admin-client.tsx`, page `/flotte` des apps admin) :

- liste des serveurs = `GET fleet-registry/servers` (rafraîchie toutes les
  5 s) ; premier passage sur registre vide → `POST sync` immédiat puis
  relecture ;
- badges par serveur : état docker, `online`/`offline` (tooltip
  heartbeat/poll), `inscrit` (registered), `orphelin`, `hold`, `pin`,
  canal ≠ stable ;
- bouton « Synchroniser » → `POST sync` ;
- les gestes (start/stop/update/logs/ops/rm) restent sur le proxy `fleet`.

Composants kit : `Badge`, `Button`, `Card`, `Input`
(`@creezio/shell-ui/ui/kit`).

## Tools MCP

Aucun.

## Logique métier non triviale

- **Statut online dérivé, jamais stocké** (`deriveFleetOnline`) :
  - heartbeat frais : `now - last_heartbeat_at < 3 × heartbeatIntervalSeconds`
    (défaut 90 s → fenêtre 270 s) → online ;
  - sinon poll frais (`now - last_polled_at < 3 × pollIntervalSeconds`) **ET**
    `docker_state === "running"` → online (un serveur arrêté vu par le
    poller n'est pas online) ;
  - sinon offline.
- **Dédup self-enroll** (`upsertFleetServerStatus`) — même règle que
  `collectServersView` du backend : un hôte enrôlé peut être CE VPS, le
  serveur `{brand}/{name}` ne doit exister qu'une fois, rattaché à l'hôte
  **enrôlé** :
  - statut arrivant pour un hôte enrôlé alors qu'une row `local` existe →
    la row est **migrée** (nouvel id, `admin_fleet_events.server_id`
    re-pointés, identité registered/tokens conservée) ;
  - statut `local` arrivant alors qu'une row hôte-enrôlé existe → appliqué
    à la row enrôlée (statut seulement, jamais de doublon `local`).
- **Upsert partiel** : seules les clés `!== undefined` de l'input écrasent
  les colonnes (un heartbeat sans `version` ne l'efface pas) ;
  `last_polled_at`, `source`, `updated_at` toujours rafraîchis.
- **Mapping backend → statut** (`backendServerToStatus`) : `hostId` défaut
  `local` ; `tunnel_slug` extrait de `env.CREEZIO_TUNNEL_SLUG` ;
  `server_url` calculé `http://127.0.0.1:{port}/` seulement en local ;
  `boot_headline` depuis `bootStatus.headline` ; serveurs sans
  brandId/name ignorés.
- **Poller** (`startFleetRegistryPoller`) : interval défaut 90 000 ms
  (spec 60-120 s) ; passe par `api.handle()` (kernel direct, pas de HTTP
  local ni de session) ; premier tick différé de 5 s (laisser le backend
  écouter) ; timers `unref()` (ne retient jamais le process) ; best-effort
  (backend down → `onError`, rien ne casse) ; à chaque cycle, appelle aussi
  `POST /api/v1/modules/fleet-releases/maintenance` (janitor F6) sauf
  `releasesMaintenance: false` — un 404 (module absent) est silencieux.
- **API ne fuit jamais les secrets** : `publicRow` retire
  `access_token_enc` et `server_key_hash` de toute réponse.

## Seeds & données initiales

Aucun seed. La table se remplit par sync/poller/register.

## Cas limites & règles de gestion

- `POST sync` avec backend down → 502 `{ error: "backend flotte → <status>…" }`
  (la DB garde son dernier état — la liste `/flotte` reste servie).
- Register sans secret côté admin → 503 avec message d'exploitation
  explicite.
- Rotation : l'ancienne `serverKey` est immédiatement invalide (le hash est
  remplacé) — le client kit se ré-inscrit automatiquement sur 401.
- Rate-limit register : fenêtre glissante en mémoire (non persistée, par
  process).
- `DELETE servers/<id>` : l'id contient des `/` — le mount décode tout le
  suffixe après `servers/`.
- `disk_bytes` : `Number()` non fini → null (jamais de NaN en DB).

## Hors périmètre

- Les gestes Docker (SoT backend flotte / fleet-collector).
- Le client heartbeat embarqué dans les serveurs marque
  (`startFleetHeartbeat`, `createFleetAccessMount`, fichier d'état
  `{dataDir}/{brand}-fleet.json`) : `packages/app-runtime/src/fleet-heartbeat.ts`
  (prouvé par la même gate heartbeat).
- Les directives d'update et le pilotage rollout : module
  [fleet-releases](../fleet-releases/prd.md) (qui lit/écrit les colonnes
  `pinned_image`/`hold`/`channel` de cette table via son propre endpoint).
