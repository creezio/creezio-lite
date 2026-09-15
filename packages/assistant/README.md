# @creezio/assistant

## Rôle

`@creezio/assistant` est le runtime assistant Creezio : stockage des conversations, prompts, modes Chat/Work, tools plateforme, intégration MCP métier, délégation Hermes, routes HTTP et UI React.

Il fournit :

- stores mémoire/SQLite et schéma assistant ;
- registre brand `configureAssistantBrand` ;
- DB de chat (`chat-db`) avec migration best-effort vers le store kit ;
- modes `chat` et `work` ;
- tools plateforme (SQL, exploration, Meili/RAG, surface UI, tasks, MCP) ;
- client Hermes OpenAI-compatible ;
- routes Hono `createAssistantRoutes` ;
- composants UI (`AssistantProvider`, `AssistantWidget`, `AssistantRoot`, traces, voice input).

## Périmètre kit vs marque

**Kit**

- Gère l'orchestration SSE `/chat`, conversations, traces et profils agent.
- Assemble les prompts génériques et les addendums de mode.
- Exécute les tools plateforme et délègue les tools métier à la façade MCP injectée.
- Fournit les handlers `create_task` / `list_tasks` via un adapter tasks injecté.
- Délègue le mode Work à Hermes via `HERMES_API_URL` / `HERMES_API_SERVER_KEY`.
- Fournit UI, active surface, actions desktop, transcription et contrôles de modèles.

**Marque**

- Appelle `configureAssistantBrand` avant tout runtime.
- Fournit identité produit, AppMap, prompts métier, auth, DB, Meili, MCP, tasks, Hermes et présence desktop.
- Monte `createAssistantRoutes` sous l'API de la marque.
- Configure les clés/env OpenAI, Anthropic, Hermes et les stores.
- Garantit auth/ACL des routes via `getSession` et les middlewares hôte.

## Installation/build

```bash
npm run build -w @creezio/assistant
npm run typecheck -w @creezio/assistant
```

Exports :

- `@creezio/assistant` : store, runtime, registry brand, routes Hono.
- `@creezio/assistant/ui` : composants React.

## Configuration détaillée

### `configureAssistantBrand`

À appeler au boot serveur/layout avant les routes et l'UI :

```ts
import {
  configureAssistantBrand,
  mcpFacadeToAssistantConfig,
} from "@creezio/assistant";
import { createAssistantTasksAdapter } from "@creezio/tasks";
import { collectAssistantSources } from "./modules/index.js";

configureAssistantBrand({
  identity: {
    productName: "Ma Marque",
    uiStorageKey: "brand-assistant-ui",
    modeStorageKey: "brand-assistant-mode",
    desktopApiGlobal: "brandDesktop",
    globalStorePrefix: "__brand",
  },
  appMap: {
    pages: [
      {
        route: "/clients",
        titre: "Clients",
        role: "Lister et gérer les clients",
        actions: ["chercher", "ouvrir une fiche"],
        synonymes: ["contacts"],
      },
    ],
  },
  prompts: {
    baseSystemPrompt: "Tu aides les utilisateurs de Ma Marque.",
    chatModeAddendum: "En mode Chat, explique avant d'agir.",
    toolDefinitions: [],
    buildHermesWorkSystemBrief: (nowIso, user) =>
      `Agent Work Ma Marque pour ${user?.name ?? "l'utilisateur"} (${nowIso}).`,
  },
  moduleSources: collectAssistantSources(), // BrandModuleDef.assistantSources
  mcp: mcpFacadeToAssistantConfig(facade),
  tasks: createAssistantTasksAdapter(),
  db: {
    queryAll: (sql, params) => db.prepare(sql).all(...(params ?? [])),
    queryOne: (sql, params) => db.prepare(sql).get(...(params ?? [])),
    getDbPath: () => "/data/app.db",
    tableExists: (name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name)),
    getDb: () => db,
  },
  meili: {
    indexes: ["clients"],
    mapHit: (index, doc) => ({
      index,
      id: String(doc.id),
      type: "client",
      title: String(doc.name ?? doc.id),
      body: String(doc.description ?? ""),
      url: `/clients/${doc.id}`,
    }),
  },
  hermes: {
    defaultSkills: ["brand-crm"],
    workSkills: ["brand-crm"],
    sessionIdPrefix: "brand",
    kanbanTenant: "brand",
  },
  auth: {
    getSession: async () => ({ sub: "user_1", email: "u@example.com", role: "owner" }),
  },
});
```

