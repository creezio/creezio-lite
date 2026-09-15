# @creezio/app-runtime

## 0.26.0

### Patch Changes

- Updated dependencies [2f5b6ea]
  - @creezio/platform-core@0.26.0
  - @creezio/shell-ui@0.26.0
  - @creezio/assistant@0.26.0
  - @creezio/browser-host@0.26.0
  - @creezio/host-runtime@0.26.0
  - @creezio/api-kernel@0.26.0
  - @creezio/auth@0.26.0
  - @creezio/database@0.26.0
  - @creezio/electron-shell@0.26.0
  - @creezio/integrations@0.26.0
  - @creezio/interactive-demo@0.26.0
  - @creezio/mails@0.26.0
  - @creezio/mcp-facade@0.26.0
  - @creezio/nav@0.26.0
  - @creezio/observability@0.26.0
  - @creezio/onboarding@0.26.0
  - @creezio/product-hub@0.26.0
  - @creezio/search@0.26.0
  - @creezio/tasks@0.26.0
  - @creezio/access-control@0.26.0
  - @creezio/brand-config@0.26.0
  - @creezio/support@0.26.0

## 0.25.0

### Minor Changes

- 17ae2a4: Les permissions nav des `navItems` alimentent `configureAuth` / `/admin/access` via `applyBrandModuleAuth` (collecteurs `collectNavPermissions` / `collectPermissionGroups`). `SessionProvider` lit uniquement `/me`. `brand module init` pose `permission: "nav.<id>"` sans `à qualifier` silencieux.

### Patch Changes

- Updated dependencies [17ae2a4]
- Updated dependencies [2da43ad]
  - @creezio/auth@0.25.0
  - @creezio/brand-config@0.25.0
  - @creezio/host-runtime@0.25.0
  - @creezio/observability@0.25.0
  - @creezio/electron-shell@0.25.0
  - @creezio/platform-core@0.25.0
  - @creezio/access-control@0.25.0
  - @creezio/integrations@0.25.0
  - @creezio/mails@0.25.0
  - @creezio/tasks@0.25.0
  - @creezio/api-kernel@0.25.0
  - @creezio/product-hub@0.25.0
  - @creezio/shell-ui@0.25.0
  - @creezio/search@0.25.0
  - @creezio/mcp-facade@0.25.0
  - @creezio/nav@0.25.0
  - @creezio/onboarding@0.25.0
  - @creezio/interactive-demo@0.25.0
  - @creezio/assistant@0.25.0
  - @creezio/support@0.25.0
  - @creezio/browser-host@0.25.0
  - @creezio/database@0.25.0

## 0.24.1

### Patch Changes

- @creezio/brand-config@0.24.1
- @creezio/platform-core@0.24.1
- @creezio/product-hub@0.24.1
- @creezio/search@0.24.1
- @creezio/host-runtime@0.24.1
- @creezio/electron-shell@0.24.1
- @creezio/api-kernel@0.24.1
- @creezio/mcp-facade@0.24.1
- @creezio/shell-ui@0.24.1
- @creezio/nav@0.24.1
- @creezio/onboarding@0.24.1
- @creezio/interactive-demo@0.24.1
- @creezio/auth@0.24.1
- @creezio/access-control@0.24.1
- @creezio/assistant@0.24.1
- @creezio/tasks@0.24.1
- @creezio/mails@0.24.1
- @creezio/observability@0.24.1
- @creezio/support@0.24.1
- @creezio/integrations@0.24.1
- @creezio/browser-host@0.24.1
- @creezio/database@0.24.1

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
  - @creezio/electron-shell@0.24.0
  - @creezio/host-runtime@0.24.0
  - @creezio/search@0.24.0
  - @creezio/shell-ui@0.24.0
  - @creezio/api-kernel@0.24.0
  - @creezio/assistant@0.24.0
  - @creezio/auth@0.24.0
  - @creezio/browser-host@0.24.0
  - @creezio/database@0.24.0
  - @creezio/integrations@0.24.0
  - @creezio/interactive-demo@0.24.0
  - @creezio/mails@0.24.0
  - @creezio/mcp-facade@0.24.0
  - @creezio/nav@0.24.0
  - @creezio/observability@0.24.0
  - @creezio/onboarding@0.24.0
  - @creezio/product-hub@0.24.0
  - @creezio/tasks@0.24.0
  - @creezio/access-control@0.24.0
  - @creezio/brand-config@0.24.0
  - @creezio/support@0.24.0

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

- cd50ae5: T5 / F3.4 — volet 2 du contrat de module : champs additifs `assistantSources`,
  `assistantSourcesJustification` et `onboarding` sur `BrandModuleDef`.
  Collecteurs `collectAssistantSources` / `collectOnboardingContent` dans
  `createBrandModuleRegistry` ; consommation réelle dans `@creezio/assistant`
  (`moduleSources`, `applyModuleAssistantSources`, contexte prompt +
  entitySources + toolDefinitions) et `@creezio/onboarding`
  (`composeOnboardingFromModules`, mount factory). Doctor warn
  `MODULE_ASSISTANT_SOURCES_MISSING` si un module expose une API sans sources
  ni justification. Templates factory (`brand module init`, from-prd) mis à
  jour. Pas de bump `ARCHITECTURE_VERSION` (champs optionnels).

### Patch Changes

- 555b2fc: Teardown fail-closed de la boucle runner IA : `stopAiRunnerLoop()` exporté par
  `@creezio/tasks` (arrêt des timers runner 2 s + récurrence 60 s posés par
  `ensureAiRunnerLoop`) et appelé par `mountBrandPlatformSurface().close()`.
  Sans cet arrêt, le `setInterval` process-global survivait à la fermeture de la
  surface plateforme et son tick suivant jetait `requireTasksBrand()` en
  `unhandledRejection` (« configureTasksBrand() requis avant d'utiliser le
  runtime kanban ») — cause de la flake de la gate
  `test-phase-platform-native-mounts` (PNM.2). Une nouvelle surface relance la
  boucle à sa première requête tasks.
