# AGENTS — @creezio/shell

## Mission du package

`@creezio/shell` est le contrat preload/IPC partagé des desktops Creezio. Sa mission est de stabiliser la surface `window.*Desktop` entre les marques et de fournir des factories testables pour construire cette surface depuis un `ipcRenderer` compatible.

Le package doit rester un package de contrats et de wiring preload :

- nommer les canaux IPC communs dans `IpcChannels` ;
- typer le bridge renderer via `DesktopBridge` et types associés ;
- exposer `createDesktopApi`, `exposeDesktopApi`, `getDesktopBridge` ;
- exposer les extensions CRM hôte et la télémétrie preload ;
- conserver les alias historiques nécessaires aux apps en migration.

## Ne pas faire / frontières

- Ne pas ajouter de handlers `ipcMain` ici. Les handlers appartiennent au main Electron de marque ou à `@creezio/electron-shell`.
- Ne pas importer Electron directement dans les types/factories. Le package travaille avec `IpcRendererLike` et `ContextBridgeLike`.
- Ne pas hardcoder `tempoflowDesktop`, `certivanDesktop` ou `fiduDesktop` dans les factories. Le `bridgeName` vient du manifest.
- Ne pas supprimer les alias historiques sans vérifier les mains existants :
  - `tabs:supplier-opened` ;
  - `update:get-status` ;
  - canaux littéraux `oauth:*`, `config:*`, `hermes:*`, `n8n:*`, `plugins:*` des extensions hôte.
- Ne pas supposer que le preload packagé peut résoudre `@creezio/shell` depuis `resources/electron/`. Si l'app utilise `extraResources`, elle doit bundler/inliner.
- Ne pas rendre obligatoires les méthodes marquées optionnelles dans `DesktopBridge`.
- Ne pas activer implicitement plugins/fleet pour Fidu.

## Points d'entrée

- `src/index.ts`
  - export public du package.
- `src/ipc-channels.ts`
  - `IpcChannels`, `IpcChannelGroup`.
- `src/types.ts`
  - `DesktopBridge`, `DesktopInfo`, `DesktopConnectionProfile`, `DesktopUpdateStatus`, types tabs et helper `getDesktopBridge`.
- `src/create-desktop-api.ts`
  - `IpcRendererLike`, `ContextBridgeLike`, `createDesktopApi`, `exposeDesktopApi`.
- `src/create-crm-host-preload.ts`
  - `createCrmHostPreloadExtensions`, `buildCrmHostDesktopApi`, `installPreloadTelemetry`, `wireCrmHostPreload`.

## Comment modifier sans casser les marques

1. Vérifier d'abord si le changement est un ajout, un renommage ou une suppression de canal.
   - Ajout : généralement sûr si optionnel.
   - Renommage/suppression : risqué, car les handlers main peuvent encore utiliser les anciens littéraux.
2. Pour une nouvelle méthode bridge :
   - ajouter le type dans `DesktopBridge` ;
   - ajouter le canal dans `IpcChannels` si c'est un canal commun ;
   - ajouter le mapping dans `createDesktopApi` si la méthode appartient au noyau commun ;
   - garder la méthode optionnelle si toutes les marques ne l'ont pas.
3. Pour une extension hôte :
   - ajouter dans `createCrmHostPreloadExtensions` seulement si le canal est bien hôte CRM ;
   - ne pas déplacer des extensions verticales tant que les handlers ne sont pas présents dans les marques concernées.
4. Pour un événement :
   - retourner une fonction `off()` qui appelle `removeListener` ;
   - si un alias historique existe, écouter les deux canaux comme `onExternalTabOpened`.
5. Pour la télémétrie :
   - rester best-effort ;
   - ne jamais throw depuis les listeners `window` / `document` ;
   - respecter `titlebarNoDragClass`.
6. `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs shell` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.

## Config attendue côté brand

Une marque doit fournir :

- `bridgeName` depuis `@creezio/brand-config` (`manifest.bridgeName`) ;
- un preload qui appelle `createDesktopApi`, `buildCrmHostDesktopApi` ou `wireCrmHostPreload` ;
- des handlers main compatibles avec les canaux utilisés ;
- une classe CSS titlebar à ignorer pour la télémétrie fleet si `installPreloadTelemetry` est activé ;
- un traitement feature-off pour les capacités absentes.

Exemple minimal :

```ts
import { contextBridge, ipcRenderer } from "electron";
import { createDesktopApi, exposeDesktopApi } from "@creezio/shell";

const api = createDesktopApi(ipcRenderer);
exposeDesktopApi(contextBridge, "demobrandDesktop", api);
```

Exemple CRM hôte :

```ts
import { contextBridge, ipcRenderer } from "electron";
import { wireCrmHostPreload } from "@creezio/shell";

wireCrmHostPreload({
  ipc: ipcRenderer,
  contextBridge,
  bridgeName: "tempoflowDesktop",
  titlebarNoDragClass: ".creezio-titlebar-no-drag",
});
```

## Tests / gates liés

Commandes directes :

```bash
npm run typecheck -w @creezio/shell
npm run build -w @creezio/shell
```

Gates monorepo utiles :

- `npm run build:packages` pour vérifier les consommateurs TypeScript ;
- `npm test`, notamment les phases liées au shell desktop, aux bridges, à l'open external tab et à la télémétrie preload.

À vérifier manuellement après changement :

- les noms de canaux restent identiques pour les handlers existants ;
- les callbacks d'événements retournent bien une désinscription ;
- `getDesktopBridge` reste sûr côté renderer/test sans Electron ;
- les méthodes optionnelles restent optionnelles dans les types.

## Fichiers sensibles

- `src/ipc-channels.ts` : tout renommage de chaîne IPC peut casser le main Electron.
- `src/types.ts` : contrat public `DesktopBridge` consommé côté renderer.
- `src/create-desktop-api.ts` : mapping méthode bridge → canal IPC ; contient la contrainte preload hors asar.
- `src/create-crm-host-preload.ts` : nombreux canaux historiques littéraux et side effects télémétrie.
- `src/index.ts` : surface publique ; ne pas oublier d'exporter les nouveaux types/helpers.

## Liens

- [README.md](./README.md)
- [docs/FILES.md](./docs/FILES.md)
