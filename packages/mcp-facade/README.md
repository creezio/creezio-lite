# @creezio/mcp-facade

## Rôle

`@creezio/mcp-facade` fournit la façade MCP unique d'une app Creezio. Il n'y a pas un "MCP produit Creezio" separe : Electron, Hono `/mcp` et le bridge assistant doivent s'appuyer sur la meme factory et exposer le meme ensemble metier, modulo la surface publique (`canonical`, `legacy-preferred`, `both`).

Le package couvre :

- registre dynamique de tools MCP ;
- namespaces `core.*` / `creezio.*`, `module.<ownerId>.*`, `plugin.<ownerId>.*` ;
- aliases legacy (`get_panier` -> `module.panier.get`) sans double exposition ;
- policies d'autorisation et deny cross-layer ;
- JWT Bearer minimal ;
- proxy Hono/Streamable HTTP ;
- OAuth 2.1 MCP avec PKCE, DCR, refresh rotation, well-known metadata et CORS/rate limit ;
- factory marque `createBrandMcpFacade` ;
- host tools plateforme dont `open_external_tab` ;
- admin MCP (policies, clients OAuth, diagnostics, routes et UI).

Surfaces publiees :

| Import | Usage |
|---|---|
| `@creezio/mcp-facade` | façade, namespaces, JWT, OAuth, Hono, host tools, admin |
| `@creezio/mcp-facade/ui` | UI React admin MCP : `McpAdminClient` |

## Périmètre (kit vs marque)

Ce qui appartient au kit :

- la mécanique MCP commune (`listTools`, `listToolsBySpace`, `callTool`) ;
- le parsing et l'assertion des namespaces ;
- la surface publique et les aliases ;
- les tools coeur `creezio.*` / `core.*` exposes par `createCoreMcpTools` ;
- le proxy Hono et le binding `bindFacadeToolsToHono` ;
- OAuth MCP : clients, authorization codes, access/refresh tokens, PKCE S256, scopes, routes, metadata ;
- le host tool generique `open_external_tab` ;
- admin MCP : policies, clients, audit/metrics/diagnostics ;
- UI admin generique.

Ce qui reste dans la marque :

- handlers metier (`mcp-tools.ts`) : panier, GED, VASP, dossiers, catalogue, etc. ;
- aliases publics historiques (`mcp-aliases.ts`) ;
- resolution API Kernel et mounts metier ;
- session/cookie/auth utilisateur injectes dans OAuth ;
- DB concrete, migrations et secret JWT ;
- resolution d'URL metier pour `open_external_tab` ;
- host tools non MCP-metier : desktop, AI tasks, dispatch vers utilisateurs ;
- transport concret `StreamableHTTPTransport` et `buildMcpServer`.

Regle importante : les host tools (desktop, AI tasks, introspection) restent hors factory metier. Ne dupliquer aucun handler panier/GED/VASP dans Hono si la façade sait deja le decouvrir.

## Installation / build

```bash
npm install
npm run build -w @creezio/mcp-facade
npm run typecheck -w @creezio/mcp-facade
```

Artefacts :

- ESM : `dist/`
- CJS Electron : `dist-cjs/`
- UI source : `ui/`

Dependances directes : `@creezio/api-kernel`, `@creezio/platform-core`, `hono`, `jose`, `zod`. Les dependances React/UI sont optionnelles et ne concernent que `./ui`.

## Configuration

### Façade de base

```ts
import { createMcpFacade } from "@creezio/mcp-facade";

const facade = createMcpFacade({
  jwtSecret: process.env.MCP_JWT_SECRET,
  publicSurface: "legacy-preferred",
  aliases: {
    get_panier: "module.panier.get",
  },
  discoverToolsBySpace: async () => ({
    module: await discoverModuleTools(),
    plugin: await discoverPluginTools(),
  }),
});
```

`publicSurface` :

| Mode | Effet |
|---|---|
| `legacy-preferred` | defaut ; expose l'alias legacy et masque le canonique correspondant |
| `canonical` | expose uniquement les noms namespaces |
| `both` | expose alias + canonique ; utile en debug, deconseille en production |

### Namespaces

Namespaces valides :

- `creezio.*` ou `core.*` : coeur reserve au kit ;
- `module.<ownerId>.*` : modules metier de la marque ;
- `plugin.<ownerId>.*` : plugins/sidecars rattaches a une organisation ou un owner plugin.

`ownerId` doit commencer par une lettre et contenir uniquement lettres, chiffres, `_` ou `-`, longueur max 63.

