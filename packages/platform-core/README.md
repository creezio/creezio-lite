# @creezio/platform-core

## Rôle

`@creezio/platform-core` regroupe les primitives pures de plateforme Creezio : chemins `userData`, schéma `local-config`, split Client/Serveur, profils de connexion, layout SQLite multi-fichiers, runtime SQLite, migrations, embeds Hermes/n8n, plugins, télémétrie flotte, factory-reset, ports, licensing, préférences installeur et helpers d'env marque.

Le package est volontairement brand-agnostic. Il reçoit un `AppManifest` depuis `@creezio/brand-config` et ne doit pas connaître directement TempoFlow, Certivan ou Fidu. La majorité des modules sont testables depuis Node et ne doivent pas importer Electron.

Architecture SQLite portée par ce package :

- `core.db` sous `{userData}/sqlite/core.db` pour les domaines plateforme ;
- `brand.db` métier sous `{userData}/{manifest.dbFileName}` via `resolveBrandDbPath` ;
- DB plugin à l'installation sous `{userData}/sqlite/plugin/<id>.db` ;
- table `_creezio_schema_migrations` propre à chaque fichier DB.

## Périmètre (kit vs marque)

### Ce qui appartient au kit

- Résolution de chemins à partir de `PathsContext` :
  - `resolveUserDataDir`, `resolveDbPath`, `resolveBrandDbPath`, `resolveCoreDbPath`, `resolvePluginDbPath`, etc.
- Split desktop Client/Serveur :
  - `parseAppKind`, `resolveAppKind`, `readAppKindFile`, `userDataDirForAppKind`, `bootBehaviorFor`, `isAllowedServerCockpitPath`.
- Config locale commune :
  - `LOCAL_CONFIG_VERSION`, `LocalConfigFileV1`, `emptyLocalConfig`, `isLocalConfigV1`.
- Runtime SQLite :
  - `createSqliteRuntime`, `ensureDay0SqliteLayout`, `ensurePluginDb`, `ensureMigrations`, `composeMigrations`.
- Contrats stores plateforme :
  - `PLATFORM_STORES_CONTRACT`, `DEPRECATED_SHADOW_ONLY`.
- Migrations plateforme :
  - `platformCoreMigrations`, `PLATFORM_CORE_MIGRATION_IDS` ;
  - `platformHistoricalMigrations`, `runHistoricalMigrations`, `PLATFORM_HISTORICAL_STEP_VERSIONS`.
- Embeds purs :
  - Hermes : ports, env, résolution binaire, sanitize config, statut public ;
  - n8n : ports, audit, résolution entry, env spawn/Next, statut public ;
  - catalogue env embeds.
- Plugins purs :
  - manifest, découverte, permissions, events, execution grants, site ids.
- Helpers transverses :
  - ports/health, tunnel URLs, recovery key, licensing, installer prefs, disk-space, updater state, fleet telemetry, factory-reset.

### Ce qui reste côté marque

- Les migrations métier brand.
- Les routes métier, repositories, services applicatifs et UI.
- Le choix du manifest et des chemins réels Electron (`app.getPath("userData")`, `process.resourcesPath`).
- Le chiffrement `safeStorage` des `StoredValue` dans le main Electron.
- Le spawn concret des services (Next, Meili, Hermes, n8n, plugins), qui vit côté Electron/runtime.
- Les labels UI, libellés support et politiques produit propres à une marque.

## Installation / build

Dans le monorepo :

```bash
npm run build -w @creezio/platform-core
npm run typecheck -w @creezio/platform-core
```

Manifest package :

- `main`: `./dist-cjs/index.js`
- `module`: `./dist/index.js`
- `types`: `./dist/index.d.ts`
- export public unique : `@creezio/platform-core`

Dépendances :

- runtime : `@creezio/brand-config`
- peers optionnels :
  - `@creezio/auth`
  - `@creezio/database`
  - `@creezio/product-hub`
  - `better-sqlite3 >=9`
- dev : `typescript`, `@types/node`, `@types/better-sqlite3`

`platformCoreMigrations()` charge des SQL venant de peers optionnels au runtime. Ne pas transformer ces peers en imports statiques si cela crée des dépendances circulaires ou force des packages non présents.

