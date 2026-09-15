# @creezio/product-hub

## Rôle

`@creezio/product-hub` est le socle kit des produits/plugins natifs Creezio. Il concentre les contrats purs, le store Product Hub, les routes HTTP Hono `/plugin-products`, l'ACL L3/L4, le control plane loopback, le provisioning n8n, la fabrique conversationnelle de plugins et l'UI d'administration.

Le package est brand-agnostic : il expose des machines d'etat, des schemas SQL, des adapters et des factories. Les marques (TempoFlow, Certivan, Fidu, DemoBrand...) branchent leurs chemins, leur session, leur API key, leur DB SQLite et leurs integrations verticales.

Surfaces publiees :

| Import | Usage |
|---|---|
| `@creezio/product-hub` | lifecycle, ACL, store, routes Hono, n8n, control plane, factory, helpers UI/desktop |
| `@creezio/product-hub/ui` | composants React admin plugins : `AdminPluginsList`, `AdminPluginDetail`, `HostManagedNotice` |

## Périmètre (kit vs marque)

Ce qui appartient au kit :

- lifecycle Product Hub (`request_received` -> `impact_analysis` -> `prd_draft` -> `released`, etc.) et statuts de taches ;
- ACL plugins L3 organisation / L4 utilisateur avec fail-closed, capabilities `see`, `install`, `execute` et deny cross-org ;
- contrats de store (`ProductHubStore`) et implementations memoire / SQLite core ;
- DDL SQL Product Hub (`PRODUCT_HUB_CORE_SQL`, `PRODUCT_HUB_ACL_*_SQL`, `PRODUCT_HUB_RUNTIME_SQL`) ;
- routes Hono `/plugin-products` et `/plugin-factory` ;
- control plane HTTP loopback (`startPluginControlPlane`, `createPluginControlPlaneHandler`) ;
- provisioning n8n generique par tokens marque ;
- fabrique conversationnelle intention -> impact -> clarification -> PRD -> materialisation ;
- UI admin reusable.

Ce qui reste dans la marque :

- authentification externe au montage des routes (`requireSessionOrApiKey`, `getActor`, `getSession`) ;
- choix des chemins (`pluginsDir`, `documentsDir`, `hermesContextDir`, `coreDbPath`) ;
- ouverture DB concrete (`better-sqlite3` ou `node:sqlite`) et migrations verticales ;
- resolution des credentials n8n, Hermes, API publique, env et secrets ;
- modules encore verticaux listes par `PRODUCT_HUB_VERTICAL_REMAINING` : `plugin-git`, `plugin-data`, `plugin-accept-check`, `plugin-test-runner`, `plugin-crm-key` ;
- UI metier autour des pages admin, navigation, ACL de routes, libelles de marque ;
- decision fonctionnelle d'activer les plugins (`features.plugins`). Fidu peut garder `features.plugins: false` sans perdre la capacite kit.

## Installation / build

Le package est un workspace npm du monorepo.

```bash
npm install
npm run build -w @creezio/product-hub
npm run typecheck -w @creezio/product-hub
```

Dans le build global, il est compile apres `@creezio/brand-config`, `@creezio/shell` et `@creezio/platform-core`.

Artefacts :

- ESM : `dist/`
- CJS Electron : `dist-cjs/`
- UI source consommee par les apps Next : `ui/`

Dependances runtime directes : `@creezio/brand-config`, `@creezio/platform-core`, `hono`, `zod`. Les dependances React/UI sont des peer dependencies optionnelles car `./ui` n'est charge que par les apps qui l'utilisent.

## Configuration

### Tokens marque

Les tokens Product Hub doivent venir du manifeste, pas de constantes `TEMPOFLOW_` / `CERTIVAN_` hardcodees.

```ts
import { productHubTokensFromManifest } from "@creezio/product-hub";
import { appManifest } from "@creezio/brand-config";

const tokens = productHubTokensFromManifest(appManifest);
```

Ces tokens alimentent notamment les tags n8n et les hints de process (`grantProcessHint`, `resolveN8nTagPrefix`).