```ts
import {
  assertNamespacedToolName,
  parseNamespacedToolName,
} from "@creezio/mcp-facade";

const parsed = parseNamespacedToolName("module.panier.get");
// { space: "module", ownerId: "panier", rest: "get" }

assertNamespacedToolName("module", "module.panier.get", "panier");
```

Les aliases legacy (`get_panier`) ne passent pas `assertNamespacedToolName`; ils doivent etre declares via `aliases` ou `registerAlias`.

### OAuth + `/mcp`

```ts
import {
  configureMcpOAuth,
  createMcpHonoApp,
  createMcpOAuthRoutes,
  ensureMcpAdminSchema,
  resolveMcpCorsOrigin,
} from "@creezio/mcp-facade";
import { StreamableHTTPTransport } from "@hono/mcp";

configureMcpOAuth({
  getWriteDb,
  tableExists,
  getJwtSecret: () => process.env.MCP_JWT_SECRET!,
  resolvePublicUrl: () =>
    process.env.MCP_PUBLIC_URL ||
    process.env.APP_PUBLIC_URL ||
    process.env.APP_BASE_URL ||
    null,
});

const oauthRoutes = createMcpOAuthRoutes({
  productName: "Ma Marque CRM",
  resourceName: "Ma Marque CRM MCP",
  consentScopesHtml: "<li>Lire et executer les tools autorises</li>",
  session: {
    getSessionFromContext,
    authenticateUser,
    validateCredentials,
    getOwnerId: () => getOwner()?.id ?? null,
    createSessionCookie,
  },
  resolveCookieSecure,
});

export const mcpApp = createMcpHonoApp({
  oauthRoutes,
  ensureSchema: ensureMcpAdminSchema,
  resolveCorsOrigin: resolveMcpCorsOrigin,
  apiKeyAuth: {
    prefix: "brand_live_",
    verify: verifyApiKey,
    resolveUserId: (key) => key.user_id || getOwner()?.id || null,
  },
  createTransport: () =>
    new StreamableHTTPTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    }),
  buildMcpServer,
});
```

Routes OAuth exposees par le kit :

- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-protected-resource`
- `POST /oauth/register`
- `GET /oauth/authorize`
- `POST /oauth/authorize`
- `POST /oauth/token`
- `ALL /mcp` via `createMcpHonoApp`

Scopes : `MCP_SCOPE`, `MCP_SCOPE_LEGACY`, `MCP_SCOPE_READ`, `MCP_SCOPE_WRITE`, `MCP_SCOPES`.

## API publique (exports + exemples)

### Façade MCP

Exports principaux :

- `createMcpFacade`, type `McpFacade`
- types : `McpToolDefinition`, `McpRegisteredTool`, `McpToolHandler`, `McpToolCallResult`, `McpToolSpace`
- `listTools`, `listToolsBySpace`, `callTool`, `registerTool`, `registerAlias`

```ts
const mcp = createMcpFacade({
  allowUnauthenticated: true,
  discoverToolsBySpace: async () => ({
    module: [
      {
        name: "module.notes.create",
        description: "Cree une note",
        space: "module",
        ownerId: "notes",
        handler: async (args) => ({ ok: true, content: args }),
      },
    ],
  }),
});

await mcp.callTool("module.notes.create", { title: "Hello" });
```

### Factory marque

```ts
import { createBrandMcpFacade } from "@creezio/mcp-facade";
import { BRAND_MCP_ALIASES } from "./mcp-aliases";
import { createBrandModuleMcpTools } from "./mcp-tools";

export function createMyBrandMcp(api, options = {}) {
  return createBrandMcpFacade({
    api,
    aliases: BRAND_MCP_ALIASES,
    discoverModuleTools: createBrandModuleMcpTools,
    discoverPluginTools: createBrandPluginTools,
    publicSurface: "legacy-preferred",
    ...options,
  });
}
```

`createBrandMcpFacade` configure par defaut :

- `allowUnauthenticated: true` pour compat runtime local ;
- `enforceNamespaces: true` ;
- `defaultCrossLayerDeny: true` ;
- `listApiMounts: () => api.listMounts()` ;
- tools `module.*` générés depuis `api.listOperations()` (handler = `api.handle`) ;
- `discoverModuleTools` optionnel = hook apps (extras / JWT) — SoT = `operations[]`, `mcpTools` n'existe plus.

### Hono / SDK MCP

Exports principaux :

- `bindFacadeToolsToHono`
- `mcpFacadeResultToSdk`
- `wrapMcpFacadeWithHonoProxy`
- `MCP_PRODUCT_EXECUTOR`, `resolveMcpFacadeRole`

```ts
import { bindFacadeToolsToHono } from "@creezio/mcp-facade";

