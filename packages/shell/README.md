# @creezio/shell

## Rôle

`@creezio/shell` définit les contrats partagés entre le main Electron, le preload et le renderer des apps desktop Creezio. Il fournit :

- les noms de canaux IPC communs (`IpcChannels`) ;
- les types du bridge exposé dans le renderer (`DesktopBridge`, `DesktopInfo`, `DesktopConnectionProfile`, etc.) ;
- une factory de bridge générique (`createDesktopApi`, `exposeDesktopApi`) ;
- une factory de bridge CRM hôte avec extensions verticales (`buildCrmHostDesktopApi`, `createCrmHostPreloadExtensions`, `wireCrmHostPreload`) ;
- l'installation de télémétrie preload renderer (`installPreloadTelemetry`).

Le package ne contient pas les handlers Electron main. Il décrit la surface preload/renderer et délègue les actions à `ipcRenderer.invoke` / `ipcRenderer.send`.

## Périmètre (kit vs marque)

### Ce qui appartient au kit

- Les canaux IPC partagés :
  - desktop, connection, profiles, window, tabs, setup, auth, update, admin, splash, assistant, llm, factory, search, background, aiWorkspace, renderer.
- Le contrat `DesktopBridge` commun aux marques TempoFlow, Certivan et Fidu.
- Les types de données renderer/preload :
  - `DesktopTabInfo`, `DesktopContentRect`, `DesktopExternalTabOpened`, `DesktopSupplierTabOpened`, `DesktopTabLoadState` ;
  - `DesktopAppKind`, `DesktopInfo`, `DesktopConnectionProfile` ;
  - `DesktopUpdateState`, `DesktopUpdateStatus`.
- Les helpers de bridge :
  - `getDesktopBridge` côté renderer/tests ;
  - `createDesktopApi` et `exposeDesktopApi` côté preload ;
  - `buildCrmHostDesktopApi`, `wireCrmHostPreload` pour le CRM hôte.
- Les extensions preload hôte pour Hermes, n8n, plugins, fleet, setup, auth locale, tunnel et compte.

### Ce qui reste côté marque

- Le choix du nom de bridge (`manifest.bridgeName`) fourni par `@creezio/brand-config`.
- Les handlers `ipcMain.handle` / `ipcMain.on` dans le runtime Electron de marque ou `@creezio/electron-shell`.
- Les extensions verticales non encore factorisées dans le kit.
- Les labels UI, composants renderer et routes métier.
- Le bundling ou l'inlining du preload si l'app packagée charge le preload depuis `extraResources`.

Point important du code : si un preload est packagé via `extraResources` hors asar, il ne faut pas supposer que `require("@creezio/shell")` ou `require("@creezio/brand-config")` fonctionne depuis `resources/electron/`. Dans ce cas, bundler le preload ou exposer un littéral `contextBridge.exposeInMainWorld("...Desktop", api)` dans le preload de l'app.

## Installation / build

Dans le monorepo :

```bash
npm run build -w @creezio/shell
npm run typecheck -w @creezio/shell
```

Manifest package :

- `main`: `./dist-cjs/index.js`
- `module`: `./dist/index.js`
- `types`: `./dist/index.d.ts`
- export public unique : `@creezio/shell`

Dépendances :

- dev : `typescript`, `@types/node`
- peer : `@creezio/brand-config` `0.1.0`

Le peer `brand-config` sert à aligner les apps sur les noms de bridge et manifests, mais `@creezio/shell` expose principalement des contrats runtime indépendants.

## Configuration (env, configure*, bindings)

`@creezio/shell` ne lit pas d'env directement et n'a pas de fonction `configure*`. La configuration se fait par injection :

- `bridgeName` vient du manifest de marque (`tempoflowDesktop`, `certivanDesktop`, `fiduDesktop`, etc.) ;
- `ipc` est un objet compatible `IpcRendererLike` ;
- `contextBridge` est un objet compatible `ContextBridgeLike` ;
- `customWindowChrome`, `titlebarNoDragClass` et `aidAttr` sont passés au wiring preload.

Exemple de wiring preload :

```ts
import { contextBridge, ipcRenderer } from "electron";
import { wireCrmHostPreload } from "@creezio/shell";

wireCrmHostPreload({
  ipc: ipcRenderer,
  contextBridge,
  bridgeName: "tempoflowDesktop",
  titlebarNoDragClass: ".creezio-titlebar-no-drag",
  aidAttr: "data-creezio-aid",
});
```

Dans une app qui ne veut exposer que le noyau commun :

