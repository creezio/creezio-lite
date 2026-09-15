# Creezio Lite

## 0.2.1 — isolation des onglets sur Sites

- Corrige une régression de l’intégration 0.2.0 : les panes conservées lisaient le contexte global Vinext, changeaient de page ensemble et publiaient le mauvais titre.
- Ajoute un pont de contexte par pane pour Sites. Le gel Next natif, la barre d’onglets, la navigation et le design Creezio sont conservés.
- Test React utilisant les véritables Children/Slot de Vinext : reproduction avant correctif, puis indépendance des titres, pages, saisies, transitions optimistes, rafraîchissements et fermeture d’une pane.
- Les applications existantes doivent aussi intégrer app/sites-pane-router.tsx et son provider dans BrandChrome ; voir docs/UPDATES.md.

## 0.2.0 — restauration du vrai kit

- Restaure les 36 packages Creezio 0.26.0 et l’ensemble des sources du monorepo, sa factory, ses scripts et ses dépendances.
- Remplace le shell imité de 0.1 par WorkspaceRoot, Sidebar, tabs, DataTable, primitives et thème du kit.
- Branche les pages natives Tâches, Support, Navigation et le player de visite interactive sur D1. Les modules nav/support/interactive-demo conservent leur handler original avec stockage injectable.
- Conserve les fonctionnalités Sites 0.1 (CRUD métier, fichiers privés, espaces et invitations), intégrées dans le shell natif.
- Documente les fonctions non portées ; la version 0.1 ne constituait pas un fork fonctionnel du kit.
- Nouvelle migration 0001 ; ne pas utiliser un upgrade automatique de 0.1 sans migration applicative.

## Historique upstream

# Changelog


## [Unreleased]

### Fixed — Win Server `Cannot find module '@creezio/auth'`

- **Cause** : `createRequire(process.cwd()/package.json)` ancré sur
  `{installDir}` (sans `node_modules`) alors que les `@creezio/*` sont dans
  `app.asar` — Require stack `…\TempoFlow-Server\package.json`.
- **Fix** : `createAppRequire()` (`@creezio/platform-core`) — ancrage module
  asar-safe ; remplace tous les `createRequire(cwd)` runtime.
- **Packaging** : `collectCreezioRuntimePackages()` dérive plancher ∪ deps
  marque ∪ transitive vendor (plus d’allowlist partielle seule).
- **Gate** : `verify-pack-runtime.mjs` résout depuis asar extract chaque
  `@creezio/*` + seeds npm scannés — échoue si un seul module manque.

### Fixed — raccourcis Server Docker (`xdg-open` manquant)

- `TempoFlow-Server-{N}.desktop` : `Exec` → `~/bin/open-creezio-server-N`
  → `~/bin/creezio-open-url` (firefox/chromium/`gio`/…), plus `xdg-open` seul.
- Cause user : `Failed to execute child process "xdg-open" (No such file…)`.
- CLI `creezio server-docker` pose les wrappers à chaque `up` / `proof`.

### Fixed — double-clic Server-N silencieux (XFCE / xrdp)

- Causes : `.desktop` non `metadata::trusted` ; `StartupNotify=true` sur bash ;
  snap Firefox tué hors cgroup (`is not a snap cgroup`) ; faux succès `gio open`.
- Fix : trust + `StartupNotify=false` ; log `~/.local/state/tempoflow-server/open-server.log` ;
  priorité `~/.local/firefox/firefox` (tarball) puis `/snap/bin/firefox`.

### Packaging Electron Windows (client slim / server bins)

- `buildElectronBuilderConfig` : client slim **sans** `resources/bin` (parité TF2) ;
  serveur embarque bins Win-only via `win.extraResources` depuis
  `.creezio/win-bin-stage` (filtre `cloudflared.exe` / `meilisearch-win.exe`) —
  **jamais** le dossier kit `electron-shell/resources/bin` en bloc dans asar
  ni extraResources (cause du client TF3 ~622 Mo).
- `WIN_SERVER_BIN_FILTER` / `stage-win-bins.sh` : plus d’alias `meili.exe`
  (doublon ~121 Mo) — uniquement `meilisearch-win.exe` + `cloudflared.exe` ;
  runtime `compose-brand-os` résout `meilisearch-win.exe` sous Windows.
