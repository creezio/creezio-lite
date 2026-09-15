# AGENTS — @creezio/brand-config

## Mission du package

`@creezio/brand-config` centralise l'identité desktop des marques Creezio. Il doit permettre aux autres packages du kit de fonctionner sans hardcoder `TempoFlow`, `Certivan` ou `Fidu`.

La mission concrète du package :

- définir le contrat `AppManifest` Client + Serveur ;
- exposer `demobrandManifest` (sandbox kit) — **H11 : plus aucun manifest
  prod** (`tempoflow` / `certivan` / `fidu` retirés, ADR
  `docs/adr/ADR-h11-purge-tf2-compat.md`) ;
- fournir un registre typé (`manifests`, `BrandId`, `getManifest`, `listBrandIds`, `listProductionBrandIds`, `isSandboxBrand`) — seul `demobrand` ; le manifest d'une marque vit dans SON repo (`src/electron/app-manifest.{ts,json}`, résolu via `resolveManifest`) ;
- dériver les noms d'env, partitions Chromium, feeds, aliases d'artifacts et dossiers de build ;
- produire des manifests sandbox pour la factory via `createAppManifest` ;
- générer les overrides `electron-builder` via `buildElectronBuilderConfig`.

Le package est un socle : une erreur ici peut casser les upgrades, les feeds, les GUID NSIS ou les chemins `userData` de plusieurs marques.

## Ne pas faire / frontières

- Ne pas régénérer `tempoflow`, `certivan` ou `fidu` avec `createAppManifest`. La factory refuse ces IDs pour une raison : ce sont des manifests de production.
- Ne pas changer `appId`, `nsisGuid`, `packageName`, `userDataSegment`, `artifactName` ou `feedUrl` d'une marque de production sans migration et validation desktop explicites.
- Ne pas recycler les feed tokens production dans un manifest sandbox.
- Ne pas ajouter de secrets dans `publish`. Les champs `remoteBuildHost`, `remoteBuildRoot`, chemins DL et noms de conteneurs sont de l'infra non secrète ; les credentials restent hors repo.
- Ne pas mettre de logique Electron ou d'I/O runtime dans les helpers de manifest. Les fonctions doivent rester pures sauf génération de config objet.
- Ne pas faire porter au kit des comportements métier marque : routes, migrations métier, wording UI ou features verticales.
- Ne pas supprimer `Fidu` des cas feature-off : `features.plugins` et `features.fleet` valent explicitement `false`.

## Points d'entrée

- `src/index.ts`
  - agrège tous les exports publics ;
  - expose `manifests`, `BrandId`, `getManifest`, `listBrandIds`, `listProductionBrandIds`, `isSandboxBrand`.
- `src/types.ts`
  - définit `AppManifest`, `ExeIdentity`, `BrandFeatures`, `BrandPublishInfra` ;
  - contient les helpers purs `envKey`, `exeForKind`, `latestYmlUrl`, etc.
- `src/create-manifest.ts`
  - contient `AppManifestSpec`, `defaultFeedToken`, `createAppManifest`, `validateAppManifest` ;
  - réservé aux marques sandbox/factory.
- `src/manifests/demobrand.ts`
  - manifest sandbox kit (seul fichier de `manifests/` — `apps/demobrand`).
    Gate `test-phase-no-brand-vocab` NV4 : tout autre
    `manifests/<marque>.ts` est rouge.
- `src/build-builder-config.ts`
  - contient `buildElectronBuilderConfig`, `CREEZIO_ASAR_RUNTIME_PACKAGES`, `DEFAULT_HOST_ONLY_ELECTRON_MODULES`.
- `src/nsis-guid.ts`
  - contient `uuidV5`, `nsisGuidFromAppId`, `ELECTRON_BUILDER_NS_OID`.

## Comment modifier sans casser les marques

1. Identifier si le changement touche un contrat stable :
   - stable : `appId`, `nsisGuid`, feed URL, `userDataSegment`, `packageName`, protocole deep-link, `bridgeName` ;
   - moins risqué : helpers dérivés, docs, ajout d'un champ optionnel avec défaut compatible.
2. Pour un manifest de production, comparer les valeurs aux apps sources et aux builds existants. Ne pas "normaliser" un champ qui semble incohérent si le commentaire indique une compatibilité historique (ex. `Fidu` et `%APPDATA%/Fidu`).
3. Si vous ajoutez une feature dans `BrandFeatures`, garder la règle actuelle : absent ou `true` = activé, `false` = désactivé.
4. Si vous ajoutez une marque sandbox, préférer `createAppManifest` et vérifier `validateAppManifest`.
5. Si vous modifiez `buildElectronBuilderConfig`, vérifier les deux kinds (`client`, `server`) et l'impact sur l'asar — crash packagé réel documenté : `Cannot find module '@creezio/brand-config'` (d'où `ensureCreezioVendorInAsar`, qui résout les packages npm installés).
6. `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs brand-config` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.

## Config attendue côté brand

Une marque doit fournir ou consommer un `AppManifest` complet :

- `brandId`, `envPrefix`, `bridgeName`, `dbFileName`, `localConfigFileName` ;
- `deepLinkProtocol`, `sessionPartition`, `logBasename`, `tunnelRootDomain` ;
- `domains.primary` et `domains.feedHost` ;
- `client` et `server` avec `appId`, `productName`, `executableName`, `artifactName`, `packageName`, `userDataSegment`, `feedUrl`, `nsisGuid`, `appUserModelId` ;
- `publish` avec chemins et noms d'infra remote-build ;
- `features` si des capacités kit doivent être désactivées.

Les apps de marque doivent utiliser les helpers au lieu de reconstituer les chaînes :

```ts
import { envKey, getManifest, latestYmlUrl } from "@creezio/brand-config";

const manifest = getManifest("demobrand");
const dbOverrideKey = envKey(manifest, "DB_PATH_OVERRIDE");
const serverLatest = latestYmlUrl(manifest, "server");
```

## Tests / gates liés

Commandes directes :

```bash
npm run typecheck -w @creezio/brand-config
npm run build -w @creezio/brand-config
```

Gates monorepo pertinents :

- `npm run build:packages` pour vérifier les consommateurs TypeScript ;
- `npm test` pour les scripts de phase qui valident manifests, builds desktop, factory, split Client/Serveur et invariants de publication.

Points à vérifier après modification :

- `validateAppManifest` ne remonte pas d'erreur pour les manifests attendus ;
- `listProductionBrandIds()` exclut toujours `demobrand` ;
- les feeds serveur contiennent `/server/` ;
- les GUID client/serveur restent distincts ;
- `buildElectronBuilderConfig` conserve les sorties `dist-electron` et `dist-electron-server`.

## Fichiers sensibles

- `src/manifests/demobrand.ts` : seul manifest encore publié (sandbox kit).
- `src/create-manifest.ts` : garde-fous factory, tokens sandbox, validation des manifests, `brandId` réservés.
- `src/build-builder-config.ts` : packaging asar et exclusion des modules host-only.
- `src/nsis-guid.ts` : algorithme GUID compatible electron-builder.
- `src/types.ts` : contrat public utilisé par plusieurs packages.

## Liens

- [README.md](./README.md)
- [docs/FILES.md](./docs/FILES.md)
