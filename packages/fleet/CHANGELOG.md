# @creezio/fleet

## 0.26.0

### Patch Changes

- cff3d24: `server-docker update` persiste et réutilise le `hostPort` loopback (2ᵉ update = même port) et lit/écrit les fichiers stack root:root 600 (`cf.env`, `secrets.env`) via `sudo -n` / wrapper `/usr/local/sbin/creezio-server-docker priv-io` — fail-closed actionnable, plus de chmod one-shot.

## 0.25.0

## 0.24.1

### Patch Changes

- 465aa62: `agent up` persiste l'URL publique du tunnel dédié (`agentUrl`) dans host-agent.json et fleet-hosts.json après provision/migration — l'admin flotte ne sonde plus l'ancienne URL nested partagée. `fleet-hosts.json` root:root 600 : écriture via `sudo -n`, sinon POST `/admin/api/hosts/agent-url` (container) — plus d'exit 1 EACCES.

## 0.24.0

## 0.23.0

### Minor Changes

- 40e40c7: T4 — suppression du hop HTTP artisanal admin → backend flotte : le contrat
  client du backend (`server-admin-client.ts`) vit désormais dans
  `@creezio/fleet` (résolution env `CREEZIO_FLEET_BACKEND_URL`/`_BASIC`,
  `fleetBackendFetch` Basic, helpers typés `fetchFleetBackendServers` /
  `verifyFleetHostCredential`), et `@creezio/admin` l'importe directement —
  `fleet-registry` (sync/poller) et `fleet-releases` (vérif credential agents)
  n'ont plus de fetch HTTP re-déclaré à la main ; `fleetFetch` (export
  conservé) délègue au client. Comportement identique : transport HTTP Basic
  loopback conservé (backend flotte = container séparé, seul détenteur du
  socket Docker et de `fleet-hosts.json`), serveur HTTP server-admin intact
  pour les host-agents distants (protocole v1, header
  `x-creezio-fleet-protocol` inchangé).
- bf14b35: T7 — tunnel cloudflared DÉDIÉ au host-agent. L'ingress `agent.{slug}.{zone}` / `agent-{slug}.{zone}` appartient exclusivement au cycle de vie du host-agent : `creezio server-docker enroll` et `agent up` provisionnent un tunnel Cloudflare propre (`ensureCfAgentTunnel`, nom CF `creezio-agent-<slug>`, container `creezio-agent-tunnel`, token `docker-data/agent-tunnel.env` 600). `agent up` (chaque update de l'agent) détecte un hôte déjà enrôlé sans tunnel dédié et exécute la migration (provision → connecteur → bascule CNAME → retrait d'une règle résiduelle). Fail-closed si `CREEZIO_CF_*` manquent. `server-docker rm` d'une instance ne touche jamais les DNS agent ; seul `agent rm` les retire (`deprovisionCfAgentTunnel`). Plus d'option `agent` sur l'ingress kernel des instances, plus de kill-switch `CREEZIO_AGENT_TUNNEL_WATCH`. Respawn surveillé par `@creezio/fleet` `agent-tunnel.ts`. Gates : `test-phase-agent-tunnel`, `test-phase-tunnel-self-provision` §10, `test-phase-server-docker` (rm instance ≠ DNS agent).

## 0.22.0

## 0.21.0

### Patch Changes

- 247aa2b: fleet : le suivi `update-status` du host-agent (et du plan local server-admin) est persisté sur disque (T8, dette « Suivi update en mémoire »). Journal JSON atomique (tmp+rename) par process dans le répertoire d'état existant (`host-agent-updates.json` à côté du state file agent, `server-admin-updates.json` dans le docker-data admin), rechargé au boot : une entrée `running` interrompue par un restart reçoit le flag additif `agentRestarted` puis est résolue via `servers.json` (image enregistrée = image cible → `done`, sinon `error` avec la dernière étape persistée). TTL 24 h sur les entrées terminées. Protocole v1 intact (champs additifs `lastStep` / `agentRestarted` seulement) ; `updateServer` gagne un hook optionnel `onStep`.
- 60683cf: server-docker : `CREEZIO_SERVER_DOCKER_BACKUP=0` (aussi `false`/`off`) skippe les backups (`update --backup`, one-shot, migrate-stack, API `backup:true`). Défaut on (prod-safe). L'env gagne ; warn `backup skippé (CREEZIO_SERVER_DOCKER_BACKUP=0)`.

## 0.20.0

### Minor Changes

- ac7035c: Retrait des wrappers de compat fleet-collector (dette 0.16, BACKLOG) :

  - `@creezio/observability` : suppression des 7 wrappers `.mjs`
    (`admin-docker`, `server-lib`, `instance-stack`, `agent-updates`,
    `registry-pull-proxy`, `server-admin`, `host-agent`) et du bin npm
    `creezio-server-admin` — la SoT flotte est `@creezio/fleet`
    (`packages/fleet/dist`). Le collector télémétrie (`server.mjs`,
    `ops-api.mjs`, `env.mjs`) reste inchangé.
  - `@creezio/factory` : le CLI `server-docker` (`importInstanceStack`,
    imports `server-lib` de backup/update/migrate-stack) pointe directement
    sur `packages/fleet/dist` (fail-closed si dist absent).
  - `@creezio/fleet` : protocole flotte v1 **strict** —
    `FLEET_PROTOCOL_ACCEPT_MISSING=false` (politique F4.4d). Pas de bump v2 :
    le format filaire est inchangé ; vérifié via l'API flotte que tous les
    composants déployés (host-agents enrôlés inclus) annoncent déjà v1.
  - `@creezio/admin` : le mount `fleet-releases` pose désormais le header
    `x-creezio-fleet-protocol` sur toutes ses réponses (la boucle pull des
    agents le vérifie — strict en 0.19) ; nouvelle dépendance
    `@creezio/fleet`.

## 0.19.0

## 0.18.0

## 0.17.1

## 0.17.0

## 0.16.0

## 0.15.0

### Minor Changes

- 1ab886b: P2.b — backend flotte sorti d'observability et typé : nouveau package `@creezio/fleet` (portage TS strict isofonctionnel des 7 `.mjs` de fleet-collector : admin-docker→docker, server-lib, instance-stack, agent-updates, registry-pull-proxy, server-admin, host-agent). Contrat de version agent↔backend (F4.4d) : header `x-creezio-fleet-protocol` v1 dans les deux sens, dual-accept UNE version pour les composants ≤ 0.14 sans header (warn bruyant throttlé), refus explicite actionnable sur écart de version. Les `.mjs` de fleet-collector deviennent des wrappers de compat `[deprecated]` (retrait au prochain minor) ; images server-admin/host-agent : CMD → `node_modules/@creezio/fleet/dist/bin/*-main.js`, contexte de build stagé par `stageFleetImageContext` (fail-closed si dist absent). Zéro changement de comportement : mêmes endpoints, formats d'état disque, noms de conteneurs/images.
