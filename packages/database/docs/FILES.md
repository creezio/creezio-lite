# packages/database — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs database` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/access-log.ts`](../src/access-log.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/adapters.ts`](../src/adapters.ts) | Adapters host pour le moteur Database (plugins, branding webhook, n8n). Évite tout import `@/` marque dans le package. |
| [`src/automations-store.ts`](../src/automations-store.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/catalog.ts`](../src/catalog.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/conditions.ts`](../src/conditions.ts) | Évaluateur de conditions style Notion (AND/OR imbriqués). |
| [`src/crud.ts`](../src/crud.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/engine.ts`](../src/engine.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/export.ts`](../src/export.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/identifiers.ts`](../src/identifiers.ts) | Identifiants SQLite sûrs (tables / colonnes). const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/; export function isSafeIdentifier(value: string): boolean { return SAFE_IDENT.test(value) && !value.startsWith("sqlite_"); } export function quoteIdent(value: string): string { if (!isSafeIdentifier(value)) { throw new Error(`Identifiant SQLite invalide : ${value}`); } |
| [`src/index.ts`](../src/index.ts) | @creezio/database — Admin Database natif + automations row-level. Fail-closed : CRUD métier impossible sans `configureDatabasePolicy({ crudAllowlist })`. Ne pas confondre avec `@creezio/automations` (lifecycle plugins/org — V3 prototype). |
| [`src/query.ts`](../src/query.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/schema.ts`](../src/schema.ts) | Schéma SQL core — tables Admin Database / automations row-level. Identique à la migration TempoFlow v33 (préfixe `db_*` conservé pour compat). |
| [`src/sqlite-driver.ts`](../src/sqlite-driver.ts) | Driver SQLite minimal — compatible better-sqlite3 / node:sqlite. Port Database TempoFlow → @creezio/database (R1). |
| [`src/stores.ts`](../src/stores.ts) | Registre multi-stores Admin Database (`core`/`brand`/plugin) — `registerDatabaseStore` / `listDatabaseStores` / `resolveDatabaseStore` |
| [`src/triggers.ts`](../src/triggers.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/views.ts`](../src/views.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/webhooks.ts`](../src/webhooks.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/whitelist.ts`](../src/whitelist.ts) | Policy écriture / automation Admin Database. Fail-closed : aucune table métier CRUD-able sans `configureDatabasePolicy`. Les allowlists métier vivent dans chaque marque (jamais dans ce kit). |

## `src/http/`

| Fichier | Rôle |
|---|---|
| [`src/http/admin-routes.ts`](../src/http/admin-routes.ts) | Routes Hono Admin Database (catalogue, browse, automations, CRUD, export). Port TempoFlow → kit (M2). Auth owner reste côté marque (montage). |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/database-automations-panel.tsx`](../ui/database-automations-panel.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/database-client.tsx`](../ui/database-client.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/index.ts`](../ui/index.ts) | Admin Database UI (port TempoFlow — M2). Consommer via `@creezio/database/ui`. |
| [`ui/types.ts`](../ui/types.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `ui/primitives/`

| Fichier | Rôle |
|---|---|
| [`ui/primitives/badge.tsx`](../ui/primitives/badge.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/button.tsx`](../ui/primitives/button.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/cn.ts`](../ui/primitives/cn.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/input.tsx`](../ui/primitives/input.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/sheet.tsx`](../ui/primitives/sheet.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/tabs.tsx`](../ui/primitives/tabs.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
