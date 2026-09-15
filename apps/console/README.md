# Console Creezio (`@creezio/console`)

Application Next.js d'ops locale pour piloter et inspecter le parc desktop
Creezio. Elle agrège les manifests de marques, les feeds `latest.yml`, les
statuts de build, l'inventaire du kit `@creezio/*`, les gates documentaires et
les surfaces de démonstration V1/V2/V3 (fabrique plugins, observabilité,
automations).

Ce n'est pas une app métier ni un CRM : la console reste un panneau
d'exploitation et de preuve kit.

## Rôle

- afficher les versions Client/Serveur disponibles pour TempoFlow, Certivan,
  Fidu et la sandbox DemoBrand ;
- exposer l'inventaire local des packages `@creezio/*` et
  `ARCHITECTURE_VERSION` ;
- lier les gates de propagation G1/G2/G3 sans les exécuter ;
- lancer des remote-builds en `dry-run` depuis l'UI ;
- conserver en local les données de démonstration V1/V2/V3 dans `var/` :
  sessions de fabrique plugins, observabilité SQLite, automations SQLite et
  registre de plugins d'organisation.

## Lancer

Depuis la racine du monorepo :

```bash
cd /agent/repos/creezio
npm install
npm run build -w @creezio/console
npm run console:dev
```

La console écoute sur <http://127.0.0.1:3080>.

Commandes utiles :

```bash
npm run console:dev                  # next dev -p 3080
npm run start -w @creezio/console    # après build, port 3080
npm run typecheck -w @creezio/console
```

Depuis `apps/console`, `npm run dev`, `npm run build`, `npm run start` et
`npm run typecheck` appellent les mêmes scripts de workspace.

## Configuration d'environnement

| Variable | Effet |
| --- | --- |
| `CREEZIO_CONSOLE_ALLOW_BUILD=1` | Autorise un `POST /api/remote-build` avec `dryRun:false`. Sans cette valeur, tout build réel est refusé (`403`). |
| `CREEZIO_OBS_CONSOLE_DB` | Chemin SQLite pour l'observabilité console. Défaut : `<kitRoot>/var/console-core.db`. |
| `CREEZIO_AUTOMATIONS_CONSOLE_DB` | Chemin SQLite pour les automations console. Défaut : `CREEZIO_OBS_CONSOLE_DB` puis `<kitRoot>/var/console-core.db`. |
| `CREEZIO_ORG_PLUGIN_REGISTRY_PATH` | Chemin du registre JSON de plugins org. Défaut : `<kitRoot>/var/org-plugin-registry.json`. |
| `CREEZIO_PLUGIN_FACTORY_DATA_DIR` | Racine de données de la fabrique plugins console. Défaut : `<kitRoot>/var/plugin-factory`. |
| `CREEZIO_PLUGIN_FACTORY_CORE_DB` | SQLite Product Hub utilisé par la fabrique plugins. Défaut : `<dataDir>/console-core.db`. |
| `CREEZIO_PLUGIN_FACTORY_PLUGINS_DIR` | Répertoire de scaffold plugins. Défaut : `<dataDir>/plugins`. |
| `CREEZIO_PRD_LLM_API_KEY`, `CREEZIO_PRD_LLM_API_URL`, `CREEZIO_PRD_LLM_MODEL` | Optionnel, consommé par `@creezio/product-hub` pour brouillon PRD LLM ; sans clé, fallback déterministe. |
| `CREEZIO_APP_ROOT` | Utilisé par le tooling desktop CLI. L'API console reçoit aussi `appRoot` dans le body ; sinon elle prend `manifest.publish.defaultAppRoot`. |

## Architecture

```text
apps/console/
  src/app/page.tsx                  # page serveur, force-dynamic
  src/app/api/*/route.ts            # endpoints Next route handlers
  src/lib/*.ts                      # accès kit, feeds, stores locaux, registry
  src/components/*.tsx              # panneaux UI et bouton remote-build
```

Flux principal de la page :

1. `page.tsx` charge synchroniquement les snapshots (`loadParc`,
   `loadKitSnapshot`, `loadOrgPluginRegistrySnapshot`,
   `listFactorySessionsSnapshot`, `loadObservabilityConsoleSnapshot`).
2. Les panneaux React affichent les données sans état global client, sauf
   `RemoteBuildButton`.
3. Les routes API exposent les mêmes snapshots ou déclenchent les opérations
   contrôlées :
   - `GET /api/kit-versions`
   - `GET /api/feeds`
   - `GET /api/status?brand=<id>&remote=1`
   - `POST /api/remote-build`
   - `GET/POST /api/plugin-factory`
   - `GET/POST /api/observability`
   - `GET/POST /api/automations`
   - `GET/POST /api/org-plugins`

La page et les routes sont dynamiques (`force-dynamic`) pour relire les feeds,
les fichiers de statut et les stores locaux à chaque requête.

## Packages `@creezio/*` utilisés

| Package | Usage dans la console |
| --- | --- |
| `@creezio/brand-config` | Liste des marques, manifests, app roots, feeds et contraintes de publish. |
| `@creezio/desktop-tooling` | Fetch des feeds `latest.yml`, collecte des statuts de build, script remote-build. |
| `@creezio/propagation` | Inventaire packages kit, hints de publication, gates G1/G2/G3 et registre plugins org. |
| `@creezio/product-hub` | Fabrique conversationnelle de plugins, store SQLite Product Hub, scaffold FS. |
| `@creezio/observability` | Store SQLite d'événements et agrégats activité/usages/control-plane. |
| `@creezio/automations` | Moteur d'automations SQLite et règles DemoBrand par défaut. |

## Flux importants

### Parc et feeds

`loadParc()` parcourt `listBrandIds()`. Pour une marque sandbox, la console ne
fetch pas le feed public et retourne un feed vide documenté. Pour les marques
prod, elle lit les `latest.yml` via `fetchBrandFeeds()`. Les statuts viennent
du fichier `manifest.publish.statusFile` ou de la collecte remote si demandé.

### Remote-build

L'UI envoie toujours `{ dryRun: true }` vers `/api/remote-build`. La route :

1. valide `brandId` avec `listBrandIds()` ;
2. résout `packages/desktop-tooling/scripts/remote-build-win.sh` ;
3. choisit `appRoot` depuis le body ou le manifest ;
4. exécute `bash remote-build-win.sh --brand=<id> --app-root=<path> --dry-run`.

Un build réel (`dryRun:false`) n'est possible qu'avec
`CREEZIO_CONSOLE_ALLOW_BUILD=1` et doit rester une action ops explicite.

### V1/V2/V3 console

- V1 : `plugin-factory-demo.ts` stocke les sessions dans SQLite et peut
  matérialiser des plugins dans un répertoire FS local.
- V2 : `observability-console.ts` persiste les événements dans SQLite.
- V3 : `automations-console.ts` partage le même core SQLite par défaut et émet
  dans l'observabilité.
- L3 org plugins : `org-plugin-registry.ts` persiste un registre JSON hors cloud.

## Vérifications recommandées

```bash
npm run typecheck -w @creezio/console
npm run build -w @creezio/console
node --test scripts/test-phase-c.mjs scripts/test-phase-f.mjs scripts/test-phase-i0.mjs scripts/test-phase-i6.mjs scripts/test-phase-v2.mjs scripts/test-phase-c4.mjs
```

Pour une modification limitée à la documentation, relire les liens et garder
`git status --short` propre côté fichiers générés suffit.

Voir aussi : [`docs/FILES.md`](docs/FILES.md) et [`AGENTS.md`](AGENTS.md).