### Brand bindings

`AssistantBrandConfig` accepte :

- `identity` : nom produit, clés `localStorage`, nom global desktop et préfixe global UI actions ;
- `appMap` : pages métier injectées dans le prompt ;
- `prompts` : prompt de base, addendum Chat, définitions de tools marque, briefs Hermes ;
- `tools` : projections (`getEntity`, `entitySources`, `formatSearchHit`, `collectSourcesFromSqlRows`, `sourceLinkMatchers`) ;
- `mcp` : `listTools`, `callTool`, `bearerToken`, `listCacheTtlMs` ;
- `tasks` : adapter `create` / `list` pour `create_task` et `list_tasks` ;
- `db` : accès SQL marque pour exploration et `run_sql` ;
- `meili` : indexes, mapping hits, enrichissement et credentials ;
- `hermes` : skills, préfixe session, tenant kanban et `createdBy` ;
- `auth` : session requise par `handleAssistantChat` ;
- `desktopPresence` : état desktop et erreur offline ;
- `trackServerDebounced` : hook ops optionnel.

`BrandTools.executeTool` est legacy : ne pas y brancher de métier. Le métier passe par `mcp`.

### Env

Variables lues par le runtime :

- `OPENAI_API_KEY` : Chat Completions et tools locaux.
- `ANTHROPIC_API_KEY` et variables modèle associées si Anthropic est utilisé.
- `HERMES_API_URL` ou `HERMES_GATEWAY_URL` : base Hermes. Défaut desktop `http://127.0.0.1:18642`, sinon `http://172.21.0.1:8642`.
- `HERMES_API_SERVER_KEY` ou `API_SERVER_KEY` : Bearer Hermes.
- `HERMES_MODEL` : modèle demandé à Hermes si non fourni.
- `CREEZIO_CORE_DB_PATH` ou `DB_PATH` : résolution du store kit/legacy dans `chat-db`
  (`resolveAssistantDbPath` — store kit d'abord, fallback historique `assistant_chats.db`).
- `DESKTOP_LOCAL=1` : active le défaut Hermes local.

### Tools site externe (desktop)

Les noms de tools UI pour piloter les onglets « site externe » sont figés dans
`EXTERNAL_SITE_TOOL_NAMES` (`src/runtime/ui-actions.ts`) : SoT `external_*`
(`external_list_tabs`, `external_click`, `external_screenshot`, …) avec alias
dépréciés `supplier_*`. `siteIdFromSurfaceHref` (alias déprécié
`fournisseurIdFromSurfaceHref`) extrait le `siteId` de la surface active.

## API publique avec exemples

### Routes HTTP

```ts
import { Hono } from "hono";
import { createAssistantRoutes } from "@creezio/assistant";

const api = new Hono();

api.route(
  "/assistant",
  createAssistantRoutes({
    getSession: async (c) => c.get("session") ?? null,
    desktopStreamAuth: "session",
    desktopPresence,
    pluginProductHub,
    onChat: async () => {
      // usage analytics marque
    },
  }),
);
```

Endpoints principaux sous `/assistant` :

- `POST /chat` : SSE assistant.
- `GET|PUT /agent-profile` : agent entreprise/personnel.
- `GET /plugin-approvals` : cartes Product Hub ; sans hub → 200 `{ approvals, clarifications, qa: [] }` (l'UI poll sans 404).
- `POST /ui-actions/:id/result` : résultat d'action UI.
- `GET /desktop-actions/stream` et alias `GET /supplier-actions/stream`.
- `POST /transcribe` : audio vers texte.
- `GET /models`, `GET /llm-status`.
- `GET /hermes-models`, `GET|POST /hermes-reasoning`, `POST /hermes-model`.
- `GET|POST /conversations`, `GET|DELETE /conversations/:id`, `GET /conversations/:id/trace`.

### Chat DB

```ts
import {
  createConversation,
  listConversations,
  listMessages,
  titleFromMessage,
} from "@creezio/assistant";

const conversation = createConversation({
  title: titleFromMessage("Analyse ce dossier"),
  mode: "chat",
  userId: "user_1",
});

const rows = listConversations("user_1");
const messages = listMessages(conversation.id);
```

### Modes

```ts
import {
  ASSISTANT_MODES,
  parseAssistantMode,
  buildHermesWorkSystemBrief,
} from "@creezio/assistant";

const mode = parseAssistantMode("work", "chat");
const brief = buildHermesWorkSystemBrief(new Date().toISOString(), {
  id: "user_1",
  name: "Owner",
  role: "owner",
});
```

### MCP et tasks

```ts
import {
  callAssistantMcpTool,
  ensureMcpToolCache,
  executeTaskTool,
} from "@creezio/assistant";

await ensureMcpToolCache();

const mcpResult = await callAssistantMcpTool(
  "module.panier.add",
  { productId: "p1" },
  { userId: "user_1" },
);

const taskResult = await executeTaskTool(
  "create_task",
  { title: "Relancer le client", executor: "hermes" },
  { conversationId: "conv_1" },
);
```

### UI

```tsx
import { AssistantProvider, AssistantWidget } from "@creezio/assistant/ui";

export function AppAssistant() {
  return (
    <AssistantProvider>
      <AssistantWidget />
    </AssistantProvider>
  );
}
```

## Flux

### Mode Chat

1. L'UI envoie `POST /assistant/chat`.
2. `handleAssistantChat` vérifie `configureAssistantBrand({ auth })`.
3. Le runtime construit le prompt : identité, AppMap, mode Chat, surface active et tools.
4. Les tools locaux s'exécutent : SQL, exploration, Meili, UI/surface, tasks.
5. Les tools métier namespacés (`module.*`, `plugin.*`, `core.*`, `creezio.*`) passent par `mcp.callTool`.
6. Les événements SSE (`thinking`, `tool_start`, `tool_result`, `token`, `done`) alimentent l'UI.
7. Conversations et traces sont persistées par `chat-db` / store kit.

### Mode Work

1. Le mode `work` délègue la tâche à Hermes.
2. Le session id vaut `${hermes.sessionIdPrefix || "creezio-crm"}-${conversationId}`.
3. Les skills viennent de `hermes.workSkills` puis `defaultSkills`.
4. Le client Hermes appelle `/health` puis `/v1/chat/completions`.
5. En agent personnel, l'endpoint profil agent remplace Hermes entreprise.

## Intégration marques

- Configurer le package avant de monter les routes.
- Brancher MCP pour tout outil métier ; éviter `BrandTools.executeTool`.
- Brancher `tasks: createAssistantTasksAdapter()` si `@creezio/tasks` est utilisé.
- Fournir `db.getDb` uniquement si les tools SQL doivent être actifs.
- Fournir `meili.mapHit` pour éviter des hits non projetés.
- Protéger les routes par session et conserver le comportement 404 sur conversations non autorisées.
- Monter l'UI dans un provider client et garder les globals desktop cohérents avec `identity`.

## Dépendances

- Runtime : `@creezio/platform-core`, `@creezio/shell`, `better-sqlite3`, `hono`.
- Peer UI : Radix UI, `react`, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`.
- Intégrations optionnelles : `@creezio/tasks`, Meilisearch côté marque, Hermes gateway, OpenAI/Anthropic.

## Voir aussi

- [AGENTS.md](./AGENTS.md)
- [docs/FILES.md](./docs/FILES.md)