```ts
import { contextBridge, ipcRenderer } from "electron";
import { createDesktopApi, exposeDesktopApi } from "@creezio/shell";

const api = createDesktopApi(ipcRenderer, { customWindowChrome: true });
exposeDesktopApi(contextBridge, "certivanDesktop", api);
```

Côté renderer :

```ts
import { getDesktopBridge } from "@creezio/shell";

const desktop = getDesktopBridge("fiduDesktop");
if (desktop) {
  const info = await desktop.getInfo();
  console.log(info.appKind, info.version);
}
```

## API publique (exports principaux avec exemples TS)

### `IpcChannels`

`IpcChannels` est l'objet de référence pour les noms de canaux :

```ts
import { IpcChannels } from "@creezio/shell";

IpcChannels.desktop.info;      // "desktop:info"
IpcChannels.connection.apply;  // "connection:apply"
IpcChannels.tabs.externalOpened; // "tabs:external-opened"
IpcChannels.update.getStatus;  // "update:get-status" (compat historique)
IpcChannels.aiWorkspace.ensure; // "ai-workspace:ensure"
```

Les alias historiques sont conservés quand les apps les émettent encore :

- `tabs.supplierOpened` est déprécié au profit de `tabs.externalOpened` ;
- `update.getStatus` est l'alias historique de `update:status` côté handlers TF2.

### Types desktop

```ts
import type {
  DesktopBridge,
  DesktopConnectionProfile,
  DesktopInfo,
  DesktopTabInfo,
  DesktopUpdateStatus,
} from "@creezio/shell";

async function renderStatus(desktop: DesktopBridge): Promise<void> {
  const info: DesktopInfo = await desktop.getInfo();
  const profile: DesktopConnectionProfile | undefined =
    await desktop.getConnectionProfile?.();
  const tabs: DesktopTabInfo[] = await desktop.listTabs();
  const update: DesktopUpdateStatus | undefined =
    await desktop.getUpdateStatus?.();

  console.log(info.version, profile?.mode, tabs.length, update?.state);
}
```

`DesktopBridge` contient des méthodes obligatoires du noyau (`getInfo`, `openTab`, `closeTab`, `activateTab`, `setContentRect`, `showCrm`, `listTabs`, `onTabsChanged`, `onExternalTabOpened`, `googleLogin`, `retrySetup`, `setAssistantChrome`, `onAssistantOpenRequest`) et des méthodes optionnelles selon maturité de marque (`getConnectionProfile`, `testConnection`, `logout`, update, espaces IA, etc.).

### `createDesktopApi`

```ts
import { createDesktopApi, type IpcRendererLike } from "@creezio/shell";

const api = createDesktopApi(ipc as IpcRendererLike, {
  customWindowChrome: true,
});

await api.openTab(42, "https://example.test");
const off = api.onExternalTabOpened((tab) => {
  console.log(tab.siteId, tab.url);
});
off();
```

`createDesktopApi` mappe les méthodes bridge vers les canaux `IpcChannels`. Les callbacks retournent une fonction `off()` qui retire le listener IPC.

### `exposeDesktopApi`

```ts
import { exposeDesktopApi } from "@creezio/shell";

exposeDesktopApi(contextBridge, "tempoflowDesktop", api);
```

Le nom du bridge doit venir du manifest de marque.

### `getDesktopBridge`

```ts
import { getDesktopBridge } from "@creezio/shell";

const desktop = getDesktopBridge("certivanDesktop", window);
if (desktop?.isDesktop) {
  await desktop.showCrm();
}
```

Le helper vérifie que `window[bridgeName]` est un objet avec `isDesktop: true`.

### Extensions CRM hôte

```ts
import {
  buildCrmHostDesktopApi,
  createCrmHostPreloadExtensions,
  installPreloadTelemetry,
  wireCrmHostPreload,
} from "@creezio/shell";

const extensions = createCrmHostPreloadExtensions(ipc);
await extensions.getN8nStatus();
await extensions.setPluginEnabled("meteo", true);

const fullApi = buildCrmHostDesktopApi(ipc);
await fullApi.getHermesStatus();

installPreloadTelemetry(ipc, {
  titlebarNoDragClass: ".certivan-titlebar-no-drag",
});

wireCrmHostPreload({
  ipc,
  contextBridge,
  bridgeName: "certivanDesktop",
  titlebarNoDragClass: ".certivan-titlebar-no-drag",
});
```

Extensions exposées par `createCrmHostPreloadExtensions` :

