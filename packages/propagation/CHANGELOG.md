# @creezio/propagation

## 0.6.1

### Patch Changes

- @creezio/brand-config@0.26.0

## 0.6.0

### Minor Changes

- 2da43ad: D1 / T10 — purge vocabulaire marque du runtime kit : markers Hermes hérités retirés, registre production propagation vidé (canaux data-driven), commentaires/JSDoc neutralisés, log opener `creezio-server`. Allowlist 270→117 / 493→173 occ. Pas de dual-read TEMPOFLOW\_\* recréé.

### Patch Changes

- Updated dependencies [2da43ad]
  - @creezio/brand-config@0.25.0

## 0.5.1

### Patch Changes

- @creezio/brand-config@0.24.0

## 0.5.0

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
  - @creezio/brand-config@0.23.0

## 0.4.5

### Patch Changes

- @creezio/brand-config@0.22.0

## 0.4.4

### Patch Changes

- @creezio/brand-config@0.21.0

## 0.4.3

### Patch Changes

- Updated dependencies [e6303bb]
  - @creezio/brand-config@0.20.0

## 0.4.2

### Patch Changes

- @creezio/brand-config@0.19.0

## 0.4.1

### Patch Changes

- @creezio/brand-config@0.18.0

## 0.4.0

### Minor Changes

- b25b823: P3.b — rollout npm flotte-wide : `buildAllBrandPrPayloads` branché sur le
  workflow réel `propagate.yml` (canaux marque data-driven, `brandId` libre,
  PR de bump automatique avec rapport d'impact) ; heartbeat flotte enrichi
  `kitVersion` + `architectureVersion` (champs additifs, protocole v1
  dual-accept) ; registre admin `admin_fleet_servers` : colonnes
  `kit_version` / `architecture_version` (migration `admin_006`) exposées via
  l'API fleet et badge UI — « quelle version tourne où ».

### Patch Changes

- @creezio/brand-config@0.17.0

## 0.3.4

### Patch Changes

- @creezio/brand-config@0.16.0

## 0.3.3

### Patch Changes

- @creezio/brand-config@0.15.0

## 0.3.2

### Patch Changes

- @creezio/brand-config@0.14.0

## 0.3.1

### Patch Changes

- Updated dependencies [a9e9fd7]
  - @creezio/brand-config@0.13.0

## 0.3.0

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

## 0.2.0

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

## 0.1.6

### Patch Changes

- @creezio/brand-config@0.10.0

## 0.1.5

### Patch Changes

- @creezio/brand-config@0.9.0

## 0.1.4

### Patch Changes

- @creezio/brand-config@0.8.0

## 0.1.3

### Patch Changes

- @creezio/brand-config@0.7.0

## 0.1.2

### Patch Changes

- @creezio/brand-config@0.6.0

## 0.1.1

### Patch Changes

- Updated dependencies [e23b259]
  - @creezio/brand-config@0.5.0
