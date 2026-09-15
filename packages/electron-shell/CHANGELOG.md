# @creezio/electron-shell

## 0.26.0

### Patch Changes

- Updated dependencies [2f5b6ea]
  - @creezio/platform-core@0.26.0
  - @creezio/browser-host@0.26.0
  - @creezio/shell@0.26.0
  - @creezio/host-runtime@0.26.0
  - @creezio/observability@0.26.0
  - @creezio/product-hub@0.26.0
  - @creezio/search@0.26.0
  - @creezio/brand-config@0.26.0

## 0.25.0

### Patch Changes

- 2da43ad: D1 / T10 — purge vocabulaire marque du runtime kit : markers Hermes hérités retirés, registre production propagation vidé (canaux data-driven), commentaires/JSDoc neutralisés, log opener `creezio-server`. Allowlist 270→117 / 493→173 occ. Pas de dual-read TEMPOFLOW\_\* recréé.
- Updated dependencies [2da43ad]
  - @creezio/brand-config@0.25.0
  - @creezio/host-runtime@0.25.0
  - @creezio/observability@0.25.0
  - @creezio/platform-core@0.25.0
  - @creezio/product-hub@0.25.0
  - @creezio/shell@0.25.0
  - @creezio/search@0.25.0
  - @creezio/browser-host@0.25.0

## 0.24.1

### Patch Changes

- @creezio/brand-config@0.24.1
- @creezio/shell@0.24.1
- @creezio/platform-core@0.24.1
- @creezio/product-hub@0.24.1
- @creezio/search@0.24.1
- @creezio/host-runtime@0.24.1
- @creezio/observability@0.24.1
- @creezio/browser-host@0.24.1

## 0.24.0

### Minor Changes

- efc7bb5: H12 — purge des shims P1.b d'electron-shell + dé-brandage workspace shell-ui (ARCHITECTURE_VERSION H11 → H12, convention 0.x : minor comme H10/H11).

  - `@creezio/electron-shell` : plus aucun ré-export `@deprecated` vers host-runtime/search ; subpath `./meili` retiré. Importer depuis les packages SoT.
  - `@creezio/host-runtime` : alias nommés marque retirés (`ensureTempoflowNode` → `ensureDesktopNode`, pins `TF2_*` → `DESKTOP_*`, `tempoflowSandboxPaths` → `desktopSandboxPaths`).
  - `@creezio/shell-ui` : `configureWorkspacePaths` remplace `configureFullscreenPaths` ; plus de `TF_LEGACY_*` / `PANIER_PATH` / `OPTIMISER_PATH` / `*Supplier*` dans le workspace.
  - Codemods `scripts/codemods/H12/` (`since: 0.24.0`), appliqués par `creezio upgrade`.
  - Gate `test-phase-electron-shell-frozen-exports` retirée (plus de surface gelée).

### Patch Changes

- Updated dependencies [efc7bb5]
  - @creezio/platform-core@0.24.0
  - @creezio/host-runtime@0.24.0
  - @creezio/search@0.24.0
  - @creezio/browser-host@0.24.0
  - @creezio/observability@0.24.0
  - @creezio/product-hub@0.24.0
  - @creezio/brand-config@0.24.0
  - @creezio/shell@0.24.0

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
- Updated dependencies [bf14b35]
- Updated dependencies [b0a53b0]
  - @creezio/platform-core@0.23.0
  - @creezio/brand-config@0.23.0
  - @creezio/search@0.23.0
  - @creezio/host-runtime@0.23.0
  - @creezio/product-hub@0.23.0
  - @creezio/browser-host@0.23.0
  - @creezio/observability@0.23.0
  - @creezio/shell@0.23.0

## 0.22.0

### Patch Changes

- @creezio/brand-config@0.22.0
- @creezio/shell@0.22.0
- @creezio/platform-core@0.22.0
- @creezio/product-hub@0.22.0
- @creezio/search@0.22.0
- @creezio/host-runtime@0.22.0
- @creezio/observability@0.22.0
- @creezio/browser-host@0.22.0

