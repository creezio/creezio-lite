# @creezio/electron-shell

## Rôle

`@creezio/electron-shell` est le **desktop Electron** plateforme Creezio : boot desktop, fenêtres, tray, updater, splash, bridge, admin-window, overlays et browser-tabs.

> **P1.b (0.11.x)** : le host Node pur a été extrait vers
> [`@creezio/host-runtime`](../host-runtime/README.md) (hermes, n8n, tunnel,
> plugins, sandbox, ai-workspace, server-launcher, crash reporter…) et
> [`@creezio/search`](../search/README.md) (sous-domaine Meili).
> **H12 (0.24.0)** : les ré-exports de compat `@deprecated` du barrel et le
> shim subpath `./meili` ont été **supprimés** — tout symbole host s'importe
> depuis son package SoT. Migration marques : codemod `scripts/codemods/H12/`
> (appliqué par `creezio upgrade`). `resources/{vendor,scripts,bin}`
> vivent dans `@creezio/host-runtime` (P1.c).

Ce package est volontairement brand-agnostic : les marques fournissent leur `AppManifest`, leurs chemins, leurs stores locaux, leurs prefixes d'env et leurs hooks verticaux.

## Périmètre

Inclus :

- runtime desktop complet via `installBrandDesktopRuntime` ;
- boot desktop (`prepareDesktopBoot`), sessions desktop, splash, tray, updater, admin-window ;
- browser-tabs exporte separement via `@creezio/electron-shell/browser-tabs` ;
- overlays desktop : assistant chrome, profile picker, error page, OAuth loopback ;
- telemetrie WebContents (`instrumentWebContents`).

Depuis H12, tout le host Node pur (host stack, launchers Hermes/n8n/tunnel,
runtime plugins, bridge client, crash reporter, safe storage, local config,
node/npm runtime, sandbox OS, ai-workspace) s'importe depuis
`@creezio/host-runtime`, le sous-domaine Meili depuis `@creezio/search` —
les exemples ci-dessous montrent le wiring complet.

Hors perimetre :

- logique metier verticale ;
- UI admin metier ;
- secrets hardcodes ;
- choix d'auth, d'ACL et de provisioning propres a une marque.

## Installation/build

```bash
npm install
npm run build -w @creezio/electron-shell
npm run typecheck -w @creezio/electron-shell
```

Le package publie :

- `@creezio/electron-shell` : barrel desktop natif (plus aucun ré-export host depuis H12) ;
- `@creezio/electron-shell/browser-tabs` : sous-export a privilegier pour les tests Node et les imports qui ne doivent pas tirer tout le barrel principal.

`electron` et `electron-updater` sont des peer dependencies optionnelles, chargees seulement par les chemins host/runtime concernes.

## Configuration

### HostRuntimeContext

Le contexte host est le noyau commun des launchers :

```ts
import { createBrandHostRuntime } from "@creezio/host-runtime";

const hostRuntime = createBrandHostRuntime({
  manifest,
  store: () => localConfigStore,
  paths,
  hermesCrm,
  n8nApiKey,
  n8nAgent,
  // Tunnel Cloudflare : auto-provisioning via l'API CF (0.10.0) — plus
  // AUCUNE config tunnel côté runtime. Le contrat est lu depuis l'env :
  //   MYBRAND_CF_API_TOKEN / _CF_ACCOUNT_ID / _CF_ZONE_ID (variante marque)
  //   puis CREEZIO_CF_* (générique kit). Voir platform-core tunnel-cf-client.
  npmUserDataSegment: "mybrand-npm",
  secretFilePrefix: "mybrand",
  hermesBridge: "full",
  nodeEnsure: "desktop",
  ensureDbScriptPath: () => brandEnsureCrmKeyDbScript(__dirname),
  log: (scope, line) => log(scope, line),
});
```

`createBrandHostRuntime` fournit des singletons Hermes, n8n, tunnel, fleet et ensure Node. `createBrandHostRuntimeContext` reste disponible si une marque veut composer elle-meme.

### Host stack

`createHostStack({ ctx, store })` construit directement :

- `hermes`
- `n8n`
- `tunnel`
- `plugins`
- `startMeili`
- `startNextServerCore`

`createBrandHostStack(cfg)` ajoute une couche de wiring marque : ports, paths, env, sandbox, feature-off, catalogue, fleet, factory reset et getters lazy compatibles avec `installBrandDesktopRuntime`.

### Bindings plugins marque

Le runtime riche des plugins exige `configurePluginHost(bindings)` avant usage :

