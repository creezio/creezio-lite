/**
 * D-P18 — tools MCP host-only pour workflows tâches IA.
 * Partagé TF/CV (ex-jumeaux hono-host-tools). Métier marque reste hors kit.
 *
 * Prérequis : `configureTasksBrand()` déjà appelé (users + runtime kanban).
 */
import { z } from "zod";
import { requireTasksBrand } from "./brand/config.js";
import {
  createTask,
  getTask,
  listTasks,
  updateTask,
} from "./kanban-service.js";
import {
  enqueueAiRunForTask,
  ensureAiRunnerLoop,
  getAiActivityForUser,
  hostBridgeReady,
  parseRecurringSchedule,
  processAiTaskQueue,
} from "./ai-task-runner.js";
import {
  getTaskRun,
  listAgentLogs,
  listTaskRunsForTask,
  resumeHitlRun,
  type TaskRunRow,
} from "./task-runs.js";

export const CREEZIO_AI_TASK_HOST_MCP_TOOL_NAMES = [
  "list_ai_collaborators",
  "create_ai_task",
  "get_ai_task",
  "get_ai_run_logs",
  "answer_ai_question",
] as const;

export type CreezioAiTaskHostMcpToolName =
  (typeof CREEZIO_AI_TASK_HOST_MCP_TOOL_NAMES)[number];

/** Optionnel  — liste kanban générique. */
export const CREEZIO_LIST_TASKS_MCP_TOOL_NAME = "list_tasks" as const;

export type AiTaskHostMcpToolConfig = {
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
};

export type AiTaskHostMcpRegisterFn = (
  name: string,
  config: AiTaskHostMcpToolConfig,
  handler: (input: any) => Promise<unknown> | unknown,
) => void;

/**
 * JSON Schema d'un `inputSchema` de tool host (zod v4 `toJSONSchema`).
 * Exposé ici pour que les intégrateurs (façade MCP kit, marques) n'aient pas
 * besoin d'importer la même instance zod que @creezio/tasks.
 */
export function aiTaskToolJsonSchema(
  shape: Record<string, z.ZodType>,
): Record<string, unknown> {
  try {
    const schema = z.toJSONSchema(z.object(shape));
    delete (schema as Record<string, unknown>)["$schema"];
    return schema as Record<string, unknown>;
  } catch {
    return { type: "object" };
  }
}

export type AiTaskToolParseResult =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; error: string };

