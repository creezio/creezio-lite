# @creezio/brand-config

## Rôle

`@creezio/brand-config` est la source de vérité des identités de marque desktop Creezio. Le package expose le schéma `AppManifest`, les manifests de production (`TempoFlow`, `Certivan`, `Fidu`), le manifest sandbox `DemoBrand`, ainsi que les helpers qui dérivent les chemins, variables d'environnement, feeds d'auto-update, identifiants Windows et configurations `electron-builder`.

Le modèle standard porté par ce package est toujours un modèle **multi-exe Client + Serveur** :

- un `client` avec son `appId`, son feed, son nom de binaire, son `userDataSegment` et son GUID NSIS ;
- un `server` distinct avec son propre `appId`, feed `.../server/`, binaire, `userDataSegment` et GUID NSIS ;
- un bloc `publish` qui paramètre l'infrastructure de publication Windows et de remote-build.

Le package est utilisé par les runtimes Electron, les scripts desktop, la factory et les packages qui doivent rester brand-agnostic. Il évite de recopier des constantes `TF2_*`, `CERTIVAN_*` ou `FIDU_*` dans le kit.

## Périmètre (kit vs marque)

### Ce qui appartient au kit

- Le type `AppManifest` et ses sous-types (`AppKind`, `ExeIdentity`, `BrandFeatures`, `BrandPublishInfra`).
- Les helpers purs :
  - `exeForKind`, `envKey`, `appSessionPartition`, `profileArgPrefix`, `profileDirArgPrefix` ;
  - `resolveArtifactFileName`, `resolveLatestAlias`, `feedBaseUrl`, `latestYmlUrl` ;
  - `appKindEnvKey`, `serverPlatformEnvKey`, `distDirForKind` ;
  - `isFeatureEnabled`.
- Le registre de manifests connu : `manifests`, `BrandId`, `getManifest`, `listBrandIds`, `listProductionBrandIds`, `isSandboxBrand`.
- Les manifests versionnés pour `tempoflow`, `certivan`, `fidu` et `demobrand`.
- La génération factory sandbox via `createAppManifest`, `defaultFeedToken`, `validateAppManifest`.
- Les helpers desktop-build :
  - `buildElectronBuilderConfig` ;
  - `CREEZIO_ASAR_RUNTIME_PACKAGES` ;
  - `DEFAULT_HOST_ONLY_ELECTRON_MODULES`.
- Les GUID NSIS déterministes via `uuidV5`, `nsisGuidFromAppId`, `ELECTRON_BUILDER_NS_OID`.

### Ce qui reste côté marque

- Les secrets de publication, tokens CI/CD, clés SSH et credentials de remote-build.
- Les fichiers `electron-builder.yml` de base, icônes, scripts d'app et overrides opérationnels propres à une marque.
- Les migrations métier, routes métier, wording UI et fonctionnalités verticales.
- La décision de consommer un manifest de production déjà présent ou un manifest sandbox généré par la factory.

Ne pas modifier les manifests de production pour adapter un cas local : utiliser les overrides d'environnement côté app ou une marque sandbox. Les GUID, `appId`, feeds et segments `userData` sont des contrats d'upgrade.

## Installation / build

Dans le monorepo Creezio :

```bash
npm run build -w @creezio/brand-config
npm run typecheck -w @creezio/brand-config
```

Le package est un module TypeScript ESM avec sortie `dist/` et entrée CJS déclarée en `dist-cjs/` :

- `main`: `./dist-cjs/index.js`
- `module`: `./dist/index.js`
- `types`: `./dist/index.d.ts`
- exports :
  - `@creezio/brand-config`
  - `@creezio/brand-config/manifests/*`

Il n'a pas de dépendance runtime externe. Sa seule dépendance de développement est `typescript`.

## Configuration (env, configure*, bindings)

`brand-config` ne lit pas directement `process.env` pour configurer une app. Il fournit des conventions déterministes à utiliser par les packages consommateurs.

### Variables d'environnement dérivées

`envKey(manifest, suffix)` concatène le préfixe de marque et un suffixe :

```ts
import { envKey, demobrandManifest } from "@creezio/brand-config";

const key = envKey(demobrandManifest, "USER_DATA_OVERRIDE");
// "DEMOBRAND_USER_DATA_OVERRIDE"
```

Helpers spécialisés :