- Exclusion asar systématique `!**/electron-shell/resources/bin/**`.
- Fileset `build/electron` toujours en forme objet (sinon `!node_modules/**`
  → asar sans `main.js` sur le serveur).
- `sync-creezio-vendor.sh` : copie `resources/vendor` electron-shell, **pas**
  les bins fat.
- `desktop-tooling/scripts/stage-win-bins.sh` + factory `pack:win` /
  `pack:win:server` / `electron:stage-win-bins`.
- Factory `electron-builder.base.json` : `!node_modules/**` + electron-updater
  (évite d’embarquer tout `node_modules` dans l’asar).

### Added
- **Phase P cockpit** — `@creezio/cockpit` (ServerCockpitShell + CockpitClient +
  configureCockpit) ; cutover TF→CV→Fidu ; extinction jumeaux UI ;
  `docs/archive/PHASE-P-COCKPIT.md` ; tests `test-phase-p-cockpit`.
- **Phase O11** — Freeze plan O0→O11 : matrice + PLAN-O + SHAs gold ;
  vision intention **~76 %** (honnête) ; `docs/archive/PHASE-O11.md` ;
  tests `test-phase-o11` ; republish feeds TF/CV/Fidu (runtime O7/O9p).
- **Phase N9** — Freeze vision 100 % N0→N9 : matrice + PLAN-N + SHAs gold ;
  dry-run sync ×3 ; `docs/archive/PHASE-N9.md` ; tests `test-phase-n9`.
- **Phase N8** — Gates LOC + allowlists vision ×3 marques :
  ceilings main/preload/runner/façades ; forbidden jumeaux ;
  `docs/archive/PHASE-N8.md` ; tests `test-phase-n8`.
- **Phase N7** — `supplier-tabs` hors métier CV/Fidu : SoT
  `@creezio/electron-shell` `host/browser-tabs` ; façades marques ;
  TF métier local conservé ; `docs/archive/PHASE-N7.md` ; tests `test-phase-n7`.
- **Phase N6p** — Cutover admin TF→Certivan : mounts ≤80 LOC ;
  delete analytics/mcp clients locaux ; façades + brand hosts ;
  kit UI imports `../dist` + `AdminPluginDetail` ; `docs/archive/PHASE-N6p.md` ;
  tests `test-phase-n6p`.
- **Phase N6** — Admin Plugins / MCP / usage-analytics génériques → kit :
  `@creezio/product-hub/ui` (AdminPluginsList/Detail) ;
  `@creezio/mcp-facade` admin + `./ui` (McpAdminClient) ;
  `@creezio/observability` usage + `./ui` (AnalyticsClient) ;
  adapters injectables ; demobrand I5 ACL inchangé ; **pas** de cutover
  marques (→ N6p) ; `docs/archive/PHASE-N6.md` ; tests `test-phase-n6`.
- **Phase N5** — Feature-off Fidu : `createFeatureOffHost` dans
  `@creezio/electron-shell` ; `BrandFeatures` /
  `features.plugins=false` (Fidu) ; delete `host-na-stubs.ts` ;
  `docs/archive/PHASE-N5.md` ; tests `test-phase-n5` ; republish Fidu.
- **Phase N4p** — Cutover migrations TF→Certivan→Fidu : steps plateforme
  absents (wraps Fidu) ; runners ≤150 LOC via `runHistoricalMigrations` ;
  `docs/archive/PHASE-N4p.md` ; tests `test-phase-n4p` ; republish Fidu (boot DB).
- **Phase N4** — Migrations historiques plateforme SoT kit :
  `platformHistoricalMigrations()` + `runHistoricalMigrations` dans
  `@creezio/platform-core` (16 steps TF gold) ; inventaire
  `docs/archive/PHASE-N4.md` ; gap migrate-legacy (colonnes absentes / 028→030) ;
  tests `test-phase-n4` ; **pas** de cutover marques (→ N4p) ;
  **pas** de republish exe.
- **Phase N3p** — Cutover assistant TF→Certivan→Fidu : jumeaux UI/runtime
  absents ; mounts `configureAssistantBrand` ; budgets ≤2000 LOC / chat-db ≤80 ;
  `docs/archive/PHASE-N3p.md` ; tests `test-phase-n3p` ; **pas** de republish exe.