## 0.21.0

### Patch Changes

- Updated dependencies [ab09f4f]
  - @creezio/search@0.21.0
  - @creezio/host-runtime@0.21.0
  - @creezio/brand-config@0.21.0
  - @creezio/shell@0.21.0
  - @creezio/platform-core@0.21.0
  - @creezio/product-hub@0.21.0
  - @creezio/observability@0.21.0
  - @creezio/browser-host@0.21.0

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

- Updated dependencies [ac7035c]
- Updated dependencies [e6303bb]
  - @creezio/observability@0.20.0
  - @creezio/host-runtime@0.20.0
  - @creezio/platform-core@0.20.0
  - @creezio/brand-config@0.20.0
  - @creezio/search@0.20.0
  - @creezio/browser-host@0.20.0
  - @creezio/product-hub@0.20.0
  - @creezio/shell@0.20.0

## 0.19.0

### Patch Changes

- @creezio/brand-config@0.19.0
- @creezio/shell@0.19.0
- @creezio/platform-core@0.19.0
- @creezio/product-hub@0.19.0
- @creezio/search@0.19.0
- @creezio/host-runtime@0.19.0
- @creezio/observability@0.19.0
- @creezio/browser-host@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [7c40c12]
  - @creezio/search@0.18.0
  - @creezio/brand-config@0.18.0
  - @creezio/shell@0.18.0
  - @creezio/platform-core@0.18.0
  - @creezio/product-hub@0.18.0
  - @creezio/host-runtime@0.18.0
  - @creezio/observability@0.18.0
  - @creezio/browser-host@0.18.0

## 0.17.1

### Patch Changes

- @creezio/brand-config@0.17.1
- @creezio/shell@0.17.1
- @creezio/platform-core@0.17.1
- @creezio/product-hub@0.17.1
- @creezio/search@0.17.1
- @creezio/host-runtime@0.17.1
- @creezio/observability@0.17.1
- @creezio/browser-host@0.17.1

## 0.17.0

### Patch Changes

- Updated dependencies [13c1d18]
  - @creezio/platform-core@0.17.0
  - @creezio/browser-host@0.17.0
  - @creezio/host-runtime@0.17.0
  - @creezio/observability@0.17.0
  - @creezio/product-hub@0.17.0
  - @creezio/search@0.17.0
  - @creezio/brand-config@0.17.0
  - @creezio/shell@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies [5dfc286]
  - @creezio/platform-core@0.16.0
  - @creezio/observability@0.16.0
  - @creezio/browser-host@0.16.0
  - @creezio/host-runtime@0.16.0
  - @creezio/product-hub@0.16.0
  - @creezio/search@0.16.0
  - @creezio/brand-config@0.16.0
  - @creezio/shell@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies [1ab886b]
  - @creezio/observability@0.15.0
  - @creezio/host-runtime@0.15.0
  - @creezio/search@0.15.0
  - @creezio/brand-config@0.15.0
  - @creezio/shell@0.15.0
  - @creezio/platform-core@0.15.0
  - @creezio/product-hub@0.15.0
  - @creezio/browser-host@0.15.0

## 0.14.0

### Minor Changes

- 8232694: P2.a — desktop legacy : gel partiel à périmètre exact. La cartographie
  prouve que `brand-desktop-runtime.ts` est le moteur desktop PARTAGÉ
  (`startBrandDesktop` → `installBrandOsDesktop` l'appelle, shell `runtime`
  par défaut) — un package `@creezio/legacy-desktop` gelé est écarté sur
  preuve (ADR `docs/adr/ADR-p2a-desktop-legacy-freeze.md`). La compat marque
  héritée fonctionnelle (défauts d'env legacy, query param SiteLink, ordre
  des preloads historiques, alias `ensureTempoflowNode`) est extraite dans le
  module feuille `desktop/legacy-brand-compat.ts`, GELÉ fail-closed : gate
  `test-phase-legacy-desktop-frozen` (empreinte SHA-256 versionnée +
  consommateurs verrouillés) ; fixes sécurité uniquement, retrait prévu au
  bump H9 avec codemod clients legacy. Aucun changement d'API publique ni de
  comportement — aucun geste requis côté marque (pas de bump
  `ARCHITECTURE_VERSION`). Allowlist vocab F1.7 : périmètre desktop 33 → 21.

