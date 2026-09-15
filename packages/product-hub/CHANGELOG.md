# @creezio/product-hub

## 0.26.0

### Patch Changes

- Updated dependencies [2f5b6ea]
  - @creezio/platform-core@0.26.0
  - @creezio/brand-config@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [2da43ad]
  - @creezio/brand-config@0.25.0
  - @creezio/platform-core@0.25.0

## 0.24.1

### Patch Changes

- @creezio/brand-config@0.24.1
- @creezio/platform-core@0.24.1

## 0.24.0

### Patch Changes

- Updated dependencies [efc7bb5]
  - @creezio/platform-core@0.24.0
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

### Patch Changes

- Updated dependencies [ddf823d]
- Updated dependencies [bf14b35]
- Updated dependencies [b0a53b0]
  - @creezio/platform-core@0.23.0
  - @creezio/brand-config@0.23.0

## 0.22.0

### Patch Changes

- @creezio/brand-config@0.22.0
- @creezio/platform-core@0.22.0

## 0.21.0

### Patch Changes

- @creezio/brand-config@0.21.0
- @creezio/platform-core@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [e6303bb]
  - @creezio/platform-core@0.20.0
  - @creezio/brand-config@0.20.0

## 0.19.0

### Patch Changes

- @creezio/brand-config@0.19.0
- @creezio/platform-core@0.19.0

## 0.18.0

### Patch Changes

- @creezio/brand-config@0.18.0
- @creezio/platform-core@0.18.0

## 0.17.1

### Patch Changes

- @creezio/brand-config@0.17.1
- @creezio/platform-core@0.17.1

## 0.17.0

### Patch Changes

- Updated dependencies [13c1d18]
  - @creezio/platform-core@0.17.0
  - @creezio/brand-config@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies [5dfc286]
  - @creezio/platform-core@0.16.0
  - @creezio/brand-config@0.16.0

## 0.15.0

### Patch Changes

- @creezio/brand-config@0.15.0
- @creezio/platform-core@0.15.0

## 0.14.0

### Patch Changes

- @creezio/brand-config@0.14.0
- @creezio/platform-core@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [a9e9fd7]
  - @creezio/brand-config@0.13.0
  - @creezio/platform-core@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [17c82b1]
  - @creezio/platform-core@0.12.0
  - @creezio/brand-config@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [b0856ee]
  - @creezio/platform-core@0.11.0
  - @creezio/brand-config@0.11.0

## 0.10.15

### Patch Changes

- @creezio/brand-config@0.10.15
- @creezio/platform-core@0.10.15

## 0.10.14

### Patch Changes

- @creezio/brand-config@0.10.14
- @creezio/platform-core@0.10.14

## 0.10.13

### Patch Changes

- @creezio/brand-config@0.10.13
- @creezio/platform-core@0.10.13

## 0.10.12

### Patch Changes

- @creezio/brand-config@0.10.12
- @creezio/platform-core@0.10.12

## 0.10.11

### Patch Changes

- @creezio/brand-config@0.10.11
- @creezio/platform-core@0.10.11

## 0.10.10

### Patch Changes

- Updated dependencies [4ecd205]
  - @creezio/platform-core@0.10.10
  - @creezio/brand-config@0.10.10

## 0.10.9

### Patch Changes

- @creezio/brand-config@0.10.9
- @creezio/platform-core@0.10.9

## 0.10.8

### Patch Changes

- @creezio/brand-config@0.10.8
- @creezio/platform-core@0.10.8

## 0.10.7

### Patch Changes

- @creezio/brand-config@0.10.7
- @creezio/platform-core@0.10.7

## 0.10.6

### Patch Changes

- @creezio/brand-config@0.10.6
- @creezio/platform-core@0.10.6

## 0.10.5

### Patch Changes

- @creezio/brand-config@0.10.5
- @creezio/platform-core@0.10.5

## 0.10.4

### Patch Changes

- @creezio/brand-config@0.10.4
- @creezio/platform-core@0.10.4

## 0.10.3

### Patch Changes

- @creezio/brand-config@0.10.3
- @creezio/platform-core@0.10.3

## 0.10.2

### Patch Changes

- @creezio/brand-config@0.10.2
- @creezio/platform-core@0.10.2

## 0.10.1

### Patch Changes

- @creezio/brand-config@0.10.1
- @creezio/platform-core@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [96464bc]
  - @creezio/platform-core@0.10.0
  - @creezio/brand-config@0.10.0

## 0.9.4

### Patch Changes

- @creezio/brand-config@0.9.4
- @creezio/platform-core@0.9.4

## 0.9.3

### Patch Changes

- @creezio/brand-config@0.9.3
- @creezio/platform-core@0.9.3

## 0.9.2

### Patch Changes

- @creezio/brand-config@0.9.2
- @creezio/platform-core@0.9.2

## 0.9.1

### Patch Changes

- @creezio/brand-config@0.9.1
- @creezio/platform-core@0.9.1

## 0.9.0

### Patch Changes

- @creezio/brand-config@0.9.0
- @creezio/platform-core@0.9.0

## 0.8.1

### Patch Changes

- @creezio/brand-config@0.8.1
- @creezio/platform-core@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies [848ec06]
  - @creezio/platform-core@0.8.0
  - @creezio/brand-config@0.8.0

## 0.7.1

### Patch Changes

- @creezio/brand-config@0.7.1
- @creezio/platform-core@0.7.1

## 0.7.0

### Patch Changes

- @creezio/brand-config@0.7.0
- @creezio/platform-core@0.7.0

## 0.6.0

### Patch Changes

- @creezio/brand-config@0.6.0
- @creezio/platform-core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [e23b259]
- Updated dependencies [d674c86]
  - @creezio/brand-config@0.5.0
  - @creezio/platform-core@0.5.0