- **Phase N3** — Runtime+UI assistant génériques dans `@creezio/assistant`
  (~11 kLOC TF gold) ; `configureAssistantBrand` (AppMap / Prompts /
  BrandTools / Meili / Hermes) ; UI `@creezio/assistant/ui` ; **pas** de
  métier panier/dispatch ; `docs/archive/PHASE-N3.md` ; tests `test-phase-n3` ;
  **pas** de republish exe.
- **Phase M12p** — `main.ts` Certivan + Fidu ≤ 800 LOC via
  `installBrandDesktopRuntime` ; deps marque (`pluginsDirEnvKey`,
  `supplierFidQueryParam`, `apiKeyEnvName`, `nodeRuntimeLabel`) ;
  `maybeRestartNextAfterHermesSpawn` + `getHeartbeatExtras` ;
  Paperclip **retiré** (aucun hook kit) ;
  fix TDZ `deps.supplierFidQueryParam` ; Paperclip **retiré**
  (aucun hook kit) ; `docs/archive/PHASE-M12p.md` ; tests `test-phase-m12p` ;
  republish Fidu (packing : retrait Paperclip `extraResources`).
- **Phase M12** — `electron/main.ts` TF ≤ 800 LOC via façade kit :
  `installBrandDesktopRuntime` dans `@creezio/electron-shell`
  (`desktop/brand-desktop-runtime.ts`) ; main = composition marque
  (brand-runtime, host-stack, vertical) ; smokes via
  `readDesktopRuntimeSrc()` ; `docs/archive/PHASE-M12.md` ; tests
  `test-phase-m12` ; **pas** de republish exe.
- **Phase M11** — Migrations SQLite cœur SoT kit :
  `platformCoreMigrations()` + `PLATFORM_CORE_MIGRATION_IDS` dans
  `@creezio/platform-core` ; TF `core-migrations.ts` absent ;
  `brand-runtime` → kit ; `brand-migrations` métier only ;
  `docs/archive/PHASE-M11.md` ; tests `test-phase-m11` ; **pas** de republish exe.
- **Phase M10** — Une seule arborescence métier TF : `crm/modules` =
  symlink → `electron/modules` (pas de doublon physique) ;
  `docs/archive/PHASE-M10.md` ; tests `test-phase-m10` ; **pas** de republish exe.
- **Phase M9** — MCP/API anti-jumeau : `wrapMcpFacadeWithHonoProxy` +
  contrat `MCP_PRODUCT_EXECUTOR` + `createCoreMcpTools` /
  `CREEZIO_CORE_MCP_TOOL_NAMES` dans `@creezio/mcp-facade` ; TF/Certivan
  sans jumeaux `mcp-runtime` / `mcp-hono-proxy` ; mounts métier only ;
  `docs/archive/PHASE-M9.md` ; tests `test-phase-m9` ; **pas** de republish exe.
- **Phase M7p** — Cutover Certivan fleet/ops (jumeaux absents ;
  `cvFleetAgent` / `getHeartbeatExtras` dossierStats ; dual-read
  `CertivanEVENT`) + Fidu vendor (stubs déjà absents) ;
  `docs/archive/PHASE-M7p.md` ; tests `test-phase-m7p` ; **pas** de republish exe.
- **Phase M7** — Fleet/obs TF sans stubs : `fleet-activity` +
  `createFleetSamples` dans `@creezio/observability` ; wiring marque
  `tfFleetAgent` / `tfFleetSamples` ; stubs TF
  `fleet-agent` / `ops-*` / `fleet-telemetry|activity|samples` absents ;
  `docs/archive/PHASE-M7.md` ; tests `test-phase-m7` ; **pas** de republish exe.
- **Phase M6p** — Dual-reads legacy Certivan/Fidu dans
  `@creezio/electron-shell` (n8n encryption/owner, Hermes API key / webui
  password, markers WebUI `.certivan-` / `.fidu-webui-*`) ; cutover
  Certivan puis Fidu (jumeaux absents ; `host-runtime-ctx` /
  `local-config-store` ; Paperclip retiré toutes marques en M12p) ;
  `docs/archive/PHASE-M6p.md` ; tests `test-phase-m6p` ; **pas** de republish exe.
