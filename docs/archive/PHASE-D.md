# Phase D — Factory `new-app` (livré)

## Objectif

Factory qui crée une **nouvelle marque multi-exe** (Client + Serveur) à partir
du kit `@creezio/*`, **sans cloner TempoFlow manuellement**.

Sans brancher Fidu / Certivan / tempoflow2 (Phase G) et sans toucher aux feeds
prod.

## Livrables

| Item | Emplacement |
|------|-------------|
| CLI / API factory | `@creezio/factory` — `creezio new-app` / `npm run factory:new-app` |
| Helpers manifest | `@creezio/brand-config` — `createAppManifest`, `nsisGuidFromAppId`, `validateAppManifest` |
| Sandbox réelle | `apps/demobrand` (`@creezio/app-demobrand`) + manifest kit `demobrand` |
| Doc | ce fichier |
| Tests | `scripts/test-phase-d.mjs` |

## Usage CLI

```bash
cd /opt/docker/creezio
npm install
npm run build:packages

# Générer une marque
npm run factory:new-app -- \
  --name DemoBrand \
  --id demobrand \
  --domain demobrand.creez.io \
  --force

# Équivalent bin
npx creezio new-app --name AcmeApp --id acmeapp --domain acme.creez.io --out /tmp/acmeapp
```

### Options

| Option | Requis | Défaut | Description |
|--------|--------|--------|-------------|
| `--name` | oui | — | Nom produit (`DemoBrand`) |
| `--id` | oui | — | `brandId` court (`demobrand`) |
| `--domain` | oui | — | Domaine feed / tunnel |
| `--out` | non | `apps/<id>` | Dossier cible |
| `--env-prefix` | non | `ID` upper | Préfixe variables d'env |
| `--feed-token` | non | `sandbox` + empreinte | Segment `/dl-<token>/` |
| `--sandbox` | non | oui | Flag `manifest.sandbox` |
| `--no-sandbox` | non | — | Désactive le flag sandbox |
| `--force` | non | false | Écrase les fichiers existants |

Les `brandId` **tempoflow / certivan / fidu** sont refusés (marques prod).

## Ce qui est généré

```
apps/<brandId>/
  package.json                 # @creezio/app-<id>, deps kit
  README.md                    # identité + build + publish dry-run
  tsconfig.electron.json
  electron-builder.base.json
  electron-builder.client.json # via buildElectronBuilderConfig
  electron-builder.server.json
  installer.nsh
  scripts/build-builder-config.mjs
  src/electron/
    app-manifest.ts / .json    # AppManifest embarqué
    main.ts                    # boot mince prepareDesktopBoot
    preload.ts                 # createDesktopApi / bridgeName
    nav-core.ts                # placeholder (PAS de catalogue TF)
    vertical-slot.ts           # slot métier VIDE
    electron-shim.d.ts         # compile sans binaire Electron
  resources/
    icons/{client,server}.png
    renderer/index.html
```

### AppManifest (champs dérivés)

- `bridgeName` = `{brandId}Desktop`
- `envPrefix` = brandId upper
- `deepLinkProtocol` / `sessionPartition` / `dbFileName` / `localConfigFileName` / `logBasename`
- `tunnelRootDomain` = domain
- `client` + `server` : appId `io.creezio.<id>[.server]`, feeds, artifactName, **GUID NSIS = UUID.v5(appId, NAMESPACE_OID)**
- `publish` : `dl-<id>`, remote-build root, `buildServerArtifact: true`

### GUID NSIS

Algorithme aligné electron-builder :

```
UUID.v5(appId, 6ba7b812-9dad-11d1-80b4-00c04fd430c8)  # NAMESPACE_OID
```

Vérifié contre les GUID Fidu kit. Les GUID sandbox sont **distincts** des
GUID TempoFlow / Certivan / Fidu.

## Sandbox DemoBrand

| Champ | Valeur |
|-------|--------|
| brandId | `demobrand` |
| appId client | `io.creezio.demobrand` |
| appId serveur | `io.creezio.demobrand.server` |
| dockerDlName | `dl-demobrand` |
| feed | `https://demobrand.creez.io/dl-sandboxfac47b3ec4fb510facba4f6f/` |
| sandbox | `true` |
| défaut app root | `/opt/docker/creezio/apps/demobrand` |

Registre kit : `packages/brand-config/src/manifests/demobrand.ts`  
(`createAppManifest` — même chemin que la CLI).

### Build sandbox

```bash
cd /opt/docker/creezio
npm run build                 # inclut @creezio/app-demobrand (tsc electron)
npm run build -w @creezio/app-demobrand
```

### Publish feed jetable

Le vhost / volume `dl-demobrand` n'est **pas** provisionné en prod dans cette
phase (évite toute collision avec `dl-tempoflow` / `dl-fidu` / `dl-certivan`).

Workflow documenté :

```bash
# 1) Config résolue (JSON / shell)
npm run desktop:resolve-config -- --brand=demobrand --kind=client --pretty

# 2) Dry-run publish (échoue sans artefact win — attendu ; ne touche pas aux DL prod)
npm run desktop:publish -- \
  --brand=demobrand \
  --kind=client \
  --dry-run \
  --app-root /opt/docker/creezio/apps/demobrand
```

Pour un publish réel sandbox plus tard : créer le volume NPM `dl-demobrand`
(distinct), puis remote-build + publish **uniquement** avec
`CREEZIO_BRAND=demobrand`.

## Console ops

`demobrand` apparaît dans la console avec badge **sandbox**. Les feeds live
ne sont **pas** fetchés (évite timeout 404) — message
« sandbox — feed jetable ».

`listProductionBrandIds()` exclut les sandboxes des asserts feeds Phase C.

## Vérification

```bash
cd /opt/docker/creezio
npm run build
npm test                      # inclut test-phase-d.mjs
```

Couverture Phase D :

1. UUID.v5 GUID + createAppManifest / validate
2. demobrand ≠ feeds/GUID/dockerDl prod
3. scaffold génération + configs client/serveur
4. CLI `creezio new-app`
5. sandbox compilée (`build/electron/*.js`)
6. resolvePublishConfig demobrand

## Contraintes respectées

1. Aucune modification de `/opt/docker/fidu`, `/opt/docker/certivan-app`, ni tempoflow2.
2. Push uniquement `creezio/creezio`.
3. Client + Serveur toujours générés (`buildServerArtifact: true`).
4. GUID / feeds / `dl-*` sandbox distincts des marques prod.
5. Pas de catalogue TempoFlow dans le squelette (nav core + slot vide).

## Limites (assumées, documentées)

| Limite | Détail |
|--------|--------|
| Pas d'exe Windows dans le CI kit | La sandbox prouve `tsc` + configs builder ; le packaging win reste remote-build |
| Feed sandbox non publié | Dry-run + resolve-config ; pas de volume NPM `dl-demobrand` auto |
| Pas de CRM Next | Factory = shell Electron + contrats kit ; métier = `vertical-slot` |
| Enregistrement kit manuel pour nouvelles marques | `demobrand` est dans le registre ; une autre marque générée hors repo doit être ajoutée à `brand-config/manifests/` pour `desktop:* --brand=` |

## Hors scope Phase D

- Product Hub / plugins généralisés → **Phase E** (livré, voir `PHASE-E.md`)
- Branchement runtime Fidu / Certivan / TF2 → **Phase F / G**
- Publish npm registry des packages `@creezio/*`

## Suite

Phase E livrée (`@creezio/product-hub`). Suivant : **Phase F (Propagation)**.
