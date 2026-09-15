# AGENTS.md — @creezio/electron-shell

## Mission

Maintenir le **desktop Electron** plateforme Creezio : boot, fenêtres, tray,
updater, splash, bridge, admin-window, overlays desktop, browser-tabs et
télémétrie webContents. Garder le package générique, testable et sans
dépendance métier verticale.

## P1.b — extraction host-runtime / search (0.11.x) — shims purgés en H12

Le host Node pur a déménagé :

- **`@creezio/search`** — tout le sous-domaine Meili (launcher, feed,
  indexation, cohérence, browse, `maybeBootBrandMeili`).
- **`@creezio/host-runtime`** — le reste du host (logger, hermes/, n8n/,
  tunnel/, plugins/, sandbox/, ai-workspace/, server-launcher,
  brand-host-stack, brand-kernel-http, node-runtime, npm-cli,
  ensure-kit-binaries, crash-reporter, `loadElectron`…).
- `kitOsResourcesRoot` / `kitOsVendorDir` / `envForNodeScriptSpawn` →
  `@creezio/platform-core`.

**H12 (0.24.0)** : les ré-exports de compat `@deprecated` du barrel et le
shim subpath `./meili` ont été **SUPPRIMÉS** (la gate
`test-phase-electron-shell-frozen-exports` et son snapshot n'existent plus —
il n'y a plus de surface gelée à protéger). Tout symbole host s'importe
depuis son package SoT ; migration marques : codemod `scripts/codemods/H12/`
(appliqué par `creezio upgrade`). Ne JAMAIS ré-exporter un symbole host
depuis ce barrel. `resources/{vendor,scripts,bin}` ont déménagé dans
`@creezio/host-runtime` (P1.c) — résolus par `kitOsResourcesRoot`.

## P2.a — moteur desktop partagé (compat legacy retirée en H10)

`src/desktop/brand-desktop-runtime.ts` (`installBrandDesktopRuntime`)
n'est **PAS** un runtime legacy mort : c'est le **moteur desktop unique**,
avec deux points d'entrée — le chemin moderne (`startBrandDesktop` →
`installBrandOsDesktop`, app-runtime, défaut P&P shell `runtime`) et les
clients desktop legacy (repos hors kit) qui l'appellent directement.
Un package `@creezio/legacy-desktop` gelé a été **écarté** sur preuve :
geler le fichier gèlerait le desktop des marques modernes
(ADR `docs/adr/ADR-p2a-desktop-legacy-freeze.md`).

Règles :

- **Features desktop** : dans le moteur, via deps injectées génériques
  (`BrandDesktopDeps`) — jamais de branche marque.
- **Compat marque héritée : RETIRÉE en H10** (T9). Le module gelé
  `src/desktop/legacy-brand-compat.ts`, sa gate
  `test-phase-legacy-desktop-frozen` et l'empreinte
  `scripts/legacy-desktop-frozen.json` n'existent plus. Les défauts sont
  génériques : `<envPrefix>_PLUGINS_DIR`, `<brandId>fid`,
  `<envPrefix>_API_KEY`, preload unique `preload.js`, contrat host
  `ensureDesktopNode` (sans alias). Les clients legacy migrent via le
  codemod `scripts/codemods/H10/` (deps explicites), appliqué par
  `creezio upgrade`.

## Meili — composant CORE fail-closed (contrat marques)

> SoT du code : `@creezio/search` (extrait P1.b ; le shim subpath
> `@creezio/electron-shell/meili` a été supprimé en H12). Le contrat
> ci-dessous reste valable.

**Meili = core, comme SQLite.** Quand un feed déclare ≥ 1 index :

1. **Boot fail-closed** : binaire absent / start KO ⇒ `maybeBootBrandMeili`
   **throw `MeiliRequiredError`** (échec de boot explicite, comme une DB
   absente). Plus de `engine:"sql-fallback"` par défaut. Unique
   échappatoire : `CREEZIO_ALLOW_NO_MEILI=1` (dev/tests hors-browse,
   warning bruyant, interdit en prod).
2. **Toujours Meili** pour lister/filtrer le catalogue dès que les
   filtres/tris sont dans `filterableAttributes` / `sortableAttributes` —
   **même avec `q` vide** (`/secteurs?categorie=`, `/produits?source=…`,
   pagination globale, recherche texte).
3. **Meili KO = erreur visible** : entité indexée + Meili injoignable ⇒
   **503 `{error:"meili_unavailable"}`** ; indexation initiale en cours ⇒
   `engine:"indexing"` (le client réessaie). **Zéro LIKE SQL de secours
   sur le catalogue.**
4. **SQL légitime UNIQUEMENT hors index** : entité non indexée, agrégats
   (`AVG(v_variation)`), bornes prix sur `releves_prix`, écritures, joins
   métier non projetés, EAN/`search-skus`, fiche GET by id, filtre rejeté
   par l'index (`filter_rejected` **visible**).
5. **Piège interdit** : `if (q) { meili } else { sql }` — le browse filtré
   sans texte doit aussi passer Meili (audit perf secteurs 3668bbbd).
