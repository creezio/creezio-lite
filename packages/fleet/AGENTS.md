# AGENTS.md — @creezio/fleet

## Mission

Backend flotte typé (P2.b) : gestes Docker Engine API, registre
`servers.json`, stacks compose par instance, updates pull/rollback, agent
hôte, backend admin flotte, proxy registre pull-only, **protocole
agent↔backend versionné**. Ex `packages/observability/fleet-collector/*.mjs`
(portage isofonctionnel 0.15.0).

**Ce code pilote la flotte réelle en prod** (app admin + host-agent sur les
VPS). Toute régression casse le pilotage d'instances vivantes : portage /
refactor à isofonctionnalité stricte, vérification empirique flotte après
déploiement (voir skill `creezio-fleet-ops`).

## Frontières

- **Node pur** : aucune dépendance runtime (ni `@creezio/*`, ni npm) — l'agent
  hôte doit rester léger et l'image se construit sans `npm ci`. Ne JAMAIS
  ajouter de dépendance runtime sans repenser le staging d'image
  (`stageFleetImageContext`, factory).
- **0 vocabulaire marque** (gate `no-brand-vocab` scanne `src/`).
- Mêmes endpoints / formats d'état disque / noms de conteneurs et d'images
  que les `.mjs` historiques — les consommateurs (admin app module fleet,
  scripts d'enrôlement, agents déployés) ne doivent rien voir changer.

## Protocole agent↔backend (`src/protocol.ts`)

- Header `x-creezio-fleet-protocol` porté dans les DEUX sens
  (server-admin↔host-agent) + boucle pull (agent-updates → app admin).
- v identique → ok ; header absent → **refus fail-closed** depuis 0.19.0
  (`FLEET_PROTOCOL_ACCEPT_MISSING=false` — dual-accept 0.15→0.18 terminé,
  versions réelles vérifiées via l'API flotte : tous les composants déployés
  annoncent v1) ; v différente → refus explicite message actionnable (jamais
  silencieux).
- Pas de bump v2 au passage strict : le format filaire n'a pas changé.
  L'app admin pose aussi le header sur les réponses du mount
  `fleet-releases` (`@creezio/admin` dépend de `@creezio/fleet`).

## Points d'entrée

- `src/index.ts` — barrel (protocol, types, docker, server-lib,
  server-admin-client, instance-stack, agent-updates, registry-pull-proxy).
- `src/server-admin-client.ts` — client typé du backend flotte (T4) consommé
  par `@creezio/admin` (imports directs) : `fleetBackendFetch`,
  `fetchFleetBackendServers`, `verifyFleetHostCredential`, résolution env
  `CREEZIO_FLEET_BACKEND_URL`/`_BASIC`. Transport HTTP Basic loopback
  conservé (backend = container séparé, seul détenteur du socket Docker) ;
  cette surface Basic ne porte PAS le header protocole (v1 réservé
  agent↔backend).
- `src/server-admin.ts` / `src/host-agent.ts` — `startServerAdmin()` /
  `startHostAgent()` (sous-chemins exports dédiés).
- `src/bin/*-main.ts` — CMD des images Docker
  (`node_modules/@creezio/fleet/dist/bin/*-main.js`).
- `public/admin.html` — UI admin mono-fichier (servie sur `/admin`).

## Wrappers de compat (historique)

RETIRÉS en 0.19.0 : les 7 wrappers `.mjs` de
`packages/observability/fleet-collector/` (+ le bin npm
`creezio-server-admin`) ont été supprimés — tous les consommateurs (CLI
factory, gates, images) pointent directement sur `packages/fleet/dist`.
`server.mjs` / `ops-api.mjs` / `env.mjs` (collector télémétrie)
restent la SoT observability, hors périmètre fleet.

## Modifier sans casser

- `updateServer` : ne pas toucher l'ordre pull → (backup opt-in) → stop →
  rm → recreate → health → rollback auto ; refus stack fail-closed AVANT
  recreate (`isStackUpdateRefused`). Le hook optionnel `onStep` (suivi
  persisté) ne doit JAMAIS pouvoir casser l'update (déjà try/catché dans
  `log`).
- `update-status-store` : le suivi update-status (host-agent + plan local
  server-admin) est PERSISTÉ (T8) — journal JSON atomique par process dans
  le répertoire d'état existant (`host-agent-updates.json` à côté du state
  file agent, `server-admin-updates.json` dans le docker-data admin),
  reload au boot (résolution via `servers.json`, flag additif
  `agentRestarted`), TTL 24 h sur les entrées terminées
  (`DEFAULT_UPDATE_STATUS_TTL_MS`). Protocole v1 strict : `lastStep` /
  `agentRestarted` sont additifs, ne pas changer les statuts existants
  (`running|done|error`) ni retirer un champ. Toute transition d'entrée
  doit repasser par `set()`/`save()` sinon elle n'est pas persistée.
- `instance-stack` : politique `resolveStackUpdatePolicy` (préserver le
  sidecar cloudflared, refuser tout update qui casserait un hostname public).
  `hostPort` persisté (`recordedHostPort` / `resolveReusableHostPort`) —
  2ᵉ update = même port loopback. Fichiers stack 600 via `priv-io.ts`
  (`sudo -n` / wrapper), fail-closed.
- `agent-tunnel` (T7) : le container cloudflared DÉDIÉ agent
  (`creezio-agent-tunnel`) est provisionné par `creezio server-docker
  enroll` / `agent up` (factory) — le watch d'ici ne fait QUE redémarrer
  un container existant (backoff borné, miroir de `cloudflared-respawn.ts`
  host-runtime : ne pas faire diverger les défauts sans raison). Jamais
  d'appel API Cloudflare dans ce module (pas de POST `cfd_tunnel`) ; le
  token du connecteur vit dans `docker-data/agent-tunnel.env` (600),
  jamais dans `host-agent.json` ni les logs. Champ `agentTunnel` du
  health : additif (protocole v1 intact). Pas de kill-switch env.
  `agentUrl` (URL dédiée) est persistée par la factory + 
  `POST /admin/api/hosts/agent-url` (auth agentToken) — l'admin ne
  sonde plus une URL nested partagée stale. `fleet-hosts.json` runtime
  root:root 600 : le CLI tente `sudo -n` puis ce POST (le container
  écrit) — jamais chmod/chown manuel.
- `server-admin-client` : tout changement de route/format côté
  `server-admin.ts` (`/admin/api/servers`, `/admin/api/hosts/verify`,
  `POST /admin/api/hosts/agent-url`) doit suivre dans le client typé —
  les modules admin (`fleet-registry`, `fleet-releases`) n'ont plus de
  fetch artisanal (T4).
- Gates : `test-phase-server-docker` (contenu server-lib/server-admin),
  `test-phase-instance-stack`, `test-phase-stack-update-preserve`,
  `test-phase-fleet-agent`, `test-phase-fleet-update-status-persist`,
  `test-phase-fleet-releases`, `test-phase-registry-pull-proxy`,
  `test-phase-agent-tunnel` (T7 : politique + watch + contrats source) —
  via `packages/fleet/dist` (build requis) ou source TS.
- Images : tout renommage de `dist/bin/*` doit suivre dans les Dockerfiles
  (`docker/server-admin`, `docker/host-agent`) ET `stageFleetImageContext`
  (factory).

## Tests

```bash
npm run build -w @creezio/fleet
node --test scripts/test-phase-server-docker.mjs scripts/test-phase-instance-stack.mjs scripts/test-phase-stack-update-preserve.mjs scripts/test-phase-fleet-agent.mjs
```