### Store SQLite core

Le package expose le DDL et le store, mais le chemin DB et l'ouvreur concret restent injectes.

```ts
import {
  createSqliteProductHubStore,
  openNodeSqliteDatabase,
} from "@creezio/product-hub";

const store = createSqliteProductHubStore({
  coreDbPath: "/path/to/core.db",
  openDatabase: openNodeSqliteDatabase,
});
```

Pour tests et sandboxes, `createMemoryProductHubStore()` evite SQLite.

### Routes `/plugin-products`

L'authentification est volontairement externe : la marque protege le prefixe puis fournit acteur ACL et session.

```ts
import {
  createPluginProductsRoutes,
  createPluginN8nProvisioning,
  createProductHubHost,
  productHubTokensFromManifest,
} from "@creezio/product-hub";

const host = createProductHubHost({
  requireStore,
  getStore,
  pluginsDir: () => process.env.MYBRAND_PLUGINS_DIR || "",
});

const n8n = createPluginN8nProvisioning({
  getDb: getProductHubBetterSqlite,
  tokens: productHubTokensFromManifest(myManifest),
  managedBy: "mybrand",
  modeLabel: "Tag dedie + registre MyBrand",
});

api.use("/plugin-products", requireSessionOrApiKey);
api.use("/plugin-products/*", requireSessionOrApiKey);
api.route(
  "/plugin-products",
  createPluginProductsRoutes({
    host,
    store: requireStore,
    getActor: (c) => resolvePluginAclActor(c),
    getSession: (c) => getSessionFromContext(c),
    pluginsDir: () => process.env.MYBRAND_PLUGINS_DIR || "",
    documentsDir: () => resolvePluginDocumentsDir(),
    hermesContextDir: () => process.env.MYBRAND_HERMES_CONTEXT_DIR || null,
    apiUrlEnvHint: "$MYBRAND_API_URL",
    n8n,
    hermesCreateTask,
    hermesSkills: ["mybrand-plugins"],
    openReadonlyPluginDb,
    defaultOwnerOrgId: "org-mybrand",
  }),
);
```

### Control plane

Le control plane est un serveur HTTP local recommande en loopback. Le token Bearer et l'ACL viennent du host.

```ts
import {
  createPluginControlPlaneAclFromStore,
  startPluginControlPlane,
  withBearerServiceKeyFallback,
} from "@creezio/product-hub";

const acl = withBearerServiceKeyFallback(
  createPluginControlPlaneAclFromStore({ store }),
);

const state = await startPluginControlPlane({
  tokens,
  controlToken: process.env.PLUGIN_CONTROL_TOKEN!,
  pluginsDir,
  adapters,
  preferredPort: 0,
  acl,
});
```

## API publique (exports + exemples)

### Lifecycle et PRD

Exports principaux :

- `PLUGIN_LIFECYCLE_STATES`, `PLUGIN_LIFECYCLE_TRANSITIONS`, `PLUGIN_TASK_STATUSES`
- `isPluginLifecycleState`, `canTransitionPluginLifecycle`, `assertPluginLifecycleTransition`
- `PLUGIN_PRD_REQUIRED_SECTIONS`, `parsePluginPrdSections`, `missingPrdSections`, `missingPrdCoreFields`
- `assertClarificationQuestions`

```ts
import {
  assertPluginLifecycleTransition,
  missingPrdSections,
  parsePluginPrdSections,
} from "@creezio/product-hub";

assertPluginLifecycleTransition("prd_draft", "awaiting_prd_approval");

const sections = parsePluginPrdSections(revision.sections_json);
if (missingPrdSections(sections).length > 0) {
  throw new Error("PRD incomplet");
}
```

### ACL L3/L4

Exports principaux :

