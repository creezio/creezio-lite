# AGENTS — `scripts/`

## Mission

Garantir que le kit reste cohérent : packages présents, frontières kit/marque
sans régression, docs fraîches, publication npm possible. Les journaux d'époque
des phases (`PHASE-*.md`) vivent dans [`../docs/archive/`](../docs/archive/) —
ils décrivent le chantier, pas l'état courant.

## Ne pas faire

- Affaiblir une gate pour faire passer un commit sans corriger la cause.
- Déplacer un gate vers une marque : les gates kit restent ici.
- Hardcoder `/opt/docker/...` sans fallback (voir `scripts/lib/brand-roots.mjs`).
- Générer des artefacts marque depuis ces scripts (sauf dry-run impact).

## Points d’entrée

| Fichier | Usage |
|---------|--------|
| `build-cjs.mjs` | Dual package CJS post-`tsc` |
| `kit-version.mjs` | Bump semver package + CHANGELOG |
| `propagation-impact.mjs` | Impact d’un bump sur marques |
| `generate-files-md.mjs` | Génère/rafraîchit les `docs/FILES.md` (standard `docs/DOC-STANDARD.md`) |
| `lib/brand-roots.mjs` | Résolution chemins brands + kit |
| `lib/intention-twins.mjs` | Scanner jumeaux intention (P0) |
| `lib/assert-runtime-dist.mjs` | Fail-closed dist runtime (contrats + hash de contenu src↔dist) — publish / gate ADR.1b-gen |
| `lib/link-kit-node-modules.mjs` | Lien `node_modules` kit → app générée (gates factory-prd hors ligne, pas de npm install) |
| `lib/propagate-pr-guard.mjs` | Garde anti-doublon PR de bump (`evaluatePropagateGuard` / HTTP 422) — D7 |
| `test-phase-*.mjs` | Gates — une phase / un contrat |

## Ajouter une gate

1. Créer `scripts/test-phase-<nom>.mjs` (`node:test`, asserts stricts).
2. L'insérer dans la ligne `test` du `package.json` racine (SoT unique de la
   liste des gates).
3. C'est tout : `test:kit` / `test:brands` / `test:env` **dérivent
   automatiquement** de cette ligne. Classification (en-tête de
   `test-fast.mjs`) : une gate listée dans `ENV_GATES` → suite `env` (opt-in
   par variable) ; une gate qui importe `lib/brand-roots.mjs` /
   `lib/intention-twins.mjs` ou mentionne `dockerRoot` → suite `brands`
   (skip auto par marque absente) ; sinon → suite `kit` (doit être 100 %
   verte partout).
4. Vérifier : `node --test scripts/test-phase-<nom>.mjs` puis
   `npm run test:kit`.

## Modifier une gate

1. Lire le journal de la phase associée (`PHASE-*.md` dans
   [`../docs/archive/`](../docs/archive/)) et la doc SoT du package.
2. Adapter l’assert **et** le code/doc SoT, pas seulement l’assert.
3. Lancer `node --test scripts/test-phase-<x>.mjs` puis `npm run test:kit`.

## État connu des suites sur ce VPS (135.125.79.113)

- `test:kit` : référence — 100 % verte attendue.
- `test:brands` : skip auto (repos `certivan-app`/`fidu` absents,
  `tempoflow2` sans `crm/vendor/creezio`). Corollaire : un `npm test` brut
  (sans la logique de skip du runner) est **rouge sur C7.2** — préexistant,
  le repo `tempoflow2` local est resté en état pré-cutover ; ne pas
  « corriger » cette gate en l'affaiblissant.
- `test:env` : `factory-prd*` lie le `node_modules` du kit (tsc via
  `electron-shim.d.ts` + `@types/node`, pas de binaire Electron ni npm
  install). `cold-warm` / `factory-docker-parity` / binaires natifs restent
  opt-in lourds (réseau, Docker, embeds).

## Dist runtime stale (fail-closed)

`dist/` est gitignoré. Après modif `packages/*/src` consommée par les apps
(packages publiés) : **`npm run build:packages`** avant toute release ou
`creezio server-docker publish|build`. Sinon package/image sans routes
(vécu Admin Database).

- Gate : `test-phase-runtime-dist-freshness` (`test:kit`) — SoT
  `lib/assert-runtime-dist.mjs` (contrats src↔dist + mtime).
- Aussi appelé par `server-docker publish|build`.
- Bypass urgence uniquement : `CREEZIO_SKIP_RUNTIME_DIST_ASSERT=1`
  (déconseillé).

## Gates et `/tmp` (tmpfs)

Les gates écrivent leurs data dirs sous `/tmp` (tmpfs = RAM). Après un
chantier : nettoyer `/tmp/creezio-*`, `/tmp/tempoflow3-*`, `tf3-*.db`. Pour
les runs lourds (cold-warm ~4 Go), pointer un disque :
`TMPDIR=/opt/docker/tmp npm run test:env`.

Ordres de grandeur sur ce VPS : `build:packages` ~10-15 min, `test:kit`
~15 min, `npm test` TF3 ~20 min, `build:ui` TF3 ~5 min — dimensionner les
timeouts en conséquence.

## Config / chemins

Les gates marques peuvent pointer vers `/opt/docker/<brand>` ou
`/agent/repos/<brand>` via `brand-roots.mjs`. Sur agents cloud, un symlink
`/opt/docker/creezio → repo` est souvent requis pour le CLI `server-docker`.

## Liens

- [README.md](./README.md)
- [docs/FILES.md](./docs/FILES.md)
- [../docs/DOC-STANDARD.md](../docs/DOC-STANDARD.md)
- [../AGENTS.md](../AGENTS.md)