## Configuration (env, configure*, bindings)

### `PathsContext`

La plupart des helpers de chemins reçoivent un `PathsContext` :

```ts
import { demobrandManifest } from "@creezio/brand-config";
import type { PathsContext } from "@creezio/platform-core";

const ctx: PathsContext = {
  manifest: demobrandManifest,
  userDataRoot: "/home/me/.config/demobrand",
  isPackaged: false,
  env: process.env,
  resourcesRoot: process.cwd(),
};
```

Champs :

- `manifest` : `AppManifest` de la marque.
- `userDataRoot` : racine déjà résolue par Electron ou par un test.
- `isPackaged` : si `true`, les overrides d'env de chemins sont ignorés.
- `env` : injecté pour les tests ; défaut `process.env`.
- `resourcesRoot` : racine des ressources packagées ou du repo en dev.

### Overrides env

Les noms d'env sont dérivés via `envKey(manifest, suffix)` dans `@creezio/brand-config`.

Exemples pour TempoFlow :

- `TF2_USER_DATA_OVERRIDE`
- `TF2_DB_PATH_OVERRIDE`
- `TF2_BRAND_DB_PATH_OVERRIDE`
- `TF2_SQLITE_ROOT_OVERRIDE`
- `TF2_CORE_DB_PATH_OVERRIDE`
- `TF2_PLUGIN_DB_DIR_OVERRIDE`
- `TF2_NODE_BINARY`
- `TF2_N8N_BIN`
- `TF2_HERMES_BIN`

Les overrides de chemins sont lus uniquement hors packagé (`isPackaged: false`).

### Env process Next / CRM

`buildNextHostEnv` construit l'env commun du process Next standalone :

```ts
import { buildNextHostEnv } from "@creezio/platform-core";

const env = buildNextHostEnv({
  manifest,
  port: 3000,
  hostname: "127.0.0.1",
  dbPath,
  assistantDbPath,
  uploadsDir,
  meiliHost: "http://127.0.0.1:7700",
  meiliMasterKey: "dev-key",
  authSecret: "secret",
  mcpJwtSecret: "jwt-secret",
  extra: { CREEZIO_CORE_DB_PATH: coreDbPath },
});
```

`resolveCoreDbPathFromEnv()` permet au process Next/CRM de retrouver `core.db` sans `PathsContext` :

1. `CREEZIO_CORE_DB_PATH` ;
2. voisin de `DB_PATH` (`{userData}/sqlite/core.db`) ;
3. `/data/sqlite/core.db` si `/data` existe ;
4. `null`.

## API publique (exports principaux avec exemples TS)

### Version d'architecture

```ts
import { ARCHITECTURE_VERSION } from "@creezio/platform-core";

console.log(ARCHITECTURE_VERSION);
```

`ARCHITECTURE_VERSION` décrit la phase d'architecture du kit et ne doit être bumpée qu'au sign-off de phase.

### Chemins et ressources

```ts
import {
  feedUrlForKind,
  resolveAssistantDbPath,
  resolveBrandDbPath,
  resolveCoreDbPath,
  resolveLocalConfigPath,
  resolveLogsDir,
  resolveMainLogPath,
  resolveMeiliDataDir,
  resolveN8nHomeDir,
  resolveNodeRuntimeDir,
  resolvePreloadPath,
  resolveResourcesRoot,
  resolveUploadsDir,
  resolveUserDataDir,
  userDataDirForKind,
} from "@creezio/platform-core";

const userData = resolveUserDataDir(ctx);
const brandDb = resolveBrandDbPath(ctx);
const coreDb = resolveCoreDbPath(ctx);
const config = resolveLocalConfigPath(ctx);
const log = resolveMainLogPath(ctx);
const preload = resolvePreloadPath(ctx, "preload.js");

const serverUserData = userDataDirForKind(manifest, "server", userData);
const feed = feedUrlForKind(manifest, "client");
```

`resolveDbPath(ctx)` existe encore mais est déprécié : préférer `resolveBrandDbPath(ctx)`.

### Split Client/Serveur

