# AGENTS — @creezio/mcp-facade

## Mission

Maintenir la façade MCP unique des apps Creezio : discovery/listage des tools, namespaces, aliases legacy, policies, OAuth 2.1, transport Hono `/mcp`, host tools plateforme et admin MCP. Le package doit garantir que Electron, Hono et assistant consomment le meme SoT de tools metier, sans registre parallele.

La mission technique est de separer clairement :

- façade metier : tools `module.*` générés depuis `api.listOperations()` (ops du mount) ; `plugin.*` découverts par la marque ; `mcpTools` n'existe plus (SoT = `operations[]`) ;
- coeur kit : `creezio.*` / `core.*` ;
- host runtime : desktop, AI tasks, introspection ;
- OAuth/transport : generique et injectable.

## Ne pas faire / frontières

- Ne pas ajouter de handler metier marque dans le kit (panier, GED, VASP, dossiers, catalogue).
- Ne pas creer un deuxieme serveur MCP produit a cote de `/mcp`.
- Ne pas exposer alias legacy et noms canoniques en double par defaut.
- Ne pas contourner `assertNamespacedToolName` pour les tools canoniques.
- Ne pas hardcoder de cookie, domaine public, prefixe API key ou secret JWT.
- Ne pas mettre les host tools dans `createBrandMcpFacade`; ils se branchent apres la façade.
- Ne pas importer de modules app via `@/`.
- Ne pas stocker de DB concrete dans le kit ; passer par adapters OAuth/admin.
- `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs mcp-facade` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.

## Points d'entrée

Façade et contrats :

- `src/index.ts` : surface publique.
- `src/types.ts` : types `McpTool*`, `McpFacadeOptions`, policies. `resolveBearerActor` (H1 Hermes) : résolution d'un Bearer OPAQUE (clé API service) consultée AVANT le JWT — l'app fournit le résolveur (ex. `createApiKeyBearerActorResolver`, @creezio/app-runtime), jamais de métier ici. Les handlers reçoivent l'acteur en 2ᵉ argument optionnel (`McpToolCallActor`, rétro-compatible).
- `src/facade.ts` : implementation `createMcpFacade`.
- `src/namespace.ts` : parser/assertions namespaces.
- `src/policy.ts` : deny cross-layer et composition de policies.
- `src/core-tools.ts` : tools coeur.
- `src/brand-facade.ts` : factory marque (génère toujours depuis `listOperations()`).
- `src/module-ops-tools.ts` : `generateModuleToolsFromOperations` / `discoverModuleToolsFromKernel`.
- `src/runtime.ts` : role/proxy/executor.

Hono/OAuth :

- `src/hono-bind.ts` : binding façade -> SDK/Hono.
- `src/hono-proxy.ts` : proxy vers upstream Hono.
- `src/oauth/store.ts` : store OAuth, tokens, PKCE, clients.
- `src/oauth/routes.ts` : endpoints OAuth.
- `src/oauth/hono-app.ts` : app `/mcp`.
- `src/oauth/cors-policy.ts`, `src/oauth/rate-limit.ts`.

Host/admin/UI :

- `src/open-external-tab-host-tools.ts` : host tool desktop.
- `src/admin/*` : schemas, policies, clients, diagnostics, routes admin.
- `ui/index.ts`, `ui/mcp-admin-client.tsx` : UI admin.
- `docs/FILES.md` : inventaire.

## Modifier sans casser

- Tout nouveau tool canonique doit respecter `core.*`/`creezio.*`, `module.<owner>.*` ou `plugin.<owner>.*`.
- Garder `legacy-preferred` comme defaut de compatibilite.
- Quand un alias est ajoute, verifier que le canonique existe et que la surface publique ne double pas les tools.
- Les policies doivent retourner `{ allow: false, reason }`, pas lancer une exception pour un refus attendu.
- Les flux OAuth doivent rester compatibles PKCE S256, DCR et refresh rotation.
- Ne pas appeler directement le transport depuis la façade ; `createMcpHonoApp` reçoit `createTransport` et `buildMcpServer`.
- Garder les host tools independants : `open_external_tab` reçoit `resolveOpenTabRequest`, `toOpenTabParams`, `dispatchOpenTabAction`, users et owner.
- Si une API publique change, mettre a jour `src/index.ts`, le README et les tests de phase correspondants.
- Preserver le dual build : eviter les patterns incompatibles CJS Electron.

## Config brand

La marque doit fournir :

- `api: ApiKernel` a `createBrandMcpFacade` ;
- `discoverModuleTools(api)` optionnel (hook apps extras / JWT) — les tools `module.*` sont générés depuis `api.listOperations()` ; `mcpTools` n'existe plus ; `discoverPluginTools(api)` optionnel ;
- `aliases` legacy publics ;
- `jwtSecret` / `MCP_JWT_SECRET` ;
- DB write et `tableExists` pour OAuth/admin ;
- `resolvePublicUrl` ou variables `MCP_PUBLIC_URL`, `APP_PUBLIC_URL`, `APP_BASE_URL` ;
- session bridge OAuth : `getSessionFromContext` (cookie CRM + Bearer JWT), `authenticateUser` (sync ou async, même login kit que `/api/v1/auth`), `validateCredentials`, `getOwnerId`, `createSessionCookie` ;
- `apiKeyAuth` si `/mcp` accepte les cles API locales ;
- `buildMcpServer` : façade + `bindFacadeToolsToHono` + host tools ;
- `resolveOpenTabRequest` et dispatch desktop pour `open_external_tab`.

Ne jamais encoder ces informations dans `@creezio/mcp-facade`.

## Tests / gates

Commandes utiles :

```bash
npm run build -w @creezio/mcp-facade
npm run typecheck -w @creezio/mcp-facade
node --test scripts/test-phase-h4.mjs
node --test scripts/test-phase-p18-host-tools.mjs
node --test scripts/test-phase-p18-open-external-tab.mjs
```

Selon la zone touchee, lancer aussi les tests OAuth/MCP listés dans le `package.json` racine (`test-phase-o4*`, `test-phase-o5*`, `test-phase-m9`, etc.).

Gates fonctionnels :

- `parseNamespacedToolName` refuse les formats invalides.
- `legacy-preferred` masque les canoniques aliasés.
- `callTool(alias)` appelle le handler canonique.
- `denyCrossLayerToolCall` reste actif par defaut.
- OAuth refuse sans migrations/adapters requis.
- `open_external_tab` refuse un token sans `user_id` et reserve `target_user_id` a l'owner principal.

## Fichiers sensibles

- `src/facade.ts` : comportement central de listTools/callTool/aliases/policies.
- `src/types.ts` : contrat public consomme par les marques.
- `src/namespace.ts` : securite de separation core/module/plugin.
- `src/oauth/store.ts` : tokens, PKCE, refresh rotation.
- `src/oauth/routes.ts` : endpoints OAuth et consent.
- `src/oauth/hono-app.ts` : auth `/mcp`, API key, transport.
- `src/open-external-tab-host-tools.ts` : actions desktop declenchees par MCP.
- `src/admin/mcp-admin.ts` : policies et clients OAuth.
- `package.json` exports.

## Liens

- [`README.md`](./README.md)
- [`docs/FILES.md`](./docs/FILES.md)
- Packages lies : `@creezio/api-kernel`, `@creezio/auth`, `@creezio/product-hub`, `@creezio/tasks`, `@creezio/shell-ui`
