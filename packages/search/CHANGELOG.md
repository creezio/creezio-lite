# @creezio/search

## 0.26.0

### Patch Changes

- Updated dependencies [2f5b6ea]
  - @creezio/platform-core@0.26.0
  - @creezio/observability@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [2da43ad]
  - @creezio/observability@0.25.0
  - @creezio/platform-core@0.25.0

## 0.24.1

### Patch Changes

- @creezio/platform-core@0.24.1
- @creezio/observability@0.24.1

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
  - @creezio/observability@0.24.0

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

### Patch Changes

- Updated dependencies [ddf823d]
- Updated dependencies [bf14b35]
- Updated dependencies [b0a53b0]
  - @creezio/platform-core@0.23.0
  - @creezio/observability@0.23.0

## 0.22.0

### Patch Changes

- @creezio/platform-core@0.22.0
- @creezio/observability@0.22.0

## 0.21.0

### Minor Changes

- ab09f4f: Doctor brand-spec : cohérence `meiliIndexes.table` ↔ migrations (résolution cross-module + historiques `fromprd_brand_*`). Nouveau check `MODULE_MEILI_TABLE_UNKNOWN`. Champ déclaratif `tableProvisionedBy` sur `BrandMeiliIndexSpec` (table provisionnée à l'exécution — pas d'env de bypass).

### Patch Changes

- @creezio/platform-core@0.21.0
- @creezio/observability@0.21.0

## 0.20.0

### Patch Changes

- e6303bb: P1.c — coupe `electron` / `electron-shell` de l'image serveur :

  - `resources/{vendor,scripts,bin}` (Hermes, n8n, skills, sonde Meili)
    déménagent de `@creezio/electron-shell` vers `@creezio/host-runtime`.
  - `kitOsResourcesRoot()` résout `@creezio/host-runtime`.
  - Factory : plus d'`electron-shell` dans `SERVER_CREEZIO_DEPS` (le client
    thin le garde).
  - Dockerfile : après `npm ci`, purge `electron`, `electron-updater` et
    `@creezio/electron-shell` du stage deps (runtime headless Node pur).

- Updated dependencies [ac7035c]
- Updated dependencies [e6303bb]
  - @creezio/observability@0.20.0
  - @creezio/platform-core@0.20.0

## 0.19.0

### Patch Changes

- @creezio/platform-core@0.19.0
- @creezio/observability@0.19.0

## 0.18.0

### Patch Changes

- 7c40c12: Permissions par module dans le mode admin (P4) — dette BACKLOG « Rôles/permissions mode admin ».

  - **access-control** : overrides PAR COMPTE (`access_user_overrides` dans core.db) — `allow` ajoute, `deny` retire, priorité sur le rôle et ses overrides. `resolvePermissions` les applique, `GET /users` expose `roleBaseline`/`overrides`, nouvelle route `PUT /users/:id/permissions` (`{ changes: [{ permission, effect: allow|deny|inherit }] }`, audit `user.override.set|clear`), UI « Rôles & accès » onglet Comptes : éditeur tri-état par compte.
  - **admin** : chaque mount déclare sa permission de module (`ADMIN_MODULE_PERMISSIONS` — `nav.fleet`, `nav.support`, `nav.prospects`, `nav.roadmap`, `nav.billing`, `nav.clients`, `nav.landing`), gardée fail-closed par `authorizeModuleAccess` (owner bypass). Routes machine préservées SANS permission session : webhook Stripe signé, `register`/`heartbeat`, `next`/`slots`/`report`/`maintenance` (host-agent v1 intact) + variantes multi-segments des ids serveurs non encodés. Preset `adminAccessControlPreset()` (politique de migration SANS lockout : collaborateur = tous les modules par défaut, l'owner restreint ensuite) + `adminAccessPermissionGroups()`. Nouvel export UI `AdminModuleGate` : état explicite « Accès refusé » en URL directe.
  - **landing** : `createLandingMount({ permission })` opt-in — édition gardée (settings/sections/media), `GET /public` reste anonyme.
  - **factory** : `scaffoldAdminApp` génère `brand-platform-bindings.ts` (preset access-control) + pages modules avec `AdminModuleGate` + nav avec permissions ; `ProductEntity.permission`/`ProductPage.permission` threadés sur les `EntitySpec` et la nav des modules générés ; nouveau geste `creezio server-docker access <nom> --user <email> [--grant p,…] [--revoke p,…] [--reset] [--role id|none]` (bootstrap sans UI, écrit core.db + audit, cohérent ensure-owner).
  - **shell-ui** : bypass owner explicite dans le filtre de nav (`hasItemPermission`) — même règle que la garde API.
  - **search** : fix master key Meili — une clé base64url commençant par `-` cassait le parsing CLI (`unexpected argument`), boot flaky ; génération hex + régénération des clés à tiret initial.
  - @creezio/platform-core@0.18.0
  - @creezio/observability@0.18.0

## 0.17.1

### Patch Changes

- @creezio/platform-core@0.17.1
- @creezio/observability@0.17.1

## 0.17.0

### Patch Changes

- Updated dependencies [13c1d18]
  - @creezio/platform-core@0.17.0
  - @creezio/observability@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies [5dfc286]
  - @creezio/platform-core@0.16.0
  - @creezio/observability@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies [1ab886b]
  - @creezio/observability@0.15.0
  - @creezio/platform-core@0.15.0

## 0.14.0

### Patch Changes

- @creezio/platform-core@0.14.0
- @creezio/observability@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [a9e9fd7]
  - @creezio/platform-core@0.13.0
  - @creezio/observability@0.13.0

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
  - @creezio/observability@0.12.0
  - @creezio/platform-core@0.12.0

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
  - @creezio/platform-core@0.11.0
  - @creezio/observability@0.11.0
