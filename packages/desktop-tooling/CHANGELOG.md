# @creezio/desktop-tooling

## 0.26.0

### Patch Changes

- @creezio/brand-config@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [2da43ad]
  - @creezio/brand-config@0.25.0

## 0.24.1

### Patch Changes

- @creezio/brand-config@0.24.1

## 0.24.0

### Patch Changes

- @creezio/brand-config@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [ddf823d]
  - @creezio/brand-config@0.23.0

## 0.22.0

### Patch Changes

- e11ba99: Smokes compatibles cohérence éventuelle Meili (contrat kit : pas de write-through, liste servie `engine:"indexing"` + 0 item pendant l'indexation initiale). Nouveau helper SoT `@creezio/desktop-tooling/scripts/meili-list-poll.mjs` (`assertModuleRowHydratedById` via `GET ?ids=<id>` — hydratation PK, chemin SQL légitime — + `pollModuleListUntilVisible` : polling borné 60 s, échec explicite immédiat si `engine:"meili"` sans le doc). `e2e-browser-parcours.mjs` l'utilise (fini l'assertion naïve GET liste immédiat post-create) et indexe par défaut (`MEILI_SKIP_INDEX` passe de `"1"` à `"0"` — sinon la liste d'une entité indexée reste `engine:"indexing"` indéfiniment). Templates factory (`renderMetierParcoursSmoke` générique + CHR, `renderMiniPrdCoreSmoke`) régénérés sur le même pattern ; assertions d'origine conservées. Gate : `test-phase-meili-smoke-polling`.
  - @creezio/brand-config@0.22.0

## 0.21.0

### Patch Changes

- @creezio/brand-config@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [e6303bb]
  - @creezio/brand-config@0.20.0

## 0.19.0

### Patch Changes

- @creezio/brand-config@0.19.0

## 0.18.0

### Patch Changes

- @creezio/brand-config@0.18.0

## 0.17.1

### Patch Changes

- @creezio/brand-config@0.17.1

## 0.17.0

### Patch Changes

- @creezio/brand-config@0.17.0

## 0.16.0

### Patch Changes

- @creezio/brand-config@0.16.0

## 0.15.0

### Patch Changes

- @creezio/brand-config@0.15.0

## 0.14.0

### Patch Changes

- @creezio/brand-config@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [a9e9fd7]
  - @creezio/brand-config@0.13.0

## 0.12.0

### Patch Changes

- @creezio/brand-config@0.12.0

## 0.11.0

### Patch Changes

- @creezio/brand-config@0.11.0

## 0.10.15

### Patch Changes

- @creezio/brand-config@0.10.15

## 0.10.14

### Patch Changes

- @creezio/brand-config@0.10.14

## 0.10.13

### Patch Changes

- @creezio/brand-config@0.10.13

## 0.10.12

### Patch Changes

- @creezio/brand-config@0.10.12

## 0.10.11

### Patch Changes

- @creezio/brand-config@0.10.11

## 0.10.10

### Patch Changes

- @creezio/brand-config@0.10.10

## 0.10.9

### Patch Changes

- @creezio/brand-config@0.10.9

## 0.10.8

### Patch Changes

- @creezio/brand-config@0.10.8

## 0.10.7

### Patch Changes

- @creezio/brand-config@0.10.7

## 0.10.6

### Patch Changes

- @creezio/brand-config@0.10.6

## 0.10.5

### Patch Changes

- @creezio/brand-config@0.10.5

## 0.10.4

### Patch Changes

- @creezio/brand-config@0.10.4

## 0.10.3

### Patch Changes

- @creezio/brand-config@0.10.3

## 0.10.2

### Patch Changes

- @creezio/brand-config@0.10.2

## 0.10.1

### Patch Changes

- @creezio/brand-config@0.10.1

## 0.10.0

### Minor Changes

- 96464bc: **BREAKING — Tunnel Cloudflare auto-provisionné par l'instance (fin du provisioner VPS et du sidecar cloudflared).**

  Le conteneur Docker crée, configure et sert son tunnel Cloudflare lui-même au boot via l'API CF (client `tunnel-cf-client` de `@creezio/platform-core`, Node pur, zéro dépendance) : GET du tunnel persisté dans `/data` → 404/token absent → recréation idempotente (le CNAME suit le nouvel id), PUT ingress (`http://127.0.0.1:18791` + services + hostnames supplémentaires multi-domaines sur le même tunnel), upsert DNS idempotent, cloudflared spawné **in-process** (binaire pinné `2026.7.3` dans l'image), sonde publique en arrière-plan non fatale.

  - **Contrat d'env** : `CREEZIO_CF_API_TOKEN` / `CREEZIO_CF_ACCOUNT_ID` / `CREEZIO_CF_ZONE_ID` (requis), `CREEZIO_CF_ZONE_NAME` / `CREEZIO_CF_UNIVERSAL_SSL` / `CREEZIO_TUNNEL_SLUG` / `CREEZIO_DOMAIN` (optionnels) — livrés au conteneur via `cf.env` (chmod 600) généré par `server-docker create`. `CREEZIO_TUNNEL_PROVISION_URL` / `_TOKEN` et `resolveTunnelProvision` sont **supprimés** (pas de fallback).
  - **Compose généré** : plus de service `cloudflared` sidecar ; `tunnel.env` → `cf.env` (600) ; secrets applicatifs isolés dans `secrets.env` (600) — aucun secret dans `environment:`.
  - **Nommage des hostnames de services** : `CREEZIO_CF_UNIVERSAL_SSL` truthy → nested (`n8n.{slug}.{zone}`) ; défaut **flat** (`n8n-{slug}.{zone}`). Remplace `CREEZIO_TUNNEL_FLAT_HOSTS`.
  - **CLI** : `create` est **fail-closed** (héritage #84/#86) : sans `CREEZIO_CF_*` (sauf `CREEZIO_TUNNEL_LOCAL=1`) **ou** sans owner VPS, échec actionnable — plus de loopback silencieux. Le contrat CF part dans `cf.env` (verify du token, aucun `/reserve`, aucun secret dans le registre). `rm` déprovisionne via l'API CF directe (DNS + tunnel) ; `enroll` gère l'ingress `agent[-.]{slug}` via le client CF ; `migrate-stack` bascule sidecar/legacy → in-container. Les instances live déjà up ne sont pas migrées par ce merge.
  - **Supprimé** : `docker/tunnel-provisioner/` entier (service, lib, docs).

  Migration des instances existantes : `creezio server-docker migrate-stack <nom> --brand-root …` avec le contrat `CREEZIO_CF_*` dans l'env (voir docs/RUNBOOK-AGENTS.md §7.3).

### Patch Changes

- @creezio/brand-config@0.10.0

## 0.9.4

### Patch Changes

- @creezio/brand-config@0.9.4

## 0.9.3

### Patch Changes

- @creezio/brand-config@0.9.3

## 0.9.2

### Patch Changes

- @creezio/brand-config@0.9.2

## 0.9.1

### Patch Changes

- @creezio/brand-config@0.9.1

## 0.9.0

### Patch Changes

- @creezio/brand-config@0.9.0

## 0.8.1

### Patch Changes

- 1dfb6f4: e2e-browser-parcours : importCreezio hoist-safe reapplique (le correctif 0.7.1
  avait ete perdu avant commit). Prouve localement : MISSION=SUCCESS sur winhub.
  - @creezio/brand-config@0.8.1

## 0.8.0

### Patch Changes

- @creezio/brand-config@0.8.0

## 0.7.1

### Patch Changes

- 200476c: e2e-browser-parcours : résolution hoist-safe des packages @creezio (imports
  nus depuis le script publié — workspaces monorepo où tout est hoisté à la
  racine) + export du sous-chemin `./scripts/*` pour que les wrappers apps
  résolvent via `import.meta.resolve` (plus de sondage `server/node_modules`).
  - @creezio/brand-config@0.7.1

## 0.7.0

### Minor Changes

- b4b90a7: Quick wins audit de robustesse (Q1→Q9) :

  - **Q1/Q6** — dev-stack standard dans `@creezio/app-runtime/scripts/dev-stack.mjs`
    (`dev`/`stop`/`status`/`setup` : kernel + Next dev, détection de ports, .env,
    PID files `.creezio/`, kill par process group) ; les apps l'exposent via le
    proxy factory `scripts/creezio-dev.mjs` — zéro copie divergente.
  - **Q2** — `port-guard.mjs` partagé (`@creezio/desktop-tooling`) : port
    explicitement demandé et occupé = erreur actionnable avec PID
    (« npm run stop ou METIER_PORT=0 ») dans le harness e2e et le dev-stack.
  - **Q4** — `engines: node >=22.5` partout (node:sqlite l'exige) + `.nvmrc`.
  - **Q5** — garde anti-stale `materialize` : marker versionné
    `.materialized-from-os-ui` + mode `--check` (erreur claire si les pages
    matérialisées divergent de la version installée).
  - **Q8** — sémantique unique : `CREEZIO_KIT_ROOT` = clone du kit,
    `CREEZIO_APP_ROOT` = clone de l'app (`CREEZIO_ROOT` conservé en fallback
    legacy partout).
  - **Q9** — `npm run clean` cross-platform (`scripts/clean.mjs`, fini rm -rf).

### Patch Changes

- @creezio/brand-config@0.7.0

## 0.6.0

### Patch Changes

- @creezio/brand-config@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [e23b259]
  - @creezio/brand-config@0.5.0
