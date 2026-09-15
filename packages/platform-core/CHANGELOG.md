# @creezio/platform-core

## 0.26.0

### Minor Changes

- 2f5b6ea: H13 — résidu allowlist runtime (ARCHITECTURE_VERSION H12 → H13, convention 0.x : minor comme H10/H11/H12).

  - Crash env : plus de dual-read `TF2_*` / `CERTIVAN_*` / `FIDU_*` / `TEMPOFLOW3_*` — `CREEZIO_*` + scan `envKey`.
  - `envForNodeScriptSpawn` : plus d'heuristique packagée nommée marque.
  - UI kit : `creezio-fake-cursor`, `creezio-titlebar-*`, cache SW `creezio-shell-*`.
  - Codemods `scripts/codemods/H13/` (`since: 0.26.0`), appliqués par `creezio upgrade`.

### Patch Changes

- @creezio/brand-config@0.26.0

## 0.25.0

### Patch Changes

- 2da43ad: D1 / T10 — purge vocabulaire marque du runtime kit : markers Hermes hérités retirés, registre production propagation vidé (canaux data-driven), commentaires/JSDoc neutralisés, log opener `creezio-server`. Allowlist 270→117 / 493→173 occ. Pas de dual-read TEMPOFLOW\_\* recréé.
- Updated dependencies [2da43ad]
  - @creezio/brand-config@0.25.0

## 0.24.1

### Patch Changes

- @creezio/brand-config@0.24.1

## 0.24.0

### Minor Changes

- efc7bb5: H12 — purge des shims P1.b d'electron-shell + dé-brandage workspace shell-ui (ARCHITECTURE_VERSION H11 → H12, convention 0.x : minor comme H10/H11).

  - `@creezio/electron-shell` : plus aucun ré-export `@deprecated` vers host-runtime/search ; subpath `./meili` retiré. Importer depuis les packages SoT.
  - `@creezio/host-runtime` : alias nommés marque retirés (`ensureTempoflowNode` → `ensureDesktopNode`, pins `TF2_*` → `DESKTOP_*`, `tempoflowSandboxPaths` → `desktopSandboxPaths`).
  - `@creezio/shell-ui` : `configureWorkspacePaths` remplace `configureFullscreenPaths` ; plus de `TF_LEGACY_*` / `PANIER_PATH` / `OPTIMISER_PATH` / `*Supplier*` dans le workspace.
  - Codemods `scripts/codemods/H12/` (`since: 0.24.0`), appliqués par `creezio upgrade`.
  - Gate `test-phase-electron-shell-frozen-exports` retirée (plus de surface gelée).

### Patch Changes

- @creezio/brand-config@0.24.0

## 0.23.0

### Minor Changes

- ddf823d: H11 — purge de la compat TF2-era (`ARCHITECTURE_VERSION` H10 → **H11**,
  ADR `docs/adr/ADR-h11-purge-tf2-compat.md`).

  Dual-reads `TEMPOFLOW_*` retirés (env canonique = `envKey` / envPrefix
  du manifest). Manifests kit `tempoflow` / `certivan` / `fidu` et leurs
  entrées de registre supprimés (`demobrand` reste).
  `createChrCatalogMeiliFeed` et l'alias `sites` → `fournisseurs` de
  `fingerprintCountKey` retirés. Alias
  `clearTempoflowGeneratedWebuiPassword` retiré ; le workspace IA exige
  `preload.js` (échec explicite si absent). Fallback registre kit des
  `build-builder-config.mjs` générés retiré.

  **Breaking** : une marque qui s'appuie encore sur `TEMPOFLOW_*`, un
  manifest kit, `createChrCatalogMeiliFeed`, l'alias Tempoflow du password
  WebUI ou `preload-app.js` casse au boot / à l'import. Migration
  automatique via `creezio upgrade` (codemod `scripts/codemods/H11/`,
  idempotent, fail-closed).

