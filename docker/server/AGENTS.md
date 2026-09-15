# AGENTS — `docker/server`

## Mission

SoT **générique kit** pour lancer des serveurs marque headless (HTTP API +
CRM web Next) via Docker, multi-instances, sans AppImage/Electron.

## Ne pas faire

- Hardcoder un métier TF/CV/Fidu dans le Dockerfile (gate le vérifie).
- Utiliser le project name Compose d'un stack prod (`tempoflow`, `n8n`, …) —
  rester sur `creezio-servers` / override marque `tf3-servers`.
- Instances **Compose** en lettres (`server-a`) — chiffres uniquement
  (`server-1`, `server-2`, …). Les instances **registre**
  (`creezio server-docker create <nom>`) sont nommées librement
  (`[a-z0-9][a-z0-9-]*`) → containers `<brandId>-server-<nom>`.
- Publier les ports sur `0.0.0.0` par défaut — loopback obligatoire,
  exposition opt-in (`--expose` / `SERVER_BIND`).
- Committer secrets tunnel/catalog dans compose ou `.env` versionné.
- Dupliquer l'orchestration OS : le CMD doit rester le harness marque →
  `startBrandKernelHarness`.
- Régénérer un `package-lock` à la main sans passer par
  `ensureBrandPackageLocks` / `scripts/ensure-server-lock.mjs` (lock racine
  workspace + locks ui/client) : relance la boucle `npm ci` rouge.
  Docker image : le Dockerfile pose déjà `/app/node_modules`.
- Passer le token npm en ARG/ENV de build — obligatoirement en **secret
  BuildKit** (`--secret id=CREEZIO_NPM_TOKEN,env=CREEZIO_NPM_TOKEN`, posé
  par le CLI) : un ARG reste dans `docker history`.

## Points d'entrée

| Fichier | Rôle |
|---------|------|
| `Dockerfile` | Image générique (context = racine marque, Meili + UI Next embarqués). `ARG IMAGE_SOURCE` + label OCI `org.opencontainers.image.source` (posé par `creezio server-docker publish`, fail-closed si registre `ghcr.io` et remote git marque introuvable). |
| `docker-compose.yml` | Legacy `server-1` + `server-2` (bind 127.0.0.1) |
| `brand.dockerignore` | Template ignore v4 (posé/rafraîchi en `.dockerignore` marque) |
| `Dockerfile` | Image serveur npm — `npm ci` workspace via **secret BuildKit** `CREEZIO_NPM_TOKEN` ; matérialisé en `docker/server.Dockerfile` marque (clone GitHub autonome ; gate `test-phase-clone-autonomy`) |
| `ensure-server-lock.mjs` | SoT pré-flight lockfiles npm (racine workspace + ui/client) — matérialisé en `scripts/ensure-server-lock.mjs` |
| `creezio-open-url.sh` | Opener navigateur (firefox/gio/xdg-open…) → `~/bin/` |
| `README.md` | Doc humaine (registre, admin, sécurité, boot-status) |
| `REMOTE-ACCESS.md` | Reverse proxy nginx-proxy-manager |
| CLI `creezio server-docker` | `create/start/stop/rm/logs/ls/admin` + `build/up/down/ps/proof` |
| `../server-admin/` | Image admin web (backend `@creezio/fleet`) |

## Config

- Registre : `{BRAND_ROOT}/docker-data/servers.json` (SoT instances —
  `packages/factory/src/server-docker-registry.ts`).
- Volumes : `{BRAND_ROOT}/docker-data/servers/<nom>` → `/data` (= userData).
- Boot observable : early-listen `GET /api/v1/os/boot-status` (SplashViewModel
  JSON), JSONL par étape dans `docker logs`, ops journal `/data/ops/`.
- First-run : UI HTTP `/setup` (pas de tray/NSIS) ; seed via env `CREEZIO_*`.
- Recherche : Meili embarqué (`MEILI_BINARY=/opt/creezio/bin/meilisearch`).
- Hermes + n8n VPS : `create`/`update` (pas tunnel-local) force `CREEZIO_NATIVE_WARM=1` + `CREEZIO_NATIVE_WARM_HERMES=1` et ignore `CREEZIO_NATIVE_WARM_N8N=0` / `CREEZIO_NATIVE_WARM=0` (warn « ignoré, n8n/hermes requis »). Skip local uniquement si `CREEZIO_TUNNEL_LOCAL=1`.
- Raccourcis compose : `{Product}-Server-{N}.desktop` → `~/bin/open-creezio-server-N`
  (**jamais** `Exec=xdg-open` seul — souvent absent hors desktop).

## Modifier

1. Bind HTTP : `CREEZIO_HTTP_HOST` géré dans `listenBrandOsHttp` /
   `listenBrandKernelHttp` — ne pas forcer `127.0.0.1` dans l'image
   (le loopback se fait au publish côté hôte).
2. Compose local : `CREEZIO_NATIVE_WARM=0` (image légère / CI). VPS create/update : WARM=1 + n8n + Hermes (incontournable).
3. Après changement runtime consommé : `npm run build -w @creezio/app-runtime`
   (+ electron-shell si besoin), changeset → publication npm, puis
   `npm update "@creezio/*"` côté marque.
4. Gate : `node --test scripts/test-phase-server-docker.mjs`.

## Preuve

```bash
# VPS : provisioner + owner requis — hostname {slug}.crm.foove.io
# (CREEZIO_OWNER_EMAIL / CREEZIO_OWNER_PASSWORD — pas de compte magique hors env)
creezio server-docker create acme --brand-root "$BRAND_ROOT" --profile prod
# Dev : CREEZIO_TUNNEL_LOCAL=1 creezio server-docker create demo --brand-root "$BRAND_ROOT"
curl -sS http://127.0.0.1:1879X/api/v1/os/boot-status | head -c 300
curl -sS http://127.0.0.1:1879X/api/v1/core/health
curl -sSI http://127.0.0.1:1879X/login        # CRM web (200, pas 404)
creezio server-docker admin up --brand-root "$BRAND_ROOT"
# brandId cohérent, HTTP 200, boot-status avec étapes, admin liste l'instance
```
