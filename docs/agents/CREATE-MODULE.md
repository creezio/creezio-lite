# CREATE-MODULE — créer un module métier de marque

Guide pour ajouter un module métier dans un **repo marque** (jamais dans le
kit). Un module = **unité de travail autonome** au sens du standard
[DOC-STANDARD-MODULE.md](../DOC-STANDARD-MODULE.md) : dossier spec 5 fichiers
(gate colocalisée comprise) + un fichier de wiring + ses pages UI. Référence
vivante : le repo `tempoflow3` (`server/src/electron/modules/`).

## 0. Scaffolder l'unité de travail

```bash
creezio brand module init <id> --app <racine-du-repo-marque>
```

Pose :

- `brand-spec/modules/<id>/` — `prd.md`, `interview.md`, `TODO.md`,
  `CHANGELOG.md` (templates à remplir — le PRD et l'interview sont la SoT,
  voir le standard) + `gate.mjs` **colocalisée** (stub structurel, à
  enrichir en preuves HTTP) ;
- `server/src/electron/modules/<id>.ts` — stub `BrandModuleDef` ;
- `server/scripts/run-module-gates.mjs` — runner d'auto-découverte des
  gates colocalisées (+ scripts `test:modules` / `test:module` branchés
  dans `npm test`) ;
- la ligne d'import + l'entrée dans le registre `modules/index.ts`
  (marqueurs `<creezio:module-imports>` / `<creezio:module-registry>`).

**Avant d'implémenter** : remplir `prd.md` + `interview.md` (décisions
d'architecture), poser les tâches dans `TODO.md`, puis claim
(`[todo]` → `[in-progress]` + `- claim: <agent> <date>` dans le même commit
que la première modif).

**Conventions OS non négociables** : l'interview ne peut pas contredire les
conventions dures du kit (section éponyme de
[DOC-STANDARD-MODULE.md](../DOC-STANDARD-MODULE.md)) — notamment home =
`/dashboard` (le kit canonise `/` → `/dashboard`), `app/page.tsx` = pure
redirection, nav accueil → `href: "/dashboard"`, routes OS + `/site/*`
réservées. Si une spec existante les contredit : corriger la spec, ne pas
arbitrer.

## Où va quoi — registre de modules

Tout le wiring d'un module vit dans **son** fichier
`server/src/electron/modules/<id>.ts`, qui exporte un `BrandModuleDef`.
Le contrat `BrandModuleDef` est **importé du kit** (`@creezio/app-runtime`,
P2.c / H9) : `modules/types.ts` est un simple ré-export — ne jamais y
redéclarer le type (doctor `MODULE_TYPES_DIVERGENT` fail-closed) :

| Élément | Champ du `BrandModuleDef` |
|---|---|
| Migrations `brand.db` | `migrations()` — IDs `mod_<id>_00N_<slug>` |
| Entités CRUD | `entitySpecs` (moteur kit `createEntityApiMount` — ops CRUD auto) |
| Mounts API manuscrits | `apiMounts` **avec `operations[]`** (1 capacité = 1 op) |
| Nav métier | `navItems` (avec `order`) |
| Tools MCP métier | **générés** depuis les ops (`module.<mountId>.<op.id>`) — plus de `mcpTools()` |
| Index Meili | `meiliIndexes` (liste catalogue) **ou** `horsIndexJustification` |
| Sources assistant | `assistantSources` (descripteurs typés `entity` / `context` / `tool`) **ou** `assistantSourcesJustification` — doctor warn `MODULE_ASSISTANT_SOURCES_MISSING` si le module expose une API sans les deux |
| Onboarding produit | `onboarding` (étapes / textes / mascotte) — agrégés par `collectOnboardingContent()` (`@creezio/onboarding`) |
| Démo interactive (**obligatoire**, ≥ 1) | `demo: { scenarios }` — agrégés par `collectInteractiveDemoDefaults` (`@creezio/interactive-demo`). Inclure `genericOsTourScenario({ productName })`. Une app sans démo = invalide. |

