# Standard module — unité de travail autonome

Contrat pour tout **module** d'une app Creezio : un module = un périmètre
métier autonome qu'un agent peut spécifier, implémenter, tester et livrer
**sans toucher aux fichiers des autres modules**. Complément du
[DOC-STANDARD.md](./DOC-STANDARD.md) (docs de packages) et du
[DOC-STANDARD-UI.md](./DOC-STANDARD-UI.md) (kit graphique imposé).

Vérifié par la gate `scripts/test-phase-module-docs.mjs` (kit `npm test`,
suite brands pour la partie repos marque).

## Conventions OS non négociables

Une spec de module (`interview.md`, `prd.md`) ne peut **jamais** contredire
les conventions dures du kit ci-dessous — un agent de dev qui rencontre une
contradiction doit corriger la spec, pas arbitrer. Toutes sont prouvables
dans le code du kit :

- **Home = page réelle à `/dashboard`.** Le workspace kit canonise tout
  href `/` → `/dashboard` (`normalizeHref` / `DASHBOARD_PATH` dans
  `packages/shell-ui/ui/workspace/types.ts`, `targetHref` dans
  `tab-workspace-context.tsx`, dupliqué dans
  `src/lib/keepalive-eviction.ts`) et l'onglet de base (épinglé, non
  fermable) est créé sur `/dashboard`. Une interview qui propose
  « accueil à `/` » est **invalide**.
- **`/` (`app/page.tsx`) = pure redirection vers `/dashboard`**, générée par
  la factory (`renderNextHomePage`) — jamais de contenu. La home
  s'implémente dans `app/dashboard/page.tsx`.
- **Entrée de nav « accueil » → `href: "/dashboard"`**, jamais `href: "/"`.
- **Routes réservées OS** : les routes matérialisées par `@creezio/os-ui`
  (`/login`, `/setup`, `/onboarding`, `/taches`, `/mails`, `/parametres`,
  `/collaborateurs`, `/configuration`, `/support`, `/settings`,
  `/developers`, `/cockpit`, `/server-cockpit`, `/mcp`, `/admin/*`)
  appartiennent à l'OS. Une page métier homonyme prime au materialize
  (override volontaire, ex. `/parametres` TF) — mais un module ne les
  revendique pas par défaut.
- **`/site/*` réservé** aux onglets de sites externes (Hermes, n8n…) —
  panes fullscreen jamais évincées (`isExternalSiteHref`,
  `keep-alive.tsx`). Aucun module ne déclare de route `/site/...`.
- **Permission d'entrée nav** : champ `permission` filtré sur
  `me.permissions` (ex. `nav.panier` ; `/admin/access` exige
  `platform.access.manage`). Absente = visible par tous
  (`ui/layout/sidebar-host.ts`).
- **Chemins fullscreen marque** : uniquement via `configureFullscreenPaths`
  (défauts vides côté kit) — pas d'autre mécanisme.

## Où vivent les specs de module

| Type de module | Dossier spec |
|---|---|
| Module server d'une marque | `<brand>/brand-spec/modules/<id>/` |
| Module admin natif kit | `packages/admin/modules/<id>/` |
| Module propre au repo `<brand>-admin` | `<brand>-admin/admin-spec/modules/<id>/` |

`modules/_template/` est réservé aux templates (ignoré par la gate).

## Les 5 fichiers obligatoires

Chaque `modules/<id>/` porte exactement ces 5 fichiers :

| Fichier | Rôle | Niveau d'exigence |
|---|---|---|
| `prd.md` | vision + spec produit | un agent qui n'a jamais vu l'app doit pouvoir **recréer exactement le module** à partir de `prd.md` + `interview.md` |
| `interview.md` | questionnaire d'architecture **rempli** — SoT des décisions | toute décision structurante (table, endpoint, composant UI, tool MCP) y est tracée avec sa justification |
| `TODO.md` | milestones + tâches cochables | format normé ci-dessous (parsé par la gate) |
| `CHANGELOG.md` | une entrée datée par livraison | ID de tâche + gate qui prouve |
| `gate.mjs` | **gate du module, colocalisée** — le test métier vit avec la spec | prouve les critères du prd (migration, CRUD HTTP, hooks, tools MCP) ; découverte auto par `server/scripts/run-module-gates.mjs` (`npm run test:modules`) — un module sans gate fait échouer `npm test` |

### `gate.mjs` — gate colocalisée (tests métier)