```ts
import {
  appKindEnvValue,
  appKindFilePayload,
  appUserModelIdFor,
  bootBehaviorFor,
  displayNameFor,
  parseAppKind,
  resolveAppKind,
  userDataDirForAppKind,
} from "@creezio/platform-core";

parseAppKind("SERVER"); // "server"

const kind = resolveAppKind({
  env: appKindEnvValue(manifest),
  fileKind: "client",
});

const behavior = bootBehaviorFor(kind, {
  mode: "server",
});

const targetUserData = userDataDirForAppKind(manifest, kind, currentUserData);
const appUserModelId = appUserModelIdFor(manifest, "server");
const displayName = displayNameFor(manifest, "client");
const payload = appKindFilePayload("client");
```

`bootBehaviorFor` porte les règles :

- `server` : stack locale autorisée, profil local forcé, cockpit `/server-cockpit`, pas de deep-link ;
- `client` : stack locale interdite, profil distant requis, picker `join-only` sauf join direct ;
- `legacy` : comportement tout-en-un compatible.

### Config locale et profils de connexion

```ts
import {
  assertProfileReady,
  defaultLocalProfile,
  emptyLocalConfig,
  isLocalConfigV1,
  normalizeRemoteUrl,
  resolveBootProfile,
  sanitizeConnectionProfile,
  testRemoteHealth,
} from "@creezio/platform-core";

const cfg = emptyLocalConfig();
if (isLocalConfigV1(cfg)) {
  cfg.connectionProfile = defaultLocalProfile();
}

const profile = sanitizeConnectionProfile({
  mode: "remote",
  remoteUrl: "crm.example.test",
  chosen: true,
});

assertProfileReady(profile);
normalizeRemoteUrl("crm.example.test"); // "http://crm.example.test"

const boot = resolveBootProfile(profile);
const health = await testRemoteHealth(profile.remoteUrl!, 8000);
```

Types notables :

- `LocalConfigFileV1`
- `StoredValue`
- `TunnelMetaStored`, `TunnelConfigPublic`
- `HermesEmbedConfig`, `N8nEmbedConfig`
- `BackgroundSettings`
- `AiWorkspacePresentationSetting`

### Layout SQLite jour 0

```ts
import {
  CORE_DB_FILENAME,
  PLUGIN_DB_SUBDIR,
  SQLITE_LAYOUT_DIR,
  ensureDay0SqliteLayout,
  ensurePluginDb,
  pluginDbExists,
  removePluginDb,
  resolveDay0SqlitePaths,
  resolvePluginDbPath,
  resolveSqliteRoot,
} from "@creezio/platform-core";

const paths = resolveDay0SqlitePaths(ctx);
// { core: ".../sqlite/core.db", brand: ".../<manifest.dbFileName>" }

ensureDay0SqliteLayout(ctx, { touchBrand: true });

const plugin = ensurePluginDb(ctx, "meteo");
const exists = pluginDbExists(ctx, "meteo");
const pluginPath = resolvePluginDbPath(ctx, "meteo");
const removed = removePluginDb(ctx, "meteo");
```

Un plugin DB est créé à l'installation, pas au boot jour 0.

### Runtime SQLite et migrations

```ts
import {
  composeMigrations,
  createSqliteRuntime,
  platformCoreMigrations,
  type SqliteMigration,
} from "@creezio/platform-core";

const brandMigrations: SqliteMigration[] = [
  {
    id: "brand_001_catalog",
    sql: "CREATE TABLE IF NOT EXISTS catalog_items (id TEXT PRIMARY KEY);",
  },
];

const runtime = createSqliteRuntime({
  ctx,
  coreMigrations: platformCoreMigrations(),
  brandMigrations: composeMigrations(brandMigrations),
});

runtime.getCore().exec("PRAGMA user_version;");
runtime.getBrand().prepare("SELECT 1").get();

const plugin = runtime.openPlugin("meteo", [
  { id: "meteo_001", sql: "CREATE TABLE IF NOT EXISTS events (id TEXT);" },
]);

console.log(plugin.created, runtime.status().openPlugins);
runtime.closePlugin("meteo");
runtime.close();
```

Exports associés :

