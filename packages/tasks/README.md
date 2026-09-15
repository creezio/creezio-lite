# @creezio/tasks

## Rôle

`@creezio/tasks` fournit les tâches plateforme Creezio :

- store mince `PlatformTasksStore` pour `core.db` / `api-kernel` ;
- kanban unifié `human` / `ai` / `hermes` ;
- synchronisation Hermes kanban ;
- runs IA (`task_runs`) avec logs, HITL, quotas et runner host ;
- adapter assistant pour `create_task` / `list_tasks` ;
- outils MCP host-only pour piloter les collaborateurs IA ;
- UI kanban (`TasksKanbanClient`, `TaskDetailSheet`, `AiActivityPanel`).

Ce package est distinct des `PluginTaskRecord` du Product Hub.

## Périmètre kit vs marque

**Kit**

- Définit les statuts, exécutants, invariants d'assignation et opérations kanban.
- Gère les runs IA, logs agent, SSE, relance, annulation et human-in-the-loop.
- Fournit `createTasksHonoRoutes()` et `createTasksApiMount()`.
- Fournit les tools MCP host `list_ai_collaborators`, `create_ai_task`, `get_ai_task`, `get_ai_run_logs`, `answer_ai_question`.
- Fournit les tools MCP **workspace** (`mcp-workspace-tools.ts`, câblés prod
  via `@creezio/app-runtime` — architecture « Hermes cerveau / task runner
  mains ») : `workspace.open_tab`, `workspace.list_tabs`,
  `workspace.web_list_targets|click|type|scroll|read|screenshot`
  (`ai_user_id` obligatoire — l'action s'exécute dans le workspace du
  collaborateur IA, garde allowlist `*_WEB_ALLOWED_HOSTS` en UX + défense
  en profondeur host `web_host_not_allowed`), et le HITL asynchrone
  `platform.ask_human` / `platform.get_human_answer` (tâche kanban + run
  HITL détaché).
- Fournit l'adapter assistant `createAssistantTasksAdapter()`.

**Marque**

- Appelle `configureTasksBrand()` au boot.
- Fournit DB, users, présence desktop, workspace Electron, navigation/permissions, external tabs, screencast et auth.
- Monte les routes Hono sous `/api/v1/tasks`.
- Monte le store `ApiMount` si elle expose la surface platform-core.
- Configure les variables d'environnement préfixées pour le runner IA.
- Branche les tools MCP dans son serveur host.

## Installation/build

```bash
npm run build -w @creezio/tasks
npm run typecheck -w @creezio/tasks
```

Exports :

- `@creezio/tasks` : store, config, kanban, runner, Hono, MCP.
- `@creezio/tasks/ui` : kanban, sheet détail et activité IA.

## Configuration détaillée

### `configureTasksBrand`

```ts
import { configureTasksBrand } from "@creezio/tasks";

configureTasksBrand({
  productName: "Ma Marque",
  productDomain: "CRM métier",
  hermesSourceLabel: "Ma Marque CRM",
  hermesSkill: "brand-crm",
  envPrefix: "BRAND_AI",
  idempotencyPrefix: "crm",
  assistantIdempotencyPrefix: "asst",
  taskHref: "/taches",
  examplePaths: ["/clients", "/dashboard"],
  db,
  users,
  presence,
  workspace,
  navigation,
  externalTabs,
  screencast,
  auth,
});
```

Bindings requis :

- `db` : `getWriteDb`, `queryAll`, `queryOne`, `tableExists`.
- `users` : `getById`, `list`, `getOwner`, `ready`.
- `presence` : état desktop et bridges en ligne.
- `workspace` : création/navigation workspace IA, tabs externes, web actions, screencast.
- `navigation` : permission requise par chemin et vérification ACL.
- `externalTabs` : résolution d'URL/site externe vers workspace params.
- `screencast` : viewer count et subscription frames.
- `auth` : session depuis Hono et helpers owner/impersonation.

### Env runner IA

Le préfixe vient de `envPrefix`. Pour `envPrefix: "BRAND_AI"`, le package lit notamment :

- `BRAND_AI_RUNNER_ENABLED=0|false|no` pour désactiver le runner ;
- `BRAND_AI_MAX_RUNS_PER_DAY` ;
- `BRAND_AI_MAX_TOKENS_PER_DAY` ;
- `BRAND_AI_HITL=1|true` pour forcer le human-in-the-loop ;
- variables modèle/limites utilisées par `ai-task-agent` via `tasksEnv` / `tasksEnvNumber`.

Les valeurs non configurées utilisent les defaults du kit ou restent illimitées selon le cas.

### Hermes

Le kanban Hermes utilise les fonctions de `@creezio/assistant` (`hermesKanbanConfigured`, create/list/patch/dispatch/cron). Les tâches `executorKind: "hermes"` n'ont pas d'assigné local et peuvent être dispatchées immédiatement.

### Assistant brand binding

```ts
import { configureAssistantBrand } from "@creezio/assistant";
import { createAssistantTasksAdapter } from "@creezio/tasks";

configureAssistantBrand({
  // autres bindings...
  tasks: createAssistantTasksAdapter(),
});
```

## API publique avec exemples