- **Phase M5** — Delete jumeaux bootstraps hermes/n8n TF : deltas
  (`installHermesAgent`, webui deps marker/pip skip, scripts vendorisés,
  os-profile, `failDiskSpace`/`force`/timeout npm) portés dans
  `@creezio/electron-shell` ; TF bootstraps absents ; hooks
  `host-runtime-ctx` ≤200 LOC ; `docs/archive/PHASE-M5.md` ; tests `test-phase-m5` ;
  **pas** de republish exe.
- **Phase M4** — Delete jumeau `local-config` TF : `fleetTelemetry` +
  sanitize/patch dans `@creezio/platform-core` ; store kit
  (`get/setFleetTelemetry`, `configPath` getter, encryption electron sync) ;
  TF wiring ≤40 LOC (`local-config-store.ts`) ; `docs/archive/PHASE-M4.md` ;
  tests `test-phase-m4` ; **pas** de republish exe.
- **Phase M3** — Product Hub / control-plane zéro façade TF : helpers kit
  (`migrateLegacyBrandProductHubOnce`, `createBrandProductHubBindings`,
  `createCachedSqliteProductHubAccessor`, `createProductHubHost`,
  `withBearerServiceKeyFallback`) ; TF façades ≤40 LOC ; extras verticaux ;
  `docs/archive/PHASE-M3.md` ; tests `test-phase-m3`.
- **Phase M3p** — Même cutover Certivan puis Fidu ; SoT core.db ; façades ≤40 ;
  `docs/archive/PHASE-M3p.md` ; tests `test-phase-m3p`.
- **Phase M2** — Admin UI Database hors TF : `@creezio/database/ui` (port
  panels) + `createAdminDatabaseRoutes` ; TF route mince ; sync vendor copie
  `ui/` ; `docs/archive/PHASE-M2.md` ; tests `test-phase-m2`.
- **Phase M2p** — Même UI/routes kit sur Certivan puis Fidu ; zéro panel local ;
  `docs/archive/PHASE-M2p.md` ; tests `test-phase-m2p`.
- **Phase R2** — Product Hub SoT unique `core.db` : `PRODUCT_HUB_RUNTIME_SQL`,
  store étendu (updateTask/details/changelog), cutover TF Next (plus de
  split-brain mig 028 brand) ; `docs/archive/PHASE-R2.md` ; tests `test-phase-r2` ;
  **pas** de republish exe.
- **Phase R0** — Gel inventions : V1/V2/V3 = prototypes ≠ SoT ;
  `@creezio/automations` clarifié **lifecycle-only** ; interdiction nouvelles
  features plateforme dans TF/Certivan/Fidu ; `docs/archive/PHASE-R0.md`.
- **Phase R1** — Package `@creezio/database` (port SoT TempoFlow Admin Database
  + automations row-level) ; cutover TF vendor ; matrice Database = natif ✅ ;
  `docs/archive/PHASE-R1.md` ; tests `test-phase-r0/r1` ; **pas** de republish exe.
- **Phase C8** — Docs finales + republish TF **0.10.32** · Certivan **0.1.15** ·
  Fidu **0.1.57** ; checklist C* 100 % ; `docs/archive/PHASE-C8.md`.
- **Phase C7** — Control-plane unifié `startHostPluginControlPlane` (TF /
  Certivan / Fidu / demobrand) + `preHandle` extras ; `docs/archive/PHASE-C7.md` ;
  pas de republish (→ C8).
- **Phase C4** — V2/V3 prod-ready : `createSqliteAutomationPersist`, console
  obs/automations SQLite, demobrand persist, pilote TempoFlow vendor + mounts ;
  `docs/archive/PHASE-C4.md` ; `test-phase-c4.mjs` ; pas de republish (→ C8).
- **Phase C5/C6** — docs sign-off mounts Fidu + RTI Certivan (`PHASE-C5.md`,
  `PHASE-C6.md`).
- **Phase C3** — Fabrique V1 réelle : scaffold `schema.sql`/`api.js`/`mcp-tools.js`,
  console SQLite persistée, `PrdDrafter` LLM optionnel ; demobrand E2E ;
  `docs/archive/PHASE-C3.md` ; `test-phase-c3.mjs` ; pas de republish.
- **Phase C2** — Certivan : MCP façade→Hono proxy + stores SoT kit cutover ;
  `docs/archive/PHASE-C2.md` ; `test:phase-c2` ; pas de republish (→ C8).