- bf14b35: T7 — tunnel cloudflared DÉDIÉ au host-agent. L'ingress `agent.{slug}.{zone}` / `agent-{slug}.{zone}` appartient exclusivement au cycle de vie du host-agent : `creezio server-docker enroll` et `agent up` provisionnent un tunnel Cloudflare propre (`ensureCfAgentTunnel`, nom CF `creezio-agent-<slug>`, container `creezio-agent-tunnel`, token `docker-data/agent-tunnel.env` 600). `agent up` (chaque update de l'agent) détecte un hôte déjà enrôlé sans tunnel dédié et exécute la migration (provision → connecteur → bascule CNAME → retrait d'une règle résiduelle). Fail-closed si `CREEZIO_CF_*` manquent. `server-docker rm` d'une instance ne touche jamais les DNS agent ; seul `agent rm` les retire (`deprovisionCfAgentTunnel`). Plus d'option `agent` sur l'ingress kernel des instances, plus de kill-switch `CREEZIO_AGENT_TUNNEL_WATCH`. Respawn surveillé par `@creezio/fleet` `agent-tunnel.ts`. Gates : `test-phase-agent-tunnel`, `test-phase-tunnel-self-provision` §10, `test-phase-server-docker` (rm instance ≠ DNS agent).
- b0a53b0: T9 — retrait de la compat desktop legacy (`ARCHITECTURE_VERSION` H9 →
  **H10**, ADR `docs/adr/ADR-p2a-desktop-legacy-freeze.md` note de clôture).

  Le module gelé `electron-shell/src/desktop/legacy-brand-compat.ts` est
  supprimé, avec sa gate `test-phase-legacy-desktop-frozen` et l'empreinte
  `scripts/legacy-desktop-frozen.json`. Le moteur desktop
  (`installBrandDesktopRuntime`) applique des défauts génériques :
  `<PREFIX>_PLUGINS_DIR`, `<brandId>fid`, `<PREFIX>_API_KEY`, preload unique
  `preload.js`, contrat host `ensureDesktopNode` (sans alias).

  **Breaking pour les clients desktop legacy** (repos hors kit appelant
  `installBrandDesktopRuntime` directement avec un envPrefix historique) :
  les valeurs d'env implicites et le basename preload historique ne sont
  plus sondés. Migration automatique via `creezio upgrade` (codemod
  `scripts/codemods/H10/`, idempotent, fail-closed) : injection des deps
  explicites aux valeurs historiques, renommage `ensureTempoflowNode` →
  `ensureDesktopNode`, rebascule `preload-app.js` → `preload.js`. Aucun
  geste pour les marques modernes (`startBrandDesktop`).

### Patch Changes

- Updated dependencies [ddf823d]
  - @creezio/brand-config@0.23.0

## 0.22.0

### Patch Changes

- @creezio/brand-config@0.22.0

## 0.21.0

### Patch Changes

- @creezio/brand-config@0.21.0

## 0.20.0

### Minor Changes

- e6303bb: P1.c — coupe `electron` / `electron-shell` de l'image serveur :

  - `resources/{vendor,scripts,bin}` (Hermes, n8n, skills, sonde Meili)
    déménagent de `@creezio/electron-shell` vers `@creezio/host-runtime`.
  - `kitOsResourcesRoot()` résout `@creezio/host-runtime`.
  - Factory : plus d'`electron-shell` dans `SERVER_CREEZIO_DEPS` (le client
    thin le garde).
  - Dockerfile : après `npm ci`, purge `electron`, `electron-updater` et
    `@creezio/electron-shell` du stage deps (runtime headless Node pur).

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

### Minor Changes

