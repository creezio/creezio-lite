# apps/demobrand — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs apps/demobrand` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `resources/renderer/`

| Fichier | Rôle |
|---|---|
| [`resources/renderer/admin-plugins.js`](../resources/renderer/admin-plugins.js) | Client de la maquette : utilise `window.demobrandAdminPlugins` si présent, sinon fallback `localStorage`. |
| [`resources/renderer/nav-shell-demo.js`](../resources/renderer/nav-shell-demo.js) | Miroir statique de la navigation coeur + `Notes`, preuve UI I7 sans backend. |

## `scripts/`

| Fichier | Rôle |
|---|---|
| [`scripts/build-builder-config.mjs`](../scripts/build-builder-config.mjs) | CLI qui résout le manifest (`@creezio/brand-config` ou JSON local) et régénère les configs builder. |

## `src/electron/`

| Fichier | Rôle |
|---|---|
| [`src/electron/admin-plugins-api.ts`](../src/electron/admin-plugins-api.ts) | Mount `/api/v1/modules/admin-plugins/*` : liste, upsert, preview, get/delete ACL plugins L3. |
| [`src/electron/app-manifest.ts`](../src/electron/app-manifest.ts) | Manifest typé `AppManifest` utilisé au runtime : ids, feeds, DB, publish, sandbox. |
| [`src/electron/main.ts`](../src/electron/main.ts) | Entrée Electron : `prepareDesktopBoot`, logs, kind file, sandbox runtime, nav model et `BrowserWindow`. |
| [`src/electron/nav-core.ts`](../src/electron/nav-core.ts) | Ré-export des items coeur `@creezio/shell-ui`, sans catalogue métier marque. |
| [`src/electron/nav-shell.ts`](../src/electron/nav-shell.ts) | Adapter shell-ui DemoBrand et registration de l'entrée métier sandbox `brand.notes`. |
| [`src/electron/plugin-factory-api.ts`](../src/electron/plugin-factory-api.ts) | Mount `/api/v1/modules/plugin-factory/*` : sessions, intention, clarification, approval, materialize, iterate. |
| [`src/electron/preload.ts`](../src/electron/preload.ts) | Preload minimal : expose `window.demobrandDesktop` avec IPC génériques sans import `@creezio/*`. |
| [`src/electron/product-hub-stub.ts`](../src/electron/product-hub-stub.ts) | Tokens Product Hub dérivés du manifest, store injecté par runtime ou fallback SQLite/mémoire, création de demandes plugin. |
| [`src/electron/sandbox-runtime.ts`](../src/electron/sandbox-runtime.ts) | Coeur de la sandbox : migrations core/brand/plugin, `SqliteRuntime`, stores natifs, API Kernel, MCP, ACL, V1/V2/V3, install/uninstall plugins. |
| [`src/electron/vertical-slot.ts`](../src/electron/vertical-slot.ts) | Objet slot marque : brandId, items, registry, adapter shell et Product Hub sandbox. |
