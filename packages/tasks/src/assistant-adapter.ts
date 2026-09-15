/**
 * Adapter create_task / list_tasks pour @creezio/assistant.
 * Branché via configureAssistantBrand({ tasks: createAssistantTasksAdapter() }).
 */
import type { AssistantTasksConfig } from "@creezio/assistant";
import { requireTasksBrand } from "./brand/config.js";
import {
  createTask,
  listTasks,
  syncHermesTasks,
  tasksReady,
} from "./kanban-service.js";

export function createAssistantTasksAdapter(): AssistantTasksConfig {
  return {
    async create(args, ctx) {
      if (!tasksReady()) {
        return {
          ok: false,
          error: "table tasks absente (schéma tasks plateforme)",
          uiSummary: "table tasks absente (schéma tasks plateforme)",
        };
      }
      const title = String(args.title || "").trim();
      if (!title) {
        return { ok: false, error: "title requis", uiSummary: "title requis" };
      }
      const brand = requireTasksBrand();
      try {
        const created = await createTask({
          title,
          body: args.body != null ? String(args.body) : undefined,
          executorKind:
            args.executor === "human" || args.executor === "ai"
              ? args.executor
              : "hermes",
          assigneeUserId:
            args.assignee_user_id != null
              ? String(args.assignee_user_id)
              : null,
          recurringSchedule:
            args.recurring_schedule != null
              ? String(args.recurring_schedule)
              : null,
          priority: Number(args.priority) || 0,
          dispatch: args.dispatch !== false,
          source: "assistant",
          conversationId:
            typeof ctx.conversationId === "string" ? ctx.conversationId : null,
          idempotencyKey:
            args.idempotency_key != null
              ? String(args.idempotency_key)
              : `${brand.assistantIdempotencyPrefix}:${ctx.conversationId || "x"}:${title.slice(0, 40)}:${Date.now()}`,
        });
        return {
          ok: true,
          task: created.task,
          hermes_task_id: created.hermes?.id || null,
          warning: created.warning || null,
          url: brand.taskHref,
          uiSummary: created.hermes?.id
            ? `tâche « ${title} » → Hermes ${created.hermes.id}`
            : `tâche « ${title} » créée (${created.task.executor_kind}${created.warning ? ` — ${created.warning}` : ""})`,
          sources: [{ title: "Tâches", url: brand.taskHref, type: "other" }],
        };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        return { ok: false, error, uiSummary: error };
      }
    },

    async list(args, ctx) {
      void ctx;
      if (!tasksReady()) {
        return {
          ok: false,
          error: "table tasks absente (schéma tasks plateforme)",
          uiSummary: "table tasks absente (schéma tasks plateforme)",
        };
      }
      const brand = requireTasksBrand();
      let syncMeta: unknown = null;
      if (args.sync !== false) {
        try {
          syncMeta = await syncHermesTasks();
        } catch (e) {
          syncMeta = {
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }
      const status =
        args.status != null && String(args.status).trim()
          ? String(args.status).trim()
          : undefined;
      const executor =
        args.executor != null && String(args.executor).trim()
          ? String(args.executor).trim()
          : undefined;
      const tasks = listTasks({ status, executor }).slice(0, 50);
      return {
        ok: true,
        count: tasks.length,
        tasks,
        sync: syncMeta,
        url: brand.taskHref,
        uiSummary: `${tasks.length} tâche(s)`,
        sources: [{ title: "Tâches", url: brand.taskHref, type: "other" }],
      };
    },
  };
}
