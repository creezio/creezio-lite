# packages/auth — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs auth` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/config.ts`](../src/config.ts) | Configuration auth marque — cookie / permissions owner. Aucun nom de cookie ni bridge hardcodé dans le kit. |
| [`src/env-store.ts`](../src/env-store.ts) | Auth SoT via env `CREEZIO_CORE_DB_PATH` / `DB_PATH` (process Next/CRM) — M8. |
| [`src/hono-middleware.ts`](../src/hono-middleware.ts) | Middlewares session Hono génériques. Les clés API publiques / scopes sont injectés par la marque. |
| [`src/hono-routes.ts`](../src/hono-routes.ts) | Factory routes auth Hono (login / logout / me / impersonation / AI workspace). Lookup users + ACL injectés — le kit ne connaît pas le métier marque. |
| [`src/index.ts`](../src/index.ts) | @creezio/auth — session native Creezio (store + JWT + Hono + UI). UI React : `@creezio/auth/ui`. Recovery crypto : `@creezio/platform-core` (réexporté ci-dessous). |
| [`src/ipc.ts`](../src/ipc.ts) | Bind handlers IPC auth sur les canaux `@creezio/shell` IpcChannels.auth. L'hôte Electron fournit `handle(channel, fn)`. |
| [`src/memory-store.ts`](../src/memory-store.ts) | Store auth mémoire — tests + sandbox sans sqlite. |
| [`src/password.ts`](../src/password.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/schema.ts`](../src/schema.ts) | DDL auth — tables dans sqlite **core** (pas brand). export const AUTH_CORE_SQL = ` CREATE TABLE IF NOT EXISTS creezio_users ( id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', stay_logged_in INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL ); |
| [`src/session-types.ts`](../src/session-types.ts) | Types session JWT génériques (indépendants du métier users marque). |
| [`src/session.ts`](../src/session.ts) | Helpers session JWT cookie Next — génériques, cookieName via configureAuth. |
| [`src/sqlite-driver.ts`](../src/sqlite-driver.ts) | Driver SQLite minimal pour @creezio/auth (Phase I1). Compatible better-sqlite3 et node:sqlite DatabaseSync. Pas d'`import.meta` — dual-build CJS Electron. |
| [`src/sqlite-store.ts`](../src/sqlite-store.ts) | Store auth persisté dans sqlite **core** (Phase I1). |
| [`src/types.ts`](../src/types.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/index.ts`](../ui/index.ts) | @creezio/auth/ui — LoginForm + SessionProvider (React / Next). Bridge desktop : configureShellUiBrand({ desktopApiGlobal }) côté marque. |
| [`ui/login-form.tsx`](../ui/login-form.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/login-page.tsx`](../ui/login-page.tsx) | (à documenter) |
| [`ui/require-session.tsx`](../ui/require-session.tsx) | (à documenter) |
| [`ui/session-provider.tsx`](../ui/session-provider.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
