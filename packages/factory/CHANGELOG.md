# @creezio/factory

## 0.20.0

### Minor Changes

- 2f5b6ea: H13 — résidu allowlist runtime (ARCHITECTURE_VERSION H12 → H13, convention 0.x : minor comme H10/H11/H12).

  - Crash env : plus de dual-read `TF2_*` / `CERTIVAN_*` / `FIDU_*` / `TEMPOFLOW3_*` — `CREEZIO_*` + scan `envKey`.
  - `envForNodeScriptSpawn` : plus d'heuristique packagée nommée marque.
  - UI kit : `creezio-fake-cursor`, `creezio-titlebar-*`, cache SW `creezio-shell-*`.
  - Codemods `scripts/codemods/H13/` (`since: 0.26.0`), appliqués par `creezio upgrade`.

### Patch Changes

- cff3d24: `server-docker update` persiste et réutilise le `hostPort` loopback (2ᵉ update = même port) et lit/écrit les fichiers stack root:root 600 (`cf.env`, `secrets.env`) via `sudo -n` / wrapper `/usr/local/sbin/creezio-server-docker priv-io` — fail-closed actionnable, plus de chmod one-shot.
- Updated dependencies [2f5b6ea]
  - @creezio/platform-core@0.26.0
  - @creezio/product-hub@0.26.0
  - @creezio/brand-config@0.26.0
  - @creezio/brand-spec@0.26.0

## 0.19.0

### Minor Changes

- a7f9988: Hygiene factory : rétention semver registre indépendante (≥ 3, jamais le tag servers.json), `creezio upgrade` isole npm au brand-root, `.npmrc` généré pointe npmjs.org, SKIP_DIRS partagé des codemods (dist-electron-server / win-unpacked / release / out).
- 17ae2a4: Les permissions nav des `navItems` alimentent `configureAuth` / `/admin/access` via `applyBrandModuleAuth` (collecteurs `collectNavPermissions` / `collectPermissionGroups`). `SessionProvider` lit uniquement `/me`. `brand module init` pose `permission: "nav.<id>"` sans `à qualifier` silencieux.
- 4d6eccc: Rétention GHCR via l'API Packages (3 semver + jamais in-use, fail-closed sans auth) et garde anti-doublon des PR de propagate (GET PR ouvertes / pin main / HTTP 422).

### Patch Changes

- 2da43ad: D1 / T10 — purge vocabulaire marque du runtime kit : markers Hermes hérités retirés, registre production propagation vidé (canaux data-driven), commentaires/JSDoc neutralisés, log opener `creezio-server`. Allowlist 270→117 / 493→173 occ. Pas de dual-read TEMPOFLOW\_\* recréé.
- Updated dependencies [2da43ad]
  - @creezio/brand-config@0.25.0
  - @creezio/platform-core@0.25.0
  - @creezio/product-hub@0.25.0
  - @creezio/brand-spec@0.25.0

## 0.18.1

### Patch Changes

- 465aa62: `agent up` persiste l'URL publique du tunnel dédié (`agentUrl`) dans host-agent.json et fleet-hosts.json après provision/migration — l'admin flotte ne sonde plus l'ancienne URL nested partagée. `fleet-hosts.json` root:root 600 : écriture via `sudo -n`, sinon POST `/admin/api/hosts/agent-url` (container) — plus d'exit 1 EACCES.
  - @creezio/brand-config@0.24.1
  - @creezio/platform-core@0.24.1
  - @creezio/product-hub@0.24.1
  - @creezio/brand-spec@0.24.1

## 0.18.0

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
  - @creezio/product-hub@0.24.0
  - @creezio/brand-config@0.24.0
  - @creezio/brand-spec@0.24.0

## 0.17.0

### Minor Changes

- 4d1b74d: **Breaking (comportement CLI)** : `creezio brand create` / `new-app` / `brand apply` ne créent plus les repos GitHub dès qu'un token est résolvable. Le push est **opt-in `--push`** uniquement — sans ce flag : zéro appel réseau, zéro résolution de token (env `GITHUB_TOKEN` / `CREEZIO_GITHUB_TOKEN` / `.github-token` ignorés). `--no-push` devient le défaut (flag accepté, redondant). `--push` sans token reste une erreur explicite.

  `creezio server-docker publish` pose le label OCI `org.opencontainers.image.source=https://github.com/<org>/<repo-marque>` dérivé du remote git `origin` du brand-root (fail-closed si le registre cible est `ghcr.io` et que le remote est introuvable), pour que GHCR rattache chaque package au repo marque.

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

