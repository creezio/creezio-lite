# ADR P2.c — `BrandModuleDef` : contrat de module importé du kit (H9)

- **Statut** : accepté (P2.c, 2026-08).
- **Contexte audit** : F3.4 — le contrat central de module (`BrandModuleDef` :
  entitySpecs, apiMounts + operations, navItems, meiliIndexes, demo,
  migrations, horsIndexJustification) était une template string factory
  (`MODULES_TYPES_TS`) matérialisée en copie owned-by-brand
  (`modules/types.ts`) chez chaque marque. Conséquences observées : l'OS ne
  pouvait pas faire évoluer son propre contrat par release npm, et une
  marque pouvait le muter localement sans que rien ne rougisse — constat
  réel : le `types.ts` de `tempoflow-admin` avait perdu
  `horsIndexJustification` et tous les commentaires de contrat.

## Décision

1. **SoT du contrat = `@creezio/app-runtime`** (`src/module-contract.ts`) :
   `BrandModuleDef`, `BrandNavItem`, `BrandMeiliIndex` +
   `createBrandModuleRegistry(modules)` (collecteurs génériques
   `collectEntitySpecs` / `collectApiMounts` / `collectNavItems` /
   `collectMcpTools` / `collectMeiliIndexes` / `collectModuleMigrations` /
   `collectDemoScenarios`, mêmes signatures que les fonctions
   historiquement générées dans le `modules/index.ts` marque).

   **Pourquoi app-runtime et pas un package dédié** (`@creezio/module-contract`) :
   - le type agrège des types de `api-kernel`, `platform-core`,
     `electron-shell/meili`, `shell-ui`, `interactive-demo` — il doit se
     construire APRÈS `electron-shell`, exactement la position
     d'`app-runtime` dans l'ordre de build (gate
     `test-phase-build-order-imports` verte : imports runtime des
     collecteurs vers `mcp-facade` / `interactive-demo`, tous deux plus
     tôt dans l'ordre) ;
   - les deux repos marque (monorepo + admin) dépendent déjà
     d'`app-runtime` (façade `startBrandDesktop`) — zéro nouvelle dep ;
   - `app-runtime` est déjà la maison de l'enforcement d'accès des mounts
     (`module-mount-auth`, hook `authorizeModuleAccess`) — le contrat et
     sa garde vivent ensemble ;
   - le doctor brand-spec et les gates restent **textuels** (regex sur les
     sources marque) : ils n'importent pas le type, donc aucun besoin d'un
     petit package bas dans le graphe.

2. **La factory ne génère plus de copie** : `modules/types.ts` devient un
   **ré-export** (`export type { BrandModuleDef, … } from
   "@creezio/app-runtime"`) — forme conservée (plutôt que suppression du
   fichier) pour préserver tous les imports existants `./types.js` des
   modules marque. `modules/index.ts` généré ne porte plus que
   `BRAND_MODULES` + la délégation `createBrandModuleRegistry`.

3. **Doctor fail-closed** (`@creezio/brand-spec`, seuil pin 0.16.0 — même
   mécanique que `MODULE_MEILI_MISSING` : error pour pin ≥ 0.16.0, warn en
   dessous) :
   - `MODULE_TYPES_DIVERGENT` — `modules/types.ts` qui redéclare
     localement le contrat (ou ne ré-exporte pas le kit) ;
   - `MODULE_PERMISSION_MISSING` — règle d'or n°7 (audit F3.4) : chaque
     apiMount manuscrit déclare `permission` (garde `authorizeModuleAccess`)
     OU `accessJustification` explicite (route publique/machine assumée).
     Nouveau champ `ApiMount.accessJustification` (api-kernel) ;
     `EntitySpec.permission` / `.accessJustification` sont threadés sur le
     mount CRUD généré. `accessJustification: "à qualifier"` (dette posée
     par le codemod H9) = warn `MODULE_PERMISSION_UNQUALIFIED` — on
     n'invente jamais une permission.

4. **H9 + codemod** : `ARCHITECTURE_VERSION` H8 → H9 ;
   `scripts/codemods/H9/h9-import-module-contract.mjs` (idempotent,
   fail-closed sur divergence réelle : un champ/type local inconnu du
   contrat kit = exit 1, marque intacte — jamais d'écrasement silencieux).

## Périmètre reporté (tickets BACKLOG)

- ~~**Sources assistant + contenu onboarding dans le descripteur**~~
  **fait (T5)** : champs additifs `assistantSources` /
  `assistantSourcesJustification` / `onboarding` — collecteurs registre +
  consommation `@creezio/assistant` / `@creezio/onboarding`. Pas de bump
  `ARCHITECTURE_VERSION` (champs optionnels, marques existantes intactes).
- ~~**Cohérence `meiliIndexes.table` ↔ migrations**~~ **fait** : doctor
  `MODULE_MEILI_TABLE_UNKNOWN`, résolution cross-module (tous modules +
  `fromprd_brand_*`), échappatoire `tableProvisionedBy`.
- **Retrait `legacy-brand-compat`** (candidat H9 noté en P2.a) : le
  périmètre est gelé fail-closed par hash
  (`test-phase-legacy-desktop-frozen`) et le retrait exige un codemod de
  migration des clients legacy — non trivial, reporté à **H10**.