- Updated dependencies [ddf823d]
- Updated dependencies [555b2fc]
- Updated dependencies [cd50ae5]
- Updated dependencies [bf14b35]
- Updated dependencies [b0a53b0]
  - @creezio/platform-core@0.23.0
  - @creezio/brand-config@0.23.0
  - @creezio/search@0.23.0
  - @creezio/host-runtime@0.23.0
  - @creezio/electron-shell@0.23.0
  - @creezio/product-hub@0.23.0
  - @creezio/tasks@0.23.0
  - @creezio/assistant@0.23.0
  - @creezio/onboarding@0.23.0
  - @creezio/api-kernel@0.23.0
  - @creezio/auth@0.23.0
  - @creezio/browser-host@0.23.0
  - @creezio/database@0.23.0
  - @creezio/integrations@0.23.0
  - @creezio/interactive-demo@0.23.0
  - @creezio/mails@0.23.0
  - @creezio/mcp-facade@0.23.0
  - @creezio/nav@0.23.0
  - @creezio/observability@0.23.0
  - @creezio/shell-ui@0.23.0
  - @creezio/access-control@0.23.0
  - @creezio/support@0.23.0

## 0.22.0

### Patch Changes

- @creezio/brand-config@0.22.0
- @creezio/platform-core@0.22.0
- @creezio/product-hub@0.22.0
- @creezio/search@0.22.0
- @creezio/host-runtime@0.22.0
- @creezio/electron-shell@0.22.0
- @creezio/api-kernel@0.22.0
- @creezio/mcp-facade@0.22.0
- @creezio/shell-ui@0.22.0
- @creezio/nav@0.22.0
- @creezio/interactive-demo@0.22.0
- @creezio/auth@0.22.0
- @creezio/access-control@0.22.0
- @creezio/assistant@0.22.0
- @creezio/tasks@0.22.0
- @creezio/mails@0.22.0
- @creezio/observability@0.22.0
- @creezio/support@0.22.0
- @creezio/integrations@0.22.0
- @creezio/browser-host@0.22.0
- @creezio/database@0.22.0

## 0.21.0

### Patch Changes

- Updated dependencies [b264d59]
- Updated dependencies [ab09f4f]
  - @creezio/mcp-facade@0.21.0
  - @creezio/search@0.21.0
  - @creezio/electron-shell@0.21.0
  - @creezio/host-runtime@0.21.0
  - @creezio/brand-config@0.21.0
  - @creezio/platform-core@0.21.0
  - @creezio/product-hub@0.21.0
  - @creezio/api-kernel@0.21.0
  - @creezio/shell-ui@0.21.0
  - @creezio/nav@0.21.0
  - @creezio/interactive-demo@0.21.0
  - @creezio/auth@0.21.0
  - @creezio/access-control@0.21.0
  - @creezio/assistant@0.21.0
  - @creezio/tasks@0.21.0
  - @creezio/mails@0.21.0
  - @creezio/observability@0.21.0
  - @creezio/support@0.21.0
  - @creezio/integrations@0.21.0
  - @creezio/browser-host@0.21.0
  - @creezio/database@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [b7d12cc]
- Updated dependencies [ac7035c]
- Updated dependencies [e6303bb]
  - @creezio/mcp-facade@0.20.0
  - @creezio/assistant@0.20.0
  - @creezio/observability@0.20.0
  - @creezio/host-runtime@0.20.0
  - @creezio/platform-core@0.20.0
  - @creezio/electron-shell@0.20.0
  - @creezio/brand-config@0.20.0
  - @creezio/search@0.20.0
  - @creezio/api-kernel@0.20.0
  - @creezio/auth@0.20.0
  - @creezio/browser-host@0.20.0
  - @creezio/database@0.20.0
  - @creezio/integrations@0.20.0
  - @creezio/interactive-demo@0.20.0
  - @creezio/mails@0.20.0
  - @creezio/nav@0.20.0
  - @creezio/product-hub@0.20.0
  - @creezio/tasks@0.20.0
  - @creezio/shell-ui@0.20.0
  - @creezio/access-control@0.20.0
  - @creezio/support@0.20.0

## 0.19.0

### Minor Changes

- 9324b6c: Deux nouveaux modules natifs hybrides (ADR-module-natif-hybride) :

  - `@creezio/granola` — connecteur Granola (AI meeting notes) : mount
    `/api/v1/modules/granola/*` avec récepteur webhook signé
    (Standard Webhooks, fail-closed dès qu'un `signingSecret` est configuré,
    dédup par `event_id`), sync des notes en brand.db via l'API publique
    (`grn_…`), `register-webhook` qui crée l'endpoint côté Granola et capture
    le `signing_secret` (retourné une seule fois), proxys
    notes/transcript/folders/webhook-endpoints, UI `GranolaClient`
    (URL webhook à copier, livraisons, notes).
  - `@creezio/grokbot` — pilotage d'agents cloud via l'API Cursor v1 :
    client REST complet (agents, runs, usage, artefacts, models,
    repositories), mount `/api/v1/modules/grokbot/*` avec token stocké côté
    serveur (masqué en GET), miroir local des agents en brand.db, cache DB
    1 h sur `repositories` (rate limit amont), ops clés publiées MCP
    (`create-agent`, `create-run`, `get-run`…), UI `GrokbotClient`
    (lancement, suivi des runs, prompts de suivi, annulation).

  UI OS : pages `/granola` et `/grokbot` (wrappers `@creezio/os-ui`) +
  entrées sidebar natives (`defaultOsPrimaryNavItems` + chrome factory
  `OS_NAV`). Après publish : `os-ui:materialize` rematérialise les pages ;
  les marques qui inlinent la nav (chrome owned-by-brand) doivent ajouter
  les deux hrefs.

  Câblage API marque : composer `granolaMigrations()` / `grokbotMigrations()`
  dans les migrations brand et enregistrer `createGranolaMount({ defaults })`
  / `createGrokbotMount({ defaults })` via `registerModuleApi`.

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