- constantes : `PLUGIN_ACL_LEVEL_ORG`, `PLUGIN_ACL_LEVEL_USER`, `PLUGIN_ACL_DEFAULT_CAPABILITIES`
- acteurs/policies : `PluginAclActor`, `PluginAclPolicy`, `PluginAclDecision`
- decisions : `decidePluginAccess`, `canActorSeePlugin`, `canActorInstallPlugin`, `canActorExecutePlugin`, `filterVisiblePluginIds`
- headers : `PLUGIN_ACL_ORG_HEADER`, `PLUGIN_ACL_USER_HEADER`, `PLUGIN_ACL_OWNER_HEADER`, `resolvePluginAclActorFromHeaders`, `buildPluginAclActorHeaders`

```ts
import { decidePluginAccess, type PluginAclActor } from "@creezio/product-hub";

const actor: PluginAclActor = {
  orgId: "org-a",
  userId: "user-1",
  isOwner: false,
};

const decision = decidePluginAccess(policy, actor, "execute");
if (!decision.allow) {
  return c.json({ error: decision.reason }, 403);
}
```

Par defaut, le modele est fail-closed : sans grant explicite, seul l'owner non impersonne ou une cle service voit/execute. `install` n'est pas dans les capabilities par defaut ; elle doit etre explicite ou admin.

### Store et SQL

Exports principaux :

- `ProductHubStore`, `PluginProductRecord`, `PluginPrdRevisionRecord`, `PluginTaskRecord`, `PluginClarificationRecord`
- `createMemoryProductHubStore`, `createSqliteProductHubStore`, `createProductRequest`, `createSqliteProductRequest`
- `PRODUCT_HUB_CORE_SQL`, `PRODUCT_HUB_ACL_USER_SQL`, `PRODUCT_HUB_ACL_ORG_SQL`, `PRODUCT_HUB_ACL_H5_SQL`, `PRODUCT_HUB_RUNTIME_SQL`
- `migrateLegacyBrandProductHubOnce`, `createCachedSqliteProductHubAccessor`, `createBrandProductHubBindings`

```ts
import { createMemoryProductHubStore, buildPluginImpactReport } from "@creezio/product-hub";

const store = createMemoryProductHubStore();
const { product } = store.createRequest({
  name: "Plugin scoring",
  description: "Calculer un score depuis les donnees CRM",
  impact: buildPluginImpactReport({ intention: "scoring", evidence: [] }),
});
```

### Routes HTTP Product Hub

`createPluginProductsRoutes` couvre notamment :

| Methode | Chemin |
|---|---|
| `GET` | `/visible` |
| `GET` / `POST` | `/` |
| `GET` | `/:id` |
| `POST` | `/:id/transition` |
| `POST` | `/:id/prd` |
| `POST` | `/:id/clarifications` |
| `POST` | `/:id/clarifications/:clarificationId/answers` |
| `POST` | `/:id/prd/:revisionId/approve` |
| `POST` / `PATCH` | `/:id/tasks`, `/:id/tasks/:taskId` |
| `POST` | `/:id/tasks/:taskId/sync-hermes` |
| `PATCH` | `/:id/runtime-link` |
| `POST` / `GET` / `DELETE` | `/:id/documents...` |
| `POST` | `/:id/test-runs`, `/:id/human-qa` |
| `GET` | `/:id/data/tables...` |
| `GET` / `POST` | `/:id/n8n...` |
| `POST` | `/:id/archive` |

### Fabrique conversationnelle

Exports principaux :

- `createConversationalPluginFactory`
- `createFsPluginScaffoldAdapters`
- `createPluginFactoryRoutes`
- `derivePluginIdentity`, `slugifyPluginId`
- `draftPrdFromIntention`, `defaultClarificationQuestions`, `needsClarification`
- `deterministicPrdDrafter`, `createOptionalLlmPrdDrafter`
- `buildPluginScaffoldFiles`

```ts
import {
  createConversationalPluginFactory,
  createFsPluginScaffoldAdapters,
  createPluginFactoryRoutes,
} from "@creezio/product-hub";

const factory = createConversationalPluginFactory({
  store: requireStore(),
  ...createFsPluginScaffoldAdapters(pluginsDir()),
  installRuntime: async (pluginId, actor) => {
    await ensurePluginMounted(pluginId, actor);
    return { dbOpened: true };
  },
});

api.route(
  "/plugin-factory",
  createPluginFactoryRoutes({
    factory,
    getActor,
    enabled: () => process.env.PRODUCT_HUB_FACTORY === "1",
  }),
);
```