- **Phase C1** — Cutover stores TempoFlow SoT kit : assistant rich schema,
  tasks `upsertWithId`, mails inbound ; TF zéro dual-write runtime ;
  `docs/archive/PHASE-C1.md` ; tests kit + `test:phase-c1` ; pas de republish (→ C8).
- **Phase C0** — Alignement docs / gates / matrice sur l’état réel post-audit
  (versions TF 0.10.31 · Fidu 0.1.56) ; backlog correction **C1–C8** ;
  `docs/archive/PHASE-C0.md` ; tests `test-phase-c0.mjs` ; pas de republish.
- **Phase V3** — Automations **lifecycle-only** (prototype) : package
  `@creezio/automations` (triggers plugins/org/factory/obs — **≠** Database
  row-level) ; demobrand règles + API ; sign-off [VISION-V1-V3.md](docs/archive/VISION-V1-V3.md) ;
  tests `test-phase-v3.mjs` ; pas de republish marques.
- **Phase V2** — Observabilité native : package `@creezio/observability`
  (activité, usages plugins, control-plane) ; demobrand mount + émissions ;
  console `GET/POST /api/observability` multi-org ; `docs/archive/PHASE-V2.md` ;
  tests `test-phase-v2.mjs` ; pas de republish marques.
- **Phase V1** — Fabrique plugins conversationnelle : `createConversationalPluginFactory`
  (intention → impact → PRD → scaffold → openPlugin → MCP) ; demobrand
  mount `plugin-factory` + tools MCP ; console `GET/POST /api/plugin-factory` ;
  `docs/archive/PHASE-V1.md` ; tests `test-phase-v1.mjs` ; pas de republish marques.
- **Phase D6** — Certivan polish : aliases MCP source unique ; dualités
  MCP/stores acceptées (non bloquantes) ; `docs/archive/PHASE-D6.md` ; pas de republish.
- **Phase D5** — ADR Fidu `clientSlim: false` définitif + critères réouverture ;
  `docs/adr/ADR-FIDU-CLIENTSLIM-D5.md`, `PHASE-D5.md`.
- **Phase D4** — Fidu control-plane HTTP minimal + ACL L3 E2E ;
  `docs/archive/PHASE-D4.md` ; bump marque **0.1.56** (republish standing ship).
- **Phase D3** — TempoFlow scan API métier + feature-parity + republish
  **0.10.31** Client+Serveur ; `docs/archive/PHASE-D3.md`.
- **Phase D2** — TempoFlow stores plateforme : adaptateurs uniques, dual-write
  auth/assistant, tasks/mails brand-retained ; dry-run migration ;
  `docs/archive/PHASE-D2.md` ; pas de republish.
- **Phase D1** — TempoFlow une stack MCP : exécuteur Hono `/mcp`, façade
  Electron = adaptateur + proxy (`setMcpUpstream`) ; aliases source unique ;
  tools `creezio.*` + `module.dispatch.*` ; `docs/archive/PHASE-D1.md` ; pas de republish.
- **Phase D0** — Alignement docs post-I18 : matrice Natif/Métier/Plugin
  (catalogue/stack/ACL L3 plus 🟡 faux), dry-run I0 H6, backlog D1–D6 +
  vision V1–V3 ; `docs/archive/PHASE-D0.md` ; pas de republish.
- **Phase I8** — Freeze kit H6 : `ARCHITECTURE_VERSION = "H6"`,
  factory scaffold `createNavShellAdapter`, feature-parity demobrand,
  sync expect H6 ; `docs/archive/PHASE-I8.md`, `FEATURE-PARITY-DEMOBRAND-H6.md` ;
  tests `test-phase-i8.mjs`. **Gate ouverture marques (I9+)**.
- **Phase I7** — Shell-UI adapters : `createNavShellAdapter`,
  `NavRenderModel` / `renderNavHtml`, demobrand conso ;
  contrat « registerBrandNav only » ; `docs/archive/PHASE-I7.md` ;
  tests `test-phase-i7.mjs`.
- **Phase I6** — Registre org persisté : `createFileOrgPluginRegistry`,
  console `GET/POST /api/org-plugins` + panel ; `docs/archive/PHASE-I6.md` ;
  tests `test-phase-i6.mjs`.