Les fichiers d'assemblage (`brand-module-api.ts`, `brand-migrations.ts`,
`vertical-slot.ts`, `brand-mcp-tools.ts`, `meili-feed.ts`) sont de simples
**consommateurs du registre** `modules/index.ts` — ne pas y remettre du
wiring de module. Le registre est partagé : un agent module n'y touche que
**sa** ligne d'import (tout autre changement = tâche sérialisée séparée).

## 1. Migration `brand.db`

Dans `migrations()` du module — IDs stables `mod_<id>_00N_<slug>`
(`[a-z0-9][a-z0-9_.-]*`), **jamais renuméroter/renommer une migration
appliquée**, quel que soit son préfixe (`fromprd_brand_0XX` compris).
Migrations cross-module interdites (une colonne sur la table d'un autre
module = tâche dans le module propriétaire). Colonnes implicites attendues
par le moteur CRUD : `id`, `created_at`, `updated_at` (+ `archived_at` si
archivable).

**Un seul plan de données** ([ADR-single-data-plane](../adr/ADR-single-data-plane.md)) :
les tables du module vivent dans `brand.db`. Si le module consomme une
source externe (snapshot, import fichier, API tierce), c'est un **flux
d'alimentation** : un module d'import la projette dans `brand.db`
(idempotent) et lui seul ouvre le fichier source. Écrans, API et tools MCP
ne lisent que `brand.db` — jamais le flux directement (gate
`single-data-plane`, fail-closed).

## 2. API — CRUD générique d'abord

Pour une entité CRUD standard, **ne pas écrire de handler** : déclarer un
`EntitySpec` et laisser le moteur kit générer les routes
(`createEntityApiMount`, `@creezio/api-kernel/entity-mount` — câblé prod
TF3, gate `test-phase-api-entity-mount`) :

```ts
import type { EntitySpec } from "@creezio/api-kernel";
import type { BrandModuleDef } from "./types.js";

const ENTITY_SPECS: Record<string, EntitySpec> = {
  clients: {
    table: "clients",
    archivable: true,
    columns: [
      { name: "nom", required: true, searchable: true },
      { name: "statut", enum: ["actif", "inactif"], filterable: true },
    ],
    hooks: { beforeCreate(row, ctx) { /* métier */ } },
    extraRoutes: async (ctx) => monSousCheminMetier(ctx), // routes hors CRUD
  },
};

export const clientsModule: BrandModuleDef = {
  id: "clients",
  entitySpecs: ENTITY_SPECS,
  navItems: [{ id: "brand.clients", label: "Clients", href: "/clients", group: "brand", order: 120 }],
  migrations: () => [{ id: "mod_clients_001_init", sql: `…` }],
};
```

Routes générées : `GET /` (liste `q`/filtres/`limit`/`offset`), `POST /`,
`GET|PATCH|DELETE /:id`, `POST /:id/archive`. Le métier va dans les
`hooks` (`beforeCreate`, `beforeUpdate`, `afterRead`, `afterList`) et
`extraRoutes`. Un mount manuscrit (`apiMounts: { id: { dbLayer: "brand",
handle } }`) reste possible pour les flux non-CRUD (à justifier dans
l'interview).

Un mount manuscrit **doit** porter `operations[]` **non vide** (doctor
`MODULE_OP_MISSING`, fail-closed pin ≥ 0.10.6) **et** déclarer son contrôle
d'accès (règle d'or n°7, fail-closed pin ≥ 0.16.0) : `permission` (ex.
`"nav.<module>"`, vérifiée par la garde `authorizeModuleAccess` du kernel)
OU `accessJustification` explicite si la route est volontairement
publique/machine (webhook signé, Bearer flotte…) — doctor
`MODULE_PERMISSION_MISSING`. `accessJustification: "à qualifier"` (posé par
le codemod H9 sur la dette héritée) = warn `MODULE_PERMISSION_UNQUALIFIED`.
Un **nouveau** module doit qualifier (`permission: "nav.<id>"`) — interdiction
de poser `"à qualifier"` silencieusement. Sur un `EntitySpec`, `permission` /
`accessJustification` sont threadés sur le mount CRUD généré.
Un `EntitySpec` sans ops extras est valide : le CRUD est généré par
`operationsFromEntitySpec`.
Les mounts kit internes (`schema`, `dashboard`, `search`,
`interactive-demo`) et les surfaces OS sont hors `modules/*.ts` — le
doctor ne les exige pas ; un module métier homonyme n'est pas exempté.