export async function buildMcpServer(ctx) {
  const server = createSdkMcpServer();
  const facade = createMyBrandMcp(api, { publicSurface: "canonical" });
  await bindFacadeToolsToHono(facade, server.registerTool.bind(server), {
    bearerToken: ctx.accessToken,
  });
  registerHostTools(server, ctx);
  return server;
}
```

### JWT, policies et ACL

Exports principaux :

- `signMcpJwt`, `verifyMcpBearer`
- `composeToolPolicies`, `denyCrossLayerToolCall`, `createDenyUnauthorizedPluginToolPolicy`
- types `McpAuthorizeContext`, `McpToolPolicyDecision`

```ts
const authorize = composeToolPolicies(
  denyCrossLayerToolCall,
  async (ctx) => {
    if (ctx.space === "plugin" && !ctx.orgId) {
      return { allow: false, reason: "missing_org" };
    }
    return { allow: true };
  },
);
```

### OAuth store et routes

Exports principaux :

- `configureMcpOAuth`, `getMcpOAuthAdapters`, `mcpOauthReady`
- `registerClient`, `getClient`, `verifyClientSecret`
- `createAuthCode`, `peekAuthCode`, `consumeAuthCode`, `verifyPkceS256`
- `createRefreshToken`, `rotateRefreshToken`
- `signAccessToken`, `verifyAccessToken`
- `resolveMcpPublicUrl`, `mcpBaseUrl`, `mcpResourceUrl`, `resourceAcceptable`
- `checkMcpRateLimit`, `rateLimitHeaders`, `resolveMcpCorsOrigin`
- `createMcpOAuthRoutes`, `createMcpHonoApp`

La DB est injectee via `McpOAuthAdapters`; le kit ne choisit pas le fichier SQLite.

### Host tools plateforme

`CREEZIO_PLATFORM_HOST_MCP_TOOL_NAMES` contient :

- `open_external_tab`
- `list_tools_by_space`

`open_external_tab` est enregistre par `createOpenExternalTabHostMcpTools`. Le kit fournit le schema et les garde-fous owner/target user ; la marque fournit resolution et dispatch.

```ts
import { createOpenExternalTabHostMcpTools } from "@creezio/mcp-facade";