- **Phase I5** — Admin Plugins L3 : `upsertPluginAclAdmin` / preview,
  demobrand mount `admin-plugins` + UI HTML, deny cross-org E2E ;
  `docs/archive/PHASE-I5.md` ; tests `test-phase-i5.mjs`.
- **Phase I4** — Control-plane unifié : `createPluginControlPlaneAclFromStore`,
  `buildPluginAclActorHeaders`, demobrand `controlPlaneAcl()`,
  doc `CONTROL-PLANE-BRAND-MIGRATION.md` ; tests `test-phase-i4.mjs`.
- **Phase I3** — Tasks/mails sqlite core : `createSqliteTasksStore`,
  `createSqliteMailsStore`, provider `file-sink` non-stub,
  demobrand mounts + migrations ; vendor sync élargi
  (assistant/tasks/mails) ; `docs/archive/PHASE-I3.md` ; tests `test-phase-i3.mjs`.
- **Phase I2** — Assistant sqlite core : `createSqliteAssistantStore` +
  `ASSISTANT_CORE_SQL` (cible core.db ; `assistant_chats.db` legacy),
  demobrand migration `i2_001_assistant` ; `docs/archive/PHASE-I2.md` ;
  tests `test-phase-i2.mjs`.
- **Phase I1** — Auth sqlite core : `createSqliteAuthStore` + driver
  injecté, demobrand sandbox branché, session persistée après restart ;
  `docs/archive/PHASE-I1.md` ; tests `test-phase-i1.mjs`.
- **Phase I0** — Gouvernance post-H5 : `scripts/sync-creezio-vendor.sh`
  (assert `ARCHITECTURE_VERSION`, CJS, `SYNC.json`), wrappers sync
  TempoFlow / Certivan / Fidu, console + `GET /api/kit-versions`
  exposent `architectureVersion`, docs `PHASE-I0`, `REPUBLISH-POLICY`,
  `gates/POST-H5`, matrice/PROPAGATION H3–H5 ; tests `test-phase-i0.mjs`.
  Pas de republish exe ; `ARCHITECTURE_VERSION` reste `H5`.
- **Phase H5** — Harden plugins / ACL (`@creezio/product-hub`) :
  `decidePluginAccess` (see/install/execute), deny cross-org,
  `plugin_org_binding` + `plugin_acl_capability`, control-plane `acl`,
  api-kernel `authorizePluginAccess`, mcp
  `createDenyUnauthorizedPluginToolPolicy` + JWT `orgId`,
  `closePlugin` / `uninstallPlugin`, demobrand E2E ;
  `docs/archive/BACKLOG-H5.md`, `docs/archive/PHASE-H5.md` ; tests
  `scripts/test-phase-h5.mjs`.
- **Phase H4** — MCP proxy unifié durci (`@creezio/mcp-facade`) :
  namespaces, aliases legacy → canonique, `publicSurface: legacy-preferred`,
  `denyCrossLayerToolCall`, registry `registerTool`/`registerAlias`,
  tool admin `creezio.admin.list_aliases` ; `docs/archive/BACKLOG-H4.md`,
  `docs/archive/PHASE-H4.md` ; tests `scripts/test-phase-h4.mjs`.
  Consommation TF : aliases brand-runtime + catalogue Hono
  `list_tools_by_space` (pas de double exposition panier).
- **Phase H3** — modules métier TempoFlow dans le brand repo :
  contrats d’accueil consommés par tempoflow2 (`registerModuleApi`,
  MCP `space: module`, `registerBrandNav`) ; shell-ui accepte
  `brand.*` + href produit (`/panier`) ; `docs/archive/BACKLOG-H3.md`,
  `docs/archive/PHASE-H3.md` ; tests `scripts/test-phase-h3.mjs`.
  Implémentation marque : `/opt/docker/tempoflow2` (`electron/modules/`,
  `brand-runtime.ts`) — **aucun** code panier/dispatch dans `@creezio/*`.
- **Phase H2** — isolation DB/API runtime :
  `createSqliteRuntime` + `ensureMigrations` / `composeMigrations` ;
  `ScopedDbAccess` api-kernel (deny brand/plugin → core) ;
  MCP `listToolsBySpace` / `discoverToolsBySpace` ;
  demobrand `sandbox-runtime` preuve E2E ;
  `docs/archive/BACKLOG-H2.md`, `docs/archive/PHASE-H2.md` ; tests `scripts/test-phase-h2.mjs`.