```ts
import {
  appKindEnvKey,
  serverPlatformEnvKey,
  demobrandManifest,
} from "@creezio/brand-config";

appKindEnvKey(demobrandManifest);        // "DEMOBRAND_APP_KIND"
serverPlatformEnvKey(demobrandManifest); // "DEMOBRAND_SERVER_PLATFORM"
```

Les packages comme `@creezio/platform-core` utilisent ces clés pour résoudre les overrides hors build packagé (`USER_DATA_OVERRIDE`, `DB_PATH_OVERRIDE`, `CORE_DB_PATH_OVERRIDE`, etc.).

### Bindings desktop

Le nom du bridge preload vient du manifest :

```ts
import { getManifest } from "@creezio/brand-config";

const manifest = getManifest("demobrand");
manifest.bridgeName; // "demobrandDesktop"
```

Ce nom est consommé par `@creezio/shell` et par les preloads de marque pour exposer l'API sous `window[manifest.bridgeName]`.

### Config electron-builder

`buildElectronBuilderConfig(manifest, kind, base, opts?)` reçoit une config de base déjà parsée et renvoie une config avec les champs identité, publish, NSIS et packaging Creezio ajustés :

```ts
import {
  buildElectronBuilderConfig,
  demobrandManifest,
} from "@creezio/brand-config";

const serverConfig = buildElectronBuilderConfig(
  demobrandManifest,
  "server",
  baseElectronBuilderYaml,
  {
    clientSlim: true,
    nsisInclude: "installer.nsh",
    iconDir: "resources/icons",
  },
);
```

Options principales :

- `hostOnlyModules` : liste des modules Electron main exclus du paquet Client.
- `clientSlim` : `true` par défaut ; `false` pour les apps qui gardent encore la stack locale dans le Client.
- `nsisInclude` : force le fichier include NSIS (`installer.nsh` par défaut) ou `false`.
- `iconDir` : dossier relatif des icônes `client.png` / `server.png`.
- `packCreezioVendor` : embarque les packages runtime `@creezio/*` (résolus depuis `node_modules`, walk-up workspaces) dans l'asar.
- `winBinStage` : stage bins Windows serveur (défaut `.creezio/win-bin-stage` ou `CREEZIO_WIN_BIN_STAGE`).

Packaging bins (parité TF2) :

- **Client slim** : pas de `resources/bin` (ni asar, ni extraResources).
- **Serveur** : `win.extraResources` filtré (`WIN_SERVER_BIN_FILTER`) depuis le stage ;
  jamais le dossier kit `electron-shell/resources/bin` en bloc.
- Exclusion asar systématique : `ASAR_EXCLUDE_KIT_BINS`.

`CREEZIO_ASAR_RUNTIME_PACKAGES` inclut notamment `brand-config`, `platform-core`, `product-hub`, `shell`, `electron-shell`, `api-kernel`, `mcp-facade`, `shell-ui` et `auth`.

## API publique (exports principaux avec exemples TS)

### Registre des manifests

```ts
import {
  getManifest,
  isSandboxBrand,
  listBrandIds,
  listProductionBrandIds,
  manifests,
  type BrandId,
} from "@creezio/brand-config";

const all: BrandId[] = listBrandIds();
// ["demobrand"] — sandbox kit seule (H11 : manifests prod hors kit)

const prod = listProductionBrandIds();
// [] — demobrand est exclu car sandbox: true

const demo = getManifest("demobrand");
const sandbox = isSandboxBrand("demobrand"); // true

manifests.demobrand.client.productName; // "DemoBrand"
```

### Manifests nommés

```ts
import { demobrandManifest } from "@creezio/brand-config";

demobrandManifest.envPrefix; // "DEMOBRAND"
demobrandManifest.sandbox; // true
```

Les manifests prod (`tempoflow` / `certivan` / `fidu`) ne sont plus
publiés par le kit (H11). Une marque les porte dans
`src/electron/app-manifest.json`, résolu via `resolveManifest`.

### Helpers d'identité et de feed

```ts
import {
  appSessionPartition,
  distDirForKind,
  exeForKind,
  feedBaseUrl,
  latestYmlUrl,
  profileArgPrefix,
  resolveArtifactFileName,
  resolveLatestAlias,
  demobrandManifest,
} from "@creezio/brand-config";

const serverExe = exeForKind(demobrandManifest, "server");

resolveArtifactFileName(serverExe, "0.10.26");
// "DemoBrand-Server-Setup-0.10.26.exe"

resolveLatestAlias(demobrandManifest.client);
// "DemoBrand-Setup-latest.exe"

feedBaseUrl(demobrandManifest.client);
// "https://demobrand.creez.io/dl-sandbox…"

latestYmlUrl(demobrandManifest, "server");
// ".../server/latest.yml"

appSessionPartition(demobrandManifest);
// "persist:demobrand-app"

profileArgPrefix(demobrandManifest);
// "--demobrand-profile="

distDirForKind("server");
// "dist-electron-server"
```

