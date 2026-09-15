# Serveurs marque Docker (headless)

> **Gestes opérationnels vérifiés** (créer un serveur, compte owner headless,
> login, publish/update/rollback, admin, enrôlement VPS, diagnostics) :
> skill [`creezio-fleet-ops`](../../.cursor/skills/creezio-fleet-ops/SKILL.md)
> (index humain : [`docs/RUNBOOK-FLOTTE.md`](../../docs/RUNBOOK-FLOTTE.md)).

Lancer le **kernel OS + métier + CRM web** d’une marque Creezio en mode
serveur HTTP, **sans** build Electron / AppImage. Multi-instances par registre
(`docker-data/servers.json`) ou Compose legacy (ports + volumes DB isolés).

Complémentaire du pack Electron `pack:linux:server` : même harness
(`startBrandKernelHarness` → `listenBrandOsHttp`), packaging différent.

L'image embarque :

- le kernel + API `/api/v1/*` + MCP (comme le desktop)
- **Meilisearch Linux** (`/opt/creezio/bin/meilisearch`) — recherche réelle,
  plus de sql-fallback
- l'**UI Next standalone** (`ui/.next/standalone`) servie derrière le port
  unique → `http://127.0.0.1:PORT/` = CRM complet (setup, login, mails,
  tâches, admin…)
- le **boot-status** : `GET /api/v1/os/boot-status` répond dès le lancement
  (early-listen) avec le même modèle que le splash desktop (étapes, %,
  chronos) ; chaque transition = une ligne JSONL dans `docker logs` ;
  journal ops JSONL sous `/data/ops/`

## Modèle standard (0.10.0) — 1 instance = 1 stack compose autonome

Chaque instance serveur est un **projet compose autonome**
(`docker-data/stacks/<nom>/compose.yml`, généré — ne pas éditer) :

- **app seule** : image `creezio-server-<brand>` — port **interne fixe
  18791**, volume `/data`, healthcheck `/api/v1/core/health`. **cloudflared
  tourne IN-PROCESS** dans le conteneur (binaire pinné
  `/opt/creezio/bin/cloudflared`, `CREEZIO_CLOUDFLARED_BINARY`) — fini le
  sidecar ;
- **tunnel auto-provisionné au boot** via l'API Cloudflare (client
  `@creezio/platform-core`) : GET du tunnel persisté dans `/data` →
  404/token absent → recréation idempotente (le CNAME suit le nouvel id),
  PUT ingress `http://127.0.0.1:18791` (+ services + hostnames
  supplémentaires multi-domaines éventuels sur le même tunnel), upsert DNS
  idempotent, sonde publique en arrière-plan (non fatale) ;
- **contrat CF via `cf.env` chmod 600** (`CREEZIO_CF_API_TOKEN` /
  `_ACCOUNT_ID` / `_ZONE_ID` / `_ZONE_NAME` / `_UNIVERSAL_SSL` /
  `CREEZIO_TUNNEL_SLUG` / `CREEZIO_DOMAIN`), écrit par `create` — jamais en
  clair dans `environment:` ; les secrets applicatifs (clés `*TOKEN*`,
  `*SECRET*`, `*PASSWORD*`, `*API_KEY*`…) partent dans **`secrets.env`
  chmod 600** ;
- **port hôte indifférent** : `127.0.0.1::18791` (attribution auto, loopback
  seul) pour debug/healthcheck — fini les collisions entre instances ;
  `--host-port N` pour un port fixe (ex. tempoflowadmin : 18801) ;
- **zéro port public** : l'accès utilisateur passe par Cloudflare.

