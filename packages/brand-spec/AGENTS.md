# AGENTS.md — @creezio/brand-spec

## Mission

Contrat déclaratif **BrandSpec** : identité marque + modules + besoins
plateforme (YAML). SoT pour l'agent créateur ; le runtime reste dans
`@creezio/app-runtime` / electron-shell.

## Ne pas faire

- Pas de code métier CHR / SQL TempoFlow ici.
- Pas de launchers OS ou sidecars JSON.
- Pas de questionnaire utilisateur final (domaine marque) dans ce package.

## Politique de seuils DATÉS (P3.a / F4.4c)

Les contrats à seuil (`DEMO_CONTRACT_SINCE` 0.10.1, `OPS_CONTRACT_SINCE`
0.10.6, `MEILI_CONTRACT_SINCE` 0.10.13, `MODULE_CONTRACT_SINCE` 0.16.0) ne
sont **plus des warn éternels**. Mécanique générique (`contractPolicyFor`,
`src/doctor.ts`) — le « kit courant » = la version de CE package (lockstep) :

| Pin marque (`@creezio/platform-core` & co) | Niveau |
|---|---|
| ≥ seuil du contrat | **error** (fail-closed, inchangé) |
| < seuil, retard ≤ 2 versions lockstep minor du kit courant | warn (fenêtre de grâce N-2) |
| < seuil, retard > 2 versions lockstep (ou major plus ancien) | **error** — message `politique N-2`, remède `creezio upgrade` |

Une marque qui ne monte pas de version voit donc ses warns datés devenir
des errors au bout de 2 releases lockstep — le remède est TOUJOURS la
montée outillée (`creezio upgrade`, packages/factory), jamais l'affaiblissement
du doctor. Version kit indéterminable → pas d'escalade aveugle (warn).

## API

- `loadBrandSpec` / `resolveBrandSpecDir`
- `doctorBrandSpec` / `formatDoctorReport` — helpers modules ignorés ;
  démo pauvre = warn ; pin < 0.10.1 : démo absente = warn **dans la
  fenêtre N-2**, error au-delà (politique ci-dessus)
- Contrat ops 0.10.6+ (pin ≥ 0.10.6 = error, sinon politique datée N-2) :
  - `MODULE_OP_MISSING` — `apiMounts` sans `operations[]` non vide
  - `MODULE_OP_UNCATALOGUED` — `extraRoutes` hors `operations[]`
  - `MODULE_OP_MCP_OVERLAP` — `mcpTools()` collision de nom avec une op
  - `MODULE_MCP_TOOLS_DEPRECATED` — `mcpTools()` restant **sans** collision
    (**error** depuis 0.10.8 — `mcpTools` n'existe plus, SoT = `operations[]`)
- Contrat de module importé du kit P2.c / H9 (pin ≥ 0.16.0 = error, sinon
  politique datée N-2 — ADR `docs/adr/ADR-p2c-module-contract.md`) :
  - `MODULE_TYPES_DIVERGENT` — `modules/types.ts` redéclare localement
    `BrandModuleDef`/`BrandNavItem`/`BrandMeiliIndex` (attendu : ré-export
    `@creezio/app-runtime`, codemod `scripts/codemods/H9/`)
  - `MODULE_PERMISSION_MISSING` — apiMount manuscrit sans `permission` ni
    `accessJustification` (règle d'or n°7, audit F3.4)
  - `MODULE_PERMISSION_UNQUALIFIED` — **warn** : `accessJustification:
    "à qualifier"` (dette posée par le codemod H9, jamais une permission
    inventée)
  - `MODULE_ASSISTANT_SOURCES_MISSING` — **warn** (volet 2 F3.4, jamais
    fail-closed) : module avec `apiMounts` / `entitySpecs` sans
    `assistantSources` ni `assistantSourcesJustification`
- Checks manifests `@creezio/*` (**error** immédiate, sans gating par pin —
  un manifest cassé est un bug runtime/build quel que soit l'âge de la
  marque) :
  - `CREEZIO_MANIFEST_MISALIGNED` — une dep `@creezio/*` présente dans ≥ 2
    manifests avec des specs divergentes (règle d'or du bump, incident
    login 0.6.0)
  - `OS_UI_PAGE_DEP_MISSING` — un package `@creezio/*` importé par une page
    os-ui (matérialisée sous `server/ui/app/(creezio-os)/` ou embarquée dans
    le `@creezio/os-ui` installé) est absent de `server/ui/package.json`
    (incident prod 0.20.0 : /granola + /grokbot matérialisés sans les deps).
    Remède : `creezio upgrade` (sync SoT kit), jamais un retrait de page.
    Ni pages matérialisées ni os-ui installé → `OS_UI_DEPS_UNCHECKED`
    (**info**, skip explicite).
- Cohérence `meiliIndexes.table` ↔ migrations (T6, toujours **error**,
  pas de pin / pas d'env de bypass) :
  - `MODULE_MEILI_TABLE_UNKNOWN` — table d'un index introuvable dans le
    plan de données **cross-module** (tous `modules/*.ts` + historiques
    `fromprd_brand_*` / `brand-migrations.ts`). Un check *par module*
    est interdit (faux positifs). Parse `CREATE TABLE` : `IF NOT EXISTS`,
    quotes (`"`, backticks, `[]`), identifiant nu. Échappatoire déclarative uniquement :
    `tableProvisionedBy` sur la spec d'index (`@creezio/search`) si la
    table est provisionnée à l'exécution.
- `initBrandSpec`
- `resolveOnboardingDecl` / `toSetupWizardConfig`

## Tests

```bash
npm run build -w @creezio/brand-spec
node --test scripts/test-phase-brand-spec.mjs
```
