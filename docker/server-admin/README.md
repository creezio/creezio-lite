# Creezio Server Admin — admin web multi-serveurs Docker

Admin web des serveurs marque headless (`docker/server`), servi par
`@creezio/fleet` (`packages/fleet/dist/bin/server-admin-main.js`, Node pur,
zéro dépendance npm runtime — même esprit que le fleet collector). Point
d'entrée **séparé** de `server.mjs` : le service fleet-collector prod n'est
pas touché.

## Usage

Voie nominale : depuis le **repo admin dédié** de la marque (`<brand>-admin`,
privé — ex. `creezio/tempoflow3-admin`), config auto-générée dans
`{adminRoot}/docker-data/server-admin.json` :

```bash
creezio server-docker admin up --admin-root <adminRoot> [--port 18800]
creezio server-docker admin status --admin-root <adminRoot>
creezio server-docker admin down  --admin-root <adminRoot>
# → http://127.0.0.1:18800/admin (Basic auth)
```

Legacy (`--brand-root <brandRoot>`) : config sous
`{brandRoot}/docker-data/server-admin.json` — toujours lu, plus généré.

Ajouter une autre marque à un admin existant (append au `server-admin.json`
puis recreate du container, nouveau volume monté) :

```bash
creezio server-docker admin add-brand <autreBrandRoot> --brand-root <brandRoot>
```

Build manuel de l'image :

```bash
docker build -f docker/server-admin/Dockerfile \
  -t creezio-server-admin:local packages/observability/fleet-collector
```

Lancement direct sans Docker (dev) :

```bash
CREEZIO_ADMIN_PASS=secret \
CREEZIO_ADMIN_BRAND_ROOTS=<brandRoot> \
node packages/fleet/dist/bin/server-admin-main.js
# (dist requis : npm run build:packages — les wrappers .mjs et le bin npm
#  creezio-server-admin ont été retirés en 0.19.0)
```

## Env

| Variable | Défaut | Rôle |
|----------|--------|------|
| `CREEZIO_ADMIN_PORT` | `18800` | Port HTTP |
| `CREEZIO_ADMIN_HOST` | `127.0.0.1` | Bind (loopback only par défaut) |
| `CREEZIO_ADMIN_USER` | `admin` | Login Basic auth |
| `CREEZIO_ADMIN_PASS` | — | **Obligatoire** — refus de démarrer sinon |
| `CREEZIO_ADMIN_BRAND_ROOTS` | — | Racines marques séparées par `:` |
| `CREEZIO_DOCKER_SOCK` | `/var/run/docker.sock` | Socket Docker Engine |

## Fonctionnalités

- Liste fusionnée des instances de **toutes** les marques
  (SoT `{brandRoot}/docker-data/servers.json`, conventions
  `packages/factory/src/server-docker-registry.ts`) + containers orphelins
  labellisés `creezio.server=1`.
- Create / start / stop / rm (+ purge data) via Docker Engine API
  (socket unix, specs identiques au CLI `creezio server-docker`).
- Barre de progression de boot en live (proxy `GET /api/v1/os/boot-status`),
  logs docker démultiplexés, événements ops JSONL, tailles disque.
- L'image serveur marque n'est **pas** buildée depuis l'admin : si elle est
  absente → 409 avec l'invite `creezio server-docker build`.

## Registre pull-only `/v2/*` (F4)

L'admin expose un **proxy pull-only** du registre d'images privé
(`CREEZIO_REGISTRY`, ex. `127.0.0.1:5000`) sous `/v2/*`, pensé pour être
publié via l'ingress `registry.{zone}` (réservation CF `kind=registry`
via le client `@creezio/platform-core` — zone-level, pull-only) :

- **GET/HEAD uniquement** — toute méthode push (PUT/POST/PATCH/DELETE) → 405.
  Le `publish` reste loopback-only sur le VPS atelier.
- **Auth Basic obligatoire** : `hostId:agentToken` d'un hôte enrôlé
  (`fleet-hosts.json`) ou `CREEZIO_ADMIN_USER:CREEZIO_ADMIN_PASS` (debug).
  Anonyme → 401 + `WWW-Authenticate` (compatible `docker login`).
- Pull distant : `docker login registry.{zone} -u <hostId> -p <agentToken>`
  puis `docker pull registry.{zone}/creezio-server-<brand>:<tag>`.
- Côté publish, `creezio server-docker publish --public-host registry.{zone}`
  (ou env `CREEZIO_REGISTRY_PUBLIC_HOST`) tague en plus la référence publique.
- Module : `packages/fleet/src/registry-pull-proxy.ts`
  (gate `scripts/test-phase-registry-pull-proxy.mjs`).

## Updates en pull (F5)

Le backend expose aussi `POST /admin/api/hosts/verify` (Basic) : vérification
d'un credential `hostId:agentToken` pour le module `fleet-releases` de l'app
admin (`@creezio/admin`). La boucle de pull vit dans l'agent hôte
(`packages/fleet/src/host-agent.ts` + `agent-updates.ts`) : opt-in via
`CREEZIO_AGENT_ADMIN_URL` / `CREEZIO_AGENT_FLEET_KEY` (posés par
`creezio server-docker enroll [--admin-app <url>]` puis `agent up`).
Gate : `scripts/test-phase-fleet-releases.mjs`.

## Sécurité

- Bind `127.0.0.1` par défaut : accessible uniquement en loopback (session
  RDP/SSH sur l'hôte, ou tunnel SSH `ssh -L 18800:127.0.0.1:18800 …`).
  Le container tourne en `--network host` précisément pour que ce bind
  loopback reste effectif et que les serveurs (`127.0.0.1:<port>`) soient
  joignables.
- Basic auth obligatoire (timing-safe) sur **toutes** les routes `/admin*`.
- Le socket docker monté donne un contrôle root-équivalent sur l'hôte :
  ne jamais exposer ce backend flotte hors loopback. Le hostname
  `admin.{zone}` appartient à l'app OS (tunnel in-process), pas à :18800.
- Audit console de chaque action mutante (create/start/stop/rm).
