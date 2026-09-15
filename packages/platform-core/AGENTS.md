# AGENTS — @creezio/platform-core

## Mission du package

`@creezio/platform-core` fournit les briques pures et Node-only de la plateforme Creezio. Il doit permettre aux apps Electron, aux serveurs Next et aux packages domaine de partager les mêmes contrats sans importer Electron et sans hardcoder une marque.

Missions principales :

- résoudre les chemins `userData`, DB, logs, uploads, ressources et preloads depuis un `PathsContext` ;
- résoudre le layout packagé `{installDir}/data/` (`resolvePackagedDataDir`, `guessPackagedDataDir`) ;
- porter le split `server` / `client` / `legacy` ;
- définir le schéma `local-config` commun ;
- gérer le layout SQLite `core` / `brand` / `plugin/<id>` ;
- créer un runtime SQLite multi-DB avec migrations par couche ;
- exposer les migrations plateforme core et historiques ;
- fournir les helpers purs pour Hermes, n8n, plugins, fleet, recovery, licensing, ports, updater, installer prefs et factory reset.

## Ne pas faire / frontières

- Ne pas importer Electron dans ce package. Le main Electron fournit `userDataRoot`, `resourcesRoot`, `isPackaged` et fait les side effects Electron.
- Ne pas hardcoder TempoFlow, Certivan ou Fidu. Toujours passer par `AppManifest`.
- Ne pas mettre de routes HTTP ou de logique métier marque ici.
- Ne pas ouvrir les DB plugins au jour 0 : un plugin s'ouvre à l'installation via `openPlugin`.
- Ne pas transformer `resolveDbPath` en autre chose que l'alias historique de la base brand. Préférer `resolveBrandDbPath` dans le nouveau code.
- Ne pas écrire dans `core.db` depuis du code brand/plugin hors garde. L'isolation est portée côté `@creezio/api-kernel`, mais les couches doivent rester conceptuellement séparées ici.
- Ne pas faire tourner `runHistoricalMigrations` dans le main Electron si le driver natif est compilé pour Node vanilla.
- Ne pas écraser une config locale persistée avec des defaults, surtout pour `fleetTelemetry` et les secrets.
- `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs platform-core` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.

## Points d'entrée

- `src/index.ts`
  - export public complet.
- `src/paths.ts`
  - `PathsContext`, chemins `userData`, DB, logs, uploads, resources, preload.
- `src/app-kind.ts`
  - split Client/Serveur/legacy, `APP_KIND_FILENAME`, boot behavior.
- `src/local-config-schema.ts`
  - `LocalConfigFileV1`, `LOCAL_CONFIG_VERSION`, `emptyLocalConfig`, `isLocalConfigV1`.
- `src/connection-profile.ts`
  - profils local/remote et health check `/health`.
- `src/sqlite-layout.ts`
  - layout multi-fichiers et création jour 0/plugin.
- `src/sqlite-runtime.ts`
  - `createSqliteRuntime`, handles core/brand/plugin.
- `src/sqlite-migrations.ts`
  - table `_creezio_schema_migrations`, `ensureMigrations`, `composeMigrations`.
- `src/core-migrations.ts`
  - migrations core plateforme (`auth`, Product Hub).
- `src/historical-migrations/*`
  - migrations `brand.db` historiques à `schema_version`.
- `src/embeds/*`
  - Hermes/n8n/hooks/catalogue env.
- `src/plugins/*`
  - contrats plugins purs.
- `src/env-brand.ts`
  - env marque et env Next.
- Modules transverses :
  - `fleet-telemetry.ts`, `recovery-key.ts`, `installer-prefs.ts`, `licensing.ts`, `disk-space.ts`, `ports.ts`, `updater-state.ts`, `factory-reset.ts`, `tunnel-urls.ts` ;
  - `web-allowlist.ts` : allowlist web des agents IA au niveau **exécution**
    (union des env `*_WEB_ALLOWED_HOSTS`, refus `web_host_not_allowed`) —
    câblée prod dans `browser-host` (openTab Chromium serveur) et
    `electron-shell` (`executeSupplierAction` desktop) ; la garde UX du
    runner (`aiWebHostAllowed`, `@creezio/tasks`) reste en amont. Aucune
    variable définie = pas de filtrage. Gate :
    `scripts/test-phase-hermes-web-allowlist.mjs`.

## Comment modifier sans casser les marques

1. Commencer par identifier la couche touchée :
   - chemins / app-kind ;
   - local-config ;
   - SQLite layout/runtime/migrations ;
   - embeds ;
   - plugins ;
   - helpers transverses.
2. Pour les chemins :
   - garder les overrides env désactivés en packagé ;
   - dériver les noms avec `envKey(manifest, suffix)` (H11 : plus de
     dual-read env première marque — clé canonique uniquement ; H13 :
     plus de dual-read crash nommé marque côté shell-ui) ;
   - `envForNodeScriptSpawn` : heuristique Electron = `same` / `electron`
     / `creezio` / suffixe `-server` — plus de nom de marque dans le
     basename (H13) ;
   - préserver la compat de `resolveBrandDbPath` avec `DB_PATH_OVERRIDE`.
