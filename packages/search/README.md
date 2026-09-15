# @creezio/search

Sous-domaine **recherche Meili** du kit Creezio, extrait de
`@creezio/electron-shell` en P1.b (déménagement pur, zéro changement de
comportement runtime).

## Contenu

- `src/meili-launcher.ts` — démarrage du binaire Meili (`startMeili`),
  master key, healthcheck.
- `src/meili/` — le sous-domaine complet :
  - `feed.ts` — feed marque générique (`BrandMeiliFeed`,
    `BrandMeiliIndexSpec` + `tableProvisionedBy`,
    `configureMeiliBrandFeed`, `GENERIC_CATALOG_INDEXES`) ;
  - `generic-indexer.ts` — indexation pilotée par le feed
    (`runFeedIndexation`, `searchMeiliIndexes`) ;
  - `index-schema.ts` — schéma d'index versionné, fingerprint, tables SQL
    (`fingerprintCountKey` = identité depuis H11, plus d'alias
    `sites` → `fournisseurs`) ;
  - `indexer.ts` — indexation historique (`runIndexation`) ;
  - `coherence.ts` / `coherence-db.ts` / `coherence-query.ts` — décision
    fail-closed `decideMeiliReady` (0.10.13/0.10.14) ;
  - `browse.ts` — browse paginé (`browseMeiliIndex`,
    `browseMeiliIndexOutcome`, `meiliFilterEq`).
- `src/brand-meili-boot.ts` — boot Meili marque (`maybeBootBrandMeili`) :
  Meili est un composant CORE fail-closed dès qu'un feed déclare ≥ 1 index
  (`MeiliRequiredError`, jamais de fallback SQL silencieux).

## Frontières

- Node pur — jamais d'import Electron (gate `test-phase-host-no-electron`).
- Aucun vocabulaire marque (gate `test-phase-no-brand-vocab`).
- H11 : plus de `createChrCatalogMeiliFeed` — le feed CHR est inliné
  par la factory dans le repo marque.
- Dépend uniquement de `@creezio/platform-core` et `@creezio/observability`.
- `@creezio/host-runtime` et `@creezio/electron-shell` dépendent de ce
  package (jamais l'inverse).

## Compat

H12 (0.24.0) : les ré-exports de compat d'electron-shell (barrel + subpath
`./meili`) ont été supprimés — ce package est l'UNIQUE point d'import du
sous-domaine Meili. Migration marques : codemod `scripts/codemods/H12/`
(`creezio upgrade`).

## Liens

- [AGENTS.md](./AGENTS.md)
- [docs/FILES.md](./docs/FILES.md)
