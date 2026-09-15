# @creezio/propagation

## Rôle

`@creezio/propagation` porte les contrats ops de propagation du kit vers les marques : semver, impact de bump, surfaces touchees, canaux PR, registre plugins org L3, points d'extension et notes de release.

Phase F : le package calcule et documente. Il n'ecrit pas dans les repos marques.

## Périmètre

Inclus :

- politique semver basee sur Conventional Commits ;
- graphe des packages `@creezio/*` et dependants transitifs ;
- mapping package -> surfaces marque -> marques impactees ;
- rapports d'impact et checklists gates ;
- payloads PR marque ;
- registre plugins org en memoire ou fichier JSON ;
- points d'extension descente/remontee ;
- helpers changelog/release notes ;
- inventaire versions locales du kit.

Hors perimetre :

- ouverture reelle de PRs ;
- mutation des repos `certivan`, `fidu`, `tempoflow` ;
- publication npm privee ;
- auto-promotion cloud de plugins.

## Installation/build

```bash
npm install
npm run build -w @creezio/propagation
npm run typecheck -w @creezio/propagation
```

## Configuration

La plupart des APIs sont pures. Les seules configurations runtime sont :

- chemin `kitRoot` pour `collectKitInventory` ;
- `filePath` et `seed` pour `createFileOrgPluginRegistry` ;
- options `keepHistory` / `maxHistory` pour `createExtensionHookBus`.

Les marques et gates connues viennent de `@creezio/brand-config` et des tables locales `brand-surfaces.ts` / `channels.ts`.

## API publique + exemples

Exports principaux :

- packages : `KIT_PACKAGES`, `assertKitPackage`, `directDependents`, `transitiveDependents` ;
- semver : `parseConventionalCommit`, `bumpKindFromCommits`, `applyBump`, `compareSemver` ;
- impact : `impactForPackageBump`, `formatImpactReport` ;
- canaux (data-driven H7) : `listUpdateChannels`, `configureBrandChannels`,
  `brandPrChannelId`, `buildBrandPrPayload`, `buildAllBrandPrPayloads`
  (`UPDATE_CHANNELS` déprécié — snapshot au chargement) ;
- registre org : `createMemoryOrgPluginRegistry`, `createFileOrgPluginRegistry`, `snapshotOrgPluginRegistry` ;
- extension points : `EXTENSION_POINTS`, `DOWNWARD_CHAIN`, `UPWARD_CHAIN`, `createExtensionHookBus` ;
- release notes : `entriesFromCommits`, `renderChangelogMarkdown`, `prependChangelog` ;
- inventaire : `collectKitInventory`, `publishedHintsFromInventory`.

Calculer un bump semver :

```ts
import { applyBump, bumpKindFromCommits } from "@creezio/propagation";

const bump = bumpKindFromCommits([
  "feat(electron-shell): add browser tabs",
  "fix(database): keep CRUD fail-closed",
]);

const next = applyBump("0.1.0", bump);
```

Generer un rapport d'impact :

```ts
import {
  formatImpactReport,
  impactForPackageBump,
} from "@creezio/propagation";

const impact = impactForPackageBump({
  packageName: "@creezio/electron-shell",
  bumpKind: "minor",
});

console.log(formatImpactReport(impact));
```

Construire les payloads PR marques :

```ts
import { buildAllBrandPrPayloads } from "@creezio/propagation";

const payloads = buildAllBrandPrPayloads(impact);
```

Registre org plugins :

```ts
import { createFileOrgPluginRegistry } from "@creezio/propagation";

const registry = createFileOrgPluginRegistry({
  filePath: "/var/lib/mybrand/org-plugin-registry.json",
});

registry.upsert({
  pluginId: "invoice-helper",
  brandId: "fidu",
  orgId: "org_1",
  createdByUserId: "user_1",
  name: "Invoice Helper",
  version: "0.1.0",
  visibility: "owner_only",
  deployedAt: ["L4-user"],
  createdAt: new Date().toISOString(),
});
```

Extension bus :

```ts
import { createExtensionHookBus } from "@creezio/propagation";

const bus = createExtensionHookBus();
bus.on("user.plugin.created", (payload) => {
  console.log(payload.pluginId, payload.orgId);
});
await bus.emit({
  pointId: "user.plugin.created",
  direction: "upward",
  levelFrom: "L4-user",
  levelTo: "L3-org",
  pluginId: "invoice-helper",
});
```

## Flux

### Semver

1. Parser les commits conventional.
2. Choisir le bump maximum : breaking -> major, feat -> minor, fix/perf -> patch, reste -> none.
3. Appliquer le bump a la version package.
4. Generer changelog et inventaire.

### Impact

1. Identifier le package bumpé.
2. Calculer les dependants transitifs a rebuild.
3. Mapper package + dependants vers surfaces marque.
4. Mapper surfaces vers marques (`certivan`, `fidu`, `tempoflow`, `demobrand`).
5. Produire gates, checklist et titre PR.

### Propagation descendante

`kit.release.published` -> `vertical.deps.bumped` -> `org.feature.rolled_out` -> `user.plugin.entitled`.

### Remontee terrain

`user.plugin.created` -> `org.plugin.reviewed` -> `vertical.plugin.promoted` -> `kit.plugin.accepted`.

## Intégration marques

Les marques consomment ce package pour preparer leurs PRs de bump et leurs consoles ops. Elles ne doivent pas attendre de ce package qu'il modifie leur repo ou applique une gate automatiquement.

Les gates de production restent ordonnees :

1. G1 Certivan
2. G2 Fidu
3. G3 TempoFlow

## Dépendances

- `@creezio/brand-config` n'est plus la SoT des ids production (H11 :
  `BrandId` kit = sandbox ; gates G1–G3 = `ProductionBrandGate` local) ;
- Node `fs`/`path` pour inventaire et registre fichier.

## Voir aussi

- `AGENTS.md`
- `docs/FILES.md`
- `docs/PROPAGATION.md`
- `docs/archive/PHASE-F.md`
- `docs/PLATFORM-VS-VERTICAL.md`
