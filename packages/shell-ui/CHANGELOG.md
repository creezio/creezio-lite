# @creezio/shell-ui

## 0.26.0

### Minor Changes

- 2f5b6ea: H13 — résidu allowlist runtime (ARCHITECTURE_VERSION H12 → H13, convention 0.x : minor comme H10/H11/H12).

  - Crash env : plus de dual-read `TF2_*` / `CERTIVAN_*` / `FIDU_*` / `TEMPOFLOW3_*` — `CREEZIO_*` + scan `envKey`.
  - `envForNodeScriptSpawn` : plus d'heuristique packagée nommée marque.
  - UI kit : `creezio-fake-cursor`, `creezio-titlebar-*`, cache SW `creezio-shell-*`.
  - Codemods `scripts/codemods/H13/` (`since: 0.26.0`), appliqués par `creezio upgrade`.

### Patch Changes

- Updated dependencies [2f5b6ea]
  - @creezio/shell@0.26.0
  - @creezio/brand-config@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [2da43ad]
  - @creezio/brand-config@0.25.0
  - @creezio/shell@0.25.0

## 0.24.1

### Patch Changes

- @creezio/brand-config@0.24.1
- @creezio/shell@0.24.1

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
- @creezio/shell@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [ddf823d]
  - @creezio/brand-config@0.23.0
  - @creezio/shell@0.23.0

## 0.22.0

### Patch Changes

- @creezio/brand-config@0.22.0
- @creezio/shell@0.22.0

## 0.21.0

### Patch Changes

- @creezio/brand-config@0.21.0
- @creezio/shell@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [e6303bb]
  - @creezio/brand-config@0.20.0
  - @creezio/shell@0.20.0

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

- 02927c6: Catalogue de nav OS unique (BRIEF NAV-1 / Phase A) :

  - `@creezio/shell-ui` exporte `NavCatalogEntry`, `resolveNavCatalog`,
    `registerOsNavEntry` / `listOsNavEntries` / `defaultOsCatalogEntries`
    (registre Node-safe) et `resolveNavIcon` (allowlist lucide, fallback
    `Circle`). `defaultOsPrimaryNavItems()` devient un adaptateur du
    registre — plus une liste recopiée.
  - Factory `renderUiBrandChrome` compose
    `[...BRAND_NAV, ...defaultOsPrimaryNavItems()]` et
    `defaultOsAdminNavItems({ includePlugins })` — **plus** de
    `const OS_NAV = […]`. Un nouveau module OS enregistré au catalogue
    apparaît sur toute marque factory-neuve sans éditer le chrome.

  Pas d'écran admin ni de table SQL (NAV-2). Plan :
  `docs/plans/PLAN-NAV-CATALOG.md`.

### Patch Changes

- @creezio/brand-config@0.19.0
- @creezio/shell@0.19.0

## 0.18.0

### Minor Changes

