# DemoBrand (`@creezio/app-demobrand`)

Sandbox desktop Creezio générée par la factory et enrichie pour prouver le kit
sur une marque jetable. DemoBrand embarque un shell Electron Client + Serveur,
un manifest de marque, une navigation `@creezio/shell-ui`, un runtime SQLite
multi-DB, API Kernel, MCP façade, Product Hub ACL, fabrique plugins,
observabilité et automations.

DemoBrand n'est pas une marque production. Ses feeds, GUID et chemins de publish
sont propres à la sandbox et ne doivent jamais être réutilisés pour TempoFlow,
Fidu ou Certivan.

## Rôle

- valider qu'une nouvelle marque peut consommer le kit `@creezio/*` sans code
  métier d'une autre marque ;
- fournir un exemple Client + Serveur compatible electron-builder ;
- démontrer l'isolation H2 : `core.db`, `brand.db` et `plugin/<id>.db` séparés ;
- démontrer H5/I5 : ACL plugins L3 (`see`, `install`, `execute`) et deny
  cross-org ;
- exposer V1/V2/V3 : fabrique conversationnelle de plugins, observabilité
  native et automations data-driven.

## Identité

| Champ | Valeur |
| --- | --- |
| `brandId` | `demobrand` |
| `envPrefix` | `DEMOBRAND` |
| `bridgeName` | `demobrandDesktop` |
| DB marque | `demobrand.db` |
| Config locale | `demobrand-config.json` |
| Deep link | `demobrand://` |
| Partition Electron | `demobrand-app` |
| Domaine | `demobrand.creez.io` |
| Client appId | `io.creezio.demobrand` |
| Server appId | `io.creezio.demobrand.server` |
| Client NSIS GUID | `7673ac29-e40f-5262-b420-5fa6b09cb1bf` |
| Server NSIS GUID | `30fe0aad-125c-5bdb-9a59-61ff33b07cd7` |
| Feed client | `https://demobrand.creez.io/dl-sandboxfac47b3ec4fb510facba4f6f/` |
| Feed serveur | `https://demobrand.creez.io/dl-sandboxfac47b3ec4fb510facba4f6f/server/` |
| Sandbox | `true` |

## Lancer et construire

Depuis la racine du monorepo :

```bash
cd /agent/repos/creezio
npm install
npm run build -w @creezio/app-demobrand
npm run typecheck -w @creezio/app-demobrand
```

Le build TypeScript écrit les fichiers compilés dans `apps/demobrand/build/`.
Ce dossier est généré et n'est pas documenté dans l'inventaire.

Générer les configs electron-builder depuis le manifest :

```bash
cd apps/demobrand
npm run electron:config:client
npm run electron:config:server
```

Publier ou remote-builder doit rester en dry-run pour la sandbox :

```bash
npm run electron:publish:dry
npm run electron:remote-build:dry

# Depuis la racine, inspection config :
npm run desktop:resolve-config -- --brand=demobrand --kind=client --pretty
npm run desktop:publish -- --brand=demobrand --kind=client --dry-run --app-root /agent/repos/creezio/apps/demobrand
```

## Configuration d'environnement

| Variable | Effet |
| --- | --- |
| `CREEZIO_BRAND=demobrand` | Posée par les scripts publish/remote-build pour résoudre le manifest DemoBrand. |
| `CREEZIO_APP_ROOT` | Override générique du tooling desktop ; sinon `manifest.publish.defaultAppRoot`. |
| `DEMOBRAND_PRODUCT_HUB_SQLITE=1` | Force `product-hub-stub.ts` à ouvrir un SQLite temporaire si aucun runtime H2 n'a injecté de store. Par défaut : mémoire hors runtime. |
| `N8N_AUTOMATION_WEBHOOK_URL` | Webhook optionnel utilisé par le moteur d'automations du sandbox runtime. |
| `CREEZIO_PRD_LLM_API_KEY`, `CREEZIO_PRD_LLM_API_URL`, `CREEZIO_PRD_LLM_MODEL` | Optionnel pour la fabrique plugins Product Hub ; sans clé, PRD déterministe. |
| Variables `DEMOBRAND_*` | Préfixe réservé aux extensions marque/plugins, dérivé du manifest. |

## Architecture

```text
apps/demobrand/
  src/electron/app-manifest.ts        # manifest de marque typé
  src/electron/main.ts                # boot Electron mince + sandbox H2
  src/electron/preload.ts             # bridge minimal demobrandDesktop
  src/electron/sandbox-runtime.ts     # coeur API/DB/MCP/ACL/V1/V2/V3
  src/electron/nav-shell.ts           # adapter shell-ui
  src/electron/vertical-slot.ts       # slot métier sandbox
  resources/renderer/*.html,*.js      # renderer statique de démo
  scripts/build-builder-config.mjs    # génération electron-builder
```

### Boot Electron

`main.ts` appelle `prepareDesktopBoot(manifest)`, initialise le logger,
écrit le fichier de kind (`client`/`server`), crée le sandbox runtime, injecte
le store Product Hub dans le stub, prépare le modèle de navigation, puis ouvre
une `BrowserWindow` sur `resources/renderer/index.html`.

Le preload expose seulement `window.demobrandDesktop` avec les IPC génériques
(`desktop:info`, connexion, setup). Il n'importe aucun package `@creezio/*`
pour rester copiable hors asar.