```ts
import type { ApiMount, ModuleOperation } from "@creezio/api-kernel";

const ops: ModuleOperation[] = [
  {
    id: "from-panier",
    method: "POST",
    path: "/from-panier",
    description: "Créer une commande depuis le panier",
    roles: ["owner", "collaborator"],
    // mcpPublishDefault: false → activer dans /admin/mcp
  },
];

const mount: ApiMount = {
  dbLayer: "brand",
  operations: ops,
  handle: async (ctx) => { /* derrière l'op déjà déclarée */ },
};
```

Lister une op = la lire **sur le module**, pas dans un `ops.ts` global :
`BrandModuleDef.apiMounts.<id>.operations`, ou `operationsFromEntitySpec(spec)`
pour un `entitySpecs.<id>`. À runtime : `api.listOperations()` (id mount + op)
alimente `/api/v1/admin/endpoints` + OpenAPI (`/api/v1/modules/<mount><path>`).

L'isolation DB est portée par le kernel : un module est en couche `brand`,
tout accès `core`/`plugin` est refusé (`cross_layer_write_denied`).

## 3. Tools MCP + policies

**Une op dans le module = un tool généré.** Le runtime génère toujours
depuis `api.listOperations()` (`generateModuleToolsFromOperations` /
`discoverModuleToolsFromKernel`) : name `module.<mountId>.<op.id>`,
handler = requête HTTP synthétique vers le même `ApiMount.handle` —
zéro 2ᵉ implémentation. `mcpTools` n'existe plus. SoT = `operations[]` →
tools générés. Un champ `mcpTools()` restant = doctor error
`MODULE_MCP_TOOLS_DEPRECATED` (fail-closed) ; collision de nom =
`MODULE_OP_MCP_OVERLAP`.

Enable/disable et rôles = policies sur les tools générés (`/admin/mcp`).
`mcpPublishDefault: false` (défaut) : le tool est seedé désactivé.
`roles` sur l'op = `defaultRoles` de la policy. Ne pas réimplémenter
l'enforcement côté marque. Documenter chaque op dans l'interview (§5).

## 4. UI, feed + nav — kit graphique imposé

- **UI** : pages sous `server/ui/app/<route>/page.tsx`, composées
  **exclusivement** de composants du kit graphique
  ([DOC-STANDARD-UI.md](../DOC-STANDARD-UI.md)) — pas de lib UI tierce, pas
  de CSS module sauvage, pas de fork des primitives. Chaque page liste ses
  composants dans l'interview (§4).
- **Resource data (réactivité)** : toute page liste / détail qui doit se
  mettre à jour quand le chat, une API ou un tool MCP mute les données
  déclare sa resource via `useCreezioResource("<id>")`
  (`@creezio/shell-ui/ui`). L'`EntitySpec` porte le même id
  (`resource` ou défaut = `table`) → header `x-creezio-data-changed` → bus
  client `creezio:data-changed`. Les mounts hors EntitySpec ajoutent le
  header (`CREEZIO_DATA_CHANGED_HEADER`) ou appellent `emitDataChanged`.
  Tools MCP : préférer `module.<id>.<action>` — l'assistant infère la
  resource via `inferResourceFromToolName` (écriture uniquement). Pour
  montrer une page après mutation UX (panier…) : `openOrNotify("/…")`
  (focus si onglet ouvert, nouvel onglet sinon — pas pastille-only).
