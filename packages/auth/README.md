# @creezio/auth

## Rôle

`@creezio/auth` porte l'authentification native Creezio : credentials en SQLite core, store memoire pour tests, sessions JWT en cookie, routes/middlewares Hono, UI login/session React, IPC Electron et recovery key crypto reexportee depuis `@creezio/platform-core`.

Le package est independant de la marque : il ne connait ni le nom du cookie, ni les permissions de navigation, ni le bridge desktop, ni les tables metier users d'une app. Ces elements sont injectes au boot.

Surfaces publiees :

| Import | Usage |
|---|---|
| `@creezio/auth` | config, store, JWT/cookies, Hono, IPC, recovery |
| `@creezio/auth/ui` | `LoginPage` (split-screen brand-configurable), `LoginForm`, `SessionProvider`, `useSession` |

## Périmètre (kit vs marque)

Ce qui appartient au kit :

- `AUTH_CORE_SQL` pour les tables `creezio_users` et `creezio_sessions` dans SQLite core ;
- `createMemoryAuthStore` pour tests/sandbox ;
- `createSqliteAuthStore` pour persistance credentials/session dans `core.db` ;
- hash password/token, generation de tokens ;
- configuration `configureAuth({ cookieName, ownerPermissions })` ;
- JWT HS256 via `jose` et helpers `createSessionToken`, `verifySessionToken`, `getSession` ;
- options cookie Hono/Next (`sessionCookieOptions`, `clearSessionCookieOptions`, `toHonoCookie`) ;
- middlewares Hono (`createHonoAuth`) ;
- routes Hono (`createAuthRoutes`) : login/logout/me, impersonation, AI workspace session ;
- composants React `LoginPage` (page /login split-screen 50/50 : formulaire
  + panneau brand configuré par `ShellUiBrand.login`, défaut neutre sans
  config), `LoginForm`, `SessionProvider`, `useSession` ;
- IPC Electron sur `IpcChannels.auth` ;
- recovery key crypto reexportee depuis `@creezio/platform-core`.

Ce qui reste dans la marque :

- nom de cookie et permissions owner ;
- source des users/roles/permissions (`ALL_NAV_PERMISSIONS`, `authenticateUser`, `listUsers`, etc.) ;
- prefixe et verification des API keys publiques ;
- resolution `secure` des cookies derriere tunnel/proxy ;
- contenu brand du panneau login (tagline, highlights, logo, gradient) via
  `login` sur `CreezioUiBoot` — le layout split-screen lui-même est kit ;
- redirections post-login (`defaultRedirect`, `next`) ;
- config `@creezio/shell-ui` pour le bridge desktop UI ;
- OAuth MCP (`src/lib/mcp-oauth.ts`, `src/server/mcp/oauth.ts`) : cela appartient a `@creezio/mcp-facade`, pas a `@creezio/auth`.

## Installation / build

```bash
npm install
npm run build -w @creezio/auth
npm run typecheck -w @creezio/auth
```

Artefacts :

- ESM : `dist/`
- CJS Electron : `dist-cjs/`
- UI source : `ui/`

Dependances directes : `@creezio/platform-core`, `@creezio/shell`, `@creezio/shell-ui`, `@hono/zod-openapi`, `hono`, `jose`, `zod`. `react`, `next` et `lucide-react` sont des peer dependencies optionnelles pour `./ui`.

## Configuration

### Configuration obligatoire au boot marque

```ts
import { configureAuth } from "@creezio/auth";
import { ALL_NAV_PERMISSIONS } from "@/lib/nav-config";

configureAuth({
  cookieName: "mybrand_crm_session",
  ownerPermissions: ALL_NAV_PERMISSIONS,
});
```

`cookieName` est obligatoire avant tout appel a `getSession`, `sessionCookieOptions` ou `createHonoAuth`. `ownerPermissions` alimente les sessions owner et le mode `AUTH_DISABLED`.

Options complémentaires :

