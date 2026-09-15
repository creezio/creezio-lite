# AGENTS.md — @creezio/desktop-tooling

## Mission

Maintenir les outils desktop generiques de publication, build distant Windows, resolution de config et statut build pour toutes les marques Creezio.

## Ne pas faire

- Ne pas hardcoder un feed ou un dossier DL d'une marque dans le code generique.
- Ne pas publier sans verifier `latest.yml`, version et path.
- Ne pas synchroniser secrets, `.env.local`, `.git`, node_modules ou artefacts inutiles vers le remote build.
- Ne pas transformer un dry-run en action destructive.
- `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs desktop-tooling` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.

## Points d'entrée

- `src/resolve-publish-config.ts` : source de verite config publish/remote.
- `src/desktop-build-status.ts` : agregateur status.
- `src/fetch-feed.ts` et `src/parse-latest-yml.ts` : lecture feeds.
- `scripts/publish-desktop.sh` : publication feed.
- `scripts/remote-build-win.sh` : build distant Windows.
- `scripts/resolve-config.mjs` et `scripts/desktop-build-status.mjs` : wrappers CLI.
- `scripts/e2e-browser-parcours.mjs` : E2E navigateur generique (harness +
  UI plane + parcours API) — les assertions « cree puis liste » passent par
  `scripts/meili-list-poll.mjs` (coherence eventuelle Meili : `?ids=`
  deterministe + polling borne, echec explicite si `engine:"meili"` sans le
  doc). `MEILI_SKIP_INDEX` vaut `"0"` par defaut ici (l'indexation doit
  tourner pour que la visibilite liste soit testable).
- `scripts/meili-list-poll.mjs` : helper SoT des smokes kit/marques —
  `assertModuleRowHydratedById` / `pollModuleListUntilVisible`. Importe
  aussi par les smokes generes factory (subpath `./scripts/*`). Gate :
  `scripts/test-phase-meili-smoke-polling.mjs`.

## Modifier sans casser

- Toute nouvelle config doit venir de `AppManifest` ou d'env override documente.
- Garder `toShellExports` escapant correctement les valeurs shell.
- Les scripts bash doivent rester `set -euo pipefail`.
- Maintenir `--dry-run`, `--skip-sync`, `--no-build`, `--client-only` et `--publish`.
- Ne pas utiliser `latest.yml` public comme source de verite sans verifier l'artefact local.

## Config brand

Les marques configurent :

- `manifest.publish.defaultAppRoot`
- `dockerDlName`, `hostDlDirDefault`, `npmContainer`
- `remoteBuildHost`, `remoteBuildRoot`, `remoteBinSrc`
- `statusFile`, `remoteLogPrefix`
- feeds client/serveur et aliases.

Les env `{ENV_PREFIX}_*` doivent toujours surcharger les defauts manifest quand le code le permet.

## Tests/gates

Avant validation :

```bash
npm run typecheck -w @creezio/desktop-tooling
npm run build -w @creezio/desktop-tooling
```

Smoke non destructif recommande :

```bash
node packages/desktop-tooling/scripts/resolve-config.mjs --brand=fidu --kind=client --pretty
node packages/desktop-tooling/scripts/desktop-build-status.mjs --brand=fidu --json
bash packages/desktop-tooling/scripts/publish-desktop.sh --brand=fidu --dry-run
bash packages/desktop-tooling/scripts/remote-build-win.sh --brand=fidu --dry-run
```

## Fichiers sensibles

- `scripts/publish-desktop.sh` : ecrit le feed public.
- `scripts/remote-build-win.sh` : SSH/rsync/build distant.
- `src/resolve-publish-config.ts` : chemins et env de toutes les marques.
- `src/desktop-build-status.ts` : detection processus/logs/remote.

## Liens

- `README.md`
- `docs/FILES.md`
- `packages/brand-config/README.md` si present
