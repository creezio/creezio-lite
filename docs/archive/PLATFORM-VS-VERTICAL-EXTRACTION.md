# Plateforme vs vertical — matrice de portage

Source d'extraction : `creezio/tempoflow2` @ **v0.10.26** (`/opt/docker/creezio-kit-src`), lecture seule Certivan / Fidu.

Légende :

- **Kit** = `@creezio/*`
- **Vertical** = reste dans l'app marque
- **A** = contrats Phase A
- **B** = runtime porté Phase B
- **B.2** = suite runtime (launchers lourds)
- **E** = Product Hub / plugins généralisés

## Matrice TF2 → package cible

| Fichier source TF2 (crm/) | Cible kit | Phase | Notes |
|---------------------------|-----------|-------|-------|
| `scripts/electron/build-builder-config.mjs` | `@creezio/brand-config` (`buildElectronBuilderConfig`) | **B** | Client+Serveur obligatoire |
| `electron/app-kind.ts` | `@creezio/platform-core` | **B** | Paramétré par manifest |
| `electron/paths.ts` | `@creezio/platform-core` | A / **B** | + meili candidates, logs, preload |
| `electron/local-config.ts` | schema A + `createLocalConfigStore` + safeStorage | A / **B.2** | Factory brand-agnostic |
| `electron/preload-app.ts` | `@creezio/shell` (`createDesktopApi`) | **B** | Extensions verticales restent en app |
| `src/types/desktop.d.ts` | `@creezio/shell` | A | `DesktopBridge` générique |
| `electron/preload-supplier.ts` | vertical / stub | B | Minimal — inchangé côté app |
| `electron/connection-profile.ts` | `@creezio/platform-core` | **B** | |
| `electron/profile.ts` | `@creezio/platform-core` | **B** | Argv / deep-link paramétrés |
| `electron/updater.ts` | platform-core (state) + `@creezio/electron-shell` | **B** / **R3** | TF stub → kit + feed/onTrack |
| `electron/splash-ui.ts` | `@creezio/electron-shell` | **B** / **R3** | TF stub labels + `cssPrefix: tf` |
| `electron/window-chrome-html.ts` | `@creezio/electron-shell` | **B** / **R3** | TF stub prefix `tf` |
| `electron/tray.ts` | `@creezio/electron-shell` | **B** / **R3** | TF stub productName |
| `electron/admin-window.ts` | `@creezio/electron-shell` | **B** | TF fork léger (destroy) |
| `electron/logger.ts` | `@creezio/electron-shell` | **B** / **R3** | TF stub `logBasename` |
| `electron/meili-launcher.ts` | `@creezio/electron-shell` | **B** / **R3** | TF stub paths/sandbox |
| `electron/factory-reset.ts` | platform-core (targets) + electron-shell (wipe) | **B** | |
| `electron/tunnel-service-urls.ts` | `@creezio/platform-core` | **B** | `tunnelRootDomain` |
| `electron/meili-launcher.ts` | `@creezio/electron-shell` | **B** | Chemins injectés |
| `electron/server-launcher.ts` | ports + `startNextServerCore` | **B** | Spawn injecté ; secrets app |
| `electron/host-stack.ts` | pattern doc / contrats | **B** | Lazy host — apps gardent le graphe |
| `electron/hermes-*` / `n8n-*` / `tunnel.ts` | electron-shell host/* | **B.2** | Factories + hooks verticaux |
| `electron/plugin-events/manifest/grants/token/host` | platform-core + electron-shell | **B.2** | spawn + token |
| `electron/plugin-control-api.ts` | `@creezio/product-hub` + `startHostPluginControlPlane` | **E** | headers/tags/service brandés |
| `electron/plugin-execution-grant.ts` | platform-core + product-hub grants-flow | B.2 / **E** | prefix via tokens |
| `src/lib/plugin-product-hub.ts` | `@creezio/product-hub` + core.db | **R2** | façade ; plus de brand.db |
| `src/lib/n8n-plugin-provisioning.ts` (tags) | `@creezio/product-hub` `pluginN8nTag` | **E** | préfixe `{brandId}-plugin:` ; registry → core |
| `src/lib/plugin-acl.ts` | `@creezio/product-hub` acl L3/L4 | **R2** | persistance store kit core.db |
| migrations 028/030/032 (+ acl org) | `schema-sql.ts` (DDL contrat) | **R2** | 028 brand = legacy ; core via store |
| `electron/node-runtime` / `npm-cli` / sandbox | electron-shell | **B.2** | |
| `electron/main.ts` | façade `prepareDesktopBoot` + vertical | **B** / vertical | Découpe progressive |
| `scripts/electron/after-pack.cjs` | `@creezio/desktop-tooling` | **C** | hook générique |
| `scripts/electron/publish-desktop.sh` | `@creezio/desktop-tooling` | **C** | paramétré AppManifest.publish |
| `scripts/electron/remote-build-win.sh` | `@creezio/desktop-tooling` | **C** | idem |
| `scripts/electron/desktop-build-status.mjs` | `@creezio/desktop-tooling` | **C** | + console ops |
| factory `new-app` | `@creezio/factory` + demobrand | **D** | + stub Product Hub **E** |
| `electron-builder.yml` | généré depuis manifest | **B** | via buildElectronBuilderConfig |
| `plugin-git` / `plugin-data` / accept / test-runner | **vertical** | — | Phase G adapters |
| Seeds / templates métier | **vertical** | — | Certivan VASP, Fidu seeds… |
| Routes Next CRM / UI Admin Plugins | **vertical** | — | |
| `vendor/hermes-skills` marque | **vertical** | — | |
| Paperclip | **retiré** | — | Plus dans aucune marque (TF / Certivan / Fidu) |
| Catalogue-sync / supplier-tabs | **vertical** | — | Métier TempoFlow |

## Identités (Phase A/B)

| Marque | bridgeName | envPrefix | deepLink | sessionPartition | tunnelRootDomain |
|--------|------------|-----------|----------|------------------|------------------|
| TempoFlow | `tempoflowDesktop` | `TF2` | `tempoflow` | `tempoflow-app` | `tempoflow.fr` |
| Certivan | `certivanDesktop` | `CERTIVAN` | `certivan` | `certivan-app` | `certivan.creez.io` |
| Fidu | `fiduDesktop` | `FIDU` | `fidu` | `fidu-app` | `fidu.creez.io` |

## Ce qui reste vertical (ne jamais monter dans le kit)

- Domaine métier (GED Fidu, RTI Certivan, catalogue TempoFlow…)
- Seeds / templates / skills Hermes spécifiques
- Pages Next, API métier, migrations SQL produit (exécution DDL Product Hub incluse)
- Credentials / tokens de feed (seuls les **URLs** publiques sont dans brand-config)
- Orchestration complète du boot `main.ts` (jusqu'à découpe progressive Phase G)
- `plugin-git`, `plugin-data`, accept-check, test-runner, UI Admin Plugins

## Product Hub (Phase E) — consommation

```ts
import { certivanManifest } from "@creezio/brand-config";
import {
  productHubTokensFromManifest,
  pluginN8nTag,
  createMemoryProductHubStore,
} from "@creezio/product-hub";
import { startHostPluginControlPlane, createPluginsHost } from "@creezio/electron-shell";

const tokens = productHubTokensFromManifest(certivanManifest);
const tag = pluginN8nTag(productId, tokens); // certivan-plugin:…
```

## Propagation (Phase F) — contrat, pas bascule

Le package `@creezio/propagation` expose :

- policy semver + `kit:version` / `kit:impact`
- mapping packages → surfaces apps + canaux PR marques
- registre plugins org L3 (mémoire) + extension points descente/remontée
- inventaire versions pour la console

Les checklists de bascule sont dans `docs/archive/gates/G1-CERTIVAN.md`,
`G2-FIDU.md`, `G3-TEMPOFLOW.md` — **exécutées en Phase G uniquement**.

Voir [PROPAGATION.md](PROPAGATION.md) et [PHASE-F.md](PHASE-F.md).

## Consommation future (Phase G)

```ts
import { fiduManifest } from "@creezio/brand-config";
import { getDesktopBridge, createDesktopApi } from "@creezio/shell";
import { resolveDbPath, feedUrlForKind } from "@creezio/platform-core";
import { prepareDesktopBoot, setupAutoUpdater } from "@creezio/electron-shell";
import { impactForPackageBump } from "@creezio/propagation";

const boot = await prepareDesktopBoot(fiduManifest);
const bridge = getDesktopBridge(fiduManifest.bridgeName);
const impact = impactForPackageBump({
  packageName: "@creezio/platform-core",
  bumpKind: "minor",
});
```

Les apps continueront de vivre sous `/opt/docker/{fidu,certivan-app}` et `creezio/tempoflow2` ; elles ajouteront une dépendance workspace/npm vers ce repo **en Phase G**.