### Runtime sandbox

`createDemobrandSandbox()` ouvre :

- `core.db` : auth, Product Hub, ACL, assistant, tasks, mails, observabilité,
  automations ;
- `demobrand.db` : module brand `demo-notes` ;
- `plugin/<id>.db` : KV par plugin installé.

Il monte les APIs :

- `/api/v1/modules/demo-notes/*`
- `/api/v1/modules/admin-plugins/*`
- `/api/v1/modules/plugin-factory/*`
- `/api/v1/platform/platform-tasks/*`
- `/api/v1/platform/platform-mails/*`
- `/api/v1/platform/observability/*`
- `/api/v1/platform/automations/*`
- `/api/v1/plugins/<pluginId>/kv`

Il expose aussi une façade MCP avec tools module et tools plugin filtrés par
ACL. Les tentatives `attack-core` dans les mounts brand/plugin existent pour
prouver que `ScopedDbAccess` bloque les écritures cross-layer.

### Navigation et renderer

`nav-shell.ts` crée un adapter `@creezio/shell-ui` puis enregistre seulement
une entrée métier sandbox `brand.notes`. `nav-core.ts` ré-exporte la nav coeur.
`vertical-slot.ts` agrège les items, le registry et le Product Hub sandbox.

Le renderer statique affiche la page DemoBrand et une maquette
`admin-plugins.html`. En Electron réel, un bridge admin peut remplacer le
fallback `localStorage` de `admin-plugins.js`.

## Packages `@creezio/*` utilisés

| Package | Usage |
| --- | --- |
| `@creezio/brand-config` | Type `AppManifest`, manifest registry et génération electron-builder. |
| `@creezio/electron-shell` | Boot desktop, logs, fichier app kind et control-plane plugin host. |
| `@creezio/shell-ui` | Navigation coeur + adapter et slots marque. |
| `@creezio/platform-core` | Paths, migrations, `SqliteRuntime`, isolation DB, répertoire plugins. |
| `@creezio/api-kernel` | API Kernel, mounts platform/module/plugin, `ScopedDbAccess`. |
| `@creezio/mcp-facade` | Façade MCP et policy deny pour tools plugins non autorisés. |
| `@creezio/product-hub` | Product Hub SQLite, ACL plugins, fabrique conversationnelle, scaffolds, tokens n8n. |
| `@creezio/auth` | Store session natif dans `core.db`. |
| `@creezio/assistant` | Store assistant dans `core.db`. |
| `@creezio/tasks` | Store tasks + mount API plateforme. |
| `@creezio/mails` | Store mails + provider file sink local. |
| `@creezio/observability` | Store événements, API observabilité, agrégats et événements control-plane. |
| `@creezio/automations` | Persist SQLite, moteur automations, règles DemoBrand par défaut. |
| `@creezio/desktop-tooling` | Scripts de publish et remote-build via `package.json`. |
| `@creezio/shell` | Dépendance déclarée du template ; le preload actuel est un bridge local minimal sans import direct. |

## Flux importants

### Installer un plugin sandbox

1. `pluginFactory.materialize()` ou `sandbox.installPlugin(pluginId)` ouvre
   `plugin/<id>.db` avec migrations KV.
2. L'API plugin `/api/v1/plugins/<id>/kv` est enregistrée.
3. Product Hub reçoit la policy ACL (`ownerOrgId`, orgs autorisées, caps).
4. Observabilité reçoit un événement control-plane `install`.
5. Les automations dispatchent `plugin.installed` et, selon le flux,
   `factory.materialized` / `plugin.released`.

### Accès plugin

Les headers ACL (`x-creezio-org-id`, `x-creezio-user-id`,
`x-creezio-is-owner`) sont construits via `sandbox.actorHeaders()`. Sans header,
le sandbox garde une compatibilité de tests H2 en mode service. Avec headers,
`decidePluginAccess()` autorise `see` pour GET/HEAD et `execute` pour les autres
méthodes.

### Désinstaller

`sandbox.uninstallPlugin(pluginId)` désenregistre l'API plugin, ferme et supprime
la DB plugin via le runtime, efface l'ACL Product Hub, journalise
`uninstall` et dispatch `plugin.uninstalled`.

## Vérifications recommandées

```bash
npm run typecheck -w @creezio/app-demobrand
npm run build -w @creezio/app-demobrand
```

Scripts ciblés selon la zone :

```bash
node --test scripts/test-phase-d.mjs      # factory new-app / manifest
node --test scripts/test-phase-h2.mjs     # isolation multi-DB
node --test scripts/test-phase-h5.mjs     # ACL plugins
node --test scripts/test-phase-i1.mjs scripts/test-phase-i2.mjs scripts/test-phase-i3.mjs
node --test scripts/test-phase-i4.mjs scripts/test-phase-i5.mjs scripts/test-phase-i7.mjs scripts/test-phase-i8.mjs
node --test scripts/test-phase-v1.mjs scripts/test-phase-v2.mjs scripts/test-phase-v3.mjs
node --test scripts/test-phase-c3.mjs scripts/test-phase-c4.mjs scripts/test-phase-c7.mjs
```

Voir aussi : [`docs/FILES.md`](docs/FILES.md) et [`AGENTS.md`](AGENTS.md).