- auth/compte : `googleLogin`, `getAccount`, `changePassword`, `recoverPassword`, `setStayLoggedIn` ;
- admin/setup : `openAdminWindow`, `getSetupStatus`, `generateRecoveryKey`, `completeSetup`, `factoryReset`, `reindexSearch` ;
- IA : `onAiWorkspaceNavigate`, `onAiWorkspaceUiAction`, LLM key status/set/status changed ;
- tunnel : `getTunnelStatus`, `checkTunnelSlug`, `reserveTunnel`, `startTunnel`, `stopTunnel` ;
- background : `getBackgroundSettings`, `setBackgroundSettings` ;
- Hermes : status, logs, retry, config, ensure runtime ;
- n8n : status, logs, config, ensure runtime, prepare session ;
- env embeds : `getEmbedEnv`, `setEmbedEnv` ;
- plugins : status, enable, scaffold, execution grant, tests, migration, restart, archive, delete, versions, restore, resolve panel, accept check ;
- fleet/ops : telemetry get/set, action report, `opsTrack`.

### Télémétrie preload

`installPreloadTelemetry` installe des listeners `window` / `document` :

- forward des erreurs renderer sur `renderer-error` ;
- forward des `unhandledrejection` ;
- capture best-effort de clics UI vers `fleet:action`, hors zone `titlebarNoDragClass`.

```ts
installPreloadTelemetry(ipc, {
  titlebarNoDragClass: ".fidu-titlebar-no-drag",
  aidAttr: "data-tf2-aid",
});
```

`aidAttr` vaut `data-tf2-aid` par défaut pour compatibilité historique.

## Flux / fonctionnement

1. Le main Electron de marque enregistre les handlers IPC correspondant aux canaux attendus.
2. Le preload crée un objet `DesktopBridge` avec `createDesktopApi` ou `buildCrmHostDesktopApi`.
3. Le preload expose cet objet via `contextBridge.exposeInMainWorld(bridgeName, api)`.
4. Le renderer récupère l'objet via `window[bridgeName]` ou `getDesktopBridge(bridgeName)`.
5. Chaque méthode bridge appelle `ipc.invoke` ou `ipc.send`.
6. Les événements main vers renderer (`tabs:changed`, `tabs:external-opened`, `update:changed`, etc.) sont écoutés via `ipc.on` et nettoyés via la fonction de désinscription retournée.

La compatibilité est volontaire :

- `onExternalTabOpened` écoute à la fois `tabs:external-opened` et `tabs:supplier-opened` ;
- `onSupplierTabOpened` reste disponible mais déprécié ;
- `getUpdateStatus` utilise `update:get-status` pour les handlers historiques.

## Intégration marques (TempoFlow, Certivan, Fidu, DemoBrand)

### TempoFlow

- Bridge attendu : `tempoflowDesktop`.
- `customWindowChrome` généralement activé sous Windows.
- `titlebarNoDragClass` typique : `.creezio-titlebar-no-drag` (H13).
- Les extensions hôte Hermes, n8n, plugins et fleet sont pertinentes car `tempoflowManifest.features` active `plugins` et `fleet`.
- Les canaux historiques TF2 (`oauth:google-login`, `config:*`, `update:get-status`, `tabs:supplier-opened`) restent pris en compte.

### Certivan

- Bridge attendu : `certivanDesktop`.
- Même noyau IPC que TempoFlow.
- Les extensions hôte sont pertinentes : plugins et fleet sont activés dans le manifest.
- Les handlers main doivent exposer les mêmes canaux si le preload générique est utilisé.

### Fidu

- Bridge attendu : `fiduDesktop`.
- Fidu a `features.plugins: false` et `features.fleet: false` dans `brand-config`.
- Le renderer doit traiter les méthodes plugins/fleet comme indisponibles ou feature-off côté hôte. Ne pas ajouter d'hypothèse selon laquelle les handlers plugins existent.
- Le noyau desktop (`getInfo`, tabs, window, update éventuel, connection éventuel) reste partagé.

### DemoBrand

- Bridge généré par `createAppManifest`: `demobrandDesktop`.
- Marque sandbox factory : utile pour tester le wiring générique sans secrets production.
- Les handlers disponibles dépendent du runtime DemoBrand ; ne pas documenter d'obligation métier au-delà du noyau.

## Dépendances @creezio/*

- `@creezio/brand-config` est déclaré en `peerDependencies`. Le package `shell` doit rester aligné avec `manifest.bridgeName`, mais n'importe pas directement les manifests dans les fichiers lus ici.
- Les handlers IPC concrets vivent hors de ce package, typiquement dans `@creezio/electron-shell` ou dans les apps de marque.
- `@creezio/platform-core` fournit les types et helpers côté runtime, mais n'est pas une dépendance directe de `@creezio/shell`.

## Voir aussi

- [AGENTS.md](./AGENTS.md)
- [docs/FILES.md](./docs/FILES.md)
