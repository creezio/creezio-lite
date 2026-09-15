# AGENTS — @creezio/api-kernel

## Mission du package

`@creezio/api-kernel` est la façade HTTP unique du kit Creezio. Sa mission est de fournir un registre framework-agnostic sous `/api/v1`, avec séparation stricte des espaces :

- `core` : routes kit intégrées ;
- `platform` : APIs plateforme sur `core.db` ;
- `module` : métier marque sur `brand.db` ;
- `plugin` : plugins installés sur `plugin/<id>.db`.

Le package doit protéger les frontières DB, empêcher les abus historiques comme `registerModuleApi("platform-*")` et rester montable dans Hono sans big-bang des routes flat existantes.

## Ne pas faire / frontières

- Ne pas ajouter de routes métier TempoFlow, Certivan ou Fidu dans le package.
- Ne pas ajouter de dépendance à Next, Express ou Fastify. Hono est l'adaptateur officiel déjà présent.
- Ne pas monter une API plateforme avec `registerModuleApi`. Utiliser `registerPlatformApi`.
- Ne pas contourner `ScopedDbAccess` pour donner un handle `core` à un module brand ou plugin.
- Ne pas ouvrir SQLite dans l'adaptateur Hono au moment de l'import : préférer un getter lazy.
- Ne pas transformer les routes Hono propres à une marque en second design API : les espaces kernel sont le contrat ; le fallthrough de `src/hono.ts` n’existe que pour la composition.
- Ne pas changer les erreurs publiques (`platform_not_mounted`, `module_not_mounted`, `plugin_not_mounted`, `cross_layer_write_denied`, etc.) sans vérifier les tests et clients.
- `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs api-kernel` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.

## Points d'entrée

- `src/index.ts`
  - export public.
- `src/types.ts`
  - contrats `ApiRequest`, `ApiResponse`, `ApiMount`, `ApiHandlerContext`, `ApiKernelOptions`, `MountedApiInfo`.
  - `ModuleOperation` / `operations[]` sur chaque mount métier (1 capacité = 1 op).
    `mcpTools` n'existe plus. SoT = `operations[]` → tools MCP générés côté `@creezio/mcp-facade`.
- `src/kernel.ts`
  - constantes de préfixe, type `ApiKernel`, `createApiKernel`, routes core, dispatch mounts.
  - `listOperations()` aplatit chaque mount + `operations[]` (`ListedModuleOperation`).
- `src/operations.ts`
  - collecte / matching des `ModuleOperation` (SoT HTTP + catalogue `/admin/api`).
  - Tools MCP générés côté `@creezio/mcp-facade` depuis ce catalogue.
- `src/db-scope.ts`
  - `CrossLayerWriteDeniedError`, `createScopedDbAccess`, `mountLayerRef`.
- `src/register.ts`
  - `registerApiMounts`, types batch.