```bash
creezio server-docker create resto-x --brand-root … --profile prod
# → cf.env écrit (contrat CF vérifié) + stack compose ; le tunnel est
#   créé/configuré par l'instance elle-même au premier boot
#   hostname public obligatoire : https://resto-x.crm.foove.io
#   + owner first-run (CREEZIO_OWNER_EMAIL / _PASSWORD)

creezio server-docker migrate-stack resto-lyon --brand-root …
# → sidecar/legacy docker run → stack in-container : backup /data
#   obligatoire, cf.env écrit, rollback automatique si le health échoue

# Debug : quel port hôte pour une instance ?
creezio server-docker ls --brand-root …          # colonne PORT (* = auto)
docker compose -f docker-data/stacks/resto-x/compose.yml port app 18791
```

Le kernel détecte le contrat CF (`CREEZIO_CF_API_TOKEN` présent) et
provisionne/configure son tunnel au boot (phase `tunnel` du boot-status).
`update` régénère le compose avec la nouvelle image (`cf.env` conservé)
puis `compose up -d`. `rm` déprovisionne via l'API CF directe (DNS +
tunnel) avant de retirer le stack.

## Une ligne (recommandé) — registre d'instances

```bash
# VPS / prod — hostname public {slug}.crm.foove.io + owner first-run obligatoires
# (CREEZIO_CF_API_TOKEN + _ACCOUNT_ID + _ZONE_ID + CREEZIO_OWNER_EMAIL +
# CREEZIO_OWNER_PASSWORD dans le .env marque).
# Slug réservé (demo, test, admin…) → CREEZIO_TUNNEL_SLUG=<brand>-<slug>.
creezio server-docker create acme --brand-root "$BRAND_ROOT" --profile prod

# Dev local uniquement (loopback assumé, owner optionnel) :
CREEZIO_TUNNEL_LOCAL=1 creezio server-docker create demo --brand-root "$BRAND_ROOT"

creezio server-docker ls     --brand-root …   # instances + état docker
creezio server-docker stop   demo --brand-root …
creezio server-docker start  demo --brand-root …
creezio server-docker logs   demo --brand-root … [--tail 500] [--follow]
creezio server-docker rm     demo --brand-root … [--purge-data]
```

Registre : `{BRAND_ROOT}/docker-data/servers.json` — nom, port, volume,
marque. Image par marque : `creezio-server-<brandId>:local`, containers
`<brandId>-server-<nom>` (multi-marques sans collision).

`--brand-root` = **racine du monorepo marque** (layout 2 repos : monorepo
`client/` + `server/` — le Dockerfile cible `server/` via l'arg `SERVER_DIR` ;
le layout plat legacy reste détecté automatiquement. L'admin flotte vit dans
le repo dédié `<brand>-admin`, voir `--admin-root`).

Options `create` : `--port N`, `--expose` (bind 0.0.0.0 — sinon loopback),
`--warm` (n8n+Hermes ; VPS create pose déjà Hermes), `--env K=V` (répétable),
`--profile prod` (voir ci-dessous).

## Profil « serveur de flotte prod » (`--profile prod`)

`creezio server-docker create <nom> --profile prod` active en une commande la
parité TF2 desktop complète, sans polluer les défauts test/CI :

- `CREEZIO_NATIVE_WARM=1` + `CREEZIO_NATIVE_WARM_HERMES=1` (n8n **et** Hermes dans le container ; un `CREEZIO_NATIVE_WARM_N8N=0` est ignoré)
- `CREEZIO_CATALOG=1` (téléchargement + **import** du catalogue après le listen)
- **fail-closed tunnel** : `CREEZIO_CF_API_TOKEN` + `_ACCOUNT_ID` + `_ZONE_ID`
  **requis** (hostname public `{slug}.crm.foove.io` / `{slug}.{zone}`,
  auto-provisionné au boot via `cf.env` 600). Un create VPS **n'est plus un
  succès silencieux en loopback** si le contrat CF manque. Slug d'instance
  dans `RESERVED_SLUGS` (`demo`, `test`…) → dérivation explicite
  `CREEZIO_TUNNEL_SLUG=<brand>-<slug>` (log + cf.env).
