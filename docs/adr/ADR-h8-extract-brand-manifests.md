# ADR — H8 : extraction des manifests marque du kit (P1.d)

Statut : accepté (P1.d). Bump `ARCHITECTURE_VERSION` H7 → **H8**
(`packages/platform-core/src/architecture-version.ts`) — codemods
`scripts/codemods/H8/`.

## Contexte

`docs/PROPAGATION.md` pose le principe : **le kit ne connaît pas ses
consommateurs** — pas de registre des apps, pas de test des apps dans la CI
kit. Ce principe était contredit par `@creezio/brand-config`, qui publiait
les manifests concrets de ses marques
(`packages/brand-config/src/manifests/{tempoflow,tempoflow3,certivan,fidu}.ts`),
les exportait publiquement (`tempoflowManifest`…) et les enregistrait dans un
registre typé (`manifests` / `getManifest` / `listBrandIds`). L'audit F1.4
couvrait cette dette par une exclusion globale de la gate
`test-phase-no-brand-vocab` (161 occurrences de vocabulaire marque).

Le chemin nominal existe déjà : la factory génère le manifest **dans le repo
de la marque** (`src/electron/app-manifest.ts` + `.json`) et
`resolveManifest` (brand-config) sait résoudre une marque hors registre via
ce JSON (`appRoot`).

## Décision

1. **`tempoflow3` sort du kit** : `manifests/tempoflow3.ts` est supprimé —
   le repo marque (déjà porteur de `server/src/electron/app-manifest.{ts,json}`
   et `client/src/electron/app-manifest.{ts,json}`) est l'unique SoT. Les
   consommateurs passent par le fallback disque de `resolveManifest` / le
   JSON local des scripts `build-builder-config.mjs`.
2. **`demobrand` reste** : sandbox kit assumée (`apps/demobrand`).
3. **`tempoflow` (TF2), `certivan`, `fidu` restent UNE version, dépréciés**
   (`@deprecated (P1.d — à matérialiser dans le repo marque via le codemod
   H8)`) : leurs repos ne sont pas accessibles depuis cette migration (serveurs
   prod ailleurs) — retrait au prochain bump d'architecture, après passage du
   codemod H8 dans chaque repo.
4. **Factory** : `renderBuildBuilderConfigMjs` génère désormais « manifest
   local d'abord » (`src/electron/app-manifest.json`), registre kit en
   fallback déprécié avec warning.
5. **Gate renforcée** : l'exclusion globale `brand-config/src/manifests/`
   de `test-phase-no-brand-vocab` est remplacée par des entrées d'allowlist
   exactes (fichier × pattern × compteur) pour les 3 manifests dépréciés,
   et un nouveau test NV4 rend ROUGE tout nouveau fichier
   `manifests/<marque>.ts` hors `demobrand.ts`.

## Politique de dépréciation (une version)

- exports `tempoflowManifest` / `certivanManifest` / `fiduManifest` et leurs
  entrées de registre : conservés une version, `@deprecated` ;
- fallback « registre kit » des `build-builder-config.mjs` générés :
  conservé une version, warning `[deprecated]` bruyant ;
- retrait planifié au **prochain bump** d'architecture (H9), une fois les
  repos TF2/Certivan/Fidu migrés via le codemod H8.

## Migration marque

`scripts/codemods/H8/h8-materialize-brand-manifest.mjs` (idempotent,
`ROOT=<clone marque> node …`) :

1. bascule les `scripts/build-builder-config.mjs` générés par la factory de
   « registre kit d'abord » vers « manifest local d'abord » ;
2. matérialise `src/electron/app-manifest.json` depuis le registre kit
   déprécié installé (`node_modules/@creezio/brand-config`) quand le repo a
   un `app-manifest.ts` sans `.json` (best-effort, no-op sinon).

Gate d'accompagnement : `test-phase-arch-codemod`.

## Comportements inchangés

- `resolveManifest`, `createAppManifest`, `validateAppManifest`, tous les
  types (`AppManifest`…) et helpers purs restent publics — seul le contenu
  marque sort du kit.
- Identités desktop (GUID NSIS, feeds, `userDataSegment`) : aucune valeur ne
  change — les fichiers déménagent, les octets restent.