- `SqliteRuntime`, `SqliteHandle`, `SqliteLayerRef`, `SqliteLayerKind`;
- `ensureMigrations`, `listAppliedMigrations`, `SQLITE_MIGRATIONS_TABLE`, `SQLITE_META_MIGRATION`;
- `openNodeSqliteDatabase` pour `node:sqlite`/driver compatible ;
- `platformHistoricalMigrations`, `runHistoricalMigrations` pour les anciennes migrations `brand.db` à `schema_version`.

Important : le runner historique `runHistoricalMigrations` est prévu pour un process Node vanilla, pas pour le main Electron chargé avec un ABI différent de `better-sqlite3`.

### Stores plateforme

```ts
import {
  DEPRECATED_SHADOW_ONLY,
  PLATFORM_STORES_CONTRACT,
} from "@creezio/platform-core";

console.log(PLATFORM_STORES_CONTRACT);
console.log(DEPRECATED_SHADOW_ONLY);
```

Ce contrat fige le store SoT de chaque domaine plateforme dans `core.db` et interdit tout dual-write runtime.

### Embeds Hermes et n8n

```ts
import {
  HERMES_DESKTOP_API_PORT,
  HERMES_DESKTOP_WEBUI_PORT,
  N8N_DESKTOP_PORT,
  buildNextHermesEnv,
  buildN8nSpawnEnv,
  hermesBinEnvKey,
  n8nBinEnvKey,
  resolveHermesBinary,
  resolveN8nEntry,
  sanitizeHermesEmbedConfig,
  sanitizeN8nEmbedConfig,
  shouldSpawnEmbeddedHermes,
  shouldSpawnEmbeddedN8n,
} from "@creezio/platform-core";

const hermes = sanitizeHermesEmbedConfig(null);
const n8n = sanitizeN8nEmbedConfig(null);

shouldSpawnEmbeddedHermes({ connectionMode: "local", hermes });
shouldSpawnEmbeddedN8n({ connectionMode: "local", n8n });

const hermesKey = hermesBinEnvKey(manifest);
const n8nKey = n8nBinEnvKey(manifest);

const hermesEnv = buildNextHermesEnv({
  apiUrl: `http://127.0.0.1:${HERMES_DESKTOP_API_PORT}`,
  apiKey: "local-key",
  webuiUrl: `http://127.0.0.1:${HERMES_DESKTOP_WEBUI_PORT}`,
});
```

Le catalogue d'env embeds expose :

- `N8N_ENV_CATALOG`, `HERMES_ENV_CATALOG`;
- `N8N_LOCKED_KEYS`, `HERMES_LOCKED_KEYS`, `OS_SANDBOX_LOCKED_KEYS`;
- `catalogFor`, `lockedKeySet`, `sanitizeUserEnvOverlay`, `mergeEmbedUserEnv`, `buildEmbedEnvPanel`.

### Plugins purs

```ts
import {
  discoverPlugins,
  hasPluginPermission,
  isValidPluginId,
  parsePluginManifest,
  pluginEnabledFlagPath,
  pluginHookUrl,
  pluginRuntimePath,
  pluginsRootDir,
  setPluginEnabled,
} from "@creezio/platform-core";

const root = pluginsRootDir(resolveUserDataDir(ctx));
const plugins = discoverPlugins(root);
const manifest = parsePluginManifest({
  id: "meteo",
  name: "Meteo",
  version: "1.0.0",
  main: "index.js",
  permissions: ["crm:read", "ui:panel"],
});

if (hasPluginPermission(manifest, "ui:panel")) {
  setPluginEnabled(root, "meteo", true);
}
```

Autres exports plugins :

- events : `PLUGIN_RUNTIME_FILE`, `pluginAcceptsHook`, `pluginN8nWebhookUrl`, `pluginSiteId`, `readPluginRuntimeState`, `writePluginRuntimeState`;
- grants : `issuePluginExecutionGrant`, `verifyPluginExecutionGrant`;
- manifest : `PLUGIN_MANIFEST_FILE`, `PluginPermission`, `PluginManifest`, `DiscoveredPlugin`.

### Recovery key, licensing, installer prefs, fleet, ports

```ts
import {
  applyFleetTelemetryPatch,
  checkLicense,
  consumeInstallerPrefsFile,
  defaultFleetTelemetry,
  findFreePort,
  generateRecoveryKey,
  initialUpdateStatus,
  installerPrefsPath,
  reduceUpdateEvent,
  storeLicenseKey,
  waitForHealth,
} from "@creezio/platform-core";