- Nav : `navItems` du module avec `permission: "nav.<id>"` sur chaque
  entrée. **Ne jamais** éditer un fichier global `nav-permissions.ts` ni
  `ownerPermissions: [...]` en dur dans les bindings. Les collecteurs
  `collectNavPermissions()` / `collectPermissionGroups()` (registre kit)
  alimentent `configureAuth` et `/admin/access` via `applyBrandModuleAuth`
  au boot. Owner API + sidebar bypassent déjà sans catalogue ; collab /
  matrice d'accès suivent le registre. Icône chrome : fallback kit si
  absente — ne pas toucher le BrandChrome partagé. Pas de
  `accessJustification: "à qualifier"` sur un module neuf.
- Meili (**composant core fail-closed**) : tout module avec une **entité
  listable** DOIT déclarer son schéma data + index — `meiliIndexes` (UIDs
  `catalog_*` imposés par le kit, jamais `tf2_*` : uid, settings,
  loadDocs/table+columns) **ou** `horsIndexJustification` explicite
  (relevés, joins commande, écritures, SKU EAN, fiche GET by id, agrégats).
  Doctor brand-spec `MODULE_MEILI_MISSING` fail-closed (0.10.13+).
  `meiliIndexes.table` doit exister dans **une** migration de l'app
  (même module, autre module, ou historique `fromprd_brand_*`) — sinon
  `MODULE_MEILI_TABLE_UNKNOWN`. Table créée à l'exécution uniquement :
  déclarer `tableProvisionedBy` (pas d'env de bypass). Le
  browse passe par `browseMeiliIndexOutcome` / entity-list Meili ; Meili
  KO = **503 `meili_unavailable`** (ou `engine:"indexing"` pendant
  l'indexation initiale) — **jamais** de LIKE SQL de secours ni
  `if (q) meili else sql`. `searchMeiliIndexes` retourne [] si q vide :
  ne pas l'utiliser pour le browse. Boot : binaire Meili absent avec un
  feed indexé = échec explicite (`CREEZIO_ALLOW_NO_MEILI=1` réservé aux
  tests hors-browse). Gate kit `test-phase-meili-browse`.

## 5. Gates métier

Chaque module a sa gate **colocalisée** `modules/<id>/gate.mjs`, découverte
par `npm run test:modules` (runner `run-module-gates.mjs` — un module sans
gate = échec). Une gate de module prouve : migration appliquée, CRUD via
HTTP, cas métier des hooks, tools MCP répondants. Le stub posé par
`module init` ne vérifie que la structure — l'enrichir
(`npm run test:module -- <id>` pour la lancer seule). La gate kit
`test-phase-module-docs` vérifie en plus le contrat des 5 fichiers spec
(marqueur `moduleGates: colocated` dans `brand.yaml`). Les tests des
fonctions **natives** Creezio restent dans le repo kit — jamais dupliqués
côté marque.

## Périmètre de fichiers (multi-agents)

Un agent module ne modifie que : son dossier spec `modules/<id>/`, son
wiring `modules/<id>.ts`, ses pages UI, sa gate, et **sa ligne** du registre
`modules/index.ts`. Tout fichier partagé = tâche séparée sérialisée.
Branche : `module/<id>/<tache>`. Détails :
[DOC-STANDARD-MODULE.md](../DOC-STANDARD-MODULE.md).

## Checklist finale

- [ ] `prd.md` + `interview.md` remplis (SoT), TODO claimé, CHANGELOG à jour
- [ ] Migration `mod_<id>_00N_<slug>` (id stable) dans `migrations()` du module
- [ ] `EntitySpec` (CRUD auto) ou mount manuscrit **avec `operations[]`**
- [ ] Tools MCP générés depuis les ops (pas de `mcpTools()` parallèle)
- [ ] Nav + permissions `configureAuth`
- [ ] `meiliIndexes` (browse catalogue) **ou** `horsIndexJustification`
- [ ] `assistantSources` (descripteurs typés) **ou** `assistantSourcesJustification`
- [ ] `onboarding` (étapes du parcours produit, optionnel)
- [ ] Pages UI 100 % kit graphique (DOC-STANDARD-UI.md)
- [ ] Gate métier ajoutée au `npm test` marque et verte
- [ ] Pas de glue OS ni fetch maison vers `/api/v1/os/*` / `/api/v1/platform/*`
      dans `ui/app` (contrat AGENTS marque)