createOpenExternalTabHostMcpTools({
  registerTool,
  getActorUserId: () => ctx.userId,
  resolveOpenTabRequest: ({ url, fournisseur_id, outil_slug, title }) =>
    resolveBrandExternalTab({ url, fournisseur_id, outil_slug, title }),
  toOpenTabParams: (resolved) => toDesktopOpenTabParams(resolved),
  dispatchOpenTabAction,
  getUserById,
  getOwner,
  includeOutilSlug: true,
});
```

Le schema accepte `url`, `fournisseur_id`, `title`, `target_user_id`, et optionnellement `outil_slug`. Seul le compte principal owner peut cibler un autre utilisateur.

### Admin MCP et UI

Exports admin :

- `configureMcpAdmin`, `ensureMcpAdminSchema`
- `listMcpToolPolicies`, `getMcpToolPolicy`, `updateMcpToolPolicy`
- `listMcpClients`, `setMcpClientEnabled`, `revokeMcpClient`, `rotateMcpClientSecret`
- `mcpAdminStatus`, `mcpDiagnostics`, `mcpMetrics`, `auditMcpAdmin`, `listMcpAuditLogs`, `exportMcpDiagnostics`
- `createMcpAdminRoutes`
- `seedMcpToolPolicies`, `isMcpAdminConfigured`

Garde d'enforcement des policies (M1) — `admin/tool-policy-guard` :

- `checkToolPolicy(name, actor, opts)` → `"tool_disabled" | "role_forbidden" | "policy_scope_forbidden" | null` (décision brute, réutilisable par l'enforcement marque) ;
- `createToolPolicyAuthorize(opts)` → `McpAuthorizeToolCallFn` composable via `composeToolPolicies` avec `denyCrossLayerToolCall` (opt-in non cassant : sans `configureMcpAdmin`, autorise tout) ;
- `registerGuardedMcpTool(server, ctx, def, config, handler, opts)` — wrapper serveur MCP SDK : annotations + policy + audit + vérif scopes marque injectée (`scopeAllows`).

Options injectables : `getPolicy` (défaut table `mcp_tool_policies`), `resolveRole` (rôle marque de l'acteur), `defaultRole` (défaut `collaborator`), `fullAccessScopes` (défaut `["crm","full"]`), `audit` (défaut `auditMcpAdmin`).

Côté façade marque, `createBrandMcpFacade({ toolPolicyGuard: true })` active l'enforcement (M2) et seed des policies permissives pour les tools listés. Rôles/scopes acceptés par `updateMcpToolPolicy` sont dé-hardcodés via les adapters (`policyRoleNames`, `policyScopeNames` — défauts historiques).

Gate : `scripts/test-phase-mcp-tool-policy-guard.mjs`.

UI :

```tsx
import { McpAdminClient } from "@creezio/mcp-facade/ui";
```

## Flux / fonctionnement

1. La marque cree ses tools metier namespacies (`module.<owner>.*`) et ses aliases legacy.
2. `createBrandMcpFacade` regroupe core tools, modules et plugins.
3. `listTools` applique `publicSurface` pour eviter alias + canonique en double.
4. `callTool` resout l'alias vers le canonique, verifie le Bearer si necessaire, applique les policies, puis appelle le handler.
5. Hono `/mcp` construit un serveur SDK, bind la façade, ajoute les host tools et traite le transport Streamable HTTP.

### Les deux transports `/mcp` (câblés prod)

Deux surfaces distinctes servent le MCP d'une app, avec la même façade
comme SoT des tools :

1. **`/mcp` OAuth Hono** (`src/oauth/hono-app.ts`) — serveur MCP SDK
   complet : OAuth 2.1/PKCE, clés API, transport Streamable HTTP avec
   session. C'est la surface publique (clients MCP externes, tunnels).
2. **`/mcp` du plane OS** (`listen-brand-os-http.ts` +
   `mcp-jsonrpc.ts`, `@creezio/app-runtime`) — transport JSON simple
   historique `{ok, tools}` / `{name, arguments}` **et** pont JSON-RPC 2.0
   stateless sur la même URL (seuls les corps `jsonrpc:"2.0"` passent par
   le pont) : c'est ce que consomme le client MCP natif de Hermes embarqué
   (`skip_preflight: true`, sans session).

Ne pas « unifier » ces transports en en supprimant un : les clients
existants dépendent des deux formes.
6. OAuth 2.1 gere en amont l'enregistrement client, l'autorisation utilisateur, le token exchange et les refresh tokens.
7. Les tools host (`open_external_tab`, AI tasks ailleurs) restent dans le host runtime, pas dans la factory metier.

## Intégration marques

Checklist :

1. Migrer les tables OAuth/admin MCP cote marque et fournir `getWriteDb` / `tableExists`.
2. Configurer `configureMcpOAuth` avec secret JWT et URL publique resolue.
3. Creer `createMcpOAuthRoutes` avec session, credentials et cookie injectes.
4. Creer `createMcpHonoApp` avec transport, API key auth optionnelle et `buildMcpServer`.
5. Remplacer les registries metier inline par `createBrandMcpFacade`.
6. Mettre les handlers metier dans `mcp-tools.ts` et aliases dans `mcp-aliases.ts`.
7. Utiliser `bindFacadeToolsToHono` dans Hono et la meme factory dans Electron/assistant.
8. Ajouter les host tools explicitement apres la façade (`open_external_tab`, AI tasks via `@creezio/tasks`).
9. Monter les routes admin MCP sous une protection owner.
10. Supprimer ou reduire a des reexports/stubs les anciens fichiers locaux OAuth, CORS, rate-limit et app `/mcp`.

## Dépendances @creezio/*

| Dependance | Rôle |
|---|---|
| `@creezio/api-kernel` | API Kernel injecte a `createBrandMcpFacade`, `listMounts()` |
| `@creezio/platform-core` | version architecture et helpers plateforme |

Interactions importantes :

- `@creezio/auth` fournit souvent session/cookie/credentials pour OAuth.
- `@creezio/product-hub` peut fournir l'ACL plugins pour `createDenyUnauthorizedPluginToolPolicy`.
- `@creezio/tasks` porte les host tools AI tasks, hors façade metier.
- `@creezio/shell-ui` fournit des helpers de cookie/origin et l'UI admin d'app autour de `McpAdminClient`.

## Voir aussi → AGENTS.md + docs/FILES.md

- [`AGENTS.md`](./AGENTS.md) : consignes de modification pour agents.
- [`docs/FILES.md`](./docs/FILES.md) : inventaire fichier par fichier des exports et responsabilites.