- d66e1a4: `creezio server-docker registry-gc` (T11) : GC fail-closed du registre Docker local (`registry:2`, `127.0.0.1:5000`) — API v2 list/delete + `registry garbage-collect`, rétention `--keep N` (défaut 2) par famille de tags (`auto.*` de l'auto-publish CI d'un côté, tags manuels de l'autre), tags protégés jamais supprimés (conteneurs en cours, `docker-data/servers.json` — `--brand-root` + découverte labels `creezio.brand-root`, instances arrêtées incluses —, releases fleet de l'app admin via `--admin-app` / `CREEZIO_FLEET_ADMIN_URL`, admin injoignable = refus). Dry-run par défaut, `--apply` exécute.
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
- bf14b35: T7 — tunnel cloudflared DÉDIÉ au host-agent. L'ingress `agent.{slug}.{zone}` / `agent-{slug}.{zone}` appartient exclusivement au cycle de vie du host-agent : `creezio server-docker enroll` et `agent up` provisionnent un tunnel Cloudflare propre (`ensureCfAgentTunnel`, nom CF `creezio-agent-<slug>`, container `creezio-agent-tunnel`, token `docker-data/agent-tunnel.env` 600). `agent up` (chaque update de l'agent) détecte un hôte déjà enrôlé sans tunnel dédié et exécute la migration (provision → connecteur → bascule CNAME → retrait d'une règle résiduelle). Fail-closed si `CREEZIO_CF_*` manquent. `server-docker rm` d'une instance ne touche jamais les DNS agent ; seul `agent rm` les retire (`deprovisionCfAgentTunnel`). Plus d'option `agent` sur l'ingress kernel des instances, plus de kill-switch `CREEZIO_AGENT_TUNNEL_WATCH`. Respawn surveillé par `@creezio/fleet` `agent-tunnel.ts`. Gates : `test-phase-agent-tunnel`, `test-phase-tunnel-self-provision` §10, `test-phase-server-docker` (rm instance ≠ DNS agent).
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
- Updated dependencies [cd50ae5]
- Updated dependencies [bf14b35]
- Updated dependencies [b0a53b0]
  - @creezio/platform-core@0.23.0
  - @creezio/brand-config@0.23.0
  - @creezio/product-hub@0.23.0
  - @creezio/brand-spec@0.23.0

## 0.16.2

### Patch Changes

- e11ba99: Smokes compatibles cohérence éventuelle Meili (contrat kit : pas de write-through, liste servie `engine:"indexing"` + 0 item pendant l'indexation initiale). Nouveau helper SoT `@creezio/desktop-tooling/scripts/meili-list-poll.mjs` (`assertModuleRowHydratedById` via `GET ?ids=<id>` — hydratation PK, chemin SQL légitime — + `pollModuleListUntilVisible` : polling borné 60 s, échec explicite immédiat si `engine:"meili"` sans le doc). `e2e-browser-parcours.mjs` l'utilise (fini l'assertion naïve GET liste immédiat post-create) et indexe par défaut (`MEILI_SKIP_INDEX` passe de `"1"` à `"0"` — sinon la liste d'une entité indexée reste `engine:"indexing"` indéfiniment). Templates factory (`renderMetierParcoursSmoke` générique + CHR, `renderMiniPrdCoreSmoke`) régénérés sur le même pattern ; assertions d'origine conservées. Gate : `test-phase-meili-smoke-polling`.
- 9f0580d: `creezio upgrade` synchronise désormais la LISTE des deps `@creezio/*` des manifests marque avec la SoT du kit (`SERVER/UI/CLIENT_CREEZIO_DEPS`) : les deps requises manquantes sont ajoutées en `^<lockstep>` (trou systémique — os-ui@0.20.0 matérialise `/granola` et `/grokbot` sur une marque sans ces deps → build cassé), jamais de suppression (dep hors SoT = warning listé). Nouveau module partagé `sync-creezio-deps.ts` (`planCreezioManifestSync` / `applyCreezioManifestSync`) consommé aussi par `scripts/propagate-brands.mjs` ; `renderUiPackageJson` consomme la nouvelle SoT `UI_CREEZIO_DEPS` (plus de liste inline parallèle).
- Updated dependencies [5bbd5ba]
  - @creezio/brand-spec@0.22.0
  - @creezio/brand-config@0.22.0
  - @creezio/platform-core@0.22.0
  - @creezio/product-hub@0.22.0

## 0.16.1

### Patch Changes

- b9162e0: Factory : `tsconfig.preload.json` inclut `electron-shim.d.ts` pour compiler le preload hors ligne, sans paquet `electron` ni `npm install`.
- 2e39bcd: Factory `--link-kit` / `CREEZIO_LINK_KIT=1` : l'install d'une app fraîche pin les `@creezio/*` sur le worktree kit (`file:`), sans dépendre d'un publish préalable. Les gates scaffold et la CI l'utilisent toujours — la PR de release n'a plus d'œuf-poule registre. Les manifests générés restent `^<lockstep>`.
- 6e18a9f: Factory : `SERVER_CREEZIO_DEPS` est la SoT unique (kit-release.ts) consommée par scaffold et --from-prd — granola / grokbot / nav ne peuvent plus manquer du server/package.json généré.
- 60683cf: server-docker : `CREEZIO_SERVER_DOCKER_BACKUP=0` (aussi `false`/`off`) skippe les backups (`update --backup`, one-shot, migrate-stack, API `backup:true`). Défaut on (prod-safe). L'env gagne ; warn `backup skippé (CREEZIO_SERVER_DOCKER_BACKUP=0)`.
- Updated dependencies [ab09f4f]
  - @creezio/brand-spec@0.21.0
  - @creezio/brand-config@0.21.0
  - @creezio/platform-core@0.21.0
  - @creezio/product-hub@0.21.0

## Unreleased

### Patch Changes

- server-docker : `CREEZIO_SERVER_DOCKER_BACKUP=0` (aussi `false`/`off`)
  ignore `--backup` et les backups automatiques (update, backup one-shot,
  migrate-stack). Défaut on (prod-safe). Warn : `backup skippé (…)`.

## 0.16.0

### Minor Changes

- ac7035c: Retrait des wrappers de compat fleet-collector (dette 0.16, BACKLOG) :

  - `@creezio/observability` : suppression des 7 wrappers `.mjs`
    (`admin-docker`, `server-lib`, `instance-stack`, `agent-updates`,
    `registry-pull-proxy`, `server-admin`, `host-agent`) et du bin npm
    `creezio-server-admin` — la SoT flotte est `@creezio/fleet`
    (`packages/fleet/dist`). Le collector télémétrie (`server.mjs`,
    `ops-api.mjs`, `env.mjs`) reste inchangé.
  - `@creezio/factory` : le CLI `server-docker` (`importInstanceStack`,
    imports `server-lib` de backup/update/migrate-stack) pointe directement
    sur `packages/fleet/dist` (fail-closed si dist absent).
  - `@creezio/fleet` : protocole flotte v1 **strict** —
    `FLEET_PROTOCOL_ACCEPT_MISSING=false` (politique F4.4d). Pas de bump v2 :
    le format filaire est inchangé ; vérifié via l'API flotte que tous les
    composants déployés (host-agents enrôlés inclus) annoncent déjà v1.
  - `@creezio/admin` : le mount `fleet-releases` pose désormais le header
    `x-creezio-fleet-protocol` sur toutes ses réponses (la boucle pull des
    agents le vérifie — strict en 0.19) ; nouvelle dépendance
    `@creezio/fleet`.

- e6303bb: P1.c — coupe `electron` / `electron-shell` de l'image serveur :

  - `resources/{vendor,scripts,bin}` (Hermes, n8n, skills, sonde Meili)
    déménagent de `@creezio/electron-shell` vers `@creezio/host-runtime`.
  - `kitOsResourcesRoot()` résout `@creezio/host-runtime`.
  - Factory : plus d'`electron-shell` dans `SERVER_CREEZIO_DEPS` (le client
    thin le garde).
  - Dockerfile : après `npm ci`, purge `electron`, `electron-updater` et
    `@creezio/electron-shell` du stage deps (runtime headless Node pur).

### Patch Changes

- Updated dependencies [e6303bb]
  - @creezio/platform-core@0.20.0
  - @creezio/brand-config@0.20.0
  - @creezio/product-hub@0.20.0
  - @creezio/brand-spec@0.20.0

## 0.15.0

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

- c34b2b0: `server-docker create/update` VPS (pas tunnel-local) force `CREEZIO_NATIVE_WARM=1` + `CREEZIO_NATIVE_WARM_N8N=1` + Hermes. `CREEZIO_NATIVE_WARM=0` / `_N8N=0` / `_HERMES=0` sont ignorés (warn « ignoré, n8n/hermes requis »). `N8N=1` est posé explicitement pour écraser l'ENV image.
- bf7a973: `server-docker create/update` VPS (pas tunnel-local) pose `CREEZIO_NATIVE_WARM=1` et `CREEZIO_NATIVE_WARM_HERMES=1`. Skip n8n (`CREEZIO_NATIVE_WARM_N8N=0`) ne bloque plus Hermes.
  - @creezio/brand-config@0.19.0
  - @creezio/platform-core@0.19.0
  - @creezio/product-hub@0.19.0
  - @creezio/brand-spec@0.19.0

## Unreleased

### Patch Changes

- VPS `create`/`update` (pas tunnel-local) : n8n et Hermes sont requis. `CREEZIO_NATIVE_WARM=0` / `CREEZIO_NATIVE_WARM_N8N=0` / `CREEZIO_NATIVE_WARM_HERMES=0` sont ignorés (warn « ignoré, n8n/hermes requis »). `CREEZIO_NATIVE_WARM_N8N=1` est posé explicitement (l'image Docker peut avoir `=0` en ENV).

## 0.14.0

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
- @creezio/platform-core@0.18.0
- @creezio/product-hub@0.18.0
- @creezio/brand-spec@0.18.0

## 0.13.0

### Minor Changes

- cafae1e: Clôture des dettes structurelles flotte (BACKLOG § Flotte multi-VPS) :

  - **`verify-prod` généralisé** : la factory matérialise `scripts/verify-prod.mjs`
    dans toute app générée (profil brand : version / login E2E `secrets.env` /
    `auth/me` role owner / browse d'un module à `meiliIndexes` `engine:"meili"` /
    `llm-status` ; profil admin : version / login / me), script npm `verify:prod`,
    extension métier `scripts/verify-prod.local.mjs` (`localChecks(ctx)`, jamais
    régénérée). Gate d'inventaire : `test-phase-factory-two-repos`.
  - **Préflight UFW fail-closed** dans `server-docker agent up | admin up |
enroll` (`src/server-docker-ufw.ts`, gate `test-phase-server-docker-ufw`) :
    UFW actif + règle `172.16.0.0/12 → 172.17.0.1:<port>` absente → règle posée
    (root / `sudo -n`, re-vérifiée), sinon échec explicite avec la commande
    exacte — incident 10–30/08/2026 (host-agent droppé 20 jours) rendu
    impossible.
  - **App admin : heartbeat flotte vers elle-même** : `server-docker create
--profile prod` d'une app admin pose `CREEZIO_FLEET_ADMIN_URL=http://127.0.0.1:18791`
    par défaut (si secret register présent et URL absente) — l'instance admin
    apparaît au tableau `/flotte` avec son propre `kitVersion`.

## 0.12.0

### Minor Changes

- 13c1d18: P3.a — runner de montée de version marque : nouvelle commande `creezio
upgrade` (détection version d'architecture, chaîne de codemods H* dans
  l'ordre avec idempotence vérifiée, bump `@creezio/*`de tous les manifests
en`--package-lock-only`, rematérialisation os-ui, doctor fail-closed,
`--dry-run`) ; codemods embarqués dans le package factory publié ; scaffold
stampe `creezio.architectureVersion` ; doctor brand-spec : les seuils datés
(`\*\_CONTRACT_SINCE`) passent en politique N-2 (pin marque à plus de 2
  versions lockstep derrière le kit = error, sinon warn).

### Patch Changes

- Updated dependencies [13c1d18]
  - @creezio/platform-core@0.17.0
  - @creezio/brand-spec@0.17.0
  - @creezio/product-hub@0.17.0
  - @creezio/brand-config@0.17.0

## 0.11.0

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
  - @creezio/brand-spec@0.16.0
  - @creezio/product-hub@0.16.0
  - @creezio/brand-config@0.16.0

## 0.10.0

### Minor Changes

- 1ab886b: P2.b — backend flotte sorti d'observability et typé : nouveau package `@creezio/fleet` (portage TS strict isofonctionnel des 7 `.mjs` de fleet-collector : admin-docker→docker, server-lib, instance-stack, agent-updates, registry-pull-proxy, server-admin, host-agent). Contrat de version agent↔backend (F4.4d) : header `x-creezio-fleet-protocol` v1 dans les deux sens, dual-accept UNE version pour les composants ≤ 0.14 sans header (warn bruyant throttlé), refus explicite actionnable sur écart de version. Les `.mjs` de fleet-collector deviennent des wrappers de compat `[deprecated]` (retrait au prochain minor) ; images server-admin/host-agent : CMD → `node_modules/@creezio/fleet/dist/bin/*-main.js`, contexte de build stagé par `stageFleetImageContext` (fail-closed si dist absent). Zéro changement de comportement : mêmes endpoints, formats d'état disque, noms de conteneurs/images.

### Patch Changes

- @creezio/brand-config@0.15.0
- @creezio/product-hub@0.15.0
- @creezio/brand-spec@0.15.0

## 0.9.1

### Patch Changes

- @creezio/brand-config@0.14.0
- @creezio/product-hub@0.14.0
- @creezio/brand-spec@0.14.0

## 0.9.0

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

### Patch Changes

- Updated dependencies [a9e9fd7]
  - @creezio/brand-config@0.13.0
  - @creezio/product-hub@0.13.0
  - @creezio/brand-spec@0.13.0

## 0.8.0

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
  - @creezio/brand-spec@0.12.0
  - @creezio/product-hub@0.12.0
  - @creezio/brand-config@0.12.0

## 0.7.6

### Patch Changes

- 3939d67: P1.b suivi — le smoke `test:meili-config` généré importait le dist interne
  d'electron-shell (`dist/host/meili-launcher.js`, `dist/host/meili/generic-indexer.js`),
  chemins disparus avec l'extraction `@creezio/search` (0.11.0) — vécu CI
  tempoflow3 PR #57. Le template importe désormais la surface publique
  `@creezio/search` (bare import, node_modules-first par construction) et le
  scaffold serveur déclare `@creezio/search` + `@creezio/host-runtime` en
  dépendances directes. Gate `test-phase-factory-templates` durcie : tout
  import profond de dist dans le smoke généré = rouge.

## 0.7.5

### Patch Changes

- @creezio/product-hub@0.11.0
- @creezio/brand-config@0.11.0
- @creezio/brand-spec@0.11.0

## 0.7.4

### Patch Changes

- e07d2cf: Meili core fail-closed dans le scaffold :

  - `createSearchMount` généré : Meili KO = 503 `meili_unavailable` (SQL borné
    uniquement sous `CREEZIO_ALLOW_NO_MEILI=1`), `engine:"indexing"` pendant
    l'indexation initiale.
  - Smokes générées (`harnessPrelude`) + workflow CI marque : posent
    `CREEZIO_ALLOW_NO_MEILI=1` (harness métier hors-browse — le boot
    fail-closed exige sinon un binaire Meili).

- Updated dependencies [e07d2cf]
  - @creezio/brand-spec@0.10.13
  - @creezio/brand-config@0.10.13
  - @creezio/product-hub@0.10.13

## 0.7.3

### Patch Changes

- 0823798: Search mount généré : 0 hit Meili reste meili (plus de piège 0-hit→SQL). Modules catalogue : meiliIndexes ou horsIndexJustification.
  - @creezio/brand-config@0.10.12
  - @creezio/product-hub@0.10.12
  - @creezio/brand-spec@0.10.12

## 0.7.2

### Patch Changes

- 38beaeb: Chrome OS (RequireSession + middleware JWT) dès brand create / new-app. Admin : un seul middleware session + rewrite lp.{zone} (plus de /flotte sans cookie). Scaffold MCP : logsSlot RequestLogsClient.
  - @creezio/brand-config@0.10.11
  - @creezio/product-hub@0.10.11
  - @creezio/brand-spec@0.10.11

## 0.7.1

### Patch Changes

- 4ecd205: Un repo admin pose tout seul `CREEZIO_DOMAIN=admin.{zone}` + `CREEZIO_TUNNEL_EXTRA_HOSTNAMES=lp.{zone}`. `migrate-stack` synchronise un stack déjà in-process (`sync-cf`). NPM n'est plus une voie d'exposition.
- 4ecd205: migrate-stack attache un tunnel Cloudflare in-process à un stack déjà sans sidecar quand cf.env manque et que CREEZIO*CF*\* + CREEZIO_DOMAIN sont posés (landing extra-hostname / admin historique).
  - @creezio/brand-config@0.10.10
  - @creezio/product-hub@0.10.10
  - @creezio/brand-spec@0.10.10

## 0.7.0

### Minor Changes

- 4cd6614: `creezio brand create` is the only way to birth a brand (no notes, no `server/crm/`, no `demo-app`). Doctor fails closed on stub specs and leftover notes so an agent cannot scaffold a notes/demo app.

  Terminer / Quitter retire le curseur singleton du DOM (`#creezio-demo-cursor` + `data-creezio-demo-ui`) au lieu de le laisser en opacity 0.

  `server-docker create --profile prod` forwarde aussi `CREEZIO_FLEET_BACKEND_URL` et `CREEZIO_FLEET_BACKEND_BASIC`.

### Patch Changes

- Updated dependencies [4cd6614]
  - @creezio/brand-spec@0.10.9
  - @creezio/brand-config@0.10.9
  - @creezio/product-hub@0.10.9

## 0.6.6

### Patch Changes

- a2fea46: **feat — `mcpTools` retiré ; `MODULE_MCP_TOOLS_DEPRECATED` = error.**

  `BrandModuleDef.mcpTools` n'existe plus. SoT = `operations[]` → tools MCP générés (`listOperations()`). Plus de merge legacy (`mergeGeneratedAndLegacy` / `warnLegacyModuleMcpTools`). Doctor fail-closed : un `mcpTools()` restant = error. Le hook apps `discoverModuleTools` reste (extras / JWT), sans documenter de tools manuscrits.

- Updated dependencies [a2fea46]
  - @creezio/brand-spec@0.10.8
  - @creezio/brand-config@0.10.8
  - @creezio/product-hub@0.10.8

## 0.6.5

### Patch Changes

- 55b1cd5: **feat — catalogue `listOperations()` + tools MCP générés + doctor ops non vides.**

  `api.listOperations()` alimente `/admin/api` (plus seulement la surface Hono). Les tools `module.<mountId>.<op.id>` sont générés depuis ce catalogue (handler = requête HTTP synthétique). Doctor fail-closed : `MODULE_OP_MISSING` si `apiMounts` sans `operations[]` **non vide** (pin ≥ 0.10.6) ; EntitySpec seul = OK (CRUD auto) ; `mcpTools` restant = `MODULE_MCP_TOOLS_DEPRECATED` (warn). Mounts kit/OS hors `modules/*.ts` non scannés.

- Updated dependencies [55b1cd5]
  - @creezio/brand-spec@0.10.7
  - @creezio/brand-config@0.10.7
  - @creezio/product-hub@0.10.7

## 0.6.4

### Patch Changes

- 1c7ec66: **feat — SoT unique : une opération de module = HTTP + /admin/api + tool MCP.**

  `ModuleOperation` sur `ApiMount` / EntitySpec (CRUD auto). Le kit collecte puis génère les tools `module.<mountId>.<op.id>` (handler = requête HTTP synthétique). Catalogue `/admin/api` = ops kernel, plus seulement la surface Hono admin. `mcpTools()` déprécié (doctor error si recouvrement). Doctor fail-closed `MODULE_OP_MISSING` / `MODULE_OP_UNCATALOGUED` depuis 0.10.6. Enable MCP = policies sur tools générés (`mcpPublishDefault`, `roles`).

- Updated dependencies [1c7ec66]
  - @creezio/brand-spec@0.10.6
  - @creezio/brand-config@0.10.6
  - @creezio/product-hub@0.10.6

## 0.6.3

### Patch Changes

- 6bce6a8: **fix(server-docker) — owner persisté dans secrets.env + ensure-owner.**

  `create` écrit `CREEZIO_OWNER_*` dans `docker-data/stacks/<nom>/secrets.env` (chmod 600, `env_file`) — plus seulement un POST hôte oublié ensuite. `update` fusionne `secrets.env` : owner / `CREEZIO_E2E_*` ne sont plus droppés. Nouveau geste `creezio server-docker ensure-owner <nom>` : first-run si setup incomplet, sinon seed recette + vérif login, recreate **app seule** (sidecar / tunnel intact). Fail-closed VPS inchangé. Jamais le mot de passe en log ni dans le registre.

  - @creezio/brand-config@0.10.5
  - @creezio/product-hub@0.10.5
  - @creezio/brand-spec@0.10.5

## 0.6.2

### Patch Changes

- 5f8a383: **fix(update) — ne peut plus retirer cloudflared / changer le hostname.**

  `server-docker update` (et tout recreate compose) préserve un sidecar `cloudflared*` historique : seule l'image app change, `tunnel.env` / id / hostname inchangés, `up` sans `--remove-orphans`. Si une adresse publique est persistée sans sidecar (et sans contrat in-process), l'update **refuse** plutôt que de publier un compose app-seule (incident Tempoflow restos, 0.10.2 → 530/1033). Dev `CREEZIO_TUNNEL_LOCAL=1` inchangé. `migrate-stack` seul retire un sidecar et **réutilise** le tunnel existant — jamais un 2e hostname à l'update.

  - @creezio/brand-config@0.10.3
  - @creezio/product-hub@0.10.3
  - @creezio/brand-spec@0.10.3

## 0.6.1

### Patch Changes

- 595c5fb: **Fail-closed — démo interactive native obligatoire** (plus optionnelle).

  Une app `--from-prd` / `create-brand` sort avec `createInteractiveDemoMount`, `interactiveDemoMigrations`, CSS + dep UI. `CreezioUiBoot` monte `InteractiveDemoRoot` (lanceur sidebar) : le chrome marque ne peut plus l'oublier. `brand module init` pose un stub `demo.scenarios` jouable (`genericOsTourScenario` + tour module). Gates : `test-phase-create-brand` assert les 4 branchements ; doctor / `test:modules` exigent ≥ 1 scénario par module. `server-docker create` (après setup owner) : `GET /api/v1/modules/interactive-demo/scenarios` ≥ 1, sinon échec — sauté si owner skip (`CREEZIO_TUNNEL_LOCAL=1` sans creds). Id `os-tour` partagé (premier gagne). Seed données métier = marque.

- Updated dependencies [595c5fb]
  - @creezio/brand-spec@0.10.1
  - @creezio/brand-config@0.10.1
  - @creezio/product-hub@0.10.1

## 0.6.0

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

- @creezio/product-hub@0.10.0
- @creezio/brand-config@0.10.0
- @creezio/brand-spec@0.10.0

## 0.5.7

### Patch Changes

- ce13ce0: `server-docker create` VPS/prod est fail-closed : sans `CREEZIO_TUNNEL_PROVISION_URL`/`_TOKEN`, la commande échoue (plus de stack loopback « OK »). Un slug d'instance dans `RESERVED_SLUGS` (`demo`…) dérive `CREEZIO_TUNNEL_SLUG=<brand>-<slug>` (log + env instance). `CREEZIO_TUNNEL_LOCAL=1` reste l'opt-in dev local.
- 35b72d5: `server-docker create` VPS/prod est fail-closed aussi sur le first-run owner : sans `CREEZIO_OWNER_EMAIL` / `CREEZIO_OWNER_PASSWORD`, la commande échoue (plus d'instance « OK » sans compte utilisable). Avec ces vars, le create appelle `POST /api/v1/os/setup` et log l'URL publique + `login : $CREEZIO_OWNER_EMAIL` (jamais le mot de passe). `CREEZIO_TUNNEL_LOCAL=1` : owner optionnel (dev machine).
  - @creezio/brand-config@0.9.4
  - @creezio/product-hub@0.9.4
  - @creezio/brand-spec@0.9.4

## 0.5.6

### Patch Changes

- d26f5db: Convention OS home = /dashboard, appliquée fail-closed par la factory et les gabarits de spec. `renderNextHomePage` redirige TOUJOURS vers `/dashboard` (plus de fallback `model.pages[0]` — vécu foove2 : `redirect("/notes")` résiduel et pas de page /dashboard alors que le workspace kit canonise tout href `/` → `/dashboard`), avec commentaire généré explicite (home réelle = `app/dashboard/page.tsx`). `ensureDashboardPage` garantit une page `/dashboard` dans TOUTE app générée (modèle générique et repo admin compris) ; `defaultWorkspaceHome` retourne toujours `/dashboard` ; le template dashboard dérive ses compteurs des entités réelles du spec (plus de labels CHR en dur). Gabarits brand-spec (interview.md / prd.md) : section « Conventions OS non négociables » (home /dashboard, `/` = pure redirection factory, nav accueil → /dashboard, routes OS + /site/\* réservées) — une interview générée ne peut plus proposer « accueil à / ».
- 83a1913: Templates factory : les scripts/feeds générés substituent les entités RÉELLES du ProductModel — `test-metier-parcours.mjs` testait un hardcode `notes` (404 sur une app sans ce module — vécu foove2-admin), le feed Meili générique indexait la table `notes` (absente du schema généré), et `test-meili-config.mjs` résolvait `meili-launcher.js`/`generic-indexer.js` par sondage d'un chemin monorepo kit inexistant dans une app npm (helper `electronShellDist` node_modules-first, porté de winhub). Fixture Meili générique : INSERT dans la table de la première entité du spec.
- Updated dependencies [d26f5db]
  - @creezio/brand-spec@0.9.3
  - @creezio/brand-config@0.9.3
  - @creezio/product-hub@0.9.3

## 0.5.5

### Patch Changes

- cfd5c31: Factory : les DEUX repos d'une marque naissent avec leurs `package-lock.json` — `maybePushBrandRepos` ne préparait les locks que du monorepo marque, le repo admin `<brand>-admin` était poussé sans aucun lock (vécu foove2-admin, 2026-08-13) ; échec explicite si un lock n'est pas produit. Tout scaffold (marque ET admin) génère aussi `.cursor/environment.json` (`npm install --no-audit --no-fund`) pour les cloud agents Cursor.

## 0.5.4

### Patch Changes

- 8c0ae0f: Dockerfile serveur : `ELECTRON_SKIP_BINARY_DOWNLOAD=1` dans le stage `deps` (electron atterrit dans l arbre prod via le lockfile malgre --omit=dev ; son postinstall telecharge ~100 Mo sur le CDN GitHub, flaky sous charge — echec de build vecu sur tempoflow 2026-08-12) + retries npm (`NPM_CONFIG_FETCH_RETRIES=5` etc.) dans les stages d install (reset TLS transitoire). Builds in-image deterministes, identiques sur tous les hotes.

## 0.5.3

### Patch Changes

- b13449f: server-docker : build 100% in-image — le stage `brand-build` du Dockerfile kit produit `build/electron` (tsc) et `ui/.next/standalone` (materialize + next build) ; `ensureUiBuild`/`ensureElectronBuild` hôte supprimés du chemin standard (`build`/`create`/`publish`/`up`). node/npm de l'hôte ne produisent plus aucun artefact d'image : même résultat sur tous les serveurs.

  Fix template tailwind factory (`renderUiTailwindConfig`) : suppression des globs `../../node_modules/@creezio/*` — le symlink workspace racine `@creezio/app-<brand>` → `server/` y matchait et Tailwind scannait `server/ui/node_modules` + `.next` (~900 Mo, ~20k fichiers → compile Next 30 s → 17 min+, hang tempoflow3-admin). Scan local `./node_modules/@creezio/*` uniquement (server/ui = projet npm indépendant, deps jamais hoistées).

  dockerignore v5 : sources `server/` + `server/ui` dans le contexte ; `**/node_modules`, `**/.next`, `build/` hôte exclus.

## 0.5.2

### Patch Changes

- @creezio/brand-config@0.9.0
- @creezio/product-hub@0.9.0
- @creezio/brand-spec@0.9.0

## 0.5.1

### Patch Changes

- f2baaf8: migrate-stack : provisioner resolu depuis l env de l instance (registre) avant
  le .env de marque — ce dernier peut viser un endpoint public legacy qui ignore
  serviceHost (ingress reste sur 127.0.0.1, 502 post-migration resto-lyon).
  - @creezio/brand-config@0.8.1
  - @creezio/product-hub@0.8.1
  - @creezio/brand-spec@0.8.1

## 0.5.0

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

- eee10b4: migrate-stack : provisioner resolu depuis l env de l instance (registre) avant
  le .env de marque — ce dernier peut viser un endpoint public legacy qui ignore
  serviceHost (ingress reste sur 127.0.0.1, 502 post-migration resto-lyon).
  - @creezio/product-hub@0.8.0
  - @creezio/brand-config@0.8.0
  - @creezio/brand-spec@0.8.0

## 0.4.0

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

- @creezio/brand-config@0.7.0
- @creezio/product-hub@0.7.0
- @creezio/brand-spec@0.7.0

## 0.3.1

### Patch Changes

- @creezio/brand-config@0.6.0
- @creezio/product-hub@0.6.0
- @creezio/brand-spec@0.6.0

## 0.3.0

### Minor Changes

- 142774b: Suppression définitive du vendoring : les artefacts générés par la factory ne référencent plus `vendor/creezio` — le proxy `creezio-cli.mjs` résout `CREEZIO_KIT_ROOT` → `node_modules/@creezio/factory` → chemin VPS, les wrappers desktop-tooling ne résolvent plus que via `node_modules`, et le test généré n'exclut plus de dossier `vendor`. Les gates de synchronisation de l'ère vendoring (O0, O5p, O9p, O10, O11, M1p, P0-intention) et la lib `intention-twins` sont retirées de la suite.

## 0.2.0

### Minor Changes

- 6f7e112: feat(interactive-demo) : collecteur de contributions démo par module — `DemoModuleContribution` + `collectInteractiveDemoDefaults()` (validation `validateDemoScenario`, dédup par id, ordre stable, erreurs agrégées explicites). Convention module étendue : champ optionnel `demo: { scenarios }` du `BrandModuleDef` (template `_template` + DOC-STANDARD-MODULE) et `collectDemoScenarios()` généré dans le registre `modules/index.ts` — le mount se câble en une ligne : `createInteractiveDemoMount({ defaults: collectDemoScenarios() })`. Dep serveur scaffoldée : `@creezio/interactive-demo` rejoint la clôture `@creezio` des apps marque.

### Patch Changes

- e23b259: feat(npm-deploy-tooling) : tooling de déploiement Docker en mode npm — le Dockerfile SoT (docker/server) installe les @creezio/\* depuis GitHub Packages via secret BuildKit CREEZIO_NPM_TOKEN (plus de COPY vendor ni symlinks, npm ci strict sur le lock racine workspace), dockerignore v4 sans exceptions vendor. Factory : les apps générées naissent npm (deps ^lockstep, .npmrc, workspaces racine, workflows ci+deploy seuls — kit-compat/vendor-update supprimés), ensure-server-lock.mjs valide les locks workspace, prepareBrandDistribution = locks npm. CLI server-docker : build/publish passent le secret BuildKit (CREEZIO_NPM_TOKEN requis) et ensureBrandStandalone ne matérialise plus de vendor. brand-config : FileSets asar résolus depuis node_modules (walk-up workspaces) au lieu de vendor/creezio.
- Updated dependencies [6f7e112]
- Updated dependencies [e23b259]
  - @creezio/brand-spec@0.5.0
  - @creezio/brand-config@0.5.0
  - @creezio/product-hub@0.5.0