Flux de la factory : `submitIntention` -> impact -> clarification optionnelle -> PRD -> `approvePrd` -> `materialize` -> runtime installe.

### n8n

Exports principaux :

- `createPluginN8nProvisioning`, `resolveN8nTagPrefix`
- `pluginN8nTag`, `isBrandPluginN8nTag`, `N8N_TAG_MAX_LENGTH`
- types `PluginN8nProvisioning`, `PluginN8nSnapshot`, `N8nWorkflow`, `N8nExecution`

```ts
const provisioning = createPluginN8nProvisioning({
  getDb,
  tokens,
  managedBy: "mybrand",
  modeLabel: "Registre n8n marque",
});

const tag = provisioning.pluginN8nTag("mon-plugin");
```

### UI admin

```tsx
import {
  AdminPluginDetail,
  AdminPluginsList,
  HostManagedNotice,
} from "@creezio/product-hub/ui";
```

La marque fournit la page, l'auth route et la navigation. Les composants consomment les endpoints kit.

## Flux / fonctionnement

1. Une intention plugin cree un `PluginProductRecord` dans le store.
2. L'analyse d'impact produit une recommandation `create` ou `evolve`.
3. Si l'intention est incomplete, une clarification ouverte est creee.
4. Un PRD est sauvegarde puis valide par session utilisateur.
5. Le produit passe en `planning`, puis `ready_for_execution`, `executing`, tests automatiques, QA humaine, release.
6. Le runtime plugin est lie via `linkRuntime` et peut etre expose au control plane.
7. Les ACL L3/L4 filtrent la visibilite, l'installation et l'execution cote API, MCP et control plane.
8. n8n peut creer/associer workflows et tags par plugin.
9. Les documents, tests, taches Hermes et donnees plugin sont accessibles via les routes dediees.

## Intégration marques

Checklist d'integration :

1. Ajouter ou verifier `features.plugins` dans le manifeste marque.
2. Executer les migrations SQLite core avec les SQL exportes par le package.
3. Construire un singleton store (`createSqliteProductHubStore` ou accessor cache).
4. Deriver les tokens via `productHubTokensFromManifest`.
5. Brancher n8n avec `createPluginN8nProvisioning`.
6. Creer `ProductHubHost` avec `createProductHubHost`.
7. Monter `/plugin-products` derriere l'auth marque.
8. Monter `/plugin-factory` seulement si la feature est active.
9. Brancher le control plane loopback si la marque a un runtime plugin local.
10. Remplacer les anciennes routes locales par des stubs minces deleguant au kit.
11. Utiliser `@creezio/product-hub/ui` pour les pages admin.

Cas Fidu : `features.plugins: false` signifie "pas d'UI plugins ni routes publiques activees par defaut", pas "le package ne fonctionne pas". Le store et le control plane peuvent rester presents pour convergence technique.

## Dépendances @creezio/*

| Dependance | Rôle |
|---|---|
| `@creezio/brand-config` | source des tokens marque via manifeste |
| `@creezio/platform-core` | constantes plateforme et helpers partages |

Liens fonctionnels sans dependance directe obligatoire :

- `@creezio/auth` protege les routes Hono cote marque.
- `@creezio/shell-ui` et `@creezio/product-hub/ui` composent les pages admin dans les apps.
- `@creezio/mcp-facade` peut reutiliser l'ACL Product Hub pour les tools plugin.
- `@creezio/tasks` / Hermes restent injectes via adapters (`hermesCreateTask`).

## Voir aussi → AGENTS.md + docs/FILES.md

- [`AGENTS.md`](./AGENTS.md) : consignes de modification pour agents.
- [`docs/FILES.md`](./docs/FILES.md) : inventaire fichier par fichier des exports et responsabilites.
