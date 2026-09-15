# AGENTS — @creezio/search

## Mission du package

Sous-domaine Meili du kit : launcher binaire, feed marque générique,
indexation, schéma d'index versionné, cohérence fail-closed et browse
paginé. Extrait de `@creezio/electron-shell` en P1.b — c'est ici (et plus
jamais dans electron-shell) que vit tout nouveau code recherche.

## Frontières absolues

- **Node pur** : aucun import statique `electron` (gate
  `test-phase-host-no-electron` couvre `packages/search/src/**`).
- **Fail-closed** : dès qu'un feed déclare ≥ 1 index, l'absence de Meili
  est une erreur explicite (`MeiliRequiredError`, 503 `meili_unavailable`),
  jamais un fallback SQL silencieux sur le catalogue. Ne PAS réintroduire
  de `engine:"sql-fallback"` — voir AGENTS racine (section Meili).
- **Pas de vocabulaire marque** (`test-phase-no-brand-vocab`, dette héritée
  ratchetée dans `scripts/no-brand-vocab-allowlist.json`).
- Dépendances : `@creezio/platform-core` (+ `@creezio/observability`).
  Jamais `host-runtime` ni `electron-shell` (sens du graphe :
  `search` ← `host-runtime` ← `electron-shell`).

## Points d'entrée

- `src/index.ts` — barrel public complet (launcher + meili/* + boot marque).
- `src/meili/index.ts` — surface historique du subpath
  `@creezio/electron-shell/meili` (compat via shim côté electron-shell).
- `src/brand-meili-boot.ts` — `maybeBootBrandMeili` (appelé par
  app-runtime : desktop ET harness serveur).

## Contrat `tableProvisionedBy` (index Meili)

Champ optionnel de `BrandMeiliIndexSpec` (`src/meili/feed.ts`) : texte
actionnable expliquant QUI provisionne `table` à l'exécution (import
distant, matérialisation runtime…). Le doctor brand-spec
(`MODULE_MEILI_TABLE_UNKNOWN`) **ne déclenche pas** si ce champ est posé
et non vide. C'est la **seule** échappatoire — pas d'env de bypass.
Cas normal : la table existe dans une migration de l'app (même module,
autre module, ou historique `fromprd_brand_*`).

## Comment modifier sans casser

1. Tout nouveau symbole public s'exporte depuis `src/index.ts` d'ICI. Ne
   jamais le ré-exporter via electron-shell (les shims compat, dont le
   subpath `./meili`, ont été purgés en H12).
2. Le chemin du script de cohérence (`meiliCoherenceScriptPath`) résout
   `kitOsResourcesRoot()` (platform-core) → `resources/scripts` du package
   host-runtime. Ne pas changer sans mettre à jour la résolution ET les
   images Docker.
3. Versionner `INDEX_SCHEMA_VERSION` à chaque changement de schéma d'index
   (déclenche la réindexation par fingerprint).
4. Comportement runtime durci en 0.10.13/0.10.14 — toute modification de
   `decideMeiliReady` / browse passe par les gates
   `test-phase-meili-feed` / `test-phase-meili-browse` / `test-phase-p29`.
   H11 : `createChrCatalogMeiliFeed` et l'alias `sites` → `fournisseurs`
   sont **retirés** (feed inliné factory, `countKey` tel que déclaré).

## Tests / gates liés

```bash
npm run typecheck -w @creezio/search
npm run build -w @creezio/search
node --test scripts/test-phase-meili-feed.mjs scripts/test-phase-meili-browse.mjs
```

Gates : `test-phase-meili-feed`, `test-phase-meili-browse`,
`test-meili-no-brand-legacy`, `test-phase-p29`, `test-phase-n2` (modules),
`test-phase-host-no-electron`, `test-phase-runtime-dist-freshness`.

## Liens

- [README.md](./README.md)
- [docs/FILES.md](./docs/FILES.md)
- [../electron-shell/AGENTS.md](../electron-shell/AGENTS.md) (section Meili historique)
