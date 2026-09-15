# @creezio/os-ui

## 0.26.0

### Patch Changes

- Updated dependencies [2f5b6ea]
  - @creezio/shell-ui@0.26.0
  - @creezio/interactive-demo@0.26.0
  - @creezio/mails@0.26.0
  - @creezio/nav@0.26.0

## 0.25.0

### Patch Changes

- @creezio/mails@0.25.0
- @creezio/shell-ui@0.25.0
- @creezio/nav@0.25.0
- @creezio/interactive-demo@0.25.0

## 0.24.1

### Patch Changes

- @creezio/shell-ui@0.24.1
- @creezio/nav@0.24.1
- @creezio/interactive-demo@0.24.1
- @creezio/mails@0.24.1

## 0.24.0

### Patch Changes

- Updated dependencies [efc7bb5]
  - @creezio/shell-ui@0.24.0
  - @creezio/interactive-demo@0.24.0
  - @creezio/mails@0.24.0
  - @creezio/nav@0.24.0

## 0.23.0

### Patch Changes

- @creezio/interactive-demo@0.23.0
- @creezio/mails@0.23.0
- @creezio/nav@0.23.0
- @creezio/shell-ui@0.23.0

## 0.22.0

### Patch Changes

- @creezio/shell-ui@0.22.0
- @creezio/nav@0.22.0
- @creezio/interactive-demo@0.22.0
- @creezio/mails@0.22.0

## 0.21.0

### Patch Changes

- @creezio/shell-ui@0.21.0
- @creezio/nav@0.21.0
- @creezio/interactive-demo@0.21.0
- @creezio/mails@0.21.0

## 0.20.0

### Patch Changes

- @creezio/interactive-demo@0.20.0
- @creezio/mails@0.20.0
- @creezio/nav@0.20.0
- @creezio/shell-ui@0.20.0

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
- Updated dependencies [7254406]
- Updated dependencies [fe20ca7]
- Updated dependencies [02927c6]
- Updated dependencies [9af500e]
  - @creezio/shell-ui@0.19.0
  - @creezio/nav@0.19.0
  - @creezio/mails@0.19.0
  - @creezio/interactive-demo@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [7c40c12]
  - @creezio/shell-ui@0.18.0
  - @creezio/interactive-demo@0.18.0
  - @creezio/mails@0.18.0

## 0.17.1

### Patch Changes

- @creezio/shell-ui@0.17.1
- @creezio/interactive-demo@0.17.1
- @creezio/mails@0.17.1

## 0.17.0

### Patch Changes

- @creezio/interactive-demo@0.17.0
- @creezio/mails@0.17.0
- @creezio/shell-ui@0.17.0

## 0.16.0

### Patch Changes

- @creezio/interactive-demo@0.16.0
- @creezio/mails@0.16.0
- @creezio/shell-ui@0.16.0

## 0.15.0

### Patch Changes

- @creezio/shell-ui@0.15.0
- @creezio/interactive-demo@0.15.0
- @creezio/mails@0.15.0

## 0.14.0

### Patch Changes

- @creezio/shell-ui@0.14.0
- @creezio/interactive-demo@0.14.0
- @creezio/mails@0.14.0

## 0.13.0

### Patch Changes

- @creezio/shell-ui@0.13.0
- @creezio/interactive-demo@0.13.0
- @creezio/mails@0.13.0

## 0.12.0

### Patch Changes

- @creezio/interactive-demo@0.12.0
- @creezio/mails@0.12.0
- @creezio/shell-ui@0.12.0

## 0.11.0

### Patch Changes

- @creezio/interactive-demo@0.11.0
- @creezio/mails@0.11.0
- @creezio/shell-ui@0.11.0

## 0.10.15

### Patch Changes

- @creezio/shell-ui@0.10.15
- @creezio/interactive-demo@0.10.15
- @creezio/mails@0.10.15

## 0.10.14

### Patch Changes

- @creezio/shell-ui@0.10.14
- @creezio/interactive-demo@0.10.14
- @creezio/mails@0.10.14

## 0.10.13

### Patch Changes

- @creezio/shell-ui@0.10.13
- @creezio/interactive-demo@0.10.13
- @creezio/mails@0.10.13

## 0.10.12

### Patch Changes

- @creezio/shell-ui@0.10.12
- @creezio/interactive-demo@0.10.12
- @creezio/mails@0.10.12

## 0.10.11

### Patch Changes

- 38beaeb: Brancher l'onglet Logs MCP sur RequestLogsClient ; /lp public dans RequireSession.
  - @creezio/shell-ui@0.10.11
  - @creezio/interactive-demo@0.10.11
  - @creezio/mails@0.10.11

## 0.10.10

### Patch Changes

- @creezio/shell-ui@0.10.10
- @creezio/interactive-demo@0.10.10
- @creezio/mails@0.10.10

## 0.10.9

### Patch Changes

- 4cd6614: `creezio brand create` is the only way to birth a brand (no notes, no `server/crm/`, no `demo-app`). Doctor fails closed on stub specs and leftover notes so an agent cannot scaffold a notes/demo app.

  Terminer / Quitter retire le curseur singleton du DOM (`#creezio-demo-cursor` + `data-creezio-demo-ui`) au lieu de le laisser en opacity 0.

  `server-docker create --profile prod` forwarde aussi `CREEZIO_FLEET_BACKEND_URL` et `CREEZIO_FLEET_BACKEND_BASIC`.

