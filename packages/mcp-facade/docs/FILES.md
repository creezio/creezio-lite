# packages/mcp-facade — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs mcp-facade` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/brand-facade.ts`](../src/brand-facade.ts) | DX factory marque — remplace le boilerplate create*BrandMcp ×3. Tools `module.*` générés depuis `api.listOperations()` ; `discoverModuleTools` = hook apps optionnel (extras / JWT). `mcpTools` n'existe plus. |
| [`src/core-tools.ts`](../src/core-tools.ts) | Tools MCP cœur (`creezio.*`) — SoT kit (H1/H4 → M9). Les marques importent les noms / factories ; handlers Hono peuvent rester brand-specific tant que les noms restent alignés. |
| [`src/dyn-import.ts`](../src/dyn-import.ts) | (à documenter) |
| [`src/facade.ts`](../src/facade.ts) | Façade / proxy MCP unique — tools cœur + discoverTools modules/plugins. H2.3 : discovery / listage scindés par couche (core / module / plugin). H4 : registry dynamique, namespacing, aliases legacy, policies deny cross-layer, surface publique sans double exposition. Pas de MCP « produit Creezio » séparé du MCP de l'app. |
| [`src/hono-bind.ts`](../src/hono-bind.ts) | O4r3 — bind Hono `/mcp` (SDK McpServer) → façade `create*BrandMcp`. Un seul SoT handlers : `facade.callTool`. Hono ne garde que transport, auth Bearer, policies admin — pas de second registre métier. |
| [`src/hono-proxy.ts`](../src/hono-proxy.ts) | Proxy façade Electron → Hono `/mcp` (D1/C2 → M9 SoT kit). Parle le transport Streamable HTTP JSON (même shape que test-mcp-oauth). Si l'upstream est absent ou en erreur et `fallbackLocal`, délègue à la façade locale (brand mounts) — zéro perte offline / tests. |
| [`src/index.ts`](../src/index.ts) | @creezio/mcp-facade — MCP d'app unique (H1.2 / discovery H2.3 / proxy H4 / M9). |
| [`src/jwt.ts`](../src/jwt.ts) | Vérification JWT HS256 minimale (sans dépendance jsonwebtoken). Alignée sur le secret local-config `mcpJwtSecret` / MCP_JWT_SECRET. |
| [`src/module-ops-tools.ts`](../src/module-ops-tools.ts) | Génération tools MCP depuis `listOperations()` (`generateModuleToolsFromOperations` / `discoverModuleToolsFromKernel`) — handler = requête HTTP synthétique vers `ApiMount.handle`, zéro 2e implémentation. SoT = `operations[]` ; `mcpTools` n'existe plus. |
| [`src/namespace.ts`](../src/namespace.ts) | Namespacing H4 — core.* / creezio.* · module.<owner>.* · plugin.<owner>.* |
| [`src/open-external-tab-host-tools.ts`](../src/open-external-tab-host-tools.ts) | D-P18 — tool MCP host-only `open_external_tab` (desktop). SoT kit partagée TF / CV / Fidu. Métier résolution URL reste injecté. |
| [`src/policy.ts`](../src/policy.ts) | Policies MCP H4 — deny cross-layer cohérent api-kernel H2. H5 — plugin ACL (see/execute) alignée Product Hub. |
| [`src/runtime.ts`](../src/runtime.ts) | Contrat MCP produit (D1/C2 → M9) — une seule stack. - Exécuteur HTTP public : **Hono** `GET\|POST /mcp`. - Façade Electron `@creezio/mcp-facade` : adaptateur brand-mounts (tests / offline) **ou** proxy vers Hono dès qu'un upstream local est annoncé. Hermes / Cursor / ChatGPT → toujours `{base}/mcp`, jamais un 2ᵉ serveur MCP dans le process Electron. |
| [`src/types.ts`](../src/types.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `src/admin/`

| Fichier | Rôle |
|---|---|
| [`src/admin/adapters.ts`](../src/admin/adapters.ts) | Injection host pour mcp-admin (évite imports `@/` marque). |
| [`src/admin/http-routes.ts`](../src/admin/http-routes.ts) | Routes Hono Admin MCP (port TempoFlow — N6). Auth owner reste côté marque (montage sous /admin). |
| [`src/admin/index.ts`](../src/admin/index.ts) | MCP admin — policies, clients OAuth, diagnostics, routes Hono (N6). |
| [`src/admin/mcp-admin.ts`](../src/admin/mcp-admin.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/admin/tool-policy-guard.ts`](../src/admin/tool-policy-guard.ts) | Garde d'enforcement des policies MCP admin (table `mcp_tool_policies`) : `checkToolPolicy` (décision brute), `createToolPolicyAuthorize` (façade, opt-in non cassant), `registerGuardedMcpTool` (wrapper serveur MCP SDK : annotations + policy + audit + scopes marque). Câblé prod TF3 — gate `test-phase-mcp-tool-policy-guard`. |
| [`src/admin/types.ts`](../src/admin/types.ts) | Types admin MCP (port TempoFlow — N6). Le registre métier des tools reste injecté par la marque. |

## `src/oauth/`

| Fichier | Rôle |
|---|---|
| [`src/oauth/cors-policy.ts`](../src/oauth/cors-policy.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/oauth/hono-app.ts`](../src/oauth/hono-app.ts) | Factory Hono `/mcp` + OAuth — SoT kit (équivalent fonctionnel server/mcp/app.ts). Transport Streamable HTTP et buildMcpServer restent injectés par la marque. |
| [`src/oauth/index.ts`](../src/oauth/index.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/oauth/rate-limit.ts`](../src/oauth/rate-limit.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/oauth/routes.ts`](../src/oauth/routes.ts) | Endpoints OAuth 2.1 du serveur MCP — SoT kit (port TempoFlow gold). Branding / session / cookie injectables via McpOAuthRoutesConfig. |
| [`src/oauth/store.ts`](../src/oauth/store.ts) | Store OAuth 2.1 MCP (PKCE S256, DCR, refresh rotation) — SoT kit. Port TempoFlow gold ; DB / JWT secret / URL publique injectables. |
| [`src/oauth/types.ts`](../src/oauth/types.ts) | Types OAuth MCP + transport Hono — adapters injectés (zéro hardcode marque). |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/index.ts`](../ui/index.ts) | MCP Admin UI (port TempoFlow — N6). Consommer via `@creezio/mcp-facade/ui`. |
| [`ui/mcp-admin-client.tsx`](../ui/mcp-admin-client.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `ui/primitives/`

| Fichier | Rôle |
|---|---|
| [`ui/primitives/badge.tsx`](../ui/primitives/badge.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/button.tsx`](../ui/primitives/button.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/card.tsx`](../ui/primitives/card.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/cn.ts`](../ui/primitives/cn.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/input.tsx`](../ui/primitives/input.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/tabs.tsx`](../ui/primitives/tabs.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