### Kanban service

```ts
import {
  createTask,
  listTasks,
  tasksByColumn,
  updateTask,
} from "@creezio/tasks";

const { task } = await createTask({
  title: "Préparer la relance client",
  body: "Analyser les échanges et proposer un message.",
  executorKind: "ai",
  assigneeUserId: "user_ai_1",
  createdBy: "owner_1",
  source: "ui",
});

await updateTask(task.id, { status: "in_progress" });

const board = tasksByColumn(listTasks({ includeCancelled: false }));
```

### Routes Hono

```ts
import { Hono } from "hono";
import { createTasksHonoRoutes } from "@creezio/tasks";

const api = new Hono();
api.route("/tasks", createTasksHonoRoutes());
```

Endpoints sous `/tasks` :

- `GET /meta`
- `GET /`
- `POST /sync`
- `GET /:id`
- `POST /`
- `PATCH /:id`
- `DELETE /:id`
- `POST /:id/launch`
- `GET /runs/:runId`, `/runs/:runId/logs`, `/runs/:runId/stream`
- `POST /runs/:runId/retry`, `/resume`, `/cancel`
- `GET /activity/:userId`, `/activity/:userId/stream`
- `GET /screencast/:aiUserId/stream`
- `POST /runner/tick`
- `POST /logs/purge`

### `ApiMount` platform-core

```ts
import { createTasksApiMount, createSqliteTasksStore } from "@creezio/tasks";

const store = createSqliteTasksStore({ db });
const mount = createTasksApiMount(store);
```

Surface mince :

- `GET /list` ou `GET /`
- `POST /create` ou `POST /`
- `GET|PATCH|DELETE /:uuid`

L'acteur vient de `x-creezio-user-id` ou `body.userId`.

### Runner IA

```ts
import {
  enqueueAiRunForTask,
  ensureAiRunnerLoop,
  processAiTaskQueue,
} from "@creezio/tasks";

const run = enqueueAiRunForTask("task_id");
ensureAiRunnerLoop();
void processAiTaskQueue();
```

### MCP host tools

```ts
import { createAiTaskHostMcpTools } from "@creezio/tasks";

const registered = createAiTaskHostMcpTools({
  registerTool: server.registerTool.bind(server),
  getActorUserId: () => currentApiKey.user_id,
  includeListTasks: true,
});
```

### UI

```tsx
import { TasksKanbanClient } from "@creezio/tasks/ui";

export default function TasksPage() {
  return <TasksKanbanClient />;
}
```

## Flux

### Création tâche

1. L'UI, l'assistant ou MCP appelle `createTask`.
2. Le kit valide l'exécutant :
   - `human` : assigné humain si fourni ;
   - `ai` : assigné IA actif obligatoire ;
   - `hermes` : pas d'assigné local.
3. La tâche est écrite dans le schéma local et upsertée dans le store plateforme.
4. Si Hermes est choisi, le kit crée/synchronise la tâche Hermes.
5. Si IA est choisie et lancée, un run est enfilé.

### Runner IA

1. `ensureAiRunnerLoop` démarre le poller.
2. `claimNextQueuedRun` sélectionne un run.
3. Le runner vérifie quotas, modèle LLM et bridge desktop host.
4. Il ouvre/assure le workspace de l'IA avec les ACL du collaborateur.
5. `runAiTaskAgent` exécute les étapes et écrit les logs.
6. Le run finit `succeeded`, `failed`, `cancelled` ou attend HITL.

### MCP host

1. La marque enregistre les tools avec `createAiTaskHostMcpTools`.
2. L'actor MCP doit être owner pour créer des tâches IA.
3. `create_ai_task` crée et lance la tâche si demandé.
4. `get_ai_task` / `get_ai_run_logs` servent au polling externe.
5. `answer_ai_question` reprend un run HITL.

## Intégration marques

- Appeler `configureTasksBrand` avant toute route, UI ou runner.
- Monter `createTasksHonoRoutes()` sous `/api/v1/tasks`.
- Brancher `createAssistantTasksAdapter()` dans `configureAssistantBrand`.
- Démarrer le runner uniquement sur le host serveur/desktop adéquat.
- Garder les permissions dans l'adapter `navigation`, pas dans le prompt.
- Exposer les tools MCP host seulement côté host, avec actor owner.
- Prévoir les migrations SQL `tasks` et `task_runs` avant d'ouvrir l'UI.

## Dépendances

- Runtime : `@creezio/api-kernel`, `@creezio/assistant`, `@creezio/auth`, `@creezio/platform-core`, `@creezio/shell-ui`, `hono`, `zod`.
- Peer UI : `react`, `lucide-react`, `date-fns`, `sonner`.
- Intégrations : Hermes via `@creezio/assistant`, desktop workspace via bindings marque.

## Voir aussi

- [AGENTS.md](./AGENTS.md)
- [docs/FILES.md](./docs/FILES.md)


## Profil Creezio Lite / Sites

TasksKanbanClient accepte une liste optionnelle d’exécuteurs. Le défaut reste human/ai/hermes ; le profil Sites fournit human. Le service D1 spécifique est documenté dans packages/sites-adapter, sans simuler les runners.