- bf7a973: Hermes warm indépendant de n8n : `CREEZIO_NATIVE_WARM_N8N=0` ne coupe plus Work. `GET /plugin-approvals` répond 200 `[]` sans Product Hub.
- Updated dependencies [9324b6c]
- Updated dependencies [cc2724a]
- Updated dependencies [7254406]
- Updated dependencies [bf7a973]
- Updated dependencies [fe20ca7]
- Updated dependencies [02927c6]
- Updated dependencies [9af500e]
  - @creezio/shell-ui@0.19.0
  - @creezio/nav@0.19.0
  - @creezio/mails@0.19.0
  - @creezio/assistant@0.19.0
  - @creezio/access-control@0.19.0
  - @creezio/auth@0.19.0
  - @creezio/interactive-demo@0.19.0
  - @creezio/tasks@0.19.0
  - @creezio/brand-config@0.19.0
  - @creezio/platform-core@0.19.0
  - @creezio/product-hub@0.19.0
  - @creezio/search@0.19.0
  - @creezio/host-runtime@0.19.0
  - @creezio/electron-shell@0.19.0
  - @creezio/api-kernel@0.19.0
  - @creezio/mcp-facade@0.19.0
  - @creezio/observability@0.19.0
  - @creezio/support@0.19.0
  - @creezio/integrations@0.19.0
  - @creezio/browser-host@0.19.0
  - @creezio/database@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [7c40c12]
- Updated dependencies [87dcdeb]
  - @creezio/access-control@0.18.0
  - @creezio/shell-ui@0.18.0
  - @creezio/search@0.18.0
  - @creezio/mcp-facade@0.18.0
  - @creezio/auth@0.18.0
  - @creezio/interactive-demo@0.18.0
  - @creezio/mails@0.18.0
  - @creezio/tasks@0.18.0
  - @creezio/brand-config@0.18.0
  - @creezio/platform-core@0.18.0
  - @creezio/product-hub@0.18.0
  - @creezio/host-runtime@0.18.0
  - @creezio/electron-shell@0.18.0
  - @creezio/api-kernel@0.18.0
  - @creezio/assistant@0.18.0
  - @creezio/observability@0.18.0
  - @creezio/support@0.18.0
  - @creezio/integrations@0.18.0
  - @creezio/browser-host@0.18.0
  - @creezio/database@0.18.0

## 0.17.1

### Patch Changes

- Updated dependencies [27c319c]
  - @creezio/assistant@0.17.1
  - @creezio/mcp-facade@0.17.1
  - @creezio/brand-config@0.17.1
  - @creezio/platform-core@0.17.1
  - @creezio/product-hub@0.17.1
  - @creezio/search@0.17.1
  - @creezio/host-runtime@0.17.1
  - @creezio/electron-shell@0.17.1
  - @creezio/api-kernel@0.17.1
  - @creezio/shell-ui@0.17.1
  - @creezio/interactive-demo@0.17.1
  - @creezio/auth@0.17.1
  - @creezio/access-control@0.17.1
  - @creezio/tasks@0.17.1
  - @creezio/mails@0.17.1
  - @creezio/observability@0.17.1
  - @creezio/support@0.17.1
  - @creezio/integrations@0.17.1
  - @creezio/browser-host@0.17.1
  - @creezio/database@0.17.1

## 0.17.0

### Minor Changes