- **Phase H1** — packages cœur CMS :
  `@creezio/api-kernel`, `@creezio/mcp-facade`, `@creezio/auth`,
  `@creezio/shell-ui`, `@creezio/assistant`, `@creezio/tasks`, `@creezio/mails` ;
  sqlite multi-fichiers (`resolveCoreDbPath` / `resolveBrandDbPath` /
  `resolvePluginDbPath` / `ensurePluginDb`) ; Product Hub
  `createSqliteProductHubStore` ; demobrand + factory branchés ;
  `docs/archive/PHASE-H1.md` ; tests `scripts/test-phase-h1.mjs`.
- **Phase H0** — cadre architecture verrouillé :
  `docs/ARCHITECTURE-INTENTION.md`, `docs/MATRICE-NATIVE-METIER-PLUGIN.md`,
  `docs/archive/BACKLOG-H1-PACKAGES.md`, `docs/archive/PHASE-H0.md` ; liens README.

### Changed
- `@creezio/platform-core` : `ARCHITECTURE_VERSION = "H5"` (était `"H4"`).
- `@creezio/mcp-facade` : proxy H4 + policy plugin ACL H5.
- `@creezio/api-kernel` : garde `authorizePluginAccess` (H5).
- `@creezio/product-hub` : ACL L3 durcie + SQL H5.
- `@creezio/shell-ui` : guard nav — ids `brand.*` peuvent cibler les routes
  produit métier ; ids nus (`panier`) toujours refusés.
- Inventaire propagation : 15 packages `@creezio/*` (était 8).

### Fixed
- `publish-desktop.sh` : si le DL local est absent, publie via SSH sur
  `remoteBuildHost` (cas TempoFlow : feed sur hôte `crm.tempoflow.fr`).
- `buildElectronBuilderConfig` : ré-inclut les packages runtime `@creezio/*`
  (`brand-config`, `platform-core`, `product-hub`, `shell`, `electron-shell`)
  dans l'asar depuis `vendor/creezio/` quand `files` exclut `node_modules/**`.
  Corrige le crash packaged `Cannot find module '@creezio/brand-config'`
  (TempoFlow Server 0.10.27 / même trou latent Certivan & Fidu).

### Changed
- Phase G3 TempoFlow : `tempoflowManifest.defaultAppRoot` → `/opt/docker/tempoflow2/crm` ; gate G3 sign-off (TF 0.10.27).
- DoD A→G documenté (`docs/archive/DOD-PHASE-A-G.md`).

Toutes les versions notables des packages `@creezio/*` sont documentées ici.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/) ;
bumps via Conventional Commits (`npm run kit:version`).

## Kit — Phase G2 prep (2026-07-29)

### Changed

- `fiduManifest` : `buildServerArtifact: true`, `userDataSegment` client = `Fidu`
  (continuité `%APPDATA%/Fidu`)
- `buildElectronBuilderConfig` : option `clientSlim` (défaut `true`) +
  `nsisInclude: false` pour apps sans include NSIS custom

### Added

- Gate **G2 Fidu** sign-off : app 0.1.52 consomme `@creezio/*` via vendor ;
  feeds Client + Serveur publiés (voir `docs/archive/gates/G2-FIDU.md`)

## Kit — Phase G1 prep (2026-07-29)

### Added

- Dual build **CJS** (`dist-cjs/` + `exports.require`) pour consommation depuis
  Electron CommonJS (Certivan / Fidu / TempoFlow) — `npm run build:cjs`
- Gate **G1 Certivan** exécutée : app consomme `@creezio/*` via `file:` (voir
  `docs/archive/gates/G1-CERTIVAN.md`)

## @creezio/propagation@0.1.0 (2026-07-29) — minor

### Added

- **propagation**: Phase F — semver policy, impacts, canaux PR, registre plugins org L3, extension points descente/remontée
- **console**: panel versions kit + liens gates G1/G2/G3 + API `/api/kit-versions`
- **docs**: PROPAGATION.md, PHASE-F.md, checklists gates (non exécutées)

## Kit 0.1.0 — Phases A–E

### Added

- Packages brand-config, shell, platform-core, product-hub, electron-shell, desktop-tooling, factory
- Console ops parc desktop (Phase C)
- Factory new-app + demobrand (Phase D)
- Product Hub brand-agnostic (Phase E)
