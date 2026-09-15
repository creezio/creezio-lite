# packages/tasks — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs tasks` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `scripts/`

| Fichier | Rôle |
|---|---|
| [`scripts/port-from-tempoflow.mjs`](../scripts/port-from-tempoflow.mjs) | One-shot port TempoFlow gold → @creezio/tasks (platform-generic). Run from packages/tasks: node scripts/port-from-tempoflow.mjs |

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/ai-task-agent.ts`](../src/ai-task-agent.ts) | Agent LLM d'un collaborateur IA — exécute une tâche du kanban dans SON workspace Electron (partition dédiée, fake-cursor visible via « Voir comme IA »), avec les ACL de SON persona (jamais celles de l'owner). Outils : navigation CRM, inspection/action UI (UiDriver), onglets web, délégation Hermes (sous-tâche), HITL, fin de tâche explicite (D4 : `done` seulement sur finish_task(success=true)). |
| [`src/ai-task-runner.ts`](../src/ai-task-runner.ts) | Runner host — exécute les tâches assignées à un collaborateur IA via la boucle LLM (ai-task-agent). Persona ACL = user AI ; surface = workspace Electron dédié (pas l'espace owner). Desktop bridge = host owner. Honnêteté des statuts (D4) : un run sans bridge desktop, sans LLM ou sans `finish_task(success=true)` est `failed` — jamais de succès de complaisance. |
| [`src/api-mount.ts`](../src/api-mount.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/assistant-adapter.ts`](../src/assistant-adapter.ts) | Adapter create_task / list_tasks pour @creezio/assistant. Branché via configureAssistantBrand({ tasks: createAssistantTasksAdapter() }). |
| [`src/env-bridge.ts`](../src/env-bridge.ts) | Bridge tasks marque → SoT kit (même UUID) — M8. |
| [`src/hono-routes.ts`](../src/hono-routes.ts) | API Kanban unifié « Tâches » — exécutants human / ai / hermes, runs IA (poll + SSE) et synchronisation Hermes. Factory : les marques montent `createTasksHonoRoutes()` sous /api/v1/tasks. |
| [`src/index.ts`](../src/index.ts) | @creezio/tasks — tâches plateforme (kanban human/ai/hermes + runs + AI). Distinct de PluginTaskRecord (@creezio/product-hub). |
| [`src/kanban-service.ts`](../src/kanban-service.ts) | Kanban unifié « Tâches » (schéma tasks plateforme) — une tâche a un exécutant : - `human` : collaborateur humain (kanban simple) - `ai` : collaborateur IA (runs `task_runs` + workspace Electron dédié) - `hermes` : agent central Hermes (carte kanban WebUI, sync bidirectionnelle) Remplace `cabinet-tasks.ts` et `todo-queries.ts`. |
| [`src/mcp-host-tools.ts`](../src/mcp-host-tools.ts) | D-P18 — tools MCP host-only pour workflows tâches IA. Partagé TF/CV (ex-jumeaux hono-host-tools). Métier marque reste hors kit. Prérequis : `configureTasksBrand()` déjà appelé (users + runtime kanban). |
| [`src/mcp-workspace-tools.ts`](../src/mcp-workspace-tools.ts) | Verbes navigateur exposés à Hermes via MCP (H4) : `workspace.open_tab`/`list_tabs`/`web_*` (dans le workspace du collaborateur IA, `ai_user_id` obligatoire, allowlist `*_WEB_ALLOWED_HOSTS`) + HITL asynchrone `platform.ask_human`/`get_human_answer`. Câblé prod via `@creezio/app-runtime`. |
| [`src/memory-store.ts`](../src/memory-store.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/sqlite-driver.ts`](../src/sqlite-driver.ts) | Driver SQLite minimal — @creezio/tasks (I3). import { createRequire } from "node:module"; import path from "node:path"; export type SqliteStatement = { run(...params: unknown[]): unknown; get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; }; export type SqliteDatabase = { exec(sql: string): unknown; |
| [`src/sqlite-store.ts`](../src/sqlite-store.ts) | Store tasks plateforme — sqlite **core** (Phase I3). |
| [`src/task-runs.ts`](../src/task-runs.ts) | Runs d'exécution des tâches IA + logs session agent. |
| [`src/types.ts`](../src/types.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `src/brand/`

| Fichier | Rôle |
|---|---|
| [`src/brand/config.ts`](../src/brand/config.ts) | Configuration marque pour le runtime tasks plateforme. Les marques appellent `configureTasksBrand` au boot (server / instrumentation). |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/ai-activity-panel.tsx`](../ui/ai-activity-panel.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/index.ts`](../ui/index.ts) | @creezio/tasks/ui — kanban / détail / activité IA (O9, gold TF). |
| [`ui/task-detail-sheet.tsx`](../ui/task-detail-sheet.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/tasks-kanban-client.tsx`](../ui/tasks-kanban-client.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/tasks-types.ts`](../ui/tasks-types.ts) | Types + méta UI du kanban unifié « Tâches » (API /api/v1/tasks). export type TaskAssignee = { id: string; username: string; kind: "human" \| "ai"; }; export type TaskCard = { id: string; title: string; body: string; status: string; position: number; executor_kind: "human" \| "ai" \| "hermes"; assignee_user_id: string \| null; assignee?: TaskAssignee \| null; parent_task_id: string \| null; created_by: string \| null; priority: number; hermes_task_id: string \| null; hermes_status: string \| null; recurring_schedule: string \| null; source: string; result: string |