### Patch Changes

- @creezio/brand-config@0.14.0
- @creezio/shell@0.14.0
- @creezio/platform-core@0.14.0
- @creezio/product-hub@0.14.0
- @creezio/search@0.14.0
- @creezio/host-runtime@0.14.0
- @creezio/observability@0.14.0
- @creezio/browser-host@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [a9e9fd7]
  - @creezio/brand-config@0.13.0
  - @creezio/platform-core@0.13.0
  - @creezio/host-runtime@0.13.0
  - @creezio/product-hub@0.13.0
  - @creezio/browser-host@0.13.0
  - @creezio/observability@0.13.0
  - @creezio/search@0.13.0
  - @creezio/shell@0.13.0

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

- Updated dependencies [17c82b1]
  - @creezio/search@0.12.0
  - @creezio/host-runtime@0.12.0
  - @creezio/observability@0.12.0
  - @creezio/platform-core@0.12.0
  - @creezio/browser-host@0.12.0
  - @creezio/product-hub@0.12.0
  - @creezio/brand-config@0.12.0
  - @creezio/shell@0.12.0

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

- Updated dependencies [b0856ee]
  - @creezio/search@0.11.0
  - @creezio/host-runtime@0.11.0
  - @creezio/platform-core@0.11.0
  - @creezio/browser-host@0.11.0
  - @creezio/observability@0.11.0
  - @creezio/product-hub@0.11.0
  - @creezio/brand-config@0.11.0
  - @creezio/shell@0.11.0

## 0.10.15

### Patch Changes