### Features optionnelles

```ts
import { createAppManifest, isFeatureEnabled } from "@creezio/brand-config";

const off = createAppManifest({
  brandId: "offbrand",
  productName: "Off",
  domain: "off.example.test",
  sandbox: true,
  features: { plugins: false, fleet: false },
});
isFeatureEnabled(off, "plugins"); // false
isFeatureEnabled(off, "fleet");   // false
```

Un champ absent ou `true` signifie activé. Seul `false` désactive explicitement la capacité.

### Factory sandbox

```ts
import {
  createAppManifest,
  defaultFeedToken,
  validateAppManifest,
} from "@creezio/brand-config";

const manifest = createAppManifest({
  brandId: "atelier-demo",
  productName: "Atelier Demo",
  domain: "atelier-demo.creez.io",
  sandbox: true,
});

const errors = validateAppManifest(manifest);
if (errors.length) throw new Error(errors.join("\n"));

defaultFeedToken("atelier-demo"); // token sandbox déterministe
```

`createAppManifest` refuse les `brandId` réservés `tempoflow`, `certivan` et `fidu`. Il ne doit donc pas servir à régénérer les manifests de production.

### GUID NSIS

```ts
import { nsisGuidFromAppId } from "@creezio/brand-config";

const guid = nsisGuidFromAppId("fr.fidu.desktop.server");
// UUID.v5(appId, namespace OID electron-builder)
```

## Flux / fonctionnement

1. Une app ou un script choisit un manifest (`getManifest("demobrand")` pour la sandbox kit, `resolveManifest(brandId, { appRoot })` pour une marque).
2. Les packages consommateurs dérivent leurs clés et chemins :
   - `@creezio/platform-core` résout `userData`, `db`, `local-config`, feeds et ressources ;
   - `@creezio/shell` utilise `bridgeName` pour exposer `window.*Desktop` ;
   - `@creezio/desktop-tooling` et les scripts Electron consomment `publish` et les identités Client/Serveur ;
   - `@creezio/electron-shell` peut utiliser `appKindEnvKey`, `distDirForKind`, `appSessionPartition`.
3. Pour le build desktop, `buildElectronBuilderConfig` applique l'identité de l'exe (`client` ou `server`) à la config de base.
4. Pour les marques générées, `createAppManifest` produit un manifest sandbox complet et `validateAppManifest` vérifie les invariants.

Les invariants critiques sont :

- feeds client et serveur distincts, avec feed serveur contenant `/server/` ;
- GUID client et serveur distincts ;
- `buildServerArtifact: true` pour les nouvelles apps ;
- pas de réutilisation de feed token production dans un manifest sandbox ;
- `userDataSegment` stable pour préserver les données et upgrades existants.

## Intégration — DemoBrand (sandbox kit)

H11 : les manifests prod (`tempoflow` / `certivan` / `fidu`) ne sont plus
publiés par `@creezio/brand-config`. Chaque marque porte son
`src/electron/app-manifest.json`. Feature-off (`plugins` / `fleet` =
`false`) se déclare dans ce JSON via `createAppManifest({ features })`.

### DemoBrand

- `brandId`: `demobrand`
- généré par `createAppManifest`
- `domain`: `demobrand.creez.io`
- `sandbox: true`
- `defaultAppRoot`: `/opt/docker/creezio/apps/demobrand`
- feeds, GUIDs et dossiers DL distincts des marques de production

`DemoBrand` sert aux flux factory et aux tests sandbox. Il est exclu par `listProductionBrandIds()`.

## Dépendances @creezio/*

Aucune dépendance `@creezio/*` runtime. `@creezio/brand-config` est plutôt une dépendance de base consommée par :

- `@creezio/platform-core` pour les chemins, env et feeds ;
- `@creezio/shell` en peer dependency pour aligner `bridgeName` et contrats desktop ;
- `@creezio/api-kernel` indirectement via `platform-core` et directement dans son `package.json` ;
- les packages Electron/tooling qui packagent les apps desktop.

## Voir aussi

- [AGENTS.md](./AGENTS.md)
- [docs/FILES.md](./docs/FILES.md)