- **Séparation native / métier** : les tests des fonctions **natives** Creezio
  vivent dans le repo kit (`scripts/test-phase-*.mjs`, CI kit) et ne sont
  JAMAIS dupliqués côté marque. La `gate.mjs` d'un module ne teste que le
  **métier** du module ; la marque ajoute des gates transversales
  d'**intégration** (deps-integrity, parcours, e1-smoke) dans
  `server/scripts/`.
- Découverte : `server/scripts/run-module-gates.mjs` énumère
  `<spec-root>/modules/*/gate.mjs` (hors `_template`) — un module sans
  `gate.mjs` = échec du runner. `npm run test:module -- <id>` pour une seule.
- Chemins : la gate résout la racine depuis son propre emplacement
  (`appDir = ../../..`, `serverDir = appDir/server` si présent) — jamais
  depuis `cwd`.
- Adoption : marqueur `moduleGates: colocated` dans `brand.yaml` /
  `admin.yaml` (scaffoldé d'office pour les nouvelles marques) — la gate kit
  `module-docs` exige alors `gate.mjs` dans chaque module. Marques
  historiques : migrer les `scripts/test-module-<id>.mjs` puis poser le
  marqueur.

### `prd.md` — sections normalisées

```markdown
# Module <id> — <titre>

## Vision
## Utilisateurs & parcours
## Capacités (fonctionnel)
## Modèle de données          ← schémas complets : colonnes, types, contraintes, défauts
## API                        ← endpoints exhaustifs : méthode, chemin, params, comportement
## UI                         ← pages, composants du kit graphique utilisés
## Tools MCP                  ← ops du module → tools générés (pas mcpTools parallèle)
## Logique métier non triviale ← formules, scores, algorithmes décrits en clair
## Seeds & données initiales
## Cas limites & règles de gestion
## Hors périmètre
```

Une section sans objet reste présente avec « Aucun ». Les schémas de tables
sont donnés en SQL (copie de la migration) ou tableau colonne/type/contrainte.

### `interview.md` — questionnaire d'architecture

Questionnaire **rempli** (pas un formulaire vide). Sections :

```markdown
# Interview module <id>

## Conventions OS non négociables
   Rappel des conventions dures du kit (section éponyme de ce standard) —
   l'interview ne peut pas les contredire : home = /dashboard, "/" = pure
   redirection, nav accueil → /dashboard, routes OS + /site/* réservées.

## 1. Identité & pages
   id, titre, routes UI (jamais "/" — home = /dashboard), entrée(s) de nav,
   permission nav.

## 2. Données & migrations
   Tables (schéma complet), index, FK logiques.
   IDs de migration : `mod_<module>_00N_<slug>` — JAMAIS renuméroter/renommer
   une migration appliquée, quel que soit son préfixe (`fromprd_brand_0XX`
   compris).
   Migrations cross-module interdites : une migration ne touche que les
   tables du module ; une colonne sur la table d'un autre module = tâche
   dans le module propriétaire.
   **Provenance des données (ADR-single-data-plane)** : chaque table déclare
   d'où viennent ses lignes — natives (écrites par le module) ou alimentées
   par projection d'un flux externe (et par quel module d'import). Le métier
   vit dans `brand.db` UNIQUEMENT : écrans, API et tools MCP ne lisent
   jamais un snapshot/flux source directement (gate
   `single-data-plane`).

## 3. API
   EntitySpec `createEntityApiMount` (CRUD auto = ops list/get/create/update/delete)
   vs mount manuscrit : **chaque `apiMount` déclare `operations[]`** (1 capacité
   = 1 op). extraRoutes doivent figurer dans `operations`. Pas de registre
   global d'app. Démo interactive (**obligatoire**, ≥ 1 scénario valide) : champ
   `demo: { scenarios: DemoScenario[] }` du `BrandModuleDef` — scénarios du
   tour produit du module, agrégés par `collectDemoScenarios()` (registre
   `modules/index.ts`) en défauts du mount `interactive-demo` (validation +
   dédup par id : `collectInteractiveDemoDefaults` de
   `@creezio/interactive-demo`). Inclure `genericOsTourScenario({ productName })`
   (id `os-tour` partagé). Une app Creezio sans démo interactive est invalide.

## 4. UI, nav & permissions — kit graphique imposé
   Chaque page déclarée liste les composants du kit qu'elle utilise
   (voir DOC-STANDARD-UI.md). Pas de style ad hoc, pas de lib UI tierce.

## 5. Tools MCP & policies
   Tools **générés** `module.<mountId>.<op.id>` depuis les ops du module.
   `mcpTools` n'existe plus. SoT = `operations[]` → tools générés. Un champ
   `mcpTools()` restant = doctor error `MODULE_MCP_TOOLS_DEPRECATED` (fail-closed) ;
   collision de nom = `MODULE_OP_MCP_OVERLAP`.
   Enable/disable et rôles = policies `/admin/mcp` sur les tools générés
   (`mcpPublishDefault`, `roles` sur l'op).

## 6. Rôles & permissions

## 7. Meili / n8n / plugins
   Index Meili alimentés, workflows n8n, interactions plugins.

## 8. Seeds & onboarding

## 9. Gates de validation
   La (les) gate(s) qui prouvent le module, et ce qu'elles vérifient.

## 10. i18n
   Langue des libellés, conventions.
```

### `TODO.md` — format normé (parsé par la gate)

```markdown
# TODO — <module>

## Milestone M1 — <titre>            ← optionnel

### [todo] <MOD>-1 — <titre de tâche>
- priorite: P1
- depends: aucune
- fichiers: server/src/electron/modules/<id>.ts, server/ui/app/<route>/
- criteres:
  - [ ] <critère d'acceptation cochable>
  - [ ] gate <nom> verte
```

Règles :

- En-tête de tâche : `### [<statut>] <ID> — <titre>` ; statuts valides :
  `todo` | `in-progress` | `blocked` | `done`.
- **Convention de claim (verrou par conflit git)** : un agent qui prend une
  tâche passe `[todo]` → `[in-progress]` et ajoute
  `- claim: <identifiant-agent> <YYYY-MM-DD>` **dans le même commit que sa
  première modification de code**. Deux agents qui claiment la même tâche =
  conflit git → le second reroute.
- `[in-progress]` et `[blocked]` exigent une ligne `claim:` datée.
- `[done]` exige une ligne `done: <YYYY-MM-DD>` et une entrée `CHANGELOG.md`.

### `CHANGELOG.md`

```markdown
# CHANGELOG — <module>

## 2026-08-06 — <MOD>-1 — <titre>
- gate: npm run test:<gate> (verte)
- <ce qui a été livré, en 1-3 lignes>
```

Une entrée par livraison (merge sur `main`), la plus récente en haut.

## Périmètre de fichiers par agent

Un agent travaillant sur le module `<id>` ne modifie que :

1. son dossier spec `modules/<id>/` (les 5 fichiers, gate comprise) ;
2. son fichier de wiring `server/src/electron/modules/<id>.ts` ;
3. ses pages UI (`server/ui/app/<routes du module>/`) et ses composants
   dédiés (`server/ui/components/<id>/`) ;
4. **une seule ligne** dans le registre `modules/index.ts` (son import) —
   et **seulement** si le module n'est pas déjà pré-enregistré.

**Dépendance de contrat ≠ attente de merge.** Un module développe contre
les services publics amont (signatures figées dans l'interview / un fichier
contrats) avec seed/mock dans sa gate. Le branchement réel du hook
appartient au module **émetteur**, dans une PR d'intégration **après**
merge des deux côtés. Absence gracieuse (`try/catch`) tant que l'amont
n'est pas là.

**Déclarer `permission: "nav.<id>"` sur chaque `navItem`.** Les collecteurs
`collectNavPermissions()` / `collectPermissionGroups()` alimentent
`configureAuth` et `/admin/access` via `applyBrandModuleAuth` au boot
(factory `brand-platform-bindings`). Interdit d'éditer un catalogue nav
global (`nav-permissions.ts`, `ownerPermissions: [...]` en dur, groupes
d'accès manuscrits, BrandChrome / icônes). Owner API + sidebar bypassent
déjà ; collab et matrice suivent le registre au boot. Interdit
`accessJustification: "à qualifier"` sur un module neuf — qualifier
(`permission`) ou justifier la route publique.

Tout fichier partagé (registre au-delà de sa ligne, `brand-migrations.ts`,
`package.json`, chrome UI, `tool-registry.ts`…) = **tâche séparée
sérialisée** (une PR dédiée, jamais mélangée au flux module).

## Workflow

- Branche : `module/<id>/<tache>` (ex. `module/promotions/PROMO-3`).
- PR vers `main` ; la gate du module + la gate `module-docs` prouvent.
- Nouvelle marque / nouveau module : `creezio brand module init <id>`
  scaffolde les 5 fichiers (gate.mjs colocalisée comprise) + wiring +
  runner `run-module-gates.mjs`
  (voir [docs/agents/CREATE-MODULE.md](./agents/CREATE-MODULE.md)).
