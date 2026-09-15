# @creezio/api-kernel

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
  - @creezio/platform-core@0.10.13

## 0.10.12

### Patch Changes

- 0823798: Meili browse : liste entity (q vide OK) via configureEntityMeiliFromFeed, helper browseMeiliIndex, SQL seulement si Meili KO ou filtre hors index.
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

- a2fea46: **feat — `mcpTools` retiré ; `MODULE_MCP_TOOLS_DEPRECATED` = error.**

  `BrandModuleDef.mcpTools` n'existe plus. SoT = `operations[]` → tools MCP générés (`listOperations()`). Plus de merge legacy (`mergeGeneratedAndLegacy` / `warnLegacyModuleMcpTools`). Doctor fail-closed : un `mcpTools()` restant = error. Le hook apps `discoverModuleTools` reste (extras / JWT), sans documenter de tools manuscrits.

  - @creezio/brand-config@0.10.8
  - @creezio/platform-core@0.10.8

## 0.10.7

### Patch Changes

- 55b1cd5: **feat — catalogue `listOperations()` + tools MCP générés + doctor ops non vides.**

  `api.listOperations()` alimente `/admin/api` (plus seulement la surface Hono). Les tools `module.<mountId>.<op.id>` sont générés depuis ce catalogue (handler = requête HTTP synthétique). Doctor fail-closed : `MODULE_OP_MISSING` si `apiMounts` sans `operations[]` **non vide** (pin ≥ 0.10.6) ; EntitySpec seul = OK (CRUD auto) ; `mcpTools` restant = `MODULE_MCP_TOOLS_DEPRECATED` (warn). Mounts kit/OS hors `modules/*.ts` non scannés.

  - @creezio/brand-config@0.10.7
  - @creezio/platform-core@0.10.7

## 0.10.6

### Patch Changes

- 1c7ec66: **feat — SoT unique : une opération de module = HTTP + /admin/api + tool MCP.**

  `ModuleOperation` sur `ApiMount` / EntitySpec (CRUD auto). Le kit collecte puis génère les tools `module.<mountId>.<op.id>` (handler = requête HTTP synthétique). Catalogue `/admin/api` = ops kernel, plus seulement la surface Hono admin. `mcpTools()` déprécié (doctor error si recouvrement). Doctor fail-closed `MODULE_OP_MISSING` / `MODULE_OP_UNCATALOGUED` depuis 0.10.6. Enable MCP = policies sur tools générés (`mcpPublishDefault`, `roles`).

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