/** Valide/normalise des arguments contre un `inputSchema` de tool host. */
export function parseAiTaskToolInput(
  shape: Record<string, z.ZodType>,
  args: Record<string, unknown>,
): AiTaskToolParseResult {
  if (!Object.keys(shape).length) return { ok: true, input: args || {} };
  const parsed = z.object(shape).safeParse(args || {});
  if (!parsed.success) {
    return {
      ok: false,
      error: `invalid_arguments: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(racine)"} ${i.message}`)
        .join(" ; ")}`,
    };
  }
  return { ok: true, input: parsed.data as Record<string, unknown> };
}

export type CreateAiTaskHostMcpToolsOptions = {
  /** Enregistrement marque (`registerMcpTool` ou `server.registerTool`). */
  registerTool: AiTaskHostMcpRegisterFn;
  /** `userId` du token MCP (Bearer / API key). */
  getActorUserId: () => string | null | undefined;
  /** : expose aussi `list_tasks`. Défaut false. */
  includeListTasks?: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }],
  };
}

function errorResult(message: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: message }),
      },
    ],
    isError: true,
  };
}

/**
 * Gate acteur des tools host « qui agissent » : l'acteur doit être l'owner.
 *
 * Décision H1 (« Hermes cerveau unique ») : la clé CRM service Hermes
 * (provisionnée par `ensure-crm-key-db`, `user_id NULL` + scopes `full`) est
 * MAPPÉE SUR L'OWNER par le résolveur Bearer de la façade MCP
 * (`createApiKeyBearerActorResolver`, @creezio/app-runtime) — même niveau de
 * confiance que l'API REST CRM complète qu'elle ouvre déjà (parité kit gold).
 * Pas de scope `tasks:run` dédié : `normalizeScopes` côté auth ne conserve
 * que `full`/`crm:*`, et une clé restreinte (`crm:read`/`crm:write`) n'est
 * PAS mappée owner → refusée ici (fail-closed).
 */
export function actorIsOwner(actorId: string | null | undefined): boolean {
  if (!actorId) return false;
  const { users } = requireTasksBrand();
  const actor = users.getById(actorId);
  const owner = users.getOwner();
  return Boolean(
    actor && owner && actor.role === "owner" && actor.id === owner.id,
  );
}

/**
 * Enregistre les tools MCP host tâches IA (SoT kit).
 * Retourne la liste des noms enregistrés.
 */
export function createAiTaskHostMcpTools(
  options: CreateAiTaskHostMcpToolsOptions,
): readonly string[] {
  const { registerTool, getActorUserId, includeListTasks = false } = options;
  const registered: string[] = [];

  if (includeListTasks) {
    registerTool(
      CREEZIO_LIST_TASKS_MCP_TOOL_NAME,
      {
        title: "Lister les tâches",
        description:
          "Liste les tâches du kanban CRM (humaines et IA), avec filtres optionnels.",
        inputSchema: {
          status: z.string().optional(),
          assignee_user_id: z.string().optional(),
          executor: z.string().optional(),
          include_cancelled: z.boolean().optional(),
        },
      },
      async (input) => {
        const tasks = listTasks({
          status: input.status,
          assigneeUserId: input.assignee_user_id,
          executor: input.executor,
          includeCancelled: Boolean(input.include_cancelled),
        }).map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          executor_kind: task.executor_kind,
          assignee_user_id: task.assignee_user_id,
          priority: task.priority,
          updated_at: task.updated_at,
          created_at: task.created_at,
        }));
        return jsonResult({ tasks, total: tasks.length });
      },
    );
    registered.push(CREEZIO_LIST_TASKS_MCP_TOOL_NAME);
  }

  registerTool(
    "list_ai_collaborators",
    {
      title: "Lister les collaborateurs IA",
      description:
        "Liste les collaborateurs IA actifs. À appeler avant create_ai_task.",
      inputSchema: {},
    },
    async () => {
      const { users } = requireTasksBrand();
      const ais = users.list().filter((u) => u.kind === "ai" && u.active);
      const collaborators = ais.map((u) => {
        const { run, task } = getAiActivityForUser(u.id);
        return {
          id: u.id,
          username: u.username,
          permissions: u.permissions,
          busy: Boolean(run),
          current_task: task
            ? { id: task.id, title: task.title, status: task.status }
            : null,
        };
      });
      return jsonResult({
        collaborators,
        host_bridge_ready: hostBridgeReady(),
      });
    },
  );
  registered.push("list_ai_collaborators");

  registerTool(
    "create_ai_task",
    {
      title: "Créer une tâche pour un collaborateur IA",
      description:
        "Crée (et lance par défaut) une tâche exécutée par un collaborateur IA. Réservé owner.",
      inputSchema: {
        title: z.string().min(1).max(300).describe("Titre court de la tâche"),
        brief: z.string().max(8000).optional(),
        assignee: z.string().optional(),
        launch: z.boolean().default(true),
        require_confirmation: z.boolean().optional(),
        recurring: z.string().max(60).optional(),
      },
    },
    async (input) => {
      const actorId = getActorUserId();
      if (!actorIsOwner(actorId)) {
        return errorResult("Réservé au compte principal (owner)");
      }
      const { users } = requireTasksBrand();
      const ais = users.list().filter((u) => u.kind === "ai" && u.active);
      if (ais.length === 0) return errorResult("Aucun collaborateur IA actif");
      let assignee = ais[0]!;
      if (input.assignee) {
        const wanted = String(input.assignee).trim();
        const found = ais.find(
          (u) =>
            u.id === wanted ||
            u.username.toLowerCase() === wanted.toLowerCase(),
        );
        if (!found) {
          return errorResult(
            `Collaborateur IA « ${wanted} » introuvable ou inactif`,
          );
        }
        assignee = found;
      }
      let brief = typeof input.brief === "string" ? input.brief : "";
      if (input.require_confirmation && !/\[\[(confirm|hitl)\]\]/i.test(brief)) {
        brief = `${brief}\n\n[[confirm]]`.trim();
      }
      const recurring =
        typeof input.recurring === "string" ? input.recurring.trim() : "";
      if (recurring && !parseRecurringSchedule(recurring)) {
        return errorResult(`Récurrence « ${recurring} » invalide`);
      }
      try {
        const { task } = await createTask({
          title: input.title,
          body: brief,
          executorKind: "ai",
          assigneeUserId: assignee.id,
          createdBy: actorId!,
          source: "assistant",
          recurringSchedule: recurring || null,
        });
        let run = null;
        if (input.launch !== false) {
          if (task.status === "backlog") {
            await updateTask(task.id, { status: "in_progress" });
          }
          run = enqueueAiRunForTask(task.id);
          ensureAiRunnerLoop();
          void processAiTaskQueue();
        }
        const bridgeReady = hostBridgeReady();
        return jsonResult({
          ok: true,
          task_id: task.id,
          run_id: run?.id || null,
          status: getTask(task.id)?.status || task.status,
          assignee: { id: assignee.id, username: assignee.username },
          host_bridge_ready: bridgeReady,
          warning: bridgeReady
            ? null
            : "Aucun hôte desktop connecté pour l'instant",
          hint: "Appelle get_ai_task(task_id) toutes les 15-30 s jusqu'à status done/failed.",
        });
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  );
  registered.push("create_ai_task");

  registerTool(
    "get_ai_task",
    {
      title: "État et résultat d'une tâche IA",
      description: "Poll jusqu'à done/failed. wait_seconds ≤ 20.",
      inputSchema: {
        task_id: z.string().min(1),
        wait_seconds: z.coerce.number().int().min(0).max(20).default(0),
        logs_after_seq: z.coerce.number().int().min(0).optional(),
      },
    },
    async (input) => {
      const task = getTask(input.task_id);
      if (!task) return errorResult(`tâche ${input.task_id} introuvable`);
      const runs = listTaskRunsForTask(task.id);
      let run: TaskRunRow | null = runs[0] ?? null;
      const deadline = Date.now() + (input.wait_seconds || 0) * 1000;
      const initialStatus = run?.status || null;
      while (
        run &&
        (run.status === "queued" || run.status === "running") &&
        run.status === initialStatus &&
        Date.now() < deadline
      ) {
        await sleep(1000);
        run = getTaskRun(run.id);
        const fresh = getTask(task.id);
        if (fresh && fresh.status === "done") break;
      }
      const fresh = getTask(task.id) || task;
      const afterSeq = input.logs_after_seq ?? 0;
      const logs = run
        ? listAgentLogs(run.id, afterSeq, 30).map((l) => ({
            seq: l.seq,
            level: l.level,
            event_type: l.event_type,
            message: l.message.slice(0, 500),
          }))
        : [];
      return jsonResult({
        task_id: fresh.id,
        title: fresh.title,
        status: fresh.status,
        result: fresh.result || null,
        run: run
          ? {
              id: run.id,
              status: run.status,
              last_error: run.last_error,
              step_count: run.step_count,
              hitl_prompt: run.hitl_prompt,
            }
          : null,
        logs,
        awaiting_human: Boolean(run?.hitl_prompt),
      });
    },
  );
  registered.push("get_ai_task");

  registerTool(
    "get_ai_run_logs",
    {
      title: "Logs d'un run IA",
      description: "Journal détaillé d'un run IA.",
      inputSchema: {
        run_id: z.string().min(1),
        after_seq: z.coerce.number().int().min(0).default(0),
      },
    },
    async (input) => {
      const run = getTaskRun(input.run_id);
      if (!run) return errorResult(`run ${input.run_id} introuvable`);
      const logs = listAgentLogs(run.id, input.after_seq || 0, 100).map(
        (l) => ({
          seq: l.seq,
          level: l.level,
          event_type: l.event_type,
          message: l.message.slice(0, 800),
        }),
      );
      const last = logs[logs.length - 1];
      return jsonResult({
        run_id: run.id,
        status: run.status,
        logs,
        last_seq: last ? last.seq : input.after_seq || 0,
      });
    },
  );
  registered.push("get_ai_run_logs");

  registerTool(
    "answer_ai_question",
    {
      title: "Répondre à une question d'un collaborateur IA (HITL)",
      description: "Reprend un run en pause HITL. Réservé owner.",
      inputSchema: {
        run_id: z.string().min(1),
        response: z.string().min(1).max(2000),
      },
    },
    async (input) => {
      if (!actorIsOwner(getActorUserId())) {
        return errorResult("Réservé au compte principal (owner)");
      }
      const run = resumeHitlRun(input.run_id, input.response);
      if (!run) return errorResult("Aucune pause HITL active sur ce run");
      return jsonResult({ ok: true, run_id: run.id, status: run.status });
    },
  );
  registered.push("answer_ai_question");

  return registered;
}