- b25b823: P3.b — rollout npm flotte-wide : `buildAllBrandPrPayloads` branché sur le
  workflow réel `propagate.yml` (canaux marque data-driven, `brandId` libre,
  PR de bump automatique avec rapport d'impact) ; heartbeat flotte enrichi
  `kitVersion` + `architectureVersion` (champs additifs, protocole v1
  dual-accept) ; registre admin `admin_fleet_servers` : colonnes
  `kit_version` / `architecture_version` (migration `admin_006`) exposées via
  l'API fleet et badge UI — « quelle version tourne où ».

### Patch Changes

- Updated dependencies [13c1d18]
  - @creezio/platform-core@0.17.0
  - @creezio/api-kernel@0.17.0
  - @creezio/assistant@0.17.0
  - @creezio/auth@0.17.0
  - @creezio/browser-host@0.17.0
  - @creezio/database@0.17.0
  - @creezio/electron-shell@0.17.0
  - @creezio/host-runtime@0.17.0
  - @creezio/integrations@0.17.0
  - @creezio/interactive-demo@0.17.0
  - @creezio/mails@0.17.0
  - @creezio/mcp-facade@0.17.0
  - @creezio/observability@0.17.0
  - @creezio/product-hub@0.17.0
  - @creezio/search@0.17.0
  - @creezio/tasks@0.17.0
  - @creezio/brand-config@0.17.0
  - @creezio/shell-ui@0.17.0
  - @creezio/access-control@0.17.0
  - @creezio/support@0.17.0

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

- Updated dependencies [5dfc286]
  - @creezio/api-kernel@0.16.0
  - @creezio/platform-core@0.16.0
  - @creezio/interactive-demo@0.16.0
  - @creezio/mails@0.16.0
  - @creezio/mcp-facade@0.16.0
  - @creezio/observability@0.16.0
  - @creezio/support@0.16.0
  - @creezio/tasks@0.16.0
  - @creezio/assistant@0.16.0
  - @creezio/auth@0.16.0
  - @creezio/browser-host@0.16.0
  - @creezio/database@0.16.0
  - @creezio/electron-shell@0.16.0
  - @creezio/host-runtime@0.16.0
  - @creezio/integrations@0.16.0
  - @creezio/product-hub@0.16.0
  - @creezio/search@0.16.0
  - @creezio/brand-config@0.16.0
  - @creezio/shell-ui@0.16.0
  - @creezio/access-control@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies [1ab886b]
  - @creezio/observability@0.15.0
  - @creezio/electron-shell@0.15.0
  - @creezio/host-runtime@0.15.0
  - @creezio/search@0.15.0
  - @creezio/brand-config@0.15.0
  - @creezio/platform-core@0.15.0
  - @creezio/product-hub@0.15.0
  - @creezio/api-kernel@0.15.0
  - @creezio/mcp-facade@0.15.0
  - @creezio/shell-ui@0.15.0
  - @creezio/auth@0.15.0
  - @creezio/access-control@0.15.0
  - @creezio/assistant@0.15.0
  - @creezio/tasks@0.15.0
  - @creezio/mails@0.15.0
  - @creezio/support@0.15.0
  - @creezio/integrations@0.15.0
  - @creezio/browser-host@0.15.0
  - @creezio/database@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [8232694]
  - @creezio/electron-shell@0.14.0
  - @creezio/brand-config@0.14.0
  - @creezio/platform-core@0.14.0
  - @creezio/product-hub@0.14.0
  - @creezio/search@0.14.0
  - @creezio/host-runtime@0.14.0
  - @creezio/api-kernel@0.14.0
  - @creezio/mcp-facade@0.14.0
  - @creezio/shell-ui@0.14.0
  - @creezio/auth@0.14.0
  - @creezio/access-control@0.14.0
  - @creezio/assistant@0.14.0
  - @creezio/tasks@0.14.0
  - @creezio/mails@0.14.0
  - @creezio/observability@0.14.0
  - @creezio/support@0.14.0
  - @creezio/integrations@0.14.0
  - @creezio/browser-host@0.14.0
  - @creezio/database@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [a9e9fd7]
  - @creezio/brand-config@0.13.0
  - @creezio/platform-core@0.13.0
  - @creezio/api-kernel@0.13.0
  - @creezio/electron-shell@0.13.0
  - @creezio/host-runtime@0.13.0
  - @creezio/product-hub@0.13.0
  - @creezio/shell-ui@0.13.0
  - @creezio/assistant@0.13.0
  - @creezio/auth@0.13.0
  - @creezio/browser-host@0.13.0
  - @creezio/database@0.13.0
  - @creezio/integrations@0.13.0
  - @creezio/mails@0.13.0
  - @creezio/mcp-facade@0.13.0
  - @creezio/observability@0.13.0
  - @creezio/search@0.13.0
  - @creezio/tasks@0.13.0
  - @creezio/access-control@0.13.0
  - @creezio/support@0.13.0

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
  - @creezio/electron-shell@0.12.0
  - @creezio/api-kernel@0.12.0
  - @creezio/assistant@0.12.0
  - @creezio/auth@0.12.0
  - @creezio/browser-host@0.12.0
  - @creezio/database@0.12.0
  - @creezio/integrations@0.12.0
  - @creezio/mails@0.12.0
  - @creezio/mcp-facade@0.12.0
  - @creezio/product-hub@0.12.0
  - @creezio/tasks@0.12.0
  - @creezio/brand-config@0.12.0
  - @creezio/shell-ui@0.12.0
  - @creezio/access-control@0.12.0
  - @creezio/support@0.12.0

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
  - @creezio/electron-shell@0.11.0
  - @creezio/platform-core@0.11.0
  - @creezio/api-kernel@0.11.0
  - @creezio/assistant@0.11.0
  - @creezio/auth@0.11.0
  - @creezio/browser-host@0.11.0
  - @creezio/database@0.11.0
  - @creezio/integrations@0.11.0
  - @creezio/mails@0.11.0
  - @creezio/mcp-facade@0.11.0
  - @creezio/observability@0.11.0
  - @creezio/product-hub@0.11.0
  - @creezio/tasks@0.11.0
  - @creezio/brand-config@0.11.0
  - @creezio/shell-ui@0.11.0
  - @creezio/access-control@0.11.0
  - @creezio/support@0.11.0

## 0.10.15

### Patch Changes

- Updated dependencies [0391870]
  - @creezio/electron-shell@0.10.15
  - @creezio/brand-config@0.10.15
  - @creezio/platform-core@0.10.15
  - @creezio/product-hub@0.10.15
  - @creezio/api-kernel@0.10.15
  - @creezio/mcp-facade@0.10.15
  - @creezio/shell-ui@0.10.15
  - @creezio/auth@0.10.15
  - @creezio/access-control@0.10.15
  - @creezio/assistant@0.10.15
  - @creezio/tasks@0.10.15
  - @creezio/mails@0.10.15
  - @creezio/observability@0.10.15
  - @creezio/support@0.10.15
  - @creezio/integrations@0.10.15
  - @creezio/browser-host@0.10.15
  - @creezio/database@0.10.15

## 0.10.14

### Patch Changes

- Updated dependencies [c0a8177]
  - @creezio/electron-shell@0.10.14
  - @creezio/brand-config@0.10.14
  - @creezio/platform-core@0.10.14
  - @creezio/product-hub@0.10.14
  - @creezio/api-kernel@0.10.14
  - @creezio/mcp-facade@0.10.14
  - @creezio/shell-ui@0.10.14
  - @creezio/auth@0.10.14
  - @creezio/access-control@0.10.14
  - @creezio/assistant@0.10.14
  - @creezio/tasks@0.10.14
  - @creezio/mails@0.10.14
  - @creezio/observability@0.10.14
  - @creezio/support@0.10.14
  - @creezio/integrations@0.10.14
  - @creezio/browser-host@0.10.14
  - @creezio/database@0.10.14

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

- Updated dependencies [e07d2cf]
  - @creezio/electron-shell@0.10.13
  - @creezio/api-kernel@0.10.13
  - @creezio/brand-config@0.10.13
  - @creezio/platform-core@0.10.13
  - @creezio/product-hub@0.10.13
  - @creezio/mcp-facade@0.10.13
  - @creezio/shell-ui@0.10.13
  - @creezio/auth@0.10.13
  - @creezio/access-control@0.10.13
  - @creezio/assistant@0.10.13
  - @creezio/tasks@0.10.13
  - @creezio/mails@0.10.13
  - @creezio/observability@0.10.13
  - @creezio/support@0.10.13
  - @creezio/integrations@0.10.13
  - @creezio/browser-host@0.10.13
  - @creezio/database@0.10.13

## 0.10.12

### Patch Changes

- 0823798: Meili browse : liste entity (q vide OK) via configureEntityMeiliFromFeed, helper browseMeiliIndex, SQL seulement si Meili KO ou filtre hors index.
- Updated dependencies [0823798]
  - @creezio/api-kernel@0.10.12
  - @creezio/electron-shell@0.10.12
  - @creezio/brand-config@0.10.12
  - @creezio/platform-core@0.10.12
  - @creezio/product-hub@0.10.12
  - @creezio/mcp-facade@0.10.12
  - @creezio/shell-ui@0.10.12
  - @creezio/auth@0.10.12
  - @creezio/access-control@0.10.12
  - @creezio/assistant@0.10.12
  - @creezio/tasks@0.10.12
  - @creezio/mails@0.10.12
  - @creezio/observability@0.10.12
  - @creezio/support@0.10.12
  - @creezio/integrations@0.10.12
  - @creezio/browser-host@0.10.12
  - @creezio/database@0.10.12

## 0.10.11

### Patch Changes

- Updated dependencies [38beaeb]
  - @creezio/auth@0.10.11
  - @creezio/brand-config@0.10.11
  - @creezio/platform-core@0.10.11
  - @creezio/product-hub@0.10.11
  - @creezio/electron-shell@0.10.11
  - @creezio/api-kernel@0.10.11
  - @creezio/mcp-facade@0.10.11
  - @creezio/shell-ui@0.10.11
  - @creezio/access-control@0.10.11
  - @creezio/assistant@0.10.11
  - @creezio/tasks@0.10.11
  - @creezio/mails@0.10.11
  - @creezio/observability@0.10.11
  - @creezio/support@0.10.11
  - @creezio/integrations@0.10.11
  - @creezio/browser-host@0.10.11
  - @creezio/database@0.10.11

## 0.10.10

### Patch Changes

- 53695b5: OAuth MCP : réutiliser la session CRM (cookie / Bearer) et authentifier via le login kit, plus seulement le compte desktop local.
- Updated dependencies [4ecd205]
- Updated dependencies [53695b5]
- Updated dependencies [4ecd205]
  - @creezio/platform-core@0.10.10
  - @creezio/mcp-facade@0.10.10
  - @creezio/electron-shell@0.10.10
  - @creezio/brand-config@0.10.10
  - @creezio/product-hub@0.10.10
  - @creezio/api-kernel@0.10.10
  - @creezio/shell-ui@0.10.10
  - @creezio/auth@0.10.10
  - @creezio/access-control@0.10.10
  - @creezio/assistant@0.10.10
  - @creezio/tasks@0.10.10
  - @creezio/mails@0.10.10
  - @creezio/observability@0.10.10
  - @creezio/support@0.10.10
  - @creezio/integrations@0.10.10
  - @creezio/browser-host@0.10.10
  - @creezio/database@0.10.10

## 0.10.9

### Patch Changes

- @creezio/brand-config@0.10.9
- @creezio/platform-core@0.10.9
- @creezio/product-hub@0.10.9
- @creezio/electron-shell@0.10.9
- @creezio/api-kernel@0.10.9
- @creezio/mcp-facade@0.10.9
- @creezio/shell-ui@0.10.9
- @creezio/auth@0.10.9
- @creezio/access-control@0.10.9
- @creezio/assistant@0.10.9
- @creezio/tasks@0.10.9
- @creezio/mails@0.10.9
- @creezio/observability@0.10.9
- @creezio/support@0.10.9
- @creezio/integrations@0.10.9
- @creezio/browser-host@0.10.9
- @creezio/database@0.10.9

## 0.10.8

### Patch Changes

- a2fea46: **feat — `mcpTools` retiré ; `MODULE_MCP_TOOLS_DEPRECATED` = error.**

  `BrandModuleDef.mcpTools` n'existe plus. SoT = `operations[]` → tools MCP générés (`listOperations()`). Plus de merge legacy (`mergeGeneratedAndLegacy` / `warnLegacyModuleMcpTools`). Doctor fail-closed : un `mcpTools()` restant = error. Le hook apps `discoverModuleTools` reste (extras / JWT), sans documenter de tools manuscrits.

- Updated dependencies [a2fea46]
  - @creezio/mcp-facade@0.10.8
  - @creezio/api-kernel@0.10.8
  - @creezio/brand-config@0.10.8
  - @creezio/platform-core@0.10.8
  - @creezio/product-hub@0.10.8
  - @creezio/electron-shell@0.10.8
  - @creezio/shell-ui@0.10.8
  - @creezio/auth@0.10.8
  - @creezio/access-control@0.10.8
  - @creezio/assistant@0.10.8
  - @creezio/tasks@0.10.8
  - @creezio/mails@0.10.8
  - @creezio/observability@0.10.8
  - @creezio/support@0.10.8
  - @creezio/integrations@0.10.8
  - @creezio/browser-host@0.10.8
  - @creezio/database@0.10.8

## 0.10.7

### Patch Changes

- 55b1cd5: **feat — catalogue `listOperations()` + tools MCP générés + doctor ops non vides.**

  `api.listOperations()` alimente `/admin/api` (plus seulement la surface Hono). Les tools `module.<mountId>.<op.id>` sont générés depuis ce catalogue (handler = requête HTTP synthétique). Doctor fail-closed : `MODULE_OP_MISSING` si `apiMounts` sans `operations[]` **non vide** (pin ≥ 0.10.6) ; EntitySpec seul = OK (CRUD auto) ; `mcpTools` restant = `MODULE_MCP_TOOLS_DEPRECATED` (warn). Mounts kit/OS hors `modules/*.ts` non scannés.

- Updated dependencies [55b1cd5]
  - @creezio/api-kernel@0.10.7
  - @creezio/mcp-facade@0.10.7
  - @creezio/observability@0.10.7
  - @creezio/brand-config@0.10.7
  - @creezio/platform-core@0.10.7
  - @creezio/product-hub@0.10.7
  - @creezio/electron-shell@0.10.7
  - @creezio/shell-ui@0.10.7
  - @creezio/auth@0.10.7
  - @creezio/access-control@0.10.7
  - @creezio/assistant@0.10.7
  - @creezio/tasks@0.10.7
  - @creezio/mails@0.10.7
  - @creezio/support@0.10.7
  - @creezio/integrations@0.10.7
  - @creezio/browser-host@0.10.7
  - @creezio/database@0.10.7

## 0.10.6

### Patch Changes

- 1c7ec66: **feat — SoT unique : une opération de module = HTTP + /admin/api + tool MCP.**

  `ModuleOperation` sur `ApiMount` / EntitySpec (CRUD auto). Le kit collecte puis génère les tools `module.<mountId>.<op.id>` (handler = requête HTTP synthétique). Catalogue `/admin/api` = ops kernel, plus seulement la surface Hono admin. `mcpTools()` déprécié (doctor error si recouvrement). Doctor fail-closed `MODULE_OP_MISSING` / `MODULE_OP_UNCATALOGUED` depuis 0.10.6. Enable MCP = policies sur tools générés (`mcpPublishDefault`, `roles`).

- Updated dependencies [1c7ec66]
  - @creezio/api-kernel@0.10.6
  - @creezio/mcp-facade@0.10.6
  - @creezio/observability@0.10.6
  - @creezio/brand-config@0.10.6
  - @creezio/platform-core@0.10.6
  - @creezio/product-hub@0.10.6
  - @creezio/electron-shell@0.10.6
  - @creezio/shell-ui@0.10.6
  - @creezio/auth@0.10.6
  - @creezio/access-control@0.10.6
  - @creezio/assistant@0.10.6
  - @creezio/tasks@0.10.6
  - @creezio/mails@0.10.6
  - @creezio/support@0.10.6
  - @creezio/integrations@0.10.6
  - @creezio/browser-host@0.10.6
  - @creezio/database@0.10.6

## 0.10.5

### Patch Changes

- Updated dependencies [6bce6a8]
  - @creezio/observability@0.10.5
  - @creezio/brand-config@0.10.5
  - @creezio/platform-core@0.10.5
  - @creezio/product-hub@0.10.5
  - @creezio/electron-shell@0.10.5
  - @creezio/api-kernel@0.10.5
  - @creezio/mcp-facade@0.10.5
  - @creezio/shell-ui@0.10.5
  - @creezio/auth@0.10.5
  - @creezio/access-control@0.10.5
  - @creezio/assistant@0.10.5
  - @creezio/tasks@0.10.5
  - @creezio/mails@0.10.5
  - @creezio/support@0.10.5
  - @creezio/integrations@0.10.5
  - @creezio/browser-host@0.10.5
  - @creezio/database@0.10.5

## 0.10.4

### Patch Changes

- @creezio/brand-config@0.10.4
- @creezio/platform-core@0.10.4
- @creezio/product-hub@0.10.4
- @creezio/electron-shell@0.10.4
- @creezio/api-kernel@0.10.4
- @creezio/mcp-facade@0.10.4
- @creezio/shell-ui@0.10.4
- @creezio/auth@0.10.4
- @creezio/access-control@0.10.4
- @creezio/assistant@0.10.4
- @creezio/tasks@0.10.4
- @creezio/mails@0.10.4
- @creezio/observability@0.10.4
- @creezio/support@0.10.4
- @creezio/integrations@0.10.4
- @creezio/browser-host@0.10.4
- @creezio/database@0.10.4

## 0.10.3

### Patch Changes

- Updated dependencies [5f8a383]
  - @creezio/observability@0.10.3
  - @creezio/brand-config@0.10.3
  - @creezio/platform-core@0.10.3
  - @creezio/product-hub@0.10.3
  - @creezio/electron-shell@0.10.3
  - @creezio/api-kernel@0.10.3
  - @creezio/mcp-facade@0.10.3
  - @creezio/shell-ui@0.10.3
  - @creezio/auth@0.10.3
  - @creezio/access-control@0.10.3
  - @creezio/assistant@0.10.3
  - @creezio/tasks@0.10.3
  - @creezio/mails@0.10.3
  - @creezio/support@0.10.3
  - @creezio/integrations@0.10.3
  - @creezio/browser-host@0.10.3
  - @creezio/database@0.10.3

## 0.10.2

### Patch Changes

- 0748020: **fix(tunnel) — superviseur cloudflared in-process (respawn borné).**

  Si le process QUIC meurt, le kernel logguait `cloudflared exit` et ne le relançait pas → hostname public **525** alors que localhost restait 200 (recette / demo / admin, 15-16/08). `startCloudflared` respawn maintenant avec backoff (1 s → 30 s, 8 essais consécutifs, compteur remis à zéro après 60 s d'uptime sain). `stopCloudflared` / `forgetTunnel` annulent le timer. Le respawn **réutilise** le token et l'id persistés — aucun POST `cfd_tunnel` (pas de nouvel id). Fail-closed #84/#86/#87 inchangé. Prend effet au prochain bump/rebuild ; pas de redéploiement live dans ce tour.

- Updated dependencies [0748020]
  - @creezio/electron-shell@0.10.2
  - @creezio/brand-config@0.10.2
  - @creezio/platform-core@0.10.2
  - @creezio/product-hub@0.10.2
  - @creezio/api-kernel@0.10.2
  - @creezio/mcp-facade@0.10.2
  - @creezio/shell-ui@0.10.2
  - @creezio/auth@0.10.2
  - @creezio/access-control@0.10.2
  - @creezio/assistant@0.10.2
  - @creezio/tasks@0.10.2
  - @creezio/mails@0.10.2
  - @creezio/observability@0.10.2
  - @creezio/support@0.10.2
  - @creezio/integrations@0.10.2
  - @creezio/browser-host@0.10.2
  - @creezio/database@0.10.2

## 0.10.1

### Patch Changes

- @creezio/brand-config@0.10.1
- @creezio/platform-core@0.10.1
- @creezio/product-hub@0.10.1
- @creezio/electron-shell@0.10.1
- @creezio/api-kernel@0.10.1
- @creezio/mcp-facade@0.10.1
- @creezio/shell-ui@0.10.1
- @creezio/auth@0.10.1
- @creezio/access-control@0.10.1
- @creezio/assistant@0.10.1
- @creezio/tasks@0.10.1
- @creezio/mails@0.10.1
- @creezio/observability@0.10.1
- @creezio/support@0.10.1
- @creezio/integrations@0.10.1
- @creezio/browser-host@0.10.1
- @creezio/database@0.10.1

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
  - @creezio/electron-shell@0.10.0
  - @creezio/observability@0.10.0
  - @creezio/api-kernel@0.10.0
  - @creezio/assistant@0.10.0
  - @creezio/auth@0.10.0
  - @creezio/browser-host@0.10.0
  - @creezio/database@0.10.0
  - @creezio/integrations@0.10.0
  - @creezio/mails@0.10.0
  - @creezio/mcp-facade@0.10.0
  - @creezio/product-hub@0.10.0
  - @creezio/tasks@0.10.0
  - @creezio/brand-config@0.10.0
  - @creezio/shell-ui@0.10.0
  - @creezio/access-control@0.10.0
  - @creezio/support@0.10.0

## 0.9.4

### Patch Changes

- 0c62242: `/api/v1/admin/*` (MCP, database, analytics, endpoints, request-logs) exige une session à la bordure HTTP — 401 sans cookie/Bearer. Health, login, setup et OAuth MCP restent publics. Ferme la surface admin ouverte en prod (foove2#78).
  - @creezio/brand-config@0.9.4
  - @creezio/platform-core@0.9.4
  - @creezio/product-hub@0.9.4
  - @creezio/electron-shell@0.9.4
  - @creezio/api-kernel@0.9.4
  - @creezio/mcp-facade@0.9.4
  - @creezio/shell-ui@0.9.4
  - @creezio/auth@0.9.4
  - @creezio/access-control@0.9.4
  - @creezio/assistant@0.9.4
  - @creezio/tasks@0.9.4
  - @creezio/mails@0.9.4
  - @creezio/observability@0.9.4
  - @creezio/support@0.9.4
  - @creezio/integrations@0.9.4
  - @creezio/browser-host@0.9.4
  - @creezio/database@0.9.4

## 0.9.3

### Patch Changes

- @creezio/brand-config@0.9.3
- @creezio/platform-core@0.9.3
- @creezio/product-hub@0.9.3
- @creezio/electron-shell@0.9.3
- @creezio/api-kernel@0.9.3
- @creezio/mcp-facade@0.9.3
- @creezio/shell-ui@0.9.3
- @creezio/auth@0.9.3
- @creezio/access-control@0.9.3
- @creezio/assistant@0.9.3
- @creezio/tasks@0.9.3
- @creezio/mails@0.9.3
- @creezio/observability@0.9.3
- @creezio/support@0.9.3
- @creezio/integrations@0.9.3
- @creezio/browser-host@0.9.3
- @creezio/database@0.9.3

## 0.9.2

### Patch Changes

- Updated dependencies [10b5198]
  - @creezio/observability@0.9.2
  - @creezio/brand-config@0.9.2
  - @creezio/platform-core@0.9.2
  - @creezio/product-hub@0.9.2
  - @creezio/electron-shell@0.9.2
  - @creezio/api-kernel@0.9.2
  - @creezio/mcp-facade@0.9.2
  - @creezio/shell-ui@0.9.2
  - @creezio/auth@0.9.2
  - @creezio/access-control@0.9.2
  - @creezio/assistant@0.9.2
  - @creezio/tasks@0.9.2
  - @creezio/mails@0.9.2
  - @creezio/support@0.9.2
  - @creezio/integrations@0.9.2
  - @creezio/browser-host@0.9.2
  - @creezio/database@0.9.2

## 0.9.1

### Patch Changes

- f825a95: fix(app-runtime): health « degraded » cosmétique au boot en mode sidecar M2 — l'étape « tunnel » appelait le provisioner (172.17.0.1, gateway docker0) injoignable depuis le réseau compose du stack et partait en timeout 30 s. En mode sidecar, la re-configuration provisioner devient best-effort en arrière-plan et l'étape valide l'état RÉEL du tunnel en sondant l'URL publique avec retry + backoff (opt-out : CREEZIO_TUNNEL_PUBLIC_PROBE=0).
  - @creezio/brand-config@0.9.1
  - @creezio/platform-core@0.9.1
  - @creezio/product-hub@0.9.1
  - @creezio/electron-shell@0.9.1
  - @creezio/api-kernel@0.9.1
  - @creezio/mcp-facade@0.9.1
  - @creezio/shell-ui@0.9.1
  - @creezio/auth@0.9.1
  - @creezio/access-control@0.9.1
  - @creezio/assistant@0.9.1
  - @creezio/tasks@0.9.1
  - @creezio/mails@0.9.1
  - @creezio/observability@0.9.1
  - @creezio/support@0.9.1
  - @creezio/integrations@0.9.1
  - @creezio/browser-host@0.9.1
  - @creezio/database@0.9.1

## 0.9.0

### Minor Changes

- a8bf57a: Polish UI démo + heartbeat desktop natif + lien secondaire login.

  - **Palette de recherche Ctrl+K** (`shell-ui`) : géométrie scopée au composant (classe dédiée `.creezio-search-palette`, spécificité renforcée dans `theme.css`) — la palette ne dépend plus des règles de modale génériques de la marque (cassée par un `[role="dialog"]` global côté app).
  - **Démo interactive** (`interactive-demo`) : la carte garde des dimensions compactes face aux règles globales « modales bornées au viewport » ; nouveau `launcher: "sidebar"` — le lanceur « Visite guidée » devient une entrée d'action de la sidebar kit (registre `registerSidebarActionsProvider` dans `shell-ui`), jamais affichée sur les pages publiques (/login). `launcher: "floating"` reste le défaut rétrocompatible.
  - **Heartbeat desktop natif** (`app-runtime`) : `POST /api/v1/desktop/heartbeat` répond 200 `{ ok: true, desktop }` dans la surface plateforme — les apps web sans bridge Electron ne subissent plus le 404 → fallthrough plane (bruit + faux états) ; quand un bridge est en ligne, `desktop: true` reflète le registre de présence réel.
  - **Login** (`auth` + `shell-ui`) : lien d'action secondaire configurable via `ShellUiBrand.login.secondaryLink` (`{ label, href }`, ex. inscription POS) — clé absente = rien ne s'affiche, aucun libellé hardcodé.

### Patch Changes

- Updated dependencies [a8bf57a]
  - @creezio/auth@0.9.0
  - @creezio/shell-ui@0.9.0
  - @creezio/access-control@0.9.0
  - @creezio/integrations@0.9.0
  - @creezio/mails@0.9.0
  - @creezio/tasks@0.9.0
  - @creezio/brand-config@0.9.0
  - @creezio/platform-core@0.9.0
  - @creezio/product-hub@0.9.0
  - @creezio/electron-shell@0.9.0
  - @creezio/api-kernel@0.9.0
  - @creezio/mcp-facade@0.9.0
  - @creezio/assistant@0.9.0
  - @creezio/observability@0.9.0
  - @creezio/support@0.9.0
  - @creezio/browser-host@0.9.0
  - @creezio/database@0.9.0

## 0.8.1

### Patch Changes

- @creezio/brand-config@0.8.1
- @creezio/platform-core@0.8.1
- @creezio/product-hub@0.8.1
- @creezio/electron-shell@0.8.1
- @creezio/api-kernel@0.8.1
- @creezio/mcp-facade@0.8.1
- @creezio/shell-ui@0.8.1
- @creezio/auth@0.8.1
- @creezio/access-control@0.8.1
- @creezio/assistant@0.8.1
- @creezio/tasks@0.8.1
- @creezio/mails@0.8.1
- @creezio/observability@0.8.1
- @creezio/support@0.8.1
- @creezio/integrations@0.8.1
- @creezio/browser-host@0.8.1
- @creezio/database@0.8.1

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

- Updated dependencies [848ec06]
  - @creezio/access-control@0.8.0
  - @creezio/auth@0.8.0
  - @creezio/shell-ui@0.8.0
  - @creezio/api-kernel@0.8.0
  - @creezio/platform-core@0.8.0
  - @creezio/integrations@0.8.0
  - @creezio/mails@0.8.0
  - @creezio/tasks@0.8.0
  - @creezio/mcp-facade@0.8.0
  - @creezio/observability@0.8.0
  - @creezio/support@0.8.0
  - @creezio/assistant@0.8.0
  - @creezio/browser-host@0.8.0
  - @creezio/database@0.8.0
  - @creezio/electron-shell@0.8.0
  - @creezio/product-hub@0.8.0
  - @creezio/brand-config@0.8.0

## 0.7.1

### Patch Changes

- @creezio/brand-config@0.7.1
- @creezio/platform-core@0.7.1
- @creezio/product-hub@0.7.1
- @creezio/electron-shell@0.7.1
- @creezio/api-kernel@0.7.1
- @creezio/mcp-facade@0.7.1
- @creezio/shell-ui@0.7.1
- @creezio/auth@0.7.1
- @creezio/assistant@0.7.1
- @creezio/tasks@0.7.1
- @creezio/mails@0.7.1
- @creezio/observability@0.7.1
- @creezio/support@0.7.1
- @creezio/integrations@0.7.1
- @creezio/browser-host@0.7.1
- @creezio/database@0.7.1

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

- Updated dependencies [adf6d46]
  - @creezio/electron-shell@0.7.0
  - @creezio/observability@0.7.0
  - @creezio/brand-config@0.7.0
  - @creezio/platform-core@0.7.0
  - @creezio/product-hub@0.7.0
  - @creezio/api-kernel@0.7.0
  - @creezio/mcp-facade@0.7.0
  - @creezio/shell-ui@0.7.0
  - @creezio/auth@0.7.0
  - @creezio/assistant@0.7.0
  - @creezio/tasks@0.7.0
  - @creezio/mails@0.7.0
  - @creezio/support@0.7.0
  - @creezio/integrations@0.7.0
  - @creezio/browser-host@0.7.0
  - @creezio/database@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [d948fcc]
  - @creezio/auth@0.6.0
  - @creezio/shell-ui@0.6.0
  - @creezio/integrations@0.6.0
  - @creezio/mails@0.6.0
  - @creezio/tasks@0.6.0
  - @creezio/brand-config@0.6.0
  - @creezio/platform-core@0.6.0
  - @creezio/product-hub@0.6.0
  - @creezio/electron-shell@0.6.0
  - @creezio/api-kernel@0.6.0
  - @creezio/mcp-facade@0.6.0
  - @creezio/assistant@0.6.0
  - @creezio/observability@0.6.0
  - @creezio/support@0.6.0
  - @creezio/browser-host@0.6.0
  - @creezio/database@0.6.0

## 0.5.0

### Minor Changes

- 8b4c876: Rôle métier marque en session : `configureAuth({ resolveBrandRole })` (callback déclaratif, db brand fournie par la surface plateforme) expose `brand_role` dans `GET /api/v1/auth/me` — la valeur suit la cible en impersonation — et `useSession().me.brandRole` côté UI. Jamais de throw (best effort → null) ; resolver absent = `brand_role: null` (rétrocompatible). Consommateur premier : `@creezio/interactive-demo` (scénarios par rôle via la prop `role` d'InteractiveDemoRoot).

### Patch Changes

- Updated dependencies [8b4c876]
- Updated dependencies [0ff4ed2]
- Updated dependencies [e23b259]
- Updated dependencies [d674c86]
  - @creezio/auth@0.5.0
  - @creezio/shell-ui@0.5.0
  - @creezio/brand-config@0.5.0
  - @creezio/assistant@0.5.0
  - @creezio/integrations@0.5.0
  - @creezio/observability@0.5.0
  - @creezio/platform-core@0.5.0
  - @creezio/support@0.5.0
  - @creezio/mails@0.5.0
  - @creezio/tasks@0.5.0
  - @creezio/product-hub@0.5.0
  - @creezio/electron-shell@0.5.0
  - @creezio/api-kernel@0.5.0
  - @creezio/mcp-facade@0.5.0
  - @creezio/browser-host@0.5.0
  - @creezio/database@0.5.0