- **fail-closed owner** : `CREEZIO_OWNER_EMAIL` + `CREEZIO_OWNER_PASSWORD`
  **requis** (first-run `POST /api/v1/os/setup` + vérif login). Même contrat
  cloud / VPS — pas de `E2E_OWNER_*`. Le create **persiste** owner dans
  `secrets.env` (600, `env_file`) et log `login : $CREEZIO_OWNER_EMAIL`
  (jamais le mot de passe). Rattrapage / compte recette optionnel :
  `creezio server-docker ensure-owner <nom>` + `CREEZIO_E2E_EMAIL` /
  `CREEZIO_E2E_PASSWORD` (seed si absents). `AUTH_DISABLED=1` = harness
  local seulement — jamais en prod.
- forward des env **présents sur l'hôte** (jamais inventés) : contrat
  Cloudflare `CREEZIO_CF_*` + `CREEZIO_TUNNEL_SLUG` / `CREEZIO_DOMAIN`
  (→ `cf.env` 600), `CREEZIO_FLEET_ENDPOINT`, `CREEZIO_CRASH_ENDPOINT`,
  `CREEZIO_PLUGINS`, `EMAIL_INBOUND_SECRET` (→ `secrets.env` 600)

Les autres phases (fleet, catalog…) restent no-op si non configurées.
Le tunnel **et** l'owner **ne le sont plus** : sans `CREEZIO_CF_*` **ou** sans
owner, `create` échoue avec un message qui indique où poser les vars
(`.env` marque, Runtime Secrets cloud).
Dev local : `CREEZIO_TUNNEL_LOCAL=1` (loopback assumé, owner optionnel,
pas de `--profile prod`).

### Phases harness (parité TF2 desktop)

Après le listen HTTP (`METIER_BASE_URL` posé), le harness rejoue les phases du
runtime desktop — chacune a son étape boot-status :

| Étape boot-status | Flag / env | Effet |
|-------------------|-----------|-------|
| `catalog` | `CREEZIO_CATALOG=1` | `ensureCatalogPresent` (téléchargement snapshot) |
| `catalog-import` | idem + host `ensureCatalogImported` | projection snapshot → brand.db via `/api/v1/modules/catalog/import` |
| `tunnel` | `CREEZIO_CF_API_TOKEN` + `_ACCOUNT_ID` + `_ZONE_ID` | ensure CF (GET → 404 → recréation, PUT ingress, DNS idempotent) + `cloudflared` in-process (binaire embarqué, `CREEZIO_CLOUDFLARED_BINARY`) ; `APP_PUBLIC_URL`/`MCP_PUBLIC_URL` suivent |
| `plugins` | défaut ON (kill-switch `CREEZIO_PLUGINS=0` / `features.plugins=false`) | `startEnabledPlugins` + control API |
| `hermes-bridge` | warm actif | clé CRM Hermes, seed contexte, pont n8n↔Hermes, webhook public n8n |
| `fleet` | `CREEZIO_FLEET_ENDPOINT` (ou manifest) | fleet agent + crash endpoint (`CREEZIO_CRASH_ENDPOINT`) |

Secret mails entrants : `EMAIL_INBOUND_SECRET` env prime, sinon persisté par
instance dans la config store (parité `ensureInboundEmailSecret` desktop).