- Updated dependencies [4cd6614]
  - @creezio/interactive-demo@0.10.9
  - @creezio/shell-ui@0.10.9
  - @creezio/mails@0.10.9

## 0.10.8

### Patch Changes

- @creezio/shell-ui@0.10.8
- @creezio/interactive-demo@0.10.8
- @creezio/mails@0.10.8

## 0.10.7

### Patch Changes

- @creezio/shell-ui@0.10.7
- @creezio/interactive-demo@0.10.7
- @creezio/mails@0.10.7

## 0.10.6

### Patch Changes

- Updated dependencies [1c7ec66]
  - @creezio/interactive-demo@0.10.6
  - @creezio/shell-ui@0.10.6
  - @creezio/mails@0.10.6

## 0.10.5

### Patch Changes

- @creezio/shell-ui@0.10.5
- @creezio/interactive-demo@0.10.5
- @creezio/mails@0.10.5

## 0.10.4

### Patch Changes

- @creezio/shell-ui@0.10.4
- @creezio/interactive-demo@0.10.4
- @creezio/mails@0.10.4

## 0.10.3

### Patch Changes

- @creezio/shell-ui@0.10.3
- @creezio/interactive-demo@0.10.3
- @creezio/mails@0.10.3

## 0.10.2

### Patch Changes

- @creezio/shell-ui@0.10.2
- @creezio/interactive-demo@0.10.2
- @creezio/mails@0.10.2

## 0.10.1

### Patch Changes

- 595c5fb: **Fail-closed — démo interactive native obligatoire** (plus optionnelle).

  Une app `--from-prd` / `create-brand` sort avec `createInteractiveDemoMount`, `interactiveDemoMigrations`, CSS + dep UI. `CreezioUiBoot` monte `InteractiveDemoRoot` (lanceur sidebar) : le chrome marque ne peut plus l'oublier. `brand module init` pose un stub `demo.scenarios` jouable (`genericOsTourScenario` + tour module). Gates : `test-phase-create-brand` assert les 4 branchements ; doctor / `test:modules` exigent ≥ 1 scénario par module. `server-docker create` (après setup owner) : `GET /api/v1/modules/interactive-demo/scenarios` ≥ 1, sinon échec — sauté si owner skip (`CREEZIO_TUNNEL_LOCAL=1` sans creds). Id `os-tour` partagé (premier gagne). Seed données métier = marque.

- Updated dependencies [595c5fb]
  - @creezio/interactive-demo@0.10.1
  - @creezio/shell-ui@0.10.1
  - @creezio/mails@0.10.1

## 0.10.0

### Patch Changes

- @creezio/mails@0.10.0
- @creezio/shell-ui@0.10.0

## 0.9.4

### Patch Changes

- @creezio/shell-ui@0.9.4
- @creezio/mails@0.9.4

## 0.9.3

### Patch Changes

- @creezio/shell-ui@0.9.3
- @creezio/mails@0.9.3

## 0.9.2

### Patch Changes

- @creezio/shell-ui@0.9.2
- @creezio/mails@0.9.2

## 0.9.1

### Patch Changes

- @creezio/shell-ui@0.9.1
- @creezio/mails@0.9.1

## 0.9.0

### Patch Changes

- Updated dependencies [a8bf57a]
  - @creezio/shell-ui@0.9.0
  - @creezio/mails@0.9.0

## 0.8.1

### Patch Changes

- @creezio/shell-ui@0.8.1
- @creezio/mails@0.8.1

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
  - @creezio/shell-ui@0.8.0
  - @creezio/mails@0.8.0

## 0.7.1

### Patch Changes

- @creezio/shell-ui@0.7.1
- @creezio/mails@0.7.1

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

- @creezio/shell-ui@0.7.0
- @creezio/mails@0.7.0

## 0.6.0

### Minor Changes

- d948fcc: feat(login): page /login split-screen 50/50 brand-configurable — nouveau `LoginPage` (@creezio/auth/ui) : panneau formulaire modernisé (labels associés, `role="alert"`, `aria-invalid`, focus accent, loading) + panneau brand (logo/initiale, nom produit, tagline, highlights, gradient/image configurables). Config marque via `ShellUiBrand.login` (prop `login` de `CreezioUiBoot`) — zéro hardcodé, défaut neutre élégant sans config. `configureShellUiBrand` devient no-op sans changement (comparaison par clé, `login` en profondeur) et notifie des abonnés : nouveau `subscribeShellUiBrand` + hook `useShellUiBrand` (@creezio/shell-ui/ui[/kit]) pour lire la brand au render sans flash du défaut — CreezioUiBoot configure désormais au render. Compat : `LoginForm` inchangé fonctionnellement (mêmes props/modes), la route OS /login et le template factory basculent sur `LoginPage` — aucune modif requise côté apps pour le nouveau design.

### Patch Changes

- Updated dependencies [d948fcc]
  - @creezio/shell-ui@0.6.0
  - @creezio/mails@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [0ff4ed2]
- Updated dependencies [d674c86]
  - @creezio/shell-ui@0.5.0
  - @creezio/mails@0.5.0
