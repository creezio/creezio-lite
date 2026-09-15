# AGENTS — @creezio/auth

## Mission

Maintenir l'auth native Creezio : store credentials SQLite core, sessions JWT cookie, routes/middlewares Hono, UI login/session, IPC Electron et recovery crypto. Le package doit rester generique et configurable par chaque marque sans connaitre ses cookies, permissions, users ou bridges desktop.

Le but est de supprimer les jumeaux auth locaux dans les marques tout en preservant les points d'injection necessaires : users, ACL navigation, API keys, secure cookie et layout.

## Ne pas faire / frontières

- Ne pas hardcoder de nom de cookie (`tempoflow2_crm_session`, `certivan_crm_session`, etc.).
- Ne pas hardcoder les permissions owner ; elles viennent de la marque.
- Ne pas importer `@/lib/users`, `@/lib/nav-config` ou autre module app.
- Ne pas mettre OAuth MCP dans `@creezio/auth`; il appartient a `@creezio/mcp-facade`.
- Ne pas remplacer `@creezio/platform-core` pour la recovery key ; ce package reexporte seulement.
- Ne pas imposer `better-sqlite3`; le driver est injectable.
- Ne pas supposer que `next/headers` existe hors Next ; `getSession()` doit rester tolerant.
- `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs auth` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.

## Points d'entrée

Core :

- `src/index.ts` : exports publics.
- `src/config.ts` : `configureAuth`, cookie name, owner permissions.
- `src/schema.ts` : `AUTH_CORE_SQL`.
- `src/types.ts` : contrat `AuthStore`.
- `src/sqlite-store.ts` : store core SQLite.
- `src/memory-store.ts` : store tests/sandbox.
- `src/password.ts` : hash password/token.
- `src/env-store.ts` : store kit via env et migration credentials.

Sessions/routes :

- `src/session.ts` et `src/session-types.ts` : JWT, cookies, permissions.
- `src/hono-middleware.ts` : `createHonoAuth`.
- `src/hono-routes.ts` : `createAuthRoutes`.
- `src/ipc.ts` : handlers Electron.

UI :

- `ui/index.ts` : surface publique UI.
- `ui/login-form.tsx` : formulaire login.
- `ui/session-provider.tsx` : provider React et hook.

Docs :

- `README.md`
- `docs/FILES.md`

## Modifier sans casser

- Appeler `getAuthCookieName()` uniquement apres `configureAuth`; conserver les erreurs explicites.
- Tout changement de JWT doit rester compatible avec les claims legacy `{ email, role: "admin" }`.
- Preserver le mode `AUTH_DISABLED` fail-safe pour dev/sandbox avec permissions owner configurees.
- Garder les routes Hono injectables : users, credentials, secure cookie, session context.
- Ne jamais exposer le hash password/token dans les objets publics.
- Si les routes changent, verifier `LoginForm` et `SessionProvider`.
- Pour IPC, utiliser `IpcChannels.auth` de `@creezio/shell`; ne pas inventer des noms de canaux.
- Les erreurs d'auth attendues doivent retourner JSON/HTTP clair, pas stack traces.
- Maintenir le dual build CJS Electron : eviter `import.meta` et imports Next statiques.

## Config brand

La marque doit fournir :

- `configureAuth({ cookieName, ownerPermissions })` au boot ;
- `AUTH_SECRET` en production ;
- `coreDbPath` a `createSqliteAuthStore` ;
- adapters users a `createAuthRoutes` :
  - `authenticateUser`
  - `ensureOwnerSynced`
  - `getUserById`
  - `getUserByUsername`
  - `listUsers`
- `resolveCookieSecure(c)` ;
- adapters API key a `createHonoAuth` :
  - `apiKeyPrefix`
  - `verifyApiKey`
  - `checkRateLimit`
  - `rateLimitPerMinute`
  - `apiKeyAllowsMethod`
  - `apiKeyAllowsTasks` si besoin ;
- page `/login` et providers React ;
- `configureShellUiBrand({ desktopApiGlobal })` si l'UI tourne en desktop ;
- binding IPC Electron si necessaire.

Optionnel : `resolveBrandRole` (rôle métier en session — `GET /me` renvoie
`brand_role`, UI `useSession().me.brandRole`) et `userAdminPermission`
(garde users owner OU permission). Voir README § Configuration.

## Tests / gates

Commandes utiles :

```bash
npm run build -w @creezio/auth
npm run typecheck -w @creezio/auth
node --test scripts/test-phase-i1.mjs
node --test scripts/test-phase-m8.mjs
node --test scripts/test-phase-m12.mjs
```

Selon la zone touchee, lancer aussi les gates auth présentes dans le `package.json` racine.

Gates fonctionnels :

- `configureAuth` refuse un cookie vide.
- `getAuthCookieName` echoue clairement si non configure.
- `AUTH_DISABLED` donne une session owner virtuelle.
- `createSessionToken` et `verifySessionToken` round-trip les permissions.
- `createHonoAuth.requireNavPermission` autorise owner non impersonne et refuse sans permission.
- `requireSessionOrTasksApiKey` n'existe que si `apiKeyAllowsTasks` est fourni.
- `createAuthRoutes` pose et efface le cookie via le nom configure.
- `createSqliteAuthStore` cree les tables core et ne fuite pas de hash.

## Fichiers sensibles

- `src/session.ts` : JWT, cookies, compat legacy, permissions.
- `src/hono-middleware.ts` : garde des routes API et API keys.
- `src/hono-routes.ts` : login/logout/me/impersonation.
- `src/sqlite-store.ts` : credentials et sessions persistants.
- `src/env-store.ts` : migration credentials marque -> kit.
- `src/config.ts` : invariant cookie obligatoire.
- `src/ipc.ts` : actions desktop auth.
- `ui/login-form.tsx` et `ui/session-provider.tsx` : UX auth commune.
- `package.json` exports et peer dependencies.

## Liens

- [`README.md`](./README.md)
- [`docs/FILES.md`](./docs/FILES.md)
- Packages lies : `@creezio/platform-core`, `@creezio/shell`, `@creezio/shell-ui`, `@creezio/mcp-facade`