```ts
import {
  configurePluginHost,
  buildPluginControlPlaneAdapters,
} from "@creezio/host-runtime";

configurePluginHost({
  envPrefix: "MYBRAND",
  productName: "MyBrand",
  brandId: "mybrand",
  userDataDir: paths.userDataDir,
  isPackaged: paths.isPackaged,
  nodeBinary: paths.nodeBinary,
  nodeScript: paths.nodeScript,
  gitBinary: paths.gitBinary,
  n8nHomeDir: paths.n8nHomeDir,
  dbPath: paths.dbPath,
  ensureDesktopNode: hostRuntime.ensureNode,
  nodeMinForEmbeds: "22.15.0",
  getN8nBridgeEnv,
  n8nDesktopPort: 5678,
  getLlmKeys: () => store.getLlmKeys(),
  hostRuntimeContext: () => hostRuntime.hostRuntimeContext(),
  manifest,
  buildControlPlaneAdapters: () => buildPluginControlPlaneAdapters(),
  createControlPlaneAcl: () => acl,
  ensureProductHubStore: () => productHubStore,
  closeProductHubStore: () => productHubStore.close(),
  apiKeyPrefix: "mybrand_live_",
});
```

Les variables plugins sont posees sur `${envPrefix}_*` uniquement (H11 : plus d'aliases historiques). Les permissions du manifest plugin pilotent l'injection CRM, n8n et LLM.

### Bindings ai-workspace

```ts
import { configureAiWorkspaceHost } from "@creezio/host-runtime";

configureAiWorkspaceHost({
  productName: "MyBrand",
  sessionCookieName: "mybrand_session",
  aiPartitionSlug: "mybrand-ai",
  shareWebSessionsEnvKey: "MYBRAND_AI_SHARE_WEB_SESSIONS",
  sessionStoragePrefix: "mybrand-ai-workspace",
  preloadPath: paths.preloadPath,
  createSupplierTabs,
  reportCrash,
  instrumentWebContents,
});
```

Chaque IA obtient une partition `persist:{aiPartitionSlug}-{userId}`, une vue CRM et son manager d'onglets isole.

## API publique + exemples

### Runtime desktop

```ts
import { installBrandDesktopRuntime } from "@creezio/electron-shell";

installBrandDesktopRuntime({
  manifest,
  bridgeName: manifest.bridgeName,
  accentColor: "#1967d2",
  cssPrefix: "mybrand",
  envPrefix: manifest.envPrefix,
  sessionCookieName: "mybrand_session",
  profileArgPrefix: "--mybrand-profile=",
  defaultDesktopPort: 18790,
  appKind: "client",
  bootBehavior,
  bootProfileLaunch,
  sessionPartition: "persist:mybrand",
  deepLinkProtocol: manifest.deepLinkProtocol,
  store: () => localConfigStore,
  hosts,
  paths,
  vertical,
  createLocalSplashSteps,
  electron,
});
```

Le runtime installe les handlers Electron, gere le boot local/remote, lance les sidecars, maintient le bridge, recharge Next lors des changements BYOK et garde le tray/updater coherent.

### Server launcher

```ts
import { startBrandNextServer } from "@creezio/host-runtime";

const server = await startBrandNextServer(deps, {
  meiliHost: meili?.host,
  meiliMasterKey: meili?.masterKey,
  bindHost: "127.0.0.1",
  extraEnv: {
    APP_PUBLIC_URL: tunnel.publicUrlForServer() ?? "",
  },
  onLog: (line) => log("next", line),
});
```

### Hermes / n8n / Meili / tunnel

```ts
const hermes = await hosts.hermes().startHermes({
  connectionMode: "local",
  crmPort: server.port,
  autoBootstrap: true,
});

const n8n = await hosts.n8n().startN8n({
  connectionMode: "local",
  publicBaseUrl: hosts.tunnel().publicUrlForEmbedService("n8n"),
});

const meili = await hosts.meili().startMeili((line) => log("meili", line));

await hosts.tunnel().configureTunnelIngress({
  crmPort: server.port,
  n8nPort: 5678,
  hermesPort: 7860,
});
```

### Plugins launcher/restart

```ts
import {
  startEnabledPlugins,
  restartPlugin,
  pluginsStatusPayloadWithGit,
} from "@creezio/host-runtime";

setPluginsCrmPort(server.port);
await startEnabledPlugins({ onLog: (line) => log("plugins", line) });
await restartPlugin("my-plugin");
const status = await pluginsStatusPayloadWithGit();
```

`restartPlugin` tue l'ancien child, attend la sortie, relance les plugins actives et attend un port si le plugin expose un panel.

### Control plane plugins

```ts
import { startHostPluginControlPlane } from "@creezio/host-runtime";

const state = await startHostPluginControlPlane({
  ctx: hostRuntime.hostRuntimeContext(),
  productHubStore,
  acl,
  preHandle: handleBrandExtras,
});
```

Le control plane loopback expose status, creation, ecriture de fichiers, enable/restart/delete et fetch Product Hub. Le token vient de `ensurePluginControlToken`.

### Browser tabs

Importer depuis le sous-export :

```ts
import {
  BrowserTabManager,
  configureBrowserTabs,
  executeSupplierAction,
} from "@creezio/electron-shell/browser-tabs";

configureBrowserTabs({
  resolvePreloadPath: () => paths.preloadPath("browser-tab-preload.js"),
});
```

Les onglets externes utilisent des `WebContentsView`, des partitions persistantes par site et des actions CDP trusted (`external_*`, alias legacy `supplier_*`).

### AI workspace

```ts
import { AiWorkspaceManager } from "@creezio/host-runtime";

const manager = new AiWorkspaceManager(mainWindow, ownerView, ownerTabs, {
  defaultPresentation: () => "window",
});

await manager.ensure({
  userId: "ai_1",
  token: sessionJwt,
  baseUrl: server.baseUrl,
  label: "Assistant IA",
});
manager.show("ai_1");
```

## Flux

### Boot local

1. La marque prepare `AppManifest`, chemins, store local et host runtime.
2. `installBrandDesktopRuntime` installe les handlers Electron apres le single instance lock.
3. La splash suit Node, catalogue, Meili, Hermes, n8n, tunnel et serveur Next.
4. `startBrandNextServer` spawn Next avec auth, secrets MCP, BYOK, Meili, embeds et env plugins.
5. Le bridge client se connecte au CRM local.
6. Le tunnel synchronise les ports CRM/n8n/Hermes si configure.
7. Les plugins actives sont demarrees et leur runtime state est ecrit.

### Mode remote

En mode remote, les modules host-only lourds ne sont pas lances. Les payloads de statut Hermes/n8n sont derives de l'origine distante pour garder les formes UI compatibles.

### Plugins

1. `configurePluginHost` injecte les chemins, env et adapters.
2. `discoverPlugins` lit les manifests.
3. `startEnabledPlugins` assure Node, cree les cles CRM plugin si permission, injecte n8n/LLM selon permissions et spawn le main plugin.
4. Les logs et ports detectes alimentent le runtime state.
5. Le control plane autorise scaffold, write files, enable, restart, delete, git versions et grants.

### Browser-tabs / AI workspace

Les browser-tabs servent a afficher et piloter des sites externes dans des `WebContentsView` isolees. L'AI workspace cree une vue CRM par persona IA et son propre manager d'onglets ; le mode `window` ouvre une fenetre parallele, le mode `embedded` remplace temporairement la vue owner.

## Intégration marques

La marque doit fournir :

- `AppManifest` et `envPrefix` ;
- chemins absolus : userData, resources, DB, Next standalone, Node, Meili, preloads ;
- store local : auth, LLM keys, tunnel config, embed configs, setup state ;
- hooks verticals : Product Hub store, ACL, extras control plane, catalogue, fleet si actif ;
- `configurePluginHost` avant tout usage du runtime plugins riche ;
- `configureAiWorkspaceHost` avant creation de workspaces IA ;
- `configureBrowserTabs` si le preload par defaut ne suffit pas.

Pour une marque sans plugins/flotte, utiliser `pluginsFeatureOff` / `createFeatureOffHost` afin de conserver les contrats UI sans lancer de sidecars.

## Dépendances

- `@creezio/brand-config` : `AppManifest`, host-only modules, env keys ;
- `@creezio/platform-core` : paths, plugins purs, embeds status, tunnel URLs, runtime helpers ;
- `@creezio/product-hub` : control plane plugins et tokens ;
- `@creezio/observability` : crash/fleet/ops journal ;
- `@creezio/shell` : contrats bridge ;
- peer deps `electron` et `electron-updater`.

## Voir aussi

- `AGENTS.md`
- `docs/FILES.md`
- sous-export `@creezio/electron-shell/browser-tabs`
- `packages/desktop-tooling/README.md` pour publish/remote-build