Gates : `scripts/test-phase-harness-parity.mjs` (kit, hermétique) et
`scripts/test-phase-factory-docker-parity.mjs` (opt-in `CREEZIO_FACTORY_DOCKER=1`
— app neuve factory → image Docker → mêmes étapes boot-status, preuve
d'héritage). Matrice historique du chantier :
[docs/archive/PARITE-TF2.md](../../docs/archive/PARITE-TF2.md).

## Updates de flotte (essentiel — détail dans la skill)

GitHub / image Docker = **code**. Les **données runtime** vivent sous
`docker-data/servers/<nom>` → `/data` (volume persistant au recreate). Un
backup tar.gz (`docker-data/backups/`) = filet si le volume casse un jour —
**pas** à refaire à chaque update quand les data sont stables.

**Défaut** : update sans nouveau backup. Opt-in : `--backup` / `"backup":true`.
Archives existantes **conservées** (pas de prune dans le flux update).

```bash
# Publier une image versionnée :
creezio server-docker publish --brand-root "$BRAND_ROOT" --tag 0.3.0 --registry 127.0.0.1:5000
# GHCR : le label OCI org.opencontainers.image.source est dérivé du remote
# git origin du brand-root (fail-closed si introuvable).

# Update unitaire (dev/itération — défaut, rapide) :
creezio server-docker update <nom> --brand-root "$BRAND_ROOT" --tag 0.3.0
# API admin (202 + polling) — même défaut :
curl -sS -u "admin:$ADMPASS" -X POST \
  http://127.0.0.1:18800/admin/api/servers/<brandId>/<nom>/update \
  -H 'content-type: application/json' \
  -d '{"image":"127.0.0.1:5000/creezio-server-<brandId>:0.3.0"}'

# Prod critique : snapshot frais avant recreate → --backup / "backup":true
# One-shot de référence (une fois) :
creezio server-docker backup <nom> --brand-root "$BRAND_ROOT"
# → docker-data/backups/<nom>-<stamp>.tar.gz (gardé ; restore = skill §4)

# Toute la flotte (releases en PULL — les agents hôtes pollent l'app admin) :
CREEZIO_FLEET_ADMIN_URL=http://127.0.0.1:18801 \
creezio server-docker publish --brand-root "$BRAND_ROOT" \
  --tag 0.3.0 --registry 127.0.0.1:5000 --release
# puis rollout draft → rolling (canary wave_pct) → done ; kill-switch
# paused/aborted ; hold/pin/canal par serveur — module fleet-releases de
# l'app admin, images pullées via registry.{zone} (proxy pull-only).
```

Pourquoi des images et jamais git-pull chez les clients :
[ADR-fleet-updates-docker-images](../../docs/adr/ADR-fleet-updates-docker-images.md).
Pas-à-pas complet (commandes vérifiées) : skill
[creezio-fleet-ops](../../.cursor/skills/creezio-fleet-ops/SKILL.md) §4 et §4b.

## Admin web multi-serveurs

```bash
creezio server-docker admin up --admin-root "$ADMIN_ROOT"   # repo admin dédié
# (legacy : --brand-root "$BRAND_ROOT")
# → http://127.0.0.1:18800/admin (Basic auth —
#   credentials dans docker-data/server-admin.json)
```

Config versionnable **sans secrets** (`port`, `user`, `brandRoots[]`) : à la
racine du **repo admin dédié** (`{ADMIN_ROOT}/server-admin.json`, ex.
`creezio/tempoflow3-admin`) — le `pass` runtime reste dans
`{ADMIN_ROOT}/docker-data/server-admin.json` (gitignoré). Le chemin legacy
`{BRAND_ROOT}/admin/server-admin.json` reste lu mais n'est plus généré.

Container `creezio-server-admin` (backend `@creezio/fleet`, `--network host`,
`/var/run/docker.sock` monté) : liste des serveurs, create/start/stop/rm,
barre de boot-status live (rendu splash), health/version, logs docker +
ops JSONL, disque. Voir `docker/server-admin/README.md`.

## Sécurité

- Ports publiés sur **127.0.0.1** par défaut (CLI registre et Compose).
  Opt-in exposition : `--expose` (create) ou `SERVER_BIND=0.0.0.0` (compose).
- Accès distant recommandé : reverse proxy (nginx-proxy-manager) + TLS —
  voir [REMOTE-ACCESS.md](./REMOTE-ACCESS.md).
- **`AUTH_SECRET` (sessions JWT + chiffrement BYOK)** : généré et persisté
  **par instance** au boot (`composeBrandOs` → `store.ensureAuthSecret()`,
  fichier `/data/{brand}-config.json`) — deux serveurs n'ont jamais le même
  secret, et il survit aux restarts (sessions conservées). En
  `NODE_ENV=production`, `@creezio/auth` **refuse** de signer/vérifier avec
  le fallback dev (`dev-insecure-secret-change-me`) ; un env `AUTH_SECRET`
  injecté par l'opérateur reste prioritaire. Gate :
  `scripts/test-phase-auth-secret.mjs`.

## Prérequis

- `docker` + `docker compose` (plugin v2+, BuildKit — défaut Docker 23+)
- Marque **npm** (docs/NPM-DISTRIBUTION.md) : deps `@creezio/*` en versions
  publiées (GitHub Packages), `.npmrc` racine commité (référence
  `${CREEZIO_NPM_TOKEN}`, sans secret) + lockfile racine workspace
- `CREEZIO_NPM_TOKEN` exporté côté hôte (PAT `read:packages`) — passé au
  build en **secret BuildKit** par le CLI (jamais dans l'historique image)
- Marque avec `scripts/brand-kernel-harness.mjs`
- **aucun build hôte** : `build:runtime` (tsc) et `build:ui` (Next) tournent
  dans le `docker build` (stage `brand-build`) — node/npm de l'hôte ne
  produisent aucun artefact d'image, le résultat est identique partout

## Distribution autonome (clone marque sans kit)

Chaque monorepo marque poussé sur GitHub doit être **autonome au clone**
(mode npm — docs/NPM-DISTRIBUTION.md) : les deps `@creezio/*` sont des
versions npm publiées, le `.npmrc` racine (sans secret) et les lockfiles
sont commités. Deux artefacts sont **matérialisés** dans la marque (SoT
ici, posés d'office par le scaffold factory) :

| Artefact marque | SoT kit | Rôle |
|-----------------|---------|------|
| `docker/server.Dockerfile` | `docker/server/Dockerfile` | `npm run docker:build` — image serveur sans kit checké out |
| `scripts/ensure-server-lock.mjs` | `docker/server/ensure-server-lock.mjs` | pré-flight lockfiles avant `docker build` (regen `--package-lock-only` si drift) |
| `.dockerignore` | `docker/server/brand.dockerignore` | contexte de build (posé/rafraîchi si marqueur absent — v5) |

L'auth registre (`CREEZIO_NPM_TOKEN`) ne se matérialise JAMAIS dans le repo :
exportée en local, secret CI en CI, secret BuildKit au `docker build`.
Les binaires fat (Meili, cloudflared) restent hors git : l'image les
télécharge au build, le desktop au premier run. Gates :
`scripts/test-phase-clone-autonomy.mjs` (kit) +
`server/scripts/test-clone-autonomy.mjs` (marque, dans son `npm test`).

## Nommage des instances

Les services Compose s’appellent **`server-1`**, **`server-2`**, … (chiffres uniquement).
Pas de lettres (`server-a` / `server-b` interdit).

| Instance | Port hôte (défaut) | Volume data | Raccourci bureau |
|----------|-------------------|-------------|------------------|
| `server-1` | `SERVER_1_PORT` → `18791` | `$DATA_DIR/server-1` | `{Product}-Server-1.desktop` |
| `server-2` | `SERVER_2_PORT` → `18792` | `$DATA_DIR/server-2` | `{Product}-Server-2.desktop` |

`DATA_DIR` par défaut : `{BRAND_ROOT}/docker-data/servers`.

## Variables

| Variable | Défaut | Rôle |
|----------|--------|------|
| `BRAND_ROOT` | — | Racine marque (build context) |
| `CREEZIO_KIT_ROOT` | racine du kit | Kit (Dockerfile / compose) |
| `BRAND_ID` | `tempoflow3` | Identité (doc / env) |
| `SERVER_1_PORT` / `SERVER_2_PORT` | `18791` / `18792` | Ports hôte |
| `METIER_PORT` / `PORT` | `18791` | Port dans le container |
| `METIER_DATA_DIR` | `/data` | Volume SQLite (`core`/`brand`) |
| `CREEZIO_HTTP_HOST` | `0.0.0.0` | Bind Docker (obligatoire) |
| `CREEZIO_NATIVE_WARM` | `0` (compose local / `TUNNEL_LOCAL=1`) ; **forcé `1`** sur VPS create/update | Master n8n+Hermes. `=0` ignoré en VPS |
| `CREEZIO_NATIVE_WARM_N8N` | suit WARM | `0` = skip n8n en local seulement — **ignoré** sur VPS create/update |
| `CREEZIO_NATIVE_WARM_HERMES` | `1` sur VPS | `0` = skip Hermes en local seulement — **forcé `1`** sur VPS |
| `CREEZIO_CATALOG` | `0` | Catalogue : présence + import post-listen |
| `CREEZIO_PLUGINS` | `1` (défaut ON — `0` = kill-switch) | Plugins host + control API |
| `CREEZIO_CF_API_TOKEN` / `_ACCOUNT_ID` / `_ZONE_ID` (/`_ZONE_NAME` / `_UNIVERSAL_SSL`) + `CREEZIO_TUNNEL_SLUG` / `CREEZIO_DOMAIN` | — | Tunnel Cloudflare auto-provisionné au boot (via `cf.env` 600) |
| `CREEZIO_FLEET_ENDPOINT` / `CREEZIO_CRASH_ENDPOINT` | manifest | Fleet agent / crash reports |
| `EMAIL_INBOUND_SECRET` | store | Secret webhooks mails entrants |
| `CREEZIO_CLOUDFLARED_BINARY` | `/opt/creezio/bin/cloudflared` (image) | Binaire cloudflared |
| `CREEZIO_TUNNEL_*` / `CREEZIO_CATALOG_*` | — | Optionnels (ne pas committer) |
| `SERVER_DESKTOP_PRODUCT` | BrandSpec `brandName` | Prefixe des `.desktop` |

## Config Docker vs Electron (first-run / setup)

| Aspect | Electron (exe / AppImage / NSIS) | Docker headless |
|--------|----------------------------------|-----------------|
| userData | `{installDir}/data/` (packagé) | volume `docker-data/servers/server-N` → `/data` |
| First-run / setup | Wizard UI dans la fenêtre desktop | **HTTP same-origin** : `/setup`, puis `/settings` |
| Tray / NSIS / splash | Oui | **Non** — pas de chrome natif |
| Secrets / seed | Fichiers sous userData + UI | Env `CREEZIO_*` au `up` + pages `/setup` / `/settings` |
| Isolation multi-tenant | Un installDir par machine | Un volume + port par `server-N` |

Chaque instance a sa propre DB SQLite sous
`{BRAND_ROOT}/docker-data/servers/server-N/` (monté `/data` = `METIER_DATA_DIR`).
Configurer l’instance **1** n’affecte pas l’instance **2**.

Flux typique first-run Docker :

1. `creezio server-docker up --brand-root …`
2. Ouvrir le raccourci bureau ou `http://127.0.0.1:18791/`
3. Compléter `/setup` dans le navigateur (même API que le desktop)
4. Ajuster ensuite via `/settings` ou en passant des env `CREEZIO_*` au compose

## 1 serveur

```bash
export CREEZIO_KIT_ROOT=<racine du kit>
export BRAND_ROOT=<racine de la marque>

# Image (build runtime + UI 100% in-image — rien à builder sur l'hôte)
creezio server-docker build --brand-root "$BRAND_ROOT"

# Une instance (ne lancer que server-1)
docker compose -p creezio-servers \
  -f "$CREEZIO_KIT_ROOT/docker/server/docker-compose.yml" \
  up -d --build server-1

curl -sS "http://127.0.0.1:18791/api/v1/core/health"
# → {"ok":true,"brandId":"tempoflow3",...}
```

## N serveurs (preuve 2 instances)

```bash
creezio server-docker up --brand-root "$BRAND_ROOT"
# ou : npm run server-docker:up -- --brand-root "$BRAND_ROOT"

curl -sS http://127.0.0.1:18791/api/v1/core/health   # server-1
curl -sS http://127.0.0.1:18792/api/v1/core/health   # server-2

# Raccourcis générés (Linux RDP / bureau) :
#   ~/Desktop/TempoFlow-Server-1.desktop
#   ~/Bureau/TempoFlow-Server-1.desktop
#   Exec → ~/bin/open-creezio-server-1 → creezio-open-url → firefox/…

creezio server-docker down --brand-root "$BRAND_ROOT"
```

**Projet Compose** : `creezio-servers` (ne touche pas `tempoflow`, `n8n`, etc.).
Override marque TF3 : `--project tf3-servers`.

## Raccourcis bureau Linux

À chaque `up` / `proof`, le CLI écrit :

| Artefact | Rôle |
|----------|------|
| `~/bin/creezio-open-url` | Script kit : `~/.local/firefox` → snap firefox → chromium → gio → xdg-open |
| `~/bin/open-creezio-server-N` | Wrapper par instance (URL `http://127.0.0.1:PORT/` figée) + log |
| `~/Desktop\|Bureau/{Product}-Server-{N}.desktop` | `Exec=/…/open-creezio-server-N` (**pas** `xdg-open` direct) |

- Log : `~/.local/state/creezio-server/open-server.log`
- Trust XFCE : `gio set … metadata::trusted true` (posé par le CLI)
- `StartupNotify=false` (évite silence XFCE sur wrapper bash)
- Préférer Firefox **tarball** dans `~/.local/firefox` : le snap échoue souvent
  hors cgroup session (`is not a snap cgroup`) sous xrdp / agents.

`Icon` : `resources/icons/server.png` (ou `brand-spec/icons/server.png`).

## Wiring marque (TF3 / futures)

Côté marque, minimum :

1. Harness existant (`scripts/brand-kernel-harness.mjs`)
2. Compose override mince (optionnel) — ex. `docker-compose.server.yml` qui
   pointe `BRAND_ROOT=.` et `CREEZIO_KIT_ROOT`
3. `.dockerignore` aligné sur `docker/server/brand.dockerignore` (le CLI le pose)

Pas de domaine métier dans l’image kit : le context = sources marque + lockfile npm.

## Lien Electron server

| Mode | Artefact | Usage |
|------|----------|-------|
| Docker headless | Image `creezio-brand-server` | Flotte / CI / multi-tenant VPS |
| Electron server | AppImage / NSIS `pack:linux:server` | Desktop « héberger » GUI |

Les deux exposent `/api/v1/core/health` + OS HTTP ; Docker n’ouvre pas de `BrowserWindow`.

## Santé / observabilité

- `GET /api/v1/os/boot-status` → splash JSON (200 dès le lancement — early-listen)
- `GET /api/v1/core/health` → `200` + `brandId` (503 pendant le boot)
- `GET /api/v1/core/version` → versions kit
- `GET /api/v1/os/status` → hosts (si profile full)
- `GET /api/v1/os/ready` → agrégat P&P (mode `docker` : vendors n8n/Hermes soft)
- `docker logs <container>` → une ligne JSONL `{"creezio":"boot-step",…}` par
  transition d'étape de boot
- `/data/ops/*.jsonl` → journal ops (mêmes kinds que le desktop)

Les **apps admin de marque** (ADR-admin-app-os) sont des apps Creezio
complètes : mêmes endpoints. Exemple TempoFlow admin (container
`tempoflowadmin-server-main`, port 18801) :

```bash
curl -sS http://127.0.0.1:18801/api/v1/os/boot-status | head -c 300
curl -sS http://127.0.0.1:18801/api/v1/core/health
# → {"ok":true,"space":"core","brandId":"tempoflowadmin",…}
```
