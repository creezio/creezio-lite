# @creezio/mcp-facade

## 0.26.0

### Patch Changes

- Updated dependencies [2f5b6ea]
  - @creezio/platform-core@0.26.0
  - @creezio/api-kernel@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [2da43ad]
  - @creezio/platform-core@0.25.0
  - @creezio/api-kernel@0.25.0

## 0.24.1

### Patch Changes

- @creezio/platform-core@0.24.1
- @creezio/api-kernel@0.24.1

## 0.24.0

### Patch Changes

- Updated dependencies [efc7bb5]
  - @creezio/platform-core@0.24.0
  - @creezio/api-kernel@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [ddf823d]
- Updated dependencies [bf14b35]
- Updated dependencies [b0a53b0]
  - @creezio/platform-core@0.23.0
  - @creezio/api-kernel@0.23.0

## 0.22.0

### Patch Changes

- @creezio/platform-core@0.22.0
- @creezio/api-kernel@0.22.0

## 0.21.0

### Patch Changes

- b264d59: mcp-facade : les access tokens OAuth MCP (HS256 `MCP_JWT_SECRET`, surface `/oauth/*`) sont désormais convertis en session plateforme sur les tools `module.*` — `headersFromActor` mint via `createSessionToken` une session pour le user du consentement (`uid` résolu fail-closed dans le store users, fallback owner strict). Complément : le `auth()` de la façade accepte en fallback un Bearer JWT session plateforme validé par `@creezio/auth` (avant : `invalid_signature` sec). Sans cela, les gardes `requireSession` des mounts métier renvoyaient `session_requise` malgré un OAuth valide (ChatGPT connectors & co) — la propagation du Bearer (#166) ne suffisait pas, les deux secrets de signature étant disjoints.
  - @creezio/platform-core@0.21.0
  - @creezio/api-kernel@0.21.0

## 0.20.0

### Patch Changes

- b7d12cc: Propager cookie / Bearer de la session chat OS dans la requête synthétique des tools `module.*` — plus de 401 `requireSession` in-process.
- Updated dependencies [e6303bb]
  - @creezio/platform-core@0.20.0
  - @creezio/api-kernel@0.20.0

## 0.19.1

### Patch Changes

- Propager cookie / Bearer de l'acteur `callTool` sur la requête synthétique des tools `module.*` (`generateModuleToolsFromOperations`) — `requireSession` des handlers marque ne renvoie plus 401 quand le chat OS est authentifié.

## 0.19.0

### Patch Changes

- @creezio/platform-core@0.19.0
- @creezio/api-kernel@0.19.0

## 0.18.0

### Patch Changes

- 87dcdeb: Fix régression 0.17.1 : `listTools` ne masque plus les tools `enabled=0` seedés par défaut (`mcpPublishDefault=false` — toute op module sans opt-in publish), qui vidaient la liste des tools métier (`module.catalog.status` absent de `GET /mcp`, gate catalog-import TF3). Nouvelle colonne `mcp_tool_policies.admin_override` (migration auto) posée uniquement quand l'admin fixe explicitement `enabled` : seul `enabled=0 AND admin_override=1` est masqué de `listTools`. Le deny au call (`checkToolPolicy`) et le plafond OpenAI 128 restent inchangés.
  - @creezio/platform-core@0.18.0
  - @creezio/api-kernel@0.18.0

## 0.17.1

### Patch Changes

- 27c319c: Fix OpenAI `Invalid 'tools': array too long` (plafond 128) : le chat OS n'envoie plus les alias Hermes en double, `listTools` masque les tools `enabled=0`, et le payload est dédupliqué / tronqué à 128. `callTool` et l'admin MCP restent inchangés.
  - @creezio/platform-core@0.17.1
  - @creezio/api-kernel@0.17.1

## 0.17.0

### Patch Changes

- Updated dependencies [13c1d18]
  - @creezio/platform-core@0.17.0
  - @creezio/api-kernel@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies [5dfc286]
  - @creezio/api-kernel@0.16.0
  - @creezio/platform-core@0.16.0

## 0.15.0

### Patch Changes

- @creezio/platform-core@0.15.0
- @creezio/api-kernel@0.15.0

## 0.14.0

### Patch Changes

- @creezio/platform-core@0.14.0
- @creezio/api-kernel@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [a9e9fd7]
  - @creezio/platform-core@0.13.0
  - @creezio/api-kernel@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [17c82b1]
  - @creezio/platform-core@0.12.0
  - @creezio/api-kernel@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [b0856ee]
  - @creezio/platform-core@0.11.0
  - @creezio/api-kernel@0.11.0

## 0.10.15

### Patch Changes

- @creezio/platform-core@0.10.15
- @creezio/api-kernel@0.10.15

## 0.10.14

### Patch Changes

- @creezio/platform-core@0.10.14
- @creezio/api-kernel@0.10.14

## 0.10.13

### Patch Changes

- Updated dependencies [e07d2cf]
  - @creezio/api-kernel@0.10.13
  - @creezio/platform-core@0.10.13

## 0.10.12

### Patch Changes

- Updated dependencies [0823798]
  - @creezio/api-kernel@0.10.12
  - @creezio/platform-core@0.10.12

## 0.10.11

### Patch Changes

- @creezio/platform-core@0.10.11
- @creezio/api-kernel@0.10.11

## 0.10.10

### Patch Changes

- 53695b5: OAuth MCP : réutiliser la session CRM (cookie / Bearer) et authentifier via le login kit, plus seulement le compte desktop local.
- Updated dependencies [4ecd205]
  - @creezio/platform-core@0.10.10
  - @creezio/api-kernel@0.10.10

## 0.10.9

### Patch Changes

- @creezio/platform-core@0.10.9
- @creezio/api-kernel@0.10.9

## 0.10.8

### Patch Changes

- a2fea46: **feat — `mcpTools` retiré ; `MODULE_MCP_TOOLS_DEPRECATED` = error.**

  `BrandModuleDef.mcpTools` n'existe plus. SoT = `operations[]` → tools MCP générés (`listOperations()`). Plus de merge legacy (`mergeGeneratedAndLegacy` / `warnLegacyModuleMcpTools`). Doctor fail-closed : un `mcpTools()` restant = error. Le hook apps `discoverModuleTools` reste (extras / JWT), sans documenter de tools manuscrits.

- Updated dependencies [a2fea46]
  - @creezio/api-kernel@0.10.8
  - @creezio/platform-core@0.10.8

## 0.10.7

### Patch Changes

- 55b1cd5: **feat — catalogue `listOperations()` + tools MCP générés + doctor ops non vides.**

  `api.listOperations()` alimente `/admin/api` (plus seulement la surface Hono). Les tools `module.<mountId>.<op.id>` sont générés depuis ce catalogue (handler = requête HTTP synthétique). Doctor fail-closed : `MODULE_OP_MISSING` si `apiMounts` sans `operations[]` **non vide** (pin ≥ 0.10.6) ; EntitySpec seul = OK (CRUD auto) ; `mcpTools` restant = `MODULE_MCP_TOOLS_DEPRECATED` (warn). Mounts kit/OS hors `modules/*.ts` non scannés.

- Updated dependencies [55b1cd5]
  - @creezio/api-kernel@0.10.7
  - @creezio/platform-core@0.10.7

## 0.10.6

### Patch Changes

- 1c7ec66: **feat — SoT unique : une opération de module = HTTP + /admin/api + tool MCP.**

  `ModuleOperation` sur `ApiMount` / EntitySpec (CRUD auto). Le kit collecte puis génère les tools `module.<mountId>.<op.id>` (handler = requête HTTP synthétique). Catalogue `/admin/api` = ops kernel, plus seulement la surface Hono admin. `mcpTools()` déprécié (doctor error si recouvrement). Doctor fail-closed `MODULE_OP_MISSING` / `MODULE_OP_UNCATALOGUED` depuis 0.10.6. Enable MCP = policies sur tools générés (`mcpPublishDefault`, `roles`).

- Updated dependencies [1c7ec66]
  - @creezio/api-kernel@0.10.6
  - @creezio/platform-core@0.10.6

## 0.10.5

### Patch Changes

- @creezio/platform-core@0.10.5
- @creezio/api-kernel@0.10.5

## 0.10.4

### Patch Changes

- @creezio/platform-core@0.10.4
- @creezio/api-kernel@0.10.4

## 0.10.3

### Patch Changes

- @creezio/platform-core@0.10.3
- @creezio/api-kernel@0.10.3

## 0.10.2

### Patch Changes

- @creezio/platform-core@0.10.2
- @creezio/api-kernel@0.10.2

## 0.10.1

### Patch Changes

- @creezio/platform-core@0.10.1
- @creezio/api-kernel@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [96464bc]
  - @creezio/platform-core@0.10.0
  - @creezio/api-kernel@0.10.0

## 0.9.4

### Patch Changes

- @creezio/platform-core@0.9.4
- @creezio/api-kernel@0.9.4

## 0.9.3

### Patch Changes

- @creezio/platform-core@0.9.3
- @creezio/api-kernel@0.9.3

## 0.9.2

### Patch Changes

- @creezio/platform-core@0.9.2
- @creezio/api-kernel@0.9.2

## 0.9.1

### Patch Changes

- @creezio/platform-core@0.9.1
- @creezio/api-kernel@0.9.1

## 0.9.0

### Patch Changes

- @creezio/platform-core@0.9.0
- @creezio/api-kernel@0.9.0

## 0.8.1

### Patch Changes

- @creezio/platform-core@0.8.1
- @creezio/api-kernel@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies [848ec06]
  - @creezio/api-kernel@0.8.0
  - @creezio/platform-core@0.8.0

## 0.7.1

### Patch Changes

- @creezio/platform-core@0.7.1
- @creezio/api-kernel@0.7.1

## 0.7.0

### Patch Changes

- @creezio/platform-core@0.7.0
- @creezio/api-kernel@0.7.0

## 0.6.0

### Patch Changes

- @creezio/platform-core@0.6.0
- @creezio/api-kernel@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [d674c86]
  - @creezio/platform-core@0.5.0
  - @creezio/api-kernel@0.5.0
