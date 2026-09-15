# @creezio/nav

## 0.26.0

### Patch Changes

- Updated dependencies [2f5b6ea]
  - @creezio/platform-core@0.26.0
  - @creezio/shell-ui@0.26.0
  - @creezio/api-kernel@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [2da43ad]
  - @creezio/platform-core@0.25.0
  - @creezio/api-kernel@0.25.0
  - @creezio/shell-ui@0.25.0

## 0.24.1

### Patch Changes

- @creezio/platform-core@0.24.1
- @creezio/api-kernel@0.24.1
- @creezio/shell-ui@0.24.1

## 0.24.0

### Patch Changes

- Updated dependencies [efc7bb5]
  - @creezio/platform-core@0.24.0
  - @creezio/shell-ui@0.24.0
  - @creezio/api-kernel@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [ddf823d]
- Updated dependencies [bf14b35]
- Updated dependencies [b0a53b0]
  - @creezio/platform-core@0.23.0
  - @creezio/api-kernel@0.23.0
  - @creezio/shell-ui@0.23.0

## 0.22.0

### Patch Changes

- @creezio/platform-core@0.22.0
- @creezio/api-kernel@0.22.0
- @creezio/shell-ui@0.22.0

## 0.21.0

### Patch Changes

- @creezio/platform-core@0.21.0
- @creezio/api-kernel@0.21.0
- @creezio/shell-ui@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [e6303bb]
  - @creezio/platform-core@0.20.0
  - @creezio/api-kernel@0.20.0
  - @creezio/shell-ui@0.20.0

## 0.19.0

### Minor Changes

- cc2724a: Vague unique granola + grokbot + catalogue sidebar :

  - Factory **installe** `@creezio/granola`, `@creezio/grokbot` et
    `@creezio/nav` (SERVER_CREEZIO_DEPS / CLIENT_CREEZIO_DEPS /
    transpilePackages / package.json UI). Jamais les retirer pour un
    E404 pré-publish — le spawn `npm install` d'une app neuve est
    attendu KO jusqu'à `changeset publish` (publish.yml), pas un skip
    de gate.
  - Chrome factory : `<NavCatalogLoader />` depuis `@creezio/shell-ui/ui`
    (GET `/api/v1/modules/nav`) — plus de `const OS_NAV`.
  - UI Granola (notes + transcript + dossiers + santé webhook) et
    GrokBot (repos/usage/artefacts + runs live) sur cette même ligne.

- fe20ca7: Catalogue sidebar consommé (BRIEF NAV-3 / Phase C) :

  - `@creezio/shell-ui/ui` exporte `<NavCatalogLoader />` : fetch
    `GET /api/v1/modules/nav`, parse le contrat `{ items }`, bump
    `configureSidebar({ getNavItems })`. Fallback premier paint =
    `defaultOsPrimaryNavItems()`. `@creezio/nav/ui` re-exporte le même
    composant — le chrome factory importe le loader depuis
    `@creezio/shell-ui/ui`. `@creezio/nav` est quand même une dep factory
    (SERVER/CLIENT_CREEZIO_DEPS + transpilePackages) : même vague publish
    que granola/grokbot (`/admin/nav` + mount auto-register).
  - Factory `renderUiBrandChrome` : plus de `BRAND_NAV` / `OS_NAV` inline.
    Chrome = loader + `defaultOsAdminNavItems({ includePlugins })`. Métier
    via `collectNavItems` (mount auto-register).
  - `@creezio/os-ui` : `OS_PRIMARY_NAV_SEGMENTS` +
    `OS_UI_HORS_NAV_JUSTIFICATIONS`. Gate `test-phase-os-nav-catalog`.

- 9af500e: Module hybride `@creezio/nav` (BRIEF NAV-2 / Phase B) :

  - Persist des overrides sidebar en `brand.db` (`nav_overrides`) — jamais le
    catalogue entier ni `core.db`.
  - Mount `/api/v1/modules/nav` auto-enregistré par `startBrandDesktop` /
    `createBrandKernel` (`createNavMount`).
  - Admin `/admin/nav` (`NavAdminClient` + wrapper os-ui) : masquer,
    réordonner, renommer. Entrée `os.admin.nav` via `registerOsNavEntry`
    **et** `defaultOsAdminNavItems()` — pas un 3ᵉ `ADMIN_NAV`.
  - Owner : voit tout ce qui est `available` ; `hidden` s'applique quand même
    (documenté dans `packages/nav/AGENTS.md`).

  Gate : `scripts/test-phase-nav-module.mjs`. Plan :
  `docs/plans/PLAN-NAV-CATALOG.md`.

### Patch Changes

- Updated dependencies [9324b6c]
- Updated dependencies [cc2724a]
- Updated dependencies [fe20ca7]
- Updated dependencies [02927c6]
  - @creezio/shell-ui@0.19.0
  - @creezio/platform-core@0.19.0
  - @creezio/api-kernel@0.19.0
