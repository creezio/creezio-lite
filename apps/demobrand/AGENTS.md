# Guide agents - `apps/demobrand`

## Mission

Maintenir DemoBrand comme sandbox de référence pour une marque Creezio générée :
manifest propre, shell Electron Client + Serveur, navigation générique, runtime
SQLite isolé, API Kernel, MCP façade, ACL plugins L3, Product Hub, observabilité
et automations.

La valeur de l'app est la preuve d'intégration du kit. Toute modification doit
rester générique, démontrable et indépendante des marques production.

## Ne pas faire

- Ne pas importer de code métier TempoFlow, Fidu ou Certivan.
- Ne pas réutiliser les GUID, feeds, tokens, `dockerDlName` ou chemins de
  publish d'une marque production.
- Ne pas pointer `demobrand` vers `dl-tempoflow`, `dl-fidu` ou `dl-certivan`.
- Ne pas casser l'isolation H2 : un mount brand écrit dans `brand`, un mount
  plugin écrit dans `plugin`, le `core` reste réservé plateforme.
- Ne pas contourner les ACL Product Hub pour les plugins quand des headers
  acteur sont présents.
- Ne pas ajouter d'import `@creezio/*` au preload sans raison forte ; il est
  volontairement minimal et copiable hors asar.
- Ne pas modifier les fichiers générés sous `build/` comme source de vérité.
  Modifier `src/electron/*` puis reconstruire.
- Ne pas commiter `dist-electron/`, `dist-electron-server/`, `build/`, données
  SQLite temporaires ou sorties de publish.

## Points d'entrée

- `src/electron/app-manifest.ts` et `.json` : identité de la sandbox.
- `src/electron/main.ts` : boot Electron et création du sandbox runtime.
- `src/electron/preload.ts` : bridge `window.demobrandDesktop`.
- `src/electron/sandbox-runtime.ts` : runtime DB/API/MCP/ACL/V1/V2/V3.
- `src/electron/admin-plugins-api.ts` : mount admin ACL L3.
- `src/electron/plugin-factory-api.ts` : mount fabrique plugins V1.
- `src/electron/product-hub-stub.ts` : tokens et store Product Hub sandbox.
- `src/electron/nav-shell.ts`, `nav-core.ts`, `vertical-slot.ts` : navigation
  coeur + slot marque.
- `resources/renderer/index.html` : page statique de démo.
- `resources/renderer/admin-plugins.html` et `.js` : maquette admin ACL.
- `scripts/build-builder-config.mjs` : régénération des configs builder.

## Modifier sans casser

- Modifier le manifest typé et le JSON ensemble si l'identité change.
- Garder `sandbox: true` tant que DemoBrand reste une app de preuve.
- Utiliser les migrations composées dans `sandbox-runtime.ts` pour ajouter des
  tables ; ne pas créer de DB hors `SqliteRuntime`.
- Enregistrer les APIs via `api.registerModuleApi`, `registerPlatformApi` ou
  `registerPluginApi` selon la couche réelle.
- Pour un plugin, toujours créer/ouvrir la DB via `runtime.openPlugin()` et
  poser/effacer l'ACL via Product Hub.
- Préserver les hooks observabilité et automations autour de la fabrique et du
  control-plane.
- Si une entrée de navigation métier est ajoutée, passer par
  `demobrandNavShell.registerBrandNav()` et garder des ids `brand.*`.
- Si une surface renderer appelle une API Electron, prévoir un fallback de démo
  ou documenter le bridge attendu.
- Après changement TypeScript, reconstruire avant de lancer les scripts
  `test-phase-*` qui importent `apps/demobrand/build/electron/*.js`.

## Tests et vérifications

Base :

```bash
npm run typecheck -w @creezio/app-demobrand
npm run build -w @creezio/app-demobrand
```

Selon la zone :

```bash
node --test scripts/test-phase-d.mjs      # app factory / manifest / builder
node --test scripts/test-phase-h2.mjs     # isolation core/brand/plugin
node --test scripts/test-phase-h5.mjs     # ACL plugins et deny cross-org
node --test scripts/test-phase-i1.mjs     # auth SQLite core
node --test scripts/test-phase-i2.mjs     # assistant SQLite core
node --test scripts/test-phase-i3.mjs     # tasks/mails plateforme
node --test scripts/test-phase-i4.mjs     # MCP / mounts
node --test scripts/test-phase-i5.mjs     # admin plugins L3
node --test scripts/test-phase-i7.mjs     # shell-ui / nav adapter
node --test scripts/test-phase-i8.mjs     # freeze/runtime integration
node --test scripts/test-phase-v1.mjs     # fabrique plugins
node --test scripts/test-phase-v2.mjs     # observabilité
node --test scripts/test-phase-v3.mjs     # automations
node --test scripts/test-phase-c3.mjs scripts/test-phase-c4.mjs scripts/test-phase-c7.mjs
```

Pour documentation seule, vérifier les liens relatifs et `git status --short`.
Ne pas créer de commit si la tâche le demande.