- 13c1d18: P3.a — runner de montée de version marque : nouvelle commande `creezio
upgrade` (détection version d'architecture, chaîne de codemods H* dans
  l'ordre avec idempotence vérifiée, bump `@creezio/*`de tous les manifests
en`--package-lock-only`, rematérialisation os-ui, doctor fail-closed,
`--dry-run`) ; codemods embarqués dans le package factory publié ; scaffold
stampe `creezio.architectureVersion` ; doctor brand-spec : les seuils datés
(`\*\_CONTRACT_SINCE`) passent en politique N-2 (pin marque à plus de 2
  versions lockstep derrière le kit = error, sinon warn).

### Patch Changes

- @creezio/brand-config@0.17.0

## 0.16.0

### Minor Changes

- 5dfc286: P2.c — le contrat de module `BrandModuleDef` devient un type importé du kit,
  jamais copié (`ARCHITECTURE_VERSION` H8 → **H9**, codemod
  `scripts/codemods/H9/`, ADR `docs/adr/ADR-p2c-module-contract.md`).

  - `@creezio/app-runtime` : nouvelle SoT `BrandModuleDef` / `BrandNavItem` /
    `BrandMeiliIndex` + `createBrandModuleRegistry(modules)` (collecteurs
    génériques du registre marque).
  - `@creezio/factory` : `modules/types.ts` généré = simple ré-export du kit ;
    `modules/index.ts` généré délègue ses collecteurs au kit.
  - `@creezio/api-kernel` : `ApiMount.accessJustification` (justification
    explicite d'un mount sans `permission`) ; `EntitySpec.permission` /
    `.accessJustification` threadés sur le mount CRUD généré.
  - `@creezio/brand-spec` doctor (seuil pin 0.16.0, mécanique
    `MODULE_MEILI_MISSING`) : `MODULE_TYPES_DIVERGENT` (redéclaration locale
    du contrat), `MODULE_PERMISSION_MISSING` (apiMount manuscrit sans
    `permission` ni `accessJustification` — règle d'or n°7, audit F3.4),
    `MODULE_PERMISSION_UNQUALIFIED` (warn sur la dette `"à qualifier"` posée
    par le codemod H9).

### Patch Changes

- @creezio/brand-config@0.16.0

## 0.15.0

### Patch Changes

- @creezio/brand-config@0.15.0

## 0.14.0

### Patch Changes

- @creezio/brand-config@0.14.0

## 0.13.0

### Minor Changes

- a9e9fd7: P1.d — le kit ne publie plus les manifests de ses marques (« le kit ne
  connaît pas ses consommateurs », docs/PROPAGATION.md). Bump
  `ARCHITECTURE_VERSION` H7 → **H8** (codemod
  `scripts/codemods/H8/h8-materialize-brand-manifest.mjs`, ADR
  `docs/adr/ADR-h8-extract-brand-manifests.md`).

  - `tempoflow3Manifest` et `manifests/tempoflow3.ts` **supprimés** : le
    manifest vit dans le repo marque (`src/electron/app-manifest.{ts,json}`,
    résolu via `resolveManifest` / le JSON local des scripts
    `build-builder-config.mjs`).
  - `demobrandManifest` (sandbox kit) reste.
  - **Politique de dépréciation (une version)** : `tempoflowManifest`,
    `certivanManifest`, `fiduManifest` et leurs entrées du registre
    `manifests` restent publiés UNE version, marqués `@deprecated (P1.d — à
matérialiser dans le repo marque via le codemod H8)` — retrait au
    prochain bump d'architecture, après passage du codemod H8 dans les repos
    marque concernés.
  - Factory : `build-builder-config.mjs` généré résout désormais « manifest
    local d'abord » (`src/electron/app-manifest.json`), registre kit en
    fallback déprécié avec warning.
  - Gate `test-phase-no-brand-vocab` renforcée : exclusion globale
    `brand-config/src/manifests/` remplacée par des entrées exactes (117
    occurrences comptées, 44 supprimées avec tempoflow3.ts) + NV4 : tout
    nouveau fichier `manifests/<marque>.ts` hors demobrand = rouge.

### Patch Changes

- Updated dependencies [a9e9fd7]
  - @creezio/brand-config@0.13.0

## 0.12.0

### Minor Changes

- 17c82b1: P1.c — H7 : neutralisation des contrats au vocabulaire marque (ARCHITECTURE_VERSION H6 → H7).

  Breaking contrôlé avec **dual-read une version** (politique de dépréciation —
  voir `docs/adr/ADR-h7-neutralize-brand-contracts.md`) :

  - **search** : `countTables`/`CatalogSqlCounts` génériques (`Record<string, …>`),
    `countKey` libre par index ; alias `sites`→`fournisseurs` normalisé par
    `fingerprintCountKey` (une version) ; `createChrCatalogMeiliFeed`,
    `expectedMeiliCounts`, `countGedSql` dépréciés (retrait au prochain bump).
    Meili reste fail-closed à l'identique.
  - **host-runtime** : env bridge Hermes dérivé du manifest (`envKey`) ; dual-read
    `TEMPOFLOW_*`, `TF2_HERMES_REMOTE_KEY` et fichiers `~/.tempoflow-*` legacy
    avec warnings bruyants ; `clearTempoflowGeneratedWebuiPassword` déprécié
    (alias de `clearGeneratedWebuiPassword`).
  - **brand-spec** : `vertical?: string` (libre), `feedPreset?: string` (id du
    registre de presets factory ; valeur legacy `<vertical>-catalog` normalisée).
  - **observability** : plus de fallbacks `CERTIVAN_/FIDU_FLEET_STATE_DIR` —
    lecture générique de `${envPrefix}_FLEET_STATE_DIR` dérivé du manifest.
  - **propagation** : canaux data-driven (`listUpdateChannels`,
    `configureBrandChannels`, `brandPrChannelId`) ; `UPDATE_CHANNELS` déprécié
    (snapshot) ; plus de noms de marque ni chemins absolus dans les types.
  - **factory** : registre de presets de feed Meili
    (`registerMeiliFeedPreset`/`getMeiliFeedPreset`) — preset catalogue CHR
    inliné dans le code marque généré.

  Migration marque : codemod idempotent `scripts/codemods/H7/h7-neutralize-brand-contracts.mjs`
  (`ROOT=<clone marque> node …`).

### Patch Changes

- @creezio/brand-config@0.12.0

## 0.11.0

### Minor Changes

- b0856ee: P1.b — extraction du host Node pur d'electron-shell en deux nouveaux packages, SANS breaking change.

  **Nouveaux packages :**

  - `@creezio/search` — tout le sous-domaine Meili : `meili/**` (feed,
    generic-indexer, index-schema, indexer, coherence, coherence-db,
    coherence-query, browse), `meili-launcher` (`startMeili`) et
    `brand-meili-boot` (`maybeBootBrandMeili`). Déménagement pur, zéro
    changement de comportement runtime (fail-closed 0.10.13/0.10.14 intact).
  - `@creezio/host-runtime` — le reste du host Node pur : logger,
    `loadElectron`, hermes/, n8n/, tunnel/, plugins/ (launcher +
    control-plane), sandbox/, ai-workspace/, node-runtime, npm-cli,
    ensure-kit-binaries, server-env, server-launcher, brand-host-stack,
    brand-host-runtime, brand-kernel-http, crash-reporter, bridge-client,
    contracts, context, safe-storage, local-config, feature-off-host,
    factory-reset-runtime. Dépend de `@creezio/search` (sens choisi d'après
    le graphe d'imports réel : brand-host-stack/host-stack → meili, jamais
    l'inverse).

  **Compat (aucun import ne casse) :**

  - `@creezio/electron-shell` est réduit au desktop Electron (boot, fenêtres,
    tray, updater, splash, bridge, admin-window, desktop/, browser-tabs,
    web-telemetry) et **ré-exporte toute la surface déménagée** avec
    `@deprecated` — y compris le subpath `@creezio/electron-shell/meili`
    (shim vers `@creezio/search`). Cette surface est FIGÉE par la nouvelle
    gate `test-phase-electron-shell-frozen-exports`.
  - `kitOsResourcesRoot` / `kitOsVendorDir` / `electronShellPackageRoot` et
    `envForNodeScriptSpawn` vivent désormais dans `@creezio/platform-core`
    (ré-exportés à l'identique par host-runtime et electron-shell).
  - `resources/vendor` et `resources/bin` restent shippés par
    `@creezio/electron-shell` (résolution `kitOsResourcesRoot` inchangée).

  **Consommateurs kit migrés vers les imports directs :** `app-runtime`
  (start-brand-kernel-harness, start-brand-desktop, compose-brand-os,
  install-brand-os-desktop, listen-brand-os-http, start-brand-ui-plane,
  harness-server-phases, types) — le harness serveur Docker n'a plus de
  dépendance fonctionnelle à electron-shell (le paquet reste dans l'arbre de
  l'image pour resources/vendor ; TODO P1.c documenté dans
  docker/server/Dockerfile et test-phase-server-docker).

  `@creezio/propagation` : registre des packages + surfaces marque mis à jour
  avec les deux nouveaux packages.

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

- 4ecd205: `ensureCfCnameRecord` remplace un A/AAAA héritage (NPM / IP VPS) par le CNAME tunnel. Sans ça, admin.{zone} restait collé à l'IP hôte.
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

- @creezio/brand-config@0.8.1

## 0.8.0

### Minor Changes

- 848ec06: Module natif `@creezio/access-control` : visibilité modules/sidebar par rôle,
  administrable en UI.

  - **Nouveau package** : rôles déclaratifs marque (config) + overrides
    allow/deny en DB (`access_role_overrides`, `access_user_roles`,
    `access_audit_log` sur core.db), résolution dynamique `resolvePermissions`
    (cache 30 s invalidé aux écritures), API `/api/v1/access/*` gardée par
    `platform.access.manage`, UI admin « Rôles & accès » (matrice, comptes,
    journal).
  - - **platform-core** : manifeste `kit-packages.json` (liste officielle des
      packages publiés, généré au build, gate de fraîcheur) — les gates
      deps-integrity des apps le lisent au lieu de listes en dur.
  - **auth** : adaptateur `resolveEffectivePermissions` — `/me` et les JWT
    mintés (login, impersonation) embarquent les permissions résolues
    dynamiquement quand la marque configure access-control.
  - **shell-ui** : `CoreNavItem.permission` / `SidebarNavItem.permission` +
    filtrage des entrées primaires de sidebar (même logique que l'admin) ;
    entrée admin native « Rôles & accès ».
  - **api-kernel** : `ApiMount.permission` + hook `authorizeModuleAccess` —
    le kernel refuse l'appel API (401/403), pas seulement l'affichage.
  - **app-runtime** : montage du module sur la surface plateforme (store
    core.db, routes, injection auth) + garde kernel câblée (session, owner,
    machine keys bordure).
  - **factory / os-ui** : nouvelle marque générée = page `/admin/access`,
    entrée de nav avec permission, deps et transpilePackages à jour.

### Patch Changes

- @creezio/brand-config@0.8.0

## 0.7.1

### Patch Changes

- @creezio/brand-config@0.7.1

## 0.7.0

### Patch Changes

- @creezio/brand-config@0.7.0

## 0.6.0

### Patch Changes

- @creezio/brand-config@0.6.0

## 0.5.0

### Patch Changes

- d674c86: Peers internes @creezio/\* en `>=0.4.0` (au lieu de `^0.4.0`) : ?vite que le
  train lockstep escalade en 1.0.0 au premier bump minor (les peers restent
  satisfaits par toute version future du kit).
- Updated dependencies [e23b259]
  - @creezio/brand-config@0.5.0
