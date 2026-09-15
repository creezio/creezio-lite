# @creezio/fleet

Backend flotte **typé** du kit (P2.b) — ex `packages/observability/fleet-collector/*.mjs`.

C'est la brique qui pilote les serveurs marque headless (`docker/server`) :

| Module | Rôle |
|---|---|
| `docker` | Client Docker Engine API via socket Unix (ping, list/inspect/create/start/stop/rm, logs démuxés, pull avec auth) |
| `server-lib` | Logique partagée admin/agent : registre `servers.json`, allocation ports, collecte d'état, `createServer`, `updateServer` (pull → backup opt-in → recreate → health → rollback auto), backups tar en conteneur éphémère, rapport disque, snapshot poller |
| `instance-stack` | Stacks compose autonomes par instance : rendu `compose.yml`, sidecar `cloudflared`, `cf.env`/`secrets.env`, politique d'update fail-closed (`STACK_UPDATE_REFUSED`, `preserve-sidecar`) |
| `agent-updates` | Boucle pull des updates agent → app admin (directives fleet-releases, slots, statuts) |
| `agent-tunnel` | T7 — surveillance respawn (bornée, miroir cloudflared-respawn) du container cloudflared **dédié** agent `creezio-agent-tunnel` ; jamais de (re)création de tunnel CF ici |
| `update-status-store` | Persistance du suivi `update-status` (host-agent + plan local admin) : journal JSON atomique dans le répertoire d'état, reload au boot, flag `agentRestarted`, TTL 24 h |
| `registry-pull-proxy` | Proxy pull-only du registre d'images (`/v2/*`, Basic `hostId:agentToken` ou admin, push 405) |
| `server-admin-client` | Client typé du backend flotte pour l'app admin (T4) : `fleetBackendFetch` (Basic, env `CREEZIO_FLEET_BACKEND_URL`/`_BASIC`), `fetchFleetBackendServers`, `verifyFleetHostCredential` |
| `server-admin` | Backend flotte admin (`startServerAdmin`) : plan local (socket) + plan flotte (agents tunnelisés), enrôlement, proxys |
| `host-agent` | Agent hôte (`startHostAgent`) : gestes locaux Bearer-only + boucle pull updates |
| `protocol` | Contrat de version agent↔backend (header `x-creezio-fleet-protocol`, refus fail-closed si absent ou ≠ v1) |

## Protocole agent ↔ backend (F4.4d)

Tous les échanges server-admin ↔ host-agent (et pull agent → app admin)
portent le header `x-creezio-fleet-protocol` (v1 depuis 0.15.0) :

- version égale → OK ;
- header **absent** ou version **différente** → refus fail-closed (409)
  avec message actionnable (`FLEET_PROTOCOL_ACCEPT_MISSING=false` depuis
  0.19.0 — dual-accept 0.15→0.18 terminé ; pas de bump v2 : le format
  filaire n'a pas changé).

## Suivi update-status persisté (T8)

Le suivi asynchrone des updates (`POST /update` → 202, poll
`GET /update-status`) était tenu en mémoire seule : un restart du process
pendant un update laissait l'admin poller dans le vide. Depuis 0.20.x le
suivi est **journalisé sur disque** (écriture atomique tmp+rename) dans le
répertoire d'état existant de chaque process :

- host-agent : `{dirname(CREEZIO_AGENT_STATE_FILE)}/host-agent-updates.json`
  (à côté de `host-agent.json`) ;
- server-admin (plan local) : `{adminRoot}/docker-data/server-admin-updates.json`.

Au boot, le journal est rechargé : une entrée restée `running` (update
interrompu par le restart) reçoit le champ **additif** `agentRestarted: true`
puis est résolue via `servers.json` — si l'image enregistrée de l'instance
correspond à l'image de l'update (posée par `updateServer` en fin d'update
OK), le statut devient `done` ; sinon l'issue réelle est inconnue → `error`
avec la **dernière étape persistée** (`lastStep`, alimentée au fil de l'eau)
dans `result.error`. Le poll admin retrouve donc toujours un statut terminal
au lieu d'un trou, et le mutex « update déjà en cours » ne reste jamais
coincé. Les entrées terminées sont purgées après un **TTL de 24 h**
(`DEFAULT_UPDATE_STATUS_TTL_MS`). Protocole v1 intact : champs additifs
seulement. Gate : `test-phase-fleet-update-status-persist`.

## Tunnel dédié agent (T7)

L'ingress public du host-agent (`agent.{slug}.{zone}` /
`agent-{slug}.{zone}`) vit sur un tunnel Cloudflare **propre à l'agent**
(nom CF `creezio-agent-<slug>`, un seul ingress → `127.0.0.1:<port agent>`)
dont le connecteur tourne dans un container dédié `creezio-agent-tunnel`
(network host, `--restart unless-stopped`, token dans
`docker-data/agent-tunnel.env` 600). `creezio server-docker enroll` et
`agent up` le provisionnent ; `agent up` migre automatiquement un hôte
déjà enrôlé sans tunnel dédié. `agent rm` est le seul geste qui retire
DNS agent + tunnel dédié.

Côté agent, `startHostAgent()` **surveille** ce container (module
`agent-tunnel`) : mort → `docker start` avec backoff borné (mêmes défauts
que la politique cloudflared in-process : 8 essais, 1 s → 30 s, reset après
60 s d'uptime sain), abandon loggué actionnable, container absent = idle.
Overrides
`CREEZIO_AGENT_TUNNEL_RESPAWN_{MAX,DELAY_MS,MAX_DELAY_MS,HEALTHY_MS}` ;
état exposé (champ additif `agentTunnel`) dans `GET /agent/api/health`.
Gates : `test-phase-agent-tunnel`, `test-phase-tunnel-self-provision` (§10).

## Client typé du backend (T4)

L'app admin (`@creezio/admin`) consommait le backend flotte via un fetch
HTTP artisanal (endpoints, Basic et formats re-déclarés à la main). Depuis
T4, le contrat client vit ici (`server-admin-client.ts`) et l'admin
l'**importe directement** : `fleetBackendFetch` (Basic + timeout),
`fetchFleetBackendServers` (vue `GET /admin/api/servers` typée
`CollectedServer & {hostId, hostLabel}`), `verifyFleetHostCredential`
(`POST /admin/api/hosts/verify`). Le transport HTTP Basic loopback demeure
(l'app admin et le backend sont deux containers du VPS — seul le backend a
le socket Docker et `fleet-hosts.json`), et le serveur HTTP `server-admin`
reste intact pour les host-agents distants (protocole v1 inchangé : cette
surface Basic ne porte pas `x-creezio-fleet-protocol`).

## Consommation

- Images Docker (`docker/server-admin`, `docker/host-agent`) : CMD
  `node node_modules/@creezio/fleet/dist/bin/{server-admin,host-agent}-main.js` —
  contexte stagé par `creezio server-docker admin|agent up`
  (`stageFleetImageContext`, fail-closed si dist absent).
- App admin (`@creezio/admin`) : client typé `server-admin-client`
  (imports directs — T4).
- CLI `creezio server-docker` : import direct `packages/fleet/dist`
  (`importInstanceStack`, `server-lib`).
- `public/admin.html` : UI mono-fichier servie par server-admin sur `/admin`.

Package ESM-only (comme `factory`) — pas de dual CJS : consommé par
`import()`/CMD node, jamais `require()` Electron.

## Build / tests

```bash
npm run build -w @creezio/fleet     # tsc strict
npm run test:kit                    # gates fleet : server-docker, instance-stack, stack-update-preserve, fleet-agent, fleet-releases…
```
