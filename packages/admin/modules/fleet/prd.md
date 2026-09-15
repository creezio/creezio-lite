# Module fleet — proxy backend flotte

## Vision

Donner à l'app admin de marque un accès HTTP authentifié au **backend flotte**
(backend @creezio/fleet, loopback `:18800`, Basic) sans jamais exposer les
credentials Basic au navigateur. Le module est un **proxy pur, server-side** :
la logique flotte (Docker, hôtes, updates, logs, ops) reste dans
`packages/observability/fleet-collector` — interdiction absolue de la
recréer ici (AGENTS.md du package).

## Utilisateurs & parcours

- **Opérateur admin de la marque** (session OS de l'app admin) : ouvre la
  page `/flotte` de son app admin ; toutes les actions (créer un serveur,
  start/stop/update, logs docker, ops JSONL, boot-status, disque, enrôler un
  VPS, retirer un hôte) passent par ce proxy.
- **Autres modules admin server-side** (`support`, `fleet-registry`,
  `fleet-releases`) : consomment le même backend via le helper exporté
  `fleetFetch` (jamais via HTTP local).

## Capacités (fonctionnel)

- Relayer toute requête `/api/v1/modules/fleet/<sub>` vers
  `{backend}/admin/api/<sub>` avec l'`Authorization: Basic` interne.
- Conserver méthode HTTP, query string (y compris paramètres multiples) et
  corps JSON (hors GET).
- Restituer le statut HTTP du backend et son corps JSON tel quel.
- Échouer proprement : 503 si le Basic n'est pas configuré, 502 si le
  backend est injoignable ou timeout.

## Modèle de données

Aucun. Le module ne possède aucune table : les JSON du backend flotte
(`servers.json`, `fleet-hosts.json`) restent la SoT des gestes Docker.

## API

Mount : `createFleetAdminMount(opts?: FleetAdminMountOptions)` —
`dbLayer: "brand"`, enregistré sous `/api/v1/modules/fleet`.

| Méthode | Chemin | Comportement |
|---|---|---|
| * (toutes) | `/api/v1/modules/fleet/<sub>` | Proxy vers `{backendUrl}/admin/api/<sub>{?query}` |

Comportement détaillé du handler (une seule route attrape-tout) :

1. Résolution config : `backendUrl` = option, sinon env
   `CREEZIO_FLEET_BACKEND_URL`, sinon `http://127.0.0.1:18800` (trailing `/`
   retiré). `basic` = option, sinon env `CREEZIO_FLEET_BACKEND_BASIC`
   (format `user:pass`).
2. Sans `basic` → `503 { ok:false, error: "backend flotte non configuré
   (CREEZIO_FLEET_BACKEND_BASIC requis)" }`.
3. Query string reconstruite depuis `req.query` (tableaux → `append`
   multiple, valeurs nulles ignorées).
4. `fetch` avec `Authorization: Basic base64(user:pass)` ; si
   `req.body !== undefined` et méthode ≠ GET : header
   `Content-Type: application/json` + corps `JSON.stringify(req.body)`.
5. Timeout via `AbortController` : `opts.timeoutMs` défaut **30 000 ms**.
6. Réponse : `{ status: res.status, body: res.json() }` ; si le corps
   backend n'est pas du JSON → `{ ok:false, error: "réponse backend non
   JSON" }` (statut backend conservé).
7. Exception réseau/abort → `502 { ok:false, error: "backend flotte
   injoignable: <message>" }`.

Le mount est protégé par la **session OS** de l'app admin (comme tout
`/api/v1/modules/*`) ; le Basic ne transite jamais côté client.

### Helper exporté `fleetFetch`

`fleetFetch(opts, method, subPath, body?, timeoutMs = 8000)` — appel Basic
direct vers `{backendUrl}{subPath}` (chemin **absolu**, ex.
`/admin/api/servers`), retourne `{ status, json | null }`. Sans Basic →
`{ status: 503, json: { ok:false, error:"fleet_basic_missing" } }`. Utilisé
par `support` (sync/reply/statut), `fleet-registry` (sync/poller) et
`fleet-releases` (vérification credentials agents).

## UI

Le module n'a pas de page propre : il est le plan « gestes » de la page
`/flotte` rendue par `FleetAdminClient` (`@creezio/admin/ui`,
`ui/fleet-admin-client.tsx`), documentée en détail dans les interviews
[fleet-registry](../fleet-registry/interview.md) et
[fleet-releases](../fleet-releases/interview.md). Sous-chemins backend
consommés par ce client via le proxy :

- `GET health` (ping docker + `brandRoots`), `GET disk`, `GET hosts` ;
- `POST hosts/enroll-token` (`{ label }` → `enrollToken` affiché une fois),
  `DELETE hosts/<hostId>` ;
- `POST servers` (`{ brandRoot, name, port? }` — création locale) ;
- par serveur (préfixe `servers/<brandId>/<name>` en local,
  `hosts/<hostId>/servers/<brandId>/<name>` sur hôte enrôlé) :
  `POST start|stop|update` (update : `{ image }`, 202 + poll),
  `GET update-status`, `GET logs?tail=200`, `GET ops?limit=100`,
  `GET boot-status`, `DELETE ?purgeData=0|1`.

## Tools MCP

Aucun.

## Logique métier non triviale

- **Séparation liste/gestes (F2)** : depuis le registre matérialisé, la
  *liste* des serveurs est lue dans `fleet-registry` (DB) ; ce proxy ne sert
  plus que les *gestes* et les données non matérialisées (hôtes, disque,
  logs, ops, boot-status).
- **Complétion de tag côté client** : dans les prompts d'update, une saisie
  sans `/` ni `:` est complétée avec le repo de l'image courante
  (`repo:tag`).

## Seeds & données initiales

Aucun.

## Cas limites & règles de gestion

- Backend down → 502 explicite, jamais d'exception non gérée (l'UI affiche
  le message et continue).
- Basic absent (app admin mal configurée) → 503 explicite dès la première
  requête.
- Réponse non JSON du backend → corps normalisé `{ ok:false }` en gardant
  le statut d'origine (permet de distinguer 401 Basic invalide, 404…).
- Le timeout proxy (30 s) est volontairement > au timeout `fleetFetch`
  (8 s) : les gestes docker (create/update) peuvent être longs.

## Hors périmètre

- Toute logique flotte (création container, backup/rollback, tunnels) :
  SoT = `packages/observability/fleet-collector`.
- La matérialisation DB des serveurs : module [fleet-registry](../fleet-registry/prd.md).
- Les updates en pull : module [fleet-releases](../fleet-releases/prd.md).
- Le naming marque (« restaurants »…) : config de l'app admin consommatrice.