- `userAdminPermission` : les gardes `POST`/`PATCH` users acceptent le owner
  OU une session collaborateur portant cette permission (défaut : owner-only).
- `resolveBrandRole(userId, db)` : rôle métier marque exposé en session (ex.
  `backoffice`, `pos`), résolu à la volée depuis la db métier de la marque —
  jamais stocké dans le JWT. Servi par `GET /api/v1/auth/me` (champ
  `brand_role`, résolu pour la cible en impersonation) et exposé côté UI via
  `useSession().me.brandRole` (démo interactive par rôle, lanceurs
  conditionnels…). Option absente = `brand_role` `null`. Le wiring
  `app-runtime` passe automatiquement la db brand au resolver.

Variables lues par le kit :

| Variable | Usage |
|---|---|
| `AUTH_SECRET` | secret JWT HS256. En `NODE_ENV=production`, absent ou egal au fallback dev → signature ET verification refusees (fail-closed). Hors production, fallback dev insecure tolere avec erreur console (`AUTH_ALLOW_DEV_SECRET=1` pour l'assumer). Les boots serveur kit le persistent par instance via `composeBrandOs` |
| `AUTH_DISABLED` | `1`/`true`/`yes` cree une session owner virtuelle |
| `AUTH_USER`, `AUTH_PASSWORD` | credentials legacy/env pour compat et migration |
| `AGENT_API_KEY` | middleware agent key Hono |
| `CREEZIO_CORE_DB_PATH` / `DB_PATH` | store kit env via `getKitAuthStore` |

### Store credentials SQLite core

```ts
import { createSqliteAuthStore } from "@creezio/auth";
import { resolveCoreDbPath } from "@creezio/platform-core";

const authStore = createSqliteAuthStore({
  coreDbPath: resolveCoreDbPath(ctx),
});
```

Le store execute `AUTH_CORE_SQL`, normalise les emails, hash les mots de passe et les tokens, purge les sessions expirees a la lecture.

Pour tests :

```ts
import { createMemoryAuthStore } from "@creezio/auth";

const authStore = createMemoryAuthStore();
```

### UI et bridge desktop

Le package auth ne configure pas `window.*Desktop`. Pour l'UI desktop, la marque configure `@creezio/shell-ui` :

```ts
import { configureShellUiBrand } from "@creezio/shell-ui";

configureShellUiBrand({
  desktopApiGlobal: "mybrandDesktop",
  productName: "Ma Marque",
});
```

## API publique (exports + exemples)

### Config

Exports :

- `configureAuth`
- `getAuthConfig`
- `getAuthCookieName`
- `resetAuthConfigForTests`
- type `AuthConfig`

```ts
configureAuth({
  cookieName: "certivan_crm_session",
  cookieMaxAge: 60 * 60 * 24 * 14,
  ownerPermissions: ALL_NAV_PERMISSIONS,
});
```

### Store, password et SQLite

Exports :

- `AUTH_CORE_SQL`
- `createMemoryAuthStore`, `createSqliteAuthStore`
- `openNodeSqliteDatabase`
- `hashPassword`, `verifyPassword`, `hashToken`, `newToken`
- types `AuthStore`, `AuthUser`, `AuthSession`, `AuthAccountPublic`

```ts
const account = await authStore.register({
  email: "owner@example.com",
  password: "secret",
  displayName: "Owner",
});

const session = await authStore.login({
  email: "owner@example.com",
  password: "secret",
  stayLoggedIn: true,
});
```

### Session JWT / cookies

Exports :

- `isAuthDisabled`, `getAuthCredentials`, `validateEnvCredentials`
- `createSessionToken`, `createSessionTokenForUsername`, `verifySessionToken`, `getSession`
- `sessionCookieOptions`, `clearSessionCookieOptions`, `toHonoCookie`
- `sessionActorIsOwner`, `sessionIsImpersonating`, `sessionCanAccessPath`

```ts
import {
  createSessionToken,
  sessionCookieOptions,
  toHonoCookie,
} from "@creezio/auth";

const token = await createSessionToken({ user });
const cookie = toHonoCookie(sessionCookieOptions(token, { secure: true }));
```

`getSession()` lit les cookies Next via import dynamique de `next/headers`. En mode `AUTH_DISABLED`, il retourne une session owner virtuelle avec `ownerPermissions`.

### Routes et middlewares Hono

```ts
import { createAuthRoutes, createHonoAuth } from "@creezio/auth";
import { resolveCookieSecure } from "@creezio/shell-ui";
import * as apiKeys from "@/lib/api-keys";
import * as users from "@/lib/users";
import { ALL_NAV_PERMISSIONS } from "@/lib/nav-config";

const honoAuth = createHonoAuth({
  apiKeyPrefix: apiKeys.API_KEY_PREFIX,
  verifyApiKey: apiKeys.verifyApiKey,
  checkRateLimit: apiKeys.checkRateLimit,
  rateLimitPerMinute: apiKeys.RATE_LIMIT_PER_MINUTE,
  apiKeyAllowsMethod: apiKeys.apiKeyAllowsMethod,
  apiKeyAllowsTasks: apiKeys.apiKeyAllowsTasks,
});

export const {
  getSessionFromContext,
  requireSession,
  requireNavPermission,
  requireOwnerNotImpersonating,
  requireSessionOrAgentKey,
  requireSessionOrApiKey,
  requireSessionOrTasksApiKey,
} = honoAuth;

export const authRoutes = createAuthRoutes({
  ...users,
  ownerPermissions: ALL_NAV_PERMISSIONS,
  getSessionFromContext,
  resolveCookieSecure: (c) =>
    resolveCookieSecure(
      { get: (name) => c.req.header(name) ?? null },
      {
        appPublicUrl: process.env.APP_PUBLIC_URL,
        appBaseUrl: process.env.APP_BASE_URL,
      },
    ),
});
```

Routes exposees par `createAuthRoutes` :

| Methode | Chemin | Rôle |
|---|---|---|
| `POST` | `/login` | authentifie, migre credentials kit si besoin, pose cookie |
| `POST` | `/logout` | supprime le cookie |
| `GET` | `/me` | session courante et permissions |
| `POST` | `/impersonate` | owner -> collaborateur/IA |
| `POST` | `/stop-impersonate` | retour au compte owner |
| `POST` | `/ai-workspace-session` | session workspace IA |

Middlewares exposes par `createHonoAuth` :

- `requireSession`
- `requireNavPermission(permission)`
- `requireOwnerNotImpersonating`
- `requireAgentKey`
- `requireSessionOrAgentKey`
- `requireSessionOrApiKey`
- `requireSessionOrTasksApiKey` si `apiKeyAllowsTasks` est fourni.

### UI React

Page login mince :

```tsx
import { redirect } from "next/navigation";
import { isAuthDisabled } from "@creezio/auth";
import { LoginForm } from "@creezio/auth/ui";

export default function LoginPage() {
  if (isAuthDisabled()) redirect("/dashboard");
  return <LoginForm title="Ma Marque CRM" />;
}
```

Lien secondaire de la page login (optionnel) : `LoginPage` affiche sous
le formulaire un lien d'action secondaire quand la marque le configure via
`ShellUiBrand.login.secondaryLink` (`CreezioUiBoot`) — ex. inscription POS :

```ts
configureShellUiBrand({
  login: {
    secondaryLink: { label: "Créer un compte", href: "/inscription" },
  },
});
```

Clé absente = rien ne s'affiche (aucun défaut kit, aucun libellé hardcodé).

Session provider :

```tsx
import { SessionProvider } from "@creezio/auth/ui";
import { ALL_NAV_PERMISSIONS } from "@/lib/nav-config";

export function Providers({ children }) {
  return (
    <SessionProvider ownerPermissions={ALL_NAV_PERMISSIONS}>
      {children}
    </SessionProvider>
  );
}
```

Consommation :

```tsx
import { useSession } from "@creezio/auth/ui";

const { me, loading, refresh } = useSession();
```

### IPC Electron

Exports :

- `bindAuthIpcHandlers`
- `authLoginWithStore`
- types `AuthIpcBindings`, `IpcHandleFn`

```ts
import { bindAuthIpcHandlers } from "@creezio/auth";

const bindings = bindAuthIpcHandlers(ipcMain.handle.bind(ipcMain), authStore);
```

Handlers generiques branches sur `IpcChannels.auth` : account, logout, stay logged in, change password, recovery key. `googleLogin` et `recoverPassword` restent des stubs documentes a brancher par la marque si necessaire.

### Recovery

Reexports depuis `@creezio/platform-core` :

- `generateRecoveryKey`
- `normalizeRecoveryKey`
- `createRecoveryVerifier`
- `verifyRecoveryKey`
- `wrapSecretsWithRecoveryKey`
- `unwrapSecretsWithRecoveryKey`

## Flux / fonctionnement

1. La marque appelle `configureAuth` au boot.
2. Le store SQLite core cree ou lit les credentials depuis `creezio_users`.
3. `createAuthRoutes().POST /login` tente le login kit-first (`authenticateViaKit`), puis fallback marque/env, puis migration one-shot vers le store kit.
4. Une session JWT est signee avec `AUTH_SECRET`, le cookie est pose avec le nom configure.
5. `createHonoAuth` lit le cookie via Hono et place la session dans le contexte ou refuse.
6. Les permissions de navigation sont verifiees via `requireNavPermission`.
7. L'UI `SessionProvider` expose `/me` au client React.
8. En desktop, IPC utilise le meme store pour account/logout/password/recovery.

## Intégration marques

Checklist :

1. Appeler `configureAuth({ cookieName, ownerPermissions })` dans un fichier boot commun.
2. Initialiser le store SQLite core avec `createSqliteAuthStore`.
3. Monter `createAuthRoutes` sous le prefixe auth de l'API Hono.
4. Exporter les middlewares `createHonoAuth` pour proteger les routes API.
5. Remplacer les pages/forms locales par `LoginForm`.
6. Remplacer le provider session local par `SessionProvider`.
7. Utiliser `resolveCookieSecure` de `@creezio/shell-ui` pour les tunnels/proxies.
8. Brancher `bindAuthIpcHandlers` dans Electron si l'app desktop utilise les canaux auth.
9. Laisser OAuth MCP dans `@creezio/mcp-facade` et lui injecter les helpers session auth.

Fichiers marque remplacés par le kit (ne pas les recréer) :

| Fichier marque | Remplacement |
|---|---|
| `src/app/login/login-form.tsx` | `@creezio/auth/ui` -> `LoginForm` |
| `src/components/auth/session-provider.tsx` | `@creezio/auth/ui` -> `SessionProvider` |
| `src/lib/auth.ts` | config + reexports minces |
| `src/server/routes/auth.ts` | `createAuthRoutes(...)` |
| `src/server/hono-auth.ts` | `createHonoAuth(...)` |
| `electron/recovery-key.ts` | reexports `@creezio/platform-core` via auth |

## Dépendances @creezio/*

| Dependance | Rôle |
|---|---|
| `@creezio/platform-core` | recovery key crypto et chemins core DB cote marque |
| `@creezio/shell` | `IpcChannels.auth` pour Electron |
| `@creezio/shell-ui` | helpers cookie/origin et bridge desktop UI |

Interactions :

- `@creezio/mcp-facade` consomme session/credentials auth pour OAuth MCP, mais reste proprietaire d'OAuth.
- Les apps marques fournissent users, permissions et API keys.

## Voir aussi → AGENTS.md + docs/FILES.md

- [`AGENTS.md`](./AGENTS.md) : consignes de modification pour agents.
- [`docs/FILES.md`](./docs/FILES.md) : inventaire fichier par fichier des exports et responsabilites.


## Profil Creezio Lite / Sites

LoginPage accepte un slot form optionnel, utilisé pour la connexion ChatGPT. Le formulaire historique reste le défaut.
