# @creezio/desktop-tooling

## Rôle

`@creezio/desktop-tooling` regroupe le tooling desktop generique Creezio : resolution de configuration publish, publication des feeds electron-updater, build Windows distant et statut de build.

## Périmètre

Inclus :

- resolution multi-marque via `AppManifest` ;
- scripts binaires `publish-desktop`, `remote-build-win`, `desktop-build-status`, `resolve-config` ;
- parsing `latest.yml` ;
- lecture des feeds client/serveur ;
- agregat de statut local, remote, logs, artefacts et feed ;
- smokes/embarques generiques (`scripts/e2e-browser-parcours.mjs`,
  `scripts/smoke-tunnel*.mjs`) et helper `scripts/meili-list-poll.mjs`
  (assertions « cree puis liste » compatibles coherence eventuelle Meili).

Hors perimetre :

- boot Electron runtime (`@creezio/electron-shell`) ;
- creation d'une nouvelle app (`@creezio/factory`) ;
- modification directe des manifests marque.

## Installation/build

```bash
npm install
npm run build -w @creezio/desktop-tooling
npm run typecheck -w @creezio/desktop-tooling
```

Binaires publies :

- `creezio-resolve-publish-config`
- `creezio-desktop-build-status`
- `creezio-publish-desktop`
- `creezio-remote-build-win`

## Configuration

La marque est choisie par `--brand` ou `CREEZIO_BRAND`. Le kind vaut `client` par defaut ou `server`.

Variables principales :

- `CREEZIO_BRAND`
- `CREEZIO_KIND`
- `CREEZIO_APP_ROOT`
- `VERSION`
- `CREEZIO_DL_DIR` ou `{ENV_PREFIX}_DL_DIR`
- `CREEZIO_REMOTE_BUILD_HOST` ou `{ENV_PREFIX}_REMOTE_BUILD_HOST`
- `CREEZIO_REMOTE_BUILD_ROOT` ou `{ENV_PREFIX}_REMOTE_BUILD_ROOT`
- `CREEZIO_BUILD_STATUS_FILE` ou `{ENV_PREFIX}_BUILD_STATUS_FILE`

`resolvePublishConfig` lit `@creezio/brand-config` et produit les chemins dist, feed, aliases, remote host/root, noms d'artefacts et commandes npm suggerees.

## API publique + exemples

Exports principaux :

- `resolvePublishConfig`, `toShellExports`, `parseBrandArg`, `parseKindArg` ;
- `parseLatestYml` ;
- `fetchFeedSnapshot`, `fetchBrandFeeds`, `fetchAllBrandFeeds` ;
- `collectDesktopBuildStatus`, `collectDesktopBuildStatusFromArgv`.

Exemple Node :

```ts
import {
  collectDesktopBuildStatus,
  resolvePublishConfig,
} from "@creezio/desktop-tooling";

const cfg = resolvePublishConfig({
  brandId: "fidu",
  kind: "client",
  appRoot: "<racine-fidu>/crm",
});

const status = collectDesktopBuildStatus({
  brandId: "fidu",
  appRoot: cfg.appRoot,
  remote: true,
});
```

Exemples CLI :

```bash
creezio-resolve-publish-config --brand=fidu --kind=client --pretty
eval "$(creezio-resolve-publish-config --brand=certivan --export-shell)"

creezio-desktop-build-status --brand=tempoflow --pretty --remote
creezio-publish-desktop --brand=fidu --kind=client --dry-run
creezio-remote-build-win --brand=certivan --publish
```

## Flux

### Publish

1. `resolve-config.mjs` calcule dist, nom d'exe, feed et dossier de destination.
2. `publish-desktop.sh` verifie l'exe et `latest.yml`.
3. Il copie exe, sha256, alias latest, blockmap optionnel et `index.html`.
4. `latest.yml` est copie en dernier.
5. Le script verifie HTTP index, `latest.yml`, version, path et exe.

### Remote build

1. Smoke SSH BatchMode vers l'hote remote.
2. Preparation du workdir et des binaires Windows.
3. `rsync` du code en excluant artefacts, node_modules, secrets et binaires locaux.
4. Build Next/Electron Windows distant.
5. Pull des artefacts vers `dist-electron`.
6. Publication optionnelle avec `--publish`.
7. Ecriture du status JSON dans `/tmp` et `dist-electron/build-status.json`.

### Build status

`collectDesktopBuildStatus` combine package version, artefacts locaux, `latest.yml`, feed public, logs `/tmp`, processus locaux et option `--remote`.

### Smokes et coherence eventuelle Meili

`scripts/e2e-browser-parcours.mjs` (consomme par les marques via un wrapper
genere) asserte « cree puis liste » sur l'entite primaire configuree. Contrat
kit delibere : pas de write-through — la liste d'une entite indexee repond
`engine:"indexing"` + 0 item pendant l'indexation initiale et le client
reessaie. Le script utilise `scripts/meili-list-poll.mjs` :

1. `assertModuleRowHydratedById` — read-after-write deterministe via
   `GET ?ids=<id>` (hydratation PK = chemin SQL legitime, jamais Meili) ;
2. `pollModuleListUntilVisible` — polling borne (60 s / 250 ms) jusqu'a
   visibilite dans la liste ; echec explicite immediat si `engine:"meili"`
   (index fige) sans le doc, echec borne explicite sinon.

L'indexation doit tourner pour que la visibilite liste soit testable :
`MEILI_SKIP_INDEX` vaut desormais `"0"` par defaut dans l'e2e (opt-out
possible pour une entite primaire volontairement hors index). Les smokes
generes par la factory (`test:metier-parcours`, `test:mini-prd-core`)
importent le meme helper. Gate : `scripts/test-phase-meili-smoke-polling.mjs`.

## Intégration marques

Les marques configurent leurs champs publish dans `AppManifest` via `@creezio/brand-config`. Les scripts doivent etre appeles depuis le root app ou avec `--app-root`.

Ne pas pointer une marque sandbox vers les dossiers/feed de production d'une autre marque.

## Dépendances

- `@creezio/brand-config` pour manifests, noms d'artefacts, feed URLs et env keys ;
- outils systeme appeles par scripts : `bash`, `node`, `curl`, `ssh`, `rsync`, `docker`, `sha256sum`.

## Voir aussi

- `AGENTS.md`
- `docs/FILES.md`
- `packages/electron-shell/README.md`
- `packages/factory/README.md`