- `src/entity-mount.ts`
  - moteur CRUD déclaratif : `EntitySpec`, `createEntityApiMount`,
    `registerEntityMounts` (routes list/get/create/patch/delete/archive,
    SQL paramétré, identifiants validés `[a-z_][a-z0-9_]*`, hooks métier).
    Liste : Meili si `configureEntityMeili` a un index pour la table **et**
    que le filtre est exprimable (`q` vide inclus). **Meili core
    fail-closed** : entité indexée + Meili KO = **503 `meili_unavailable`**
    (ou `engine:"indexing"` pendant l'indexation initiale) — zéro LIKE SQL
    de secours. SQL légitime : entité non indexée, filtre hors index
    (`filter_not_indexable`/`filter_rejected` visibles), hydratation
    `?ids=`, archives, ou `CREEZIO_ALLOW_NO_MEILI=1` (dev/tests).
    Gate : `scripts/test-phase-api-entity-mount.mjs` + `test-phase-meili-browse`.
- `src/meili-browse.ts`
  - `browseMeiliIndexOutcome` (issue discriminée incident/hors-index) +
    `browseMeiliIndex` (compat `null`) + `configureEntityMeili` /
    `configureEntityMeiliFromFeed` (UIDs depuis le feed marque, jamais
    hardcodés). `searchMeiliIndexes` est interdit pour le browse.
- `src/hono.ts`
  - `apiKernelToHonoHandler`, `applyApiResponse`, `mountApiKernelOnHono`.

## Comment modifier sans casser les marques

1. Préserver le préfixe `/api/v1` et les quatre espaces documentés.
2. Pour ajouter une route core :
   - l'ajouter dans `handleCore` ;
   - limiter les méthodes HTTP explicitement ;
   - retourner `ApiResponse` JSON cohérente ;
   - ne pas dépendre d'une marque.
3. Pour modifier le dispatch :
   - vérifier les regex de paths platform/modules/plugins ;
   - conserver la validation d'ID `^[a-z][a-z0-9_-]{0,62}$` ;
   - conserver le blocage des subpaths `..`.
4. Pour l'isolation DB :
   - `platform` doit rester couche `core` ;
   - `module` doit rester couche `brand` ;
   - `plugin` doit rester couche `plugin` avec `pluginId = mountId` ;
   - `brand` et `plugin` ne doivent ni lire ni écrire les autres couches via `access`.
5. Pour Hono :
   - garder `fallthroughOnNotFound` par défaut à `true` pour ne pas voler les routes flat ;
   - garder les chemins relatifs compatibles avec `.basePath("/api/v1")`.
6. Pour les helpers d'enregistrement :
   - `registerApiMounts` doit rester un helper mince, sans logique métier ;
   - ne pas réintroduire une factory `MountGold` ou des copies par marque.

## Config attendue côté brand

Une marque doit créer un kernel et enregistrer ses mounts :

```ts
import {
  createApiKernel,
  registerApiMounts,
  type ApiKernel,
} from "@creezio/api-kernel";

export function registerBrandModuleApis(api: ApiKernel): void {
  registerApiMounts(api, {
    modules: [
      ["panier", createPanierMount()],
      ["dispatch", createDispatchMount()],
    ],
  });
}

const api = createApiKernel({
  brandId: "tempoflow",
  sqliteRuntime,
  authorizePluginAccess,
});

registerBrandModuleApis(api);
registerApiMounts(api, {
  platform: [
    ["platform-tasks", createTasksApiMount(tasks)],
    ["platform-mails", createMailsApiMount(mails)],
  ],
});
```

Pour Hono :

```ts
mountApiKernelOnHono(app, () => getBrandModuleApi(), {
  spaces: ["core", "platform", "modules", "plugins"],
});
```

Le `sqliteRuntime` vient de `@creezio/platform-core`. Si absent, les mounts fonctionnent mais `ctx.db` est `undefined` et les routes SQLite core répondent indisponibles.

## Tests / gates liés

Commandes directes :

```bash
npm run typecheck -w @creezio/api-kernel
npm run build -w @creezio/api-kernel
```

Gates monorepo pertinents :

- `npm run build:packages` ;
- `npm test`, en particulier les phases H1/H2/H3/H5/P17 et les tests des packages qui montent des `ApiMount`.

À vérifier après modification :

- `GET /api/v1/core/health` répond 200 ;
- `GET /api/v1/core/version` expose `appVersion`, `architectureVersion`, `brandId` ;
- `GET /api/v1/core/sqlite/status` répond 503 sans runtime et 200 avec runtime ;
- `registerModuleApi("platform-tasks", ...)` lève une erreur ;
- un module brand ne peut pas `access({ kind: "core" }, "write")` ;
- Hono laisse passer les 404 kernel prévues vers `next()`.

## Fichiers sensibles

- `src/kernel.ts`
  - routage public, erreurs publiques, routes core et garde anti-cross-write.
- `src/db-scope.ts`
  - isolation DB ; toute relaxation peut créer une fuite cross-layer.
- `src/hono.ts`
  - intégration Next/Hono ; le fallthrough protège les routes flat existantes.
- `src/types.ts`
  - contrat public des mounts consommé par les packages domaine.
- `src/register.ts`
  - pattern recommandé pour éviter la duplication Electron/Next.
- `src/index.ts`
  - surface exportée ; tout nouvel API public doit y être présent.

## Liens

- [README.md](./README.md)
- [docs/FILES.md](./docs/FILES.md)
