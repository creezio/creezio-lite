# Phase B — Runtime Electron plateforme (livré)

## Objectif

Porter le **runtime Electron générique** depuis TempoFlow2 **v0.10.26** vers le monorepo kit `@creezio/*`, sans brancher les apps marques (Phase G) et sans toucher Fidu / Certivan / tempoflow2.

## Chemin repo

| Item | Valeur |
|------|--------|
| Repo local | `/opt/docker/creezio` |
| Source lecture seule | `/opt/docker/creezio-kit-src` @ `v0.10.26` |
| Remote | https://github.com/creezio/creezio |

## Packages

| Package | Rôle Phase B |
|---------|----------------|
| `@creezio/brand-config` | Manifests enrichis + **`buildElectronBuilderConfig`** (Client+Serveur) |
| `@creezio/shell` | IPC + **`createDesktopApi` / `exposeDesktopApi`** (preload factory) |
| `@creezio/platform-core` | app-kind, connection-profile, profile-launch, tunnel-urls, ports, updater-state, factory-reset targets, env-brand |
| `@creezio/electron-shell` | **Nouveau** — logger, splash, updater, tray, admin-window, boot façade, meili launcher, server-env core, wipe factory-reset |

## Porté (buildable)

- **app-kind** : `resolveAppKind`, `bootBehaviorFor`, `isAllowedServerCockpitPath`, userData / AppUserModelId depuis manifest
- **build-builder-config** : générateur JSON electron-builder paramétré (slim client, GUID/feeds/exe)
- **preload** : fabrique `DesktopBridge` + expose `window[bridgeName]`
- **updater** : `reduceUpdateEvent` (pur) + `setupAutoUpdater({ feedUrl })` (runtime)
- **splash / tray / admin-window** : génériques (`productName`, `bridgeName`, partition)
- **boot façade** : `prepareDesktopBoot(manifest)` avant single-instance lock
- **paths / factory-reset targets / local-config schema** : déjà A, enrichis B
- **meili launcher** + **startNextServerCore** (spawn injecté)
- **tunnel URL helpers** paramétrés par `tunnelRootDomain`
- **contrats** Hermes / n8n / tunnel (`buildEmbedHostEnv`) — implémentations complètes = **B.2 livré** (voir [PHASE-B2.md](./PHASE-B2.md))

## Hors scope / reste vertical

- Monolithe `main.ts` (onglets fournisseurs, catalogue-sync, AI workspace, fleet…)
- Seeds / skills / routes Next métier + product-hub HTTP (voir inventaire vertical B.2)
- Brancher Certivan / Fidu / TF2 sur le kit — **Phase G**

## Comment une marque consommera (Phase G)

```ts
import { certivanManifest } from "@creezio/brand-config";
import { createDesktopApi, exposeDesktopApi } from "@creezio/shell";
import {
  prepareDesktopBoot,
  setupAutoUpdater,
  TrayController,
  startMeili,
} from "@creezio/electron-shell";
import { feedUrlForKind } from "@creezio/platform-core";

// main.ts (extrait)
const boot = await prepareDesktopBoot(certivanManifest);
await setupAutoUpdater({
  feedUrl: feedUrlForKind(certivanManifest, boot.appKind === "server" ? "server" : "client"),
});

// preload-app.ts
import { contextBridge, ipcRenderer } from "electron";
exposeDesktopApi(
  contextBridge,
  certivanManifest.bridgeName,
  createDesktopApi(ipcRenderer),
);
```

Build electron-builder :

```ts
import { buildElectronBuilderConfig, fiduManifest } from "@creezio/brand-config";
const cfg = buildElectronBuilderConfig(fiduManifest, "client", baseYamlObject);
```

Les apps restent sous `/opt/docker/{fidu,certivan-app}` et `creezio/tempoflow2` ; elles ajouteront une dépendance workspace/npm vers ce repo en Phase G.

## Vérification

```bash
cd /opt/docker/creezio
npm install
npm run build
npm test
```

## Suite

| Phase | Contenu |
|-------|---------|
| **B.2** | ✅ Livré — voir [PHASE-B2.md](./PHASE-B2.md) |
| **C** | Tooling publish / after-pack / remote-build génériques |
| **E** | Embeds UI (sandbox, status IPC) unifiés |
| **G** | Branchement apps sur le kit (sans republier tant que non demandé) |

## Contraintes respectées

1. Aucune modification de `/opt/docker/fidu`, `/opt/docker/certivan-app`, ni push `creezio/tempoflow2`
2. Client+Serveur = modèle standard (pas optionnel)
3. Apps marques ne consomment pas encore le kit
4. Zéro impact sur les 3 apps publishées