6. Helpers publics : `browseMeiliIndexOutcome` (`@creezio/search`,
   issue discriminée incident/hors-index) et `browseMeiliIndex` (compat,
   `null` = tout incident). **Ne pas** utiliser `searchMeiliIndexes` pour le
   browse (retourne `[]` si `q` vide). Entity-list kit : `configureEntityMeili`
   (`@creezio/api-kernel`) auto-branché depuis le feed
   (`configureEntityMeiliFromFeed`) — 503 fail-closed intégré.
7. **Schéma data + index par module** : chaque `BrandModuleDef` avec entité
   listable déclare `meiliIndexes` **ou** `horsIndexJustification` — doctor
   brand-spec `MODULE_MEILI_MISSING` fail-closed (0.10.13+).

Le launcher/indexer vivent ici ; la requête UI (`listProduits` etc.) reste
dans la marque mais **doit** respecter ce contrat.

## Ne pas faire

- Ne pas hardcoder `TF2`, `TEMPOFLOW`, `CERTIVAN` ou `FIDU` dans une nouvelle logique ; utiliser `envPrefix`, `AppManifest` ou bindings.
- Ne pas importer de code marque depuis ce package.
- Ne pas tirer le barrel principal dans des tests Node qui n'ont besoin que des browser-tabs ; utiliser `@creezio/electron-shell/browser-tabs`.
- Ne pas lancer un sidecar sans chemin, store, contexte et logs injectes.
- Ne pas exposer secrets BYOK, tokens control plane, cles CRM/n8n dans les logs.
- Ne pas casser les alias legacy existants sans migration explicite.
- `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs electron-shell` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.

## Points d'entrée

- `src/index.ts` : barrel public principal (desktop natif UNIQUEMENT —
  plus de ré-exports host depuis H12).
- `src/desktop/brand-desktop-runtime.ts` : moteur desktop partagé complet
  (chemin moderne app-runtime + clients legacy — voir section P2.a).
- `src/host/browser-tabs/index.ts` : sous-export browser-tabs
  (`@creezio/electron-shell/browser-tabs` — reste ICI, Electron via
  `loadElectron`).
- `src/host/web-telemetry.ts` : `instrumentWebContents` (desktop).

Déménagés en P1.b (voir leurs AGENTS) :

- host-stack / brand-host-stack / brand-host-runtime, plugins/, hermes/,
  n8n/, tunnel/, sandbox/, ai-workspace/, server-launcher, crash-reporter →
  [`@creezio/host-runtime`](../host-runtime/AGENTS.md) ;
- meili/ (indexer générique, schéma d'index, contrat catalogue),
  meili-launcher, brand-meili-boot →
  [`@creezio/search`](../search/AGENTS.md).

## Modifier sans casser

- Preserver les types publics exportes par `src/index.ts`.
- Garder les modules host-only lazy : ne pas charger Electron/sidecars au simple import si evitable.
- Pour les plugins, toute nouvelle env doit passer par `assignPluginEnv` (clé `${envPrefix}_*` uniquement — plus d'aliases TF2).
- `restartPlugin` doit rester race-safe : un ancien child ne doit pas effacer un process plus recent.
- Les preloads et partitions browser-tabs/IA doivent rester isoles.
- Les launchers doivent retourner des payloads de statut stables meme en mode remote ou feature-off.
- En cas d'erreur onglet externe, afficher/rapporter sans crash fatal du runtime.

## Config brand

Sur une marque complete, verifier l'ordre :

1. Construire `AppManifest`, paths, local config store.
2. Creer `createBrandHostRuntime` ou `createBrandHostRuntimeContext`.
3. Appeler `configurePluginHost` avant `startEnabledPlugins`, `restartPlugin`, control extras ou git plugins.
4. Appeler `configureAiWorkspaceHost` avant `AiWorkspaceManager.ensure`.
5. Appeler `configureBrowserTabs` si le preload par defaut n'est pas celui de la marque.
6. Construire `createBrandHostStack` puis passer ses getters a `installBrandDesktopRuntime`.

Verifier que `envPrefix`, `secretFilePrefix`, noms de cookies, protocoles deep-link, ports et chemins de binaires viennent de la marque.

## Tests/gates

Avant validation :

```bash
npm run typecheck -w @creezio/electron-shell
npm run build -w @creezio/electron-shell
```

Si la modification touche Electron reel, completer par un smoke de marque :

- boot client local ;
- boot serveur si supporte ;
- status Hermes/n8n/Meili/tunnel ;
- start/restart plugin avec panel ;
- browser-tab open + action simple ;
- workspace IA `ensure` + `show`.

## Fichiers sensibles

- `src/desktop/brand-desktop-runtime.ts` : boot global, IPC, restart Next, BYOK.
- `src/host/browser-tabs/browser-tab-driver.ts` : CDP trusted input.
- `src/index.ts` : barrel desktop natif — ne JAMAIS y ré-exporter un
  symbole host (H12 : shims purgés, importer depuis les packages SoT).
- Vendor / scripts / bins kit : `@creezio/host-runtime/resources`
  (résolution `kitOsResourcesRoot`).
- Le reste (plugins, hermes, n8n, tunnel, sandbox, ai-workspace) : voir
  `packages/host-runtime/AGENTS.md`.

## Liens

- `README.md`
- `docs/FILES.md`
- `packages/desktop-tooling/README.md`
- `packages/brand-config/README.md` si present