const key = generateRecoveryKey();
const telemetry = applyFleetTelemetryPatch(defaultFleetTelemetry(), {
  preset: "basic",
});

const port = await findFreePort("127.0.0.1", 3000);
const status = reduceUpdateEvent(initialUpdateStatus("0.1.0"), {
  type: "checking",
});
```

Ces helpers restent purs ou Node-only, et ne doivent pas dépendre d'Electron.

## Flux / fonctionnement

### Boot desktop packagé

1. Le main Electron choisit le manifest (`@creezio/brand-config`).
2. Il résout le kind avec `resolveAppKind` à partir de l'env et/ou `app-kind.json`.
3. Il calcule le `userData` cible via `userDataDirForAppKind` et configure Electron.
4. Il construit un `PathsContext`.
5. Il résout chemins, config locale, logs, DBs et ressources via les helpers.
6. Le serveur local ou client distant applique `bootBehaviorFor`.

### Boot serveur / SQLite

1. `ensureDay0SqliteLayout(ctx, { touchBrand: true })` garantit `core.db` et `brand.db`.
2. `createSqliteRuntime` ouvre `core` + `brand`.
3. Les migrations core plateforme viennent de `platformCoreMigrations()`.
4. Les migrations métier sont injectées via `brandMigrations`.
5. Les plugins ne sont ouverts qu'à l'installation avec `openPlugin(pluginId, migrations)`.

### Process Next / CRM

1. Le launcher injecte `DB_PATH`, `ASSISTANT_DB_PATH`, `UPLOADS_DIR`, `CREEZIO_CORE_DB_PATH`, etc.
2. Côté Next, `resolveCoreDbPathFromEnv` permet de retrouver `core.db`.
3. Les routes plateforme consomment `core.db` ; le métier marque vit dans `brand.db`.

## Intégration marques (H11)

Le kit ne publie plus les manifests prod. Une marque fournit son
`AppManifest` (JSON local / `resolveManifest`). `brandEnv` /
`buildNextHostEnv` n'injectent que `${envPrefix}_*`. Feature-off
(`plugins` / `fleet` = `false`) se déclare sur le manifest, pas via un
export kit.

### DemoBrand

- Manifest sandbox généré par `createAppManifest`.
- Préfixe env : `DEMOBRAND`.
- DB brand : `demobrand.db`.
- Config : `demobrand-config.json`.
- Utilisé par factory et tests sans secrets production.
- Sert à vérifier que les helpers sont réellement brand-agnostic.

## Dépendances @creezio/*

- Dépendance runtime :
  - `@creezio/brand-config` pour `AppManifest`, `envKey`, feeds et identités.
- Peers optionnels :
  - `@creezio/auth` pour les migrations core auth ;
  - `@creezio/product-hub` pour les migrations Product Hub ;
  - `@creezio/database` selon les intégrations ;
  - `better-sqlite3` pour certains runners historiques ou injections driver.
- Consommateurs fréquents :
  - `@creezio/api-kernel` pour `SqliteRuntime`, scoped DB et `ARCHITECTURE_VERSION` ;
  - `@creezio/electron-shell` pour le main Electron ;
  - `@creezio/shell-ui`, `@creezio/onboarding`, `@creezio/cockpit` pour des contrats UI/config ;
  - packages domaine (`auth`, `tasks`, `mails`, `assistant`, `automations`, `observability`, etc.) pour les chemins et contrats plateforme.

## Voir aussi

- [AGENTS.md](./AGENTS.md)
- [docs/FILES.md](./docs/FILES.md)


## Profil Creezio Lite / Sites

Les types de maps d’environnement des embeds utilisent Record<string,string|undefined> pour éviter l’augmentation globale de ProcessEnv par Next. Aucun comportement Hermes/n8n ne change ; ces services ne sont pas lancés par le profil Sites.