- 0391870: P1.a — invariants d'architecture gravés en gates. brand-spec : le doctor rapporte `CREEZIO_MANIFEST_MISALIGNED` (error fail-closed) quand une dep `@creezio/*` a des specs divergentes entre les manifests d'une app marque (racine/server/server/ui/client — incident réel login 0.6.0, règle d'or docs/PROPAGATION.md). electron-shell : suppression des 2 derniers imports statiques d'`electron` dans `src/host/browser-tabs` (chrome-ua, browser-tab-manager) au profit de `loadElectron()` — `src/host/**` reste chargeable en Node pur (gate `test-phase-host-no-electron`).
  - @creezio/brand-config@0.10.15
  - @creezio/shell@0.10.15
  - @creezio/platform-core@0.10.15
  - @creezio/product-hub@0.10.15
  - @creezio/observability@0.10.15
  - @creezio/browser-host@0.10.15

## 0.10.14

### Patch Changes

- c0a8177: `searchMeiliIndexes` fail-closed : le catch vide avalait Meili down en `[]`
  (le search mount répondait 200 `engine:"meili"` silencieux avec un Meili
  mort). Seul l'index absent (HTTP 404, indexation initiale pas passée) reste
  toléré — toute autre erreur (connexion refusée, timeout, 5xx) est rethrow
  pour que l'appelant réponde 503 `meili_unavailable`.
  - @creezio/brand-config@0.10.14
  - @creezio/shell@0.10.14
  - @creezio/platform-core@0.10.14
  - @creezio/product-hub@0.10.14
  - @creezio/observability@0.10.14
  - @creezio/browser-host@0.10.14

## 0.10.13

### Patch Changes

- e07d2cf: Meili = composant CORE fail-closed (décision plateforme 2026-08-28) :

  - `maybeBootBrandMeili` : feed avec ≥ 1 index + binaire absent / start KO =
    **throw `MeiliRequiredError`** (échec de boot explicite, comme une DB
    absente). Échappatoire unique `CREEZIO_ALLOW_NO_MEILI=1` (dev/tests
    hors-browse, warning bruyant). Plus de `engine:"sql-fallback"` par défaut.
  - Entity-list (`createEntityApiMount`) : entité indexée + Meili KO =
    **503 `{error:"meili_unavailable"}`** (ou `engine:"indexing"` pendant
    l'indexation initiale) — zéro LIKE SQL de secours sur le catalogue. SQL
    reste légitime hors index (entité non indexée, filtre hors index visible,
    `?ids=`, archives).
  - Nouveau `browseMeiliIndexOutcome` (api-kernel + electron-shell/meili) :
    issue discriminée `ok / empty_index / index_missing / filter_rejected /
unavailable / unconfigured` ; `browseMeiliIndex` conservé (compat `null`).
  - Doctor brand-spec : `MODULE_MEILI_MISSING` fail-closed (0.10.13+) — chaque
    module métier avec entité listable déclare `meiliIndexes` (schéma data +
    index) ou `horsIndexJustification` explicite.
  - `startBrandDesktop` propage `MeiliRequiredError` (plus de swallow).
  - @creezio/brand-config@0.10.13
  - @creezio/shell@0.10.13
  - @creezio/platform-core@0.10.13
  - @creezio/product-hub@0.10.13
  - @creezio/observability@0.10.13
  - @creezio/browser-host@0.10.13

## 0.10.12

### Patch Changes

- 0823798: Meili browse : liste entity (q vide OK) via configureEntityMeiliFromFeed, helper browseMeiliIndex, SQL seulement si Meili KO ou filtre hors index.
  - @creezio/brand-config@0.10.12
  - @creezio/shell@0.10.12
  - @creezio/platform-core@0.10.12
  - @creezio/product-hub@0.10.12
  - @creezio/observability@0.10.12
  - @creezio/browser-host@0.10.12

## 0.10.11

### Patch Changes

- @creezio/brand-config@0.10.11
- @creezio/shell@0.10.11
- @creezio/platform-core@0.10.11
- @creezio/product-hub@0.10.11
- @creezio/observability@0.10.11
- @creezio/browser-host@0.10.11

## 0.10.10

### Patch Changes

- 4ecd205: Au re-ensure boot, le hostname public suit `CREEZIO_DOMAIN` (plus le store seul). Sans ça, un admin passé de `lp` à `admin`+`lp` gardait un ingress lp-only.
- Updated dependencies [4ecd205]
  - @creezio/platform-core@0.10.10
  - @creezio/brand-config@0.10.10
  - @creezio/shell@0.10.10
  - @creezio/product-hub@0.10.10
  - @creezio/observability@0.10.10
  - @creezio/browser-host@0.10.10

## 0.10.9

### Patch Changes

- @creezio/brand-config@0.10.9
- @creezio/shell@0.10.9
- @creezio/platform-core@0.10.9
- @creezio/product-hub@0.10.9
- @creezio/observability@0.10.9
- @creezio/browser-host@0.10.9

## 0.10.8

### Patch Changes

- @creezio/brand-config@0.10.8
- @creezio/shell@0.10.8
- @creezio/platform-core@0.10.8
- @creezio/product-hub@0.10.8
- @creezio/observability@0.10.8
- @creezio/browser-host@0.10.8

## 0.10.7

### Patch Changes

- Updated dependencies [55b1cd5]
  - @creezio/observability@0.10.7
  - @creezio/brand-config@0.10.7
  - @creezio/shell@0.10.7
  - @creezio/platform-core@0.10.7
  - @creezio/product-hub@0.10.7
  - @creezio/browser-host@0.10.7

## 0.10.6

### Patch Changes

- Updated dependencies [1c7ec66]
  - @creezio/observability@0.10.6
  - @creezio/brand-config@0.10.6
  - @creezio/shell@0.10.6
  - @creezio/platform-core@0.10.6
  - @creezio/product-hub@0.10.6
  - @creezio/browser-host@0.10.6

## 0.10.5

### Patch Changes

- Updated dependencies [6bce6a8]
  - @creezio/observability@0.10.5
  - @creezio/brand-config@0.10.5
  - @creezio/shell@0.10.5
  - @creezio/platform-core@0.10.5
  - @creezio/product-hub@0.10.5
  - @creezio/browser-host@0.10.5

## 0.10.4

### Patch Changes

- @creezio/brand-config@0.10.4
- @creezio/shell@0.10.4
- @creezio/platform-core@0.10.4
- @creezio/product-hub@0.10.4
- @creezio/observability@0.10.4
- @creezio/browser-host@0.10.4

## 0.10.3

### Patch Changes

- Updated dependencies [5f8a383]
  - @creezio/observability@0.10.3
  - @creezio/brand-config@0.10.3
  - @creezio/shell@0.10.3
  - @creezio/platform-core@0.10.3
  - @creezio/product-hub@0.10.3
  - @creezio/browser-host@0.10.3

## 0.10.2

### Patch Changes

- 0748020: **fix(tunnel) — superviseur cloudflared in-process (respawn borné).**

  Si le process QUIC meurt, le kernel logguait `cloudflared exit` et ne le relançait pas → hostname public **525** alors que localhost restait 200 (recette / demo / admin, 15-16/08). `startCloudflared` respawn maintenant avec backoff (1 s → 30 s, 8 essais consécutifs, compteur remis à zéro après 60 s d'uptime sain). `stopCloudflared` / `forgetTunnel` annulent le timer. Le respawn **réutilise** le token et l'id persistés — aucun POST `cfd_tunnel` (pas de nouvel id). Fail-closed #84/#86/#87 inchangé. Prend effet au prochain bump/rebuild ; pas de redéploiement live dans ce tour.

  - @creezio/brand-config@0.10.2
  - @creezio/shell@0.10.2
  - @creezio/platform-core@0.10.2
  - @creezio/product-hub@0.10.2
  - @creezio/observability@0.10.2
  - @creezio/browser-host@0.10.2

## 0.10.1

### Patch Changes

- @creezio/brand-config@0.10.1
- @creezio/shell@0.10.1
- @creezio/platform-core@0.10.1
- @creezio/product-hub@0.10.1
- @creezio/observability@0.10.1
- @creezio/browser-host@0.10.1

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

- Updated dependencies [96464bc]
  - @creezio/platform-core@0.10.0
  - @creezio/observability@0.10.0
  - @creezio/browser-host@0.10.0
  - @creezio/product-hub@0.10.0
  - @creezio/brand-config@0.10.0
  - @creezio/shell@0.10.0

## 0.9.4

### Patch Changes

- @creezio/brand-config@0.9.4
- @creezio/shell@0.9.4
- @creezio/platform-core@0.9.4
- @creezio/product-hub@0.9.4
- @creezio/observability@0.9.4
- @creezio/browser-host@0.9.4

## 0.9.3

### Patch Changes

- @creezio/brand-config@0.9.3
- @creezio/shell@0.9.3
- @creezio/platform-core@0.9.3
- @creezio/product-hub@0.9.3
- @creezio/observability@0.9.3
- @creezio/browser-host@0.9.3

## 0.9.2

### Patch Changes

- Updated dependencies [10b5198]
  - @creezio/observability@0.9.2
  - @creezio/brand-config@0.9.2
  - @creezio/shell@0.9.2
  - @creezio/platform-core@0.9.2
  - @creezio/product-hub@0.9.2
  - @creezio/browser-host@0.9.2

## 0.9.1

### Patch Changes

- @creezio/brand-config@0.9.1
- @creezio/shell@0.9.1
- @creezio/platform-core@0.9.1
- @creezio/product-hub@0.9.1
- @creezio/observability@0.9.1
- @creezio/browser-host@0.9.1

## 0.9.0

### Patch Changes

- @creezio/brand-config@0.9.0
- @creezio/shell@0.9.0
- @creezio/platform-core@0.9.0
- @creezio/product-hub@0.9.0
- @creezio/observability@0.9.0
- @creezio/browser-host@0.9.0

## 0.8.1

### Patch Changes

- @creezio/brand-config@0.8.1
- @creezio/shell@0.8.1
- @creezio/platform-core@0.8.1
- @creezio/product-hub@0.8.1
- @creezio/observability@0.8.1
- @creezio/browser-host@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies [848ec06]
  - @creezio/platform-core@0.8.0
  - @creezio/observability@0.8.0
  - @creezio/browser-host@0.8.0
  - @creezio/product-hub@0.8.0
  - @creezio/brand-config@0.8.0
  - @creezio/shell@0.8.0

## 0.7.1

### Patch Changes

- @creezio/brand-config@0.7.1
- @creezio/shell@0.7.1
- @creezio/platform-core@0.7.1
- @creezio/product-hub@0.7.1
- @creezio/observability@0.7.1
- @creezio/browser-host@0.7.1

## 0.7.0

### Minor Changes

- adf6d46: **M2 — 1 instance serveur = 1 stack compose autonome (app + cloudflared sidecar).**

  - `server-docker create` génère par défaut un stack compose par instance :
    port interne fixe 18791, port hôte loopback auto (`127.0.0.1::18791`,
    `--host-port N` pour un fixe), sidecar cloudflared (token dans
    `tunnel.env` chmod 600), zéro port public. `--no-stack` = legacy.
  - `server-docker migrate-stack <nom>` : bascule une instance legacy en
    douceur — backup /data obligatoire, ingress tunnel repointé
    `http://app:18791` (provisioner `serviceHost`), rollback legacy auto si KO.
  - Kernel : mode sidecar (`CREEZIO_TUNNEL_SIDECAR=1`) — config tunnel seedée
    par env (`CREEZIO_TUNNEL_TOKEN/_HOSTNAME/_ID`), ingress via provisioner
    avec `serviceHost`, `startCloudflared` no-op (le sidecar tourne déjà).
  - Provisioner : `/reserve` et `/configure` acceptent `serviceHost` (défaut
    127.0.0.1 — rétrocompatible), persisté dans le state du slug.
  - `update` stack-aware (server-lib) : compose régénéré avec la nouvelle
    image, `compose up -d`, registre réaligné sur le port hôte réattribué.
  - start/stop/rm/logs/ls stack-aware ; SoT renderer partagée
    (`fleet-collector/instance-stack.mjs`) entre CLI factory et server-lib.
  - dev-stack (Q1) matérialise les pages OS avant `next dev` (le hook predev
    de server/ui est contourné par le spawn direct — Q5 appliqué au dev).

### Patch Changes

- Updated dependencies [adf6d46]
  - @creezio/observability@0.7.0
  - @creezio/brand-config@0.7.0
  - @creezio/shell@0.7.0
  - @creezio/platform-core@0.7.0
  - @creezio/product-hub@0.7.0
  - @creezio/browser-host@0.7.0

## 0.6.0

### Patch Changes

- @creezio/brand-config@0.6.0
- @creezio/shell@0.6.0
- @creezio/platform-core@0.6.0
- @creezio/product-hub@0.6.0
- @creezio/observability@0.6.0
- @creezio/browser-host@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [e23b259]
- Updated dependencies [d674c86]
  - @creezio/brand-config@0.5.0
  - @creezio/observability@0.5.0
  - @creezio/platform-core@0.5.0
  - @creezio/shell@0.5.0
  - @creezio/product-hub@0.5.0
  - @creezio/browser-host@0.5.0