- 7c40c12: Permissions par module dans le mode admin (P4) — dette BACKLOG « Rôles/permissions mode admin ».

  - **access-control** : overrides PAR COMPTE (`access_user_overrides` dans core.db) — `allow` ajoute, `deny` retire, priorité sur le rôle et ses overrides. `resolvePermissions` les applique, `GET /users` expose `roleBaseline`/`overrides`, nouvelle route `PUT /users/:id/permissions` (`{ changes: [{ permission, effect: allow|deny|inherit }] }`, audit `user.override.set|clear`), UI « Rôles & accès » onglet Comptes : éditeur tri-état par compte.
  - **admin** : chaque mount déclare sa permission de module (`ADMIN_MODULE_PERMISSIONS` — `nav.fleet`, `nav.support`, `nav.prospects`, `nav.roadmap`, `nav.billing`, `nav.clients`, `nav.landing`), gardée fail-closed par `authorizeModuleAccess` (owner bypass). Routes machine préservées SANS permission session : webhook Stripe signé, `register`/`heartbeat`, `next`/`slots`/`report`/`maintenance` (host-agent v1 intact) + variantes multi-segments des ids serveurs non encodés. Preset `adminAccessControlPreset()` (politique de migration SANS lockout : collaborateur = tous les modules par défaut, l'owner restreint ensuite) + `adminAccessPermissionGroups()`. Nouvel export UI `AdminModuleGate` : état explicite « Accès refusé » en URL directe.
  - **landing** : `createLandingMount({ permission })` opt-in — édition gardée (settings/sections/media), `GET /public` reste anonyme.
  - **factory** : `scaffoldAdminApp` génère `brand-platform-bindings.ts` (preset access-control) + pages modules avec `AdminModuleGate` + nav avec permissions ; `ProductEntity.permission`/`ProductPage.permission` threadés sur les `EntitySpec` et la nav des modules générés ; nouveau geste `creezio server-docker access <nom> --user <email> [--grant p,…] [--revoke p,…] [--reset] [--role id|none]` (bootstrap sans UI, écrit core.db + audit, cohérent ensure-owner).
  - **shell-ui** : bypass owner explicite dans le filtre de nav (`hasItemPermission`) — même règle que la garde API.
  - **search** : fix master key Meili — une clé base64url commençant par `-` cassait le parsing CLI (`unexpected argument`), boot flaky ; génération hex + régénération des clés à tiret initial.

### Patch Changes

- @creezio/brand-config@0.18.0
- @creezio/shell@0.18.0

## 0.17.1

### Patch Changes

- @creezio/brand-config@0.17.1
- @creezio/shell@0.17.1

## 0.17.0

### Patch Changes

- @creezio/brand-config@0.17.0
- @creezio/shell@0.17.0

## 0.16.0

### Patch Changes

- @creezio/brand-config@0.16.0
- @creezio/shell@0.16.0

## 0.15.0

### Patch Changes

- @creezio/brand-config@0.15.0
- @creezio/shell@0.15.0

## 0.14.0

### Patch Changes

- @creezio/brand-config@0.14.0
- @creezio/shell@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [a9e9fd7]
  - @creezio/brand-config@0.13.0
  - @creezio/shell@0.13.0

## 0.12.0

### Patch Changes

- @creezio/brand-config@0.12.0
- @creezio/shell@0.12.0

## 0.11.0

### Patch Changes

- @creezio/brand-config@0.11.0
- @creezio/shell@0.11.0

## 0.10.15

### Patch Changes

- @creezio/brand-config@0.10.15
- @creezio/shell@0.10.15

## 0.10.14

### Patch Changes

- @creezio/brand-config@0.10.14
- @creezio/shell@0.10.14

## 0.10.13

### Patch Changes

- @creezio/brand-config@0.10.13
- @creezio/shell@0.10.13

## 0.10.12

### Patch Changes

- @creezio/brand-config@0.10.12
- @creezio/shell@0.10.12

## 0.10.11

### Patch Changes

- @creezio/brand-config@0.10.11
- @creezio/shell@0.10.11

## 0.10.10

### Patch Changes

- @creezio/brand-config@0.10.10
- @creezio/shell@0.10.10

## 0.10.9

### Patch Changes

- @creezio/brand-config@0.10.9
- @creezio/shell@0.10.9

## 0.10.8

### Patch Changes

- @creezio/brand-config@0.10.8
- @creezio/shell@0.10.8

## 0.10.7

### Patch Changes

- @creezio/brand-config@0.10.7
- @creezio/shell@0.10.7

## 0.10.6

### Patch Changes

- @creezio/brand-config@0.10.6
- @creezio/shell@0.10.6

## 0.10.5

### Patch Changes

- @creezio/brand-config@0.10.5
- @creezio/shell@0.10.5

## 0.10.4

### Patch Changes

- @creezio/brand-config@0.10.4
- @creezio/shell@0.10.4

## 0.10.3

### Patch Changes

- @creezio/brand-config@0.10.3
- @creezio/shell@0.10.3

## 0.10.2

### Patch Changes

- @creezio/brand-config@0.10.2
- @creezio/shell@0.10.2

## 0.10.1

### Patch Changes

- @creezio/brand-config@0.10.1
- @creezio/shell@0.10.1

## 0.10.0

### Patch Changes

- @creezio/brand-config@0.10.0
- @creezio/shell@0.10.0

## 0.9.4

### Patch Changes

- @creezio/brand-config@0.9.4
- @creezio/shell@0.9.4

## 0.9.3

### Patch Changes

- @creezio/brand-config@0.9.3
- @creezio/shell@0.9.3

## 0.9.2

### Patch Changes

- @creezio/brand-config@0.9.2
- @creezio/shell@0.9.2

## 0.9.1

### Patch Changes

- @creezio/brand-config@0.9.1
- @creezio/shell@0.9.1

## 0.9.0

### Minor Changes

- a8bf57a: Polish UI démo + heartbeat desktop natif + lien secondaire login.

  - **Palette de recherche Ctrl+K** (`shell-ui`) : géométrie scopée au composant (classe dédiée `.creezio-search-palette`, spécificité renforcée dans `theme.css`) — la palette ne dépend plus des règles de modale génériques de la marque (cassée par un `[role="dialog"]` global côté app).
  - **Démo interactive** (`interactive-demo`) : la carte garde des dimensions compactes face aux règles globales « modales bornées au viewport » ; nouveau `launcher: "sidebar"` — le lanceur « Visite guidée » devient une entrée d'action de la sidebar kit (registre `registerSidebarActionsProvider` dans `shell-ui`), jamais affichée sur les pages publiques (/login). `launcher: "floating"` reste le défaut rétrocompatible.
  - **Heartbeat desktop natif** (`app-runtime`) : `POST /api/v1/desktop/heartbeat` répond 200 `{ ok: true, desktop }` dans la surface plateforme — les apps web sans bridge Electron ne subissent plus le 404 → fallthrough plane (bruit + faux états) ; quand un bridge est en ligne, `desktop: true` reflète le registre de présence réel.
  - **Login** (`auth` + `shell-ui`) : lien d'action secondaire configurable via `ShellUiBrand.login.secondaryLink` (`{ label, href }`, ex. inscription POS) — clé absente = rien ne s'affiche, aucun libellé hardcodé.

### Patch Changes

- @creezio/brand-config@0.9.0
- @creezio/shell@0.9.0

## 0.8.1

### Patch Changes

- @creezio/brand-config@0.8.1
- @creezio/shell@0.8.1

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
- @creezio/shell@0.8.0

## 0.7.1

### Patch Changes

- @creezio/brand-config@0.7.1
- @creezio/shell@0.7.1

## 0.7.0

### Patch Changes

- @creezio/brand-config@0.7.0
- @creezio/shell@0.7.0

## 0.6.0

### Minor Changes

- d948fcc: feat(login): page /login split-screen 50/50 brand-configurable — nouveau `LoginPage` (@creezio/auth/ui) : panneau formulaire modernisé (labels associés, `role="alert"`, `aria-invalid`, focus accent, loading) + panneau brand (logo/initiale, nom produit, tagline, highlights, gradient/image configurables). Config marque via `ShellUiBrand.login` (prop `login` de `CreezioUiBoot`) — zéro hardcodé, défaut neutre élégant sans config. `configureShellUiBrand` devient no-op sans changement (comparaison par clé, `login` en profondeur) et notifie des abonnés : nouveau `subscribeShellUiBrand` + hook `useShellUiBrand` (@creezio/shell-ui/ui[/kit]) pour lire la brand au render sans flash du défaut — CreezioUiBoot configure désormais au render. Compat : `LoginForm` inchangé fonctionnellement (mêmes props/modes), la route OS /login et le template factory basculent sur `LoginPage` — aucune modif requise côté apps pour le nouveau design.

### Patch Changes

- @creezio/brand-config@0.6.0
- @creezio/shell@0.6.0

## 0.5.0

### Minor Changes

- 0ff4ed2: Bandeau impersonation ? Voir comme ? natif dans WorkspaceRoot (auto-masqu?
  hors impersonation, nom produit via getShellUiBrand, retour via
  stopImpersonate) ? plus de wiring marque n?cessaire.

### Patch Changes

- d674c86: Peers internes @creezio/\* en `>=0.4.0` (au lieu de `^0.4.0`) : ?vite que le
  train lockstep escalade en 1.0.0 au premier bump minor (les peers restent
  satisfaits par toute version future du kit).
- Updated dependencies [e23b259]
- Updated dependencies [d674c86]
  - @creezio/brand-config@0.5.0
  - @creezio/shell@0.5.0