3. Pour SQLite :
   - ne jamais renommer une migration déjà appliquée ;
   - utiliser des IDs stables et valides (`[a-z0-9][a-z0-9_.-]{0,127}`) ;
   - garder `core`, `brand` et `plugin` comme fichiers séparés ;
   - ne pas créer toutes les DB plugins au boot.
4. Pour `local-config` :
   - ajouter des champs optionnels ;
   - garder `version: 1` tant qu'il n'y a pas de migration explicite ;
   - ne pas casser les alias dépréciés encore lus (`hermes`, `n8n`, champs plats background).
5. Pour les embeds :
   - garder les fonctions pures et injectables (`existsSync`, `readFileSync`, `env`, `platform`) ;
   - ne pas faire de spawn ici.
6. Pour les plugins :
   - respecter `isValidPluginId` ;
   - garder les permissions dans l'union `PluginPermission` ;
   - ne pas mettre de control-plane/spawn dans `platform-core`.
7. Pour les peers optionnels :
   - éviter les imports statiques qui rendent un peer obligatoire ;
   - préserver le chargement runtime si le code existant l'utilise.

## Config attendue côté brand

Une app de marque ou un runtime Electron doit fournir :

- un `AppManifest` depuis `@creezio/brand-config` ;
- un `PathsContext` avec `userDataRoot`, `isPackaged`, `env` optionnel et `resourcesRoot` si nécessaire ;
- des migrations brand injectées explicitement à `createSqliteRuntime` ;
- un driver SQLite compatible si le runtime par défaut ne convient pas ;
- les secrets déjà déchiffrés ou env nécessaires au launcher Next/Hermes/n8n ;
- une politique feature-off cohérente avec `manifest.features`.

Exemple d'initialisation typique :

```ts
import { getManifest } from "@creezio/brand-config";
import {
  buildNextHostEnv,
  composeMigrations,
  createSqliteRuntime,
  platformCoreMigrations,
  resolveAssistantDbPath,
  resolveBrandDbPath,
  resolveCoreDbPath,
  resolveUploadsDir,
  type PathsContext,
} from "@creezio/platform-core";

const manifest = getManifest("demobrand");
const ctx: PathsContext = {
  manifest,
  userDataRoot,
  isPackaged,
  resourcesRoot,
};

const runtime = createSqliteRuntime({
  ctx,
  coreMigrations: platformCoreMigrations(),
  brandMigrations: composeMigrations(brandMigrations),
});

const nextEnv = buildNextHostEnv({
  manifest,
  port,
  hostname: "127.0.0.1",
  dbPath: resolveBrandDbPath(ctx),
  assistantDbPath: resolveAssistantDbPath(ctx),
  uploadsDir: resolveUploadsDir(ctx),
  extra: {
    CREEZIO_CORE_DB_PATH: resolveCoreDbPath(ctx),
  },
});
```

## Tests / gates liés

Commandes directes :

```bash
npm run typecheck -w @creezio/platform-core
npm run build -w @creezio/platform-core
```

Gates monorepo pertinents :

- `npm run build:packages` ;
- `npm test`, notamment les phases H1/H2/H5, M8/M11, N4/N5, O3/O4/O5/O7 et les phases plugins/embeds selon le changement.

À vérifier selon le changement :

- chemins : overrides env hors packagé et chemins packagés ;
- app-kind : comportements `server`, `client`, `legacy` ;
- SQLite : création `core.db`, `brand.db`, plugin DB, migrations et fermeture handles ;
- local-config : `isLocalConfigV1` et defaults non destructifs ;
- embeds : résolution binaire avec injections de tests ;
- plugins : parsing manifest, IDs, permissions et enable flag ;
- recovery/licensing : formats stables et compat crypto.

## Fichiers sensibles

- `src/paths.ts` : chemins userData et overrides env.
- `src/app-kind.ts` : split Client/Serveur, garde cockpit serveur.
- `src/sqlite-layout.ts` : emplacements DB stables.
- `src/sqlite-runtime.ts` : lifecycle handles DB.
- `src/sqlite-migrations.ts` : table de migrations par fichier.
- `src/core-migrations.ts` : chargement SQL auth/Product Hub.
- `src/historical-migrations/*` : ABI Node vanilla / better-sqlite3.
- `src/local-config-schema.ts` : données persistées utilisateur.
- `src/embeds/n8n-embed.ts` et `src/embeds/hermes-embed.ts` : résolution runtime outils.
- `src/plugins/plugin-manifest.ts` : sécurité manifest plugin.
- `src/recovery-key.ts` et `src/licensing.ts` : crypto locale.
- `src/env-brand.ts` et `src/core-db-env.ts` : env de lancement Next/CRM.

## Liens

- [README.md](./README.md)
- [docs/FILES.md](./docs/FILES.md)
