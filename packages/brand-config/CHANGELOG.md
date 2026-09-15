# @creezio/brand-config

## 0.26.0

## 0.25.0

### Minor Changes

- 2da43ad: D1 / T10 — purge vocabulaire marque du runtime kit : markers Hermes hérités retirés, registre production propagation vidé (canaux data-driven), commentaires/JSDoc neutralisés, log opener `creezio-server`. Allowlist 270→117 / 493→173 occ. Pas de dual-read TEMPOFLOW\_\* recréé.

## 0.24.1

## 0.24.0

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

## 0.22.0

## 0.21.0

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

## 0.19.0

## 0.18.0

## 0.17.1

## 0.17.0

## 0.16.0

## 0.15.0

## 0.14.0

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

## 0.12.0

## 0.11.0

## 0.10.15

## 0.10.14

## 0.10.13

## 0.10.12

## 0.10.11

## 0.10.10

## 0.10.9

## 0.10.8

## 0.10.7

## 0.10.6

## 0.10.5

## 0.10.4

## 0.10.3

## 0.10.2

## 0.10.1

## 0.10.0

## 0.9.4

## 0.9.3

## 0.9.2

## 0.9.1

## 0.9.0

## 0.8.1

## 0.8.0

## 0.7.1

## 0.7.0

## 0.6.0

## 0.5.0

### Patch Changes

- e23b259: feat(npm-deploy-tooling) : tooling de déploiement Docker en mode npm — le Dockerfile SoT (docker/server) installe les @creezio/\* depuis GitHub Packages via secret BuildKit CREEZIO_NPM_TOKEN (plus de COPY vendor ni symlinks, npm ci strict sur le lock racine workspace), dockerignore v4 sans exceptions vendor. Factory : les apps générées naissent npm (deps ^lockstep, .npmrc, workspaces racine, workflows ci+deploy seuls — kit-compat/vendor-update supprimés), ensure-server-lock.mjs valide les locks workspace, prepareBrandDistribution = locks npm. CLI server-docker : build/publish passent le secret BuildKit (CREEZIO_NPM_TOKEN requis) et ensureBrandStandalone ne matérialise plus de vendor. brand-config : FileSets asar résolus depuis node_modules (walk-up workspaces) au lieu de vendor/creezio.
