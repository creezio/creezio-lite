/**
 * API Kanban unifié « Tâches » — exécutants human / ai / hermes,
 * runs IA (poll + SSE) et synchronisation Hermes.
 * Factory : les marques montent `createTasksHonoRoutes()` sous /api/v1/tasks.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import { hermesKanbanConfigured } from "@creezio/assistant";
import { requireTasksBrand } from "./brand/config.js";
import {
  ensureAiRunnerLoop,
  enqueueAiRunForTask,
  getAiActivityForUser,
  hostBridgeReady,
  processAiTaskQueue,
  retryFailedRun,
} from "./ai-task-runner.js";
import {
  createTask,
  deleteTask,
  EXECUTOR_KINDS,
  getTask,
  getTaskDetail,
  KANBAN_COLUMNS,
  listTasks,
  syncHermesTasks,
  TASK_STATUSES,
  tasksByColumn,
  tasksReady,
  updateTask,
} from "./kanban-service.js";
import {
  cancelTaskRun,
  getTaskRun,
  listAgentLogs,
  listTaskRunsForTask,
  maxConcurrentAiRuns,
  purgeAgentLogsOlderThan,
  resumeHitlRun,
  subscribeAgentLogs,
  subscribeTaskRuns,
  taskRunsReady,
} from "./task-runs.js";

function queryOne<T>(sql: string, params: unknown[] = []): T | null | undefined {
  return requireTasksBrand().db.queryOne<T>(sql, params);
}
function getUserById(id: string) {
  return requireTasksBrand().users.getById(id);
}
function listUsers() {
  return requireTasksBrand().users.list();
}
function usersReady() {
  return requireTasksBrand().users.ready();
}
function getSessionFromContext(c: Context) {
  return requireTasksBrand().auth.getSessionFromContext(c);
}
function sessionActorIsOwner(session: import("./brand/config.js").TasksSession | null) {
  return requireTasksBrand().auth.sessionActorIsOwner(session);
}
function sessionIsImpersonating(session: import("./brand/config.js").TasksSession | null) {
  return requireTasksBrand().auth.sessionIsImpersonating(session);
}
function screencastViewerCount(aiUserId: string) {
  return requireTasksBrand().screencast.viewerCount(aiUserId);
}
function subscribeScreencast(
  aiUserId: string,
  listener: (frame: { data: string; seq: number; ts?: number }) => void,
) {
  return requireTasksBrand().screencast.subscribe(aiUserId, listener);
}
function startScreencastOnHost(aiUserId: string) {
  return requireTasksBrand().workspace.startScreencast(aiUserId);
}
function stopScreencastOnHost(aiUserId: string) {
  return requireTasksBrand().workspace.stopScreencast(aiUserId);
}

export function createTasksHonoRoutes(): Hono {
  const tasksRoutes = new Hono();


  /**
   * Acteur d'une requête tâches : session cookie (UI) OU clé API scope
   * `tasks:run` (réveil externe). Les endpoints qui n'appellent PAS ce helper
   * (mais `getSessionFromContext` directement) restent session-only : une clé
   * API n'a pas de cookie, donc 401 — fail-closed.
   */
  type TaskActor = { userId: string; role: "owner" | "collaborator"; via: "session" | "api_key" };
  async function getTaskActor(c: Context): Promise<TaskActor | null> {
    const session = await getSessionFromContext(c);
    if (session) {
      return { userId: session.sub, role: session.role, via: "session" };
    }
    const key = c.get("apiKey") as { user_id?: string | null } | undefined;
    if (key?.user_id) {
      const u = getUserById(key.user_id);
      if (u) return { userId: u.id, role: u.role, via: "api_key" };
    }
    return null;
  }

  tasksRoutes.use("*", async (_c, next) => {
    ensureAiRunnerLoop();
    await next();
  });

  function sseResponse(
    c: { req: { raw: Request } },
    setup: (send: (event: string, data: unknown) => void) => () => void,
  ): Response {
    const encoder = new TextEncoder();
    let cleanup: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const stream = new ReadableStream({
      start(controller) {
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
              ),
            );
          } catch {
            /* fermé */
          }
        };
        send("ready", { ok: true, ts: Date.now() });
        cleanup = setup(send);
        heartbeat = setInterval(() => send("ping", { ts: Date.now() }), 20_000);
        c.req.raw.signal.addEventListener("abort", () => {
          if (heartbeat) clearInterval(heartbeat);
          cleanup?.();
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        });
      },
      cancel() {
        if (heartbeat) clearInterval(heartbeat);
        cleanup?.();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  tasksRoutes.get("/meta", async (c) => {
    const session = await getSessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    const assignable = usersReady()
      ? listUsers().filter((u) => u.role === "collaborator" && u.active)
      : [];
    return c.json({
      ready: tasksReady() && taskRunsReady(),
      columns: KANBAN_COLUMNS,
      executors: EXECUTOR_KINDS,
      host_bridge_ready: hostBridgeReady(),
      hermes_configured: hermesKanbanConfigured(),
      max_concurrent: maxConcurrentAiRuns(),
      assignable_users: assignable.map((u) => ({
        id: u.id,
        username: u.username,
        kind: u.kind,
      })),
    });
  });

  tasksRoutes.get("/", async (c) => {
    const session = await getSessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    if (!tasksReady()) {
      return c.json(
        { error: "schéma tasks plateforme requis", tasks: [], columns: {} },
        503,
      );
    }
    // Rafraîchit les tâches Hermes à chaque board (comme l'ancien /todos),
    // sauf sync=0 explicite.
    let syncMeta: Awaited<ReturnType<typeof syncHermesTasks>> | null = null;
    if (c.req.query("sync") !== "0" && hermesKanbanConfigured()) {
      syncMeta = await syncHermesTasks();
    }
    const tasks = listTasks({
      status: c.req.query("status") || undefined,
      assigneeUserId: c.req.query("assignee") || undefined,
      executor: c.req.query("executor") || undefined,
    });
    return c.json({
      tasks,
      columns: tasksByColumn(tasks),
      host_bridge_ready: hostBridgeReady(),
      hermes_configured: hermesKanbanConfigured(),
      max_concurrent: maxConcurrentAiRuns(),
      sync: syncMeta,
    });
  });

  tasksRoutes.post("/sync", async (c) => {
    const session = await getSessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    if (!tasksReady()) return c.json({ error: "schéma tasks plateforme requis" }, 503);
    const sync = await syncHermesTasks();
    const tasks = listTasks();
    return c.json({ ok: true, sync, tasks, columns: tasksByColumn(tasks) });
  });

  tasksRoutes.get("/runs/:runId/stream", async (c) => {
    const session = await getSessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    const runId = c.req.param("runId");
    const run = getTaskRun(runId);
    if (!run) return c.json({ error: "Run introuvable" }, 404);

    return sseResponse(c, (send) => {
      send("run", { run: getTaskRun(runId) });
      const after = Number(c.req.query("after") || "0") || 0;
      for (const log of listAgentLogs(runId, after)) {
        send("log", { log, run: getTaskRun(runId) });
      }
      const offLog = subscribeAgentLogs(runId, (ev) => {
        send("log", { log: ev.log, run: ev.run });
      });
      const offRun = subscribeTaskRuns(runId, (r) => {
        send("run", { run: r });
      });
      return () => {
        offLog();
        offRun();
      };
    });
  });

  tasksRoutes.get("/runs/:runId/logs", async (c) => {
    const actor = await getTaskActor(c);
    if (!actor) return c.json({ error: "Non authentifié" }, 401);
    const run = getTaskRun(c.req.param("runId"));
    if (!run) return c.json({ error: "Run introuvable" }, 404);
    const after = Number(c.req.query("after") || "0") || 0;
    const logs = listAgentLogs(run.id, after);
    return c.json({ run, logs, host_bridge_ready: hostBridgeReady() });
  });

  tasksRoutes.get("/runs/:runId", async (c) => {
    const actor = await getTaskActor(c);
    if (!actor) return c.json({ error: "Non authentifié" }, 401);
    const run = getTaskRun(c.req.param("runId"));
    if (!run) return c.json({ error: "Run introuvable" }, 404);
    return c.json({ task: getTask(run.task_id), run });
  });

  tasksRoutes.post("/runs/:runId/retry", async (c) => {
    const session = await getSessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    let run;
    try {
      run = retryFailedRun(c.req.param("runId"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("quota_exceeded")) {
        return c.json({ error: msg, code: "quota_exceeded" }, 429);
      }
      return c.json({ error: msg }, 400);
    }
    if (!run) {
      return c.json(
        { error: "Retry impossible (run non failed/cancelled ou tâche absente)" },
        400,
      );
    }
    void processAiTaskQueue();
    return c.json({
      ok: true,
      run,
      task: getTask(run.task_id),
      host_bridge_ready: hostBridgeReady(),
    });
  });

  tasksRoutes.post("/runs/:runId/resume", async (c) => {
    const actor = await getTaskActor(c);
    if (!actor) return c.json({ error: "Non authentifié" }, 401);
    const body = await c.req.json().catch(() => ({}));
    const response =
      typeof (body as { response?: string }).response === "string"
        ? (body as { response: string }).response
        : "ok";
    const run = resumeHitlRun(c.req.param("runId"), response);
    if (!run) {
      return c.json({ error: "Aucune pause HITL active sur ce run" }, 400);
    }
    return c.json({ ok: true, run });
  });

  tasksRoutes.post("/runs/:runId/cancel", async (c) => {
    const session = await getSessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    const run = cancelTaskRun(c.req.param("runId"));
    if (!run) return c.json({ error: "Run introuvable" }, 404);
    return c.json({ ok: true, run });
  });

  tasksRoutes.get("/activity/:userId/stream", async (c) => {
    const session = await getSessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    const userId = c.req.param("userId");

    return sseResponse(c, (send) => {
      const { run, task } = getAiActivityForUser(userId);
      let currentRunId = run?.id || null;
      if (!run) {
        const last = queryOne<{ id: string }>(
          `SELECT id FROM task_runs WHERE assignee_user_id = ?
           ORDER BY created_at DESC LIMIT 1`,
          [userId],
        );
        if (last) {
          const lastRun = getTaskRun(last.id);
          currentRunId = lastRun?.id || null;
          send("snapshot", {
            run: lastRun,
            task: lastRun ? getTask(lastRun.task_id) : null,
            logs: lastRun ? listAgentLogs(lastRun.id, 0) : [],
          });
        } else {
          send("snapshot", { run: null, task: null, logs: [] });
        }
      } else {
        send("snapshot", {
          run,
          task,
          logs: listAgentLogs(run.id, 0),
        });
      }

      const offLog = subscribeAgentLogs(userId, (ev) => {
        currentRunId = ev.run.id;
        send("log", { log: ev.log, run: ev.run });
      });
      const offRun = subscribeTaskRuns(userId, (r) => {
        currentRunId = r.id;
        send("run", { run: r, task: getTask(r.task_id) });
      });
      return () => {
        offLog();
        offRun();
        void currentRunId;
      };
    });
  });

  /**
   * Vue live (lecture seule) d'un espace IA : frames JPEG en SSE.
   * Le screencast desktop est démarré au 1er spectateur et arrêté au dernier
   * (l'app desktop a en plus son auto-stop si les frames ne servent à personne).
   */
  tasksRoutes.get("/screencast/:aiUserId/stream", async (c) => {
    const session = await getSessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    const aiUserId = c.req.param("aiUserId");
    const ai = getUserById(aiUserId);
    if (!ai || ai.kind !== "ai") {
      return c.json({ error: "Collaborateur IA introuvable" }, 404);
    }

    return sseResponse(c, (send) => {
      const firstViewer = screencastViewerCount(aiUserId) === 0;
      const off = subscribeScreencast(aiUserId, (frame) => {
        send("frame", { seq: frame.seq, ts: frame.ts, data: frame.data });
      });
      if (firstViewer) {
        void startScreencastOnHost(aiUserId).then((r) => {
          if (r && r.ok !== true) {
            send("status", {
              ok: false,
              error: r.error || "Screencast indisponible",
              code: r.code || null,
            });
          } else {
            send("status", { ok: true });
          }
        });
      } else {
        send("status", { ok: true });
      }
      return () => {
        off();
        if (screencastViewerCount(aiUserId) === 0) {
          void stopScreencastOnHost(aiUserId);
        }
      };
    });
  });

  tasksRoutes.get("/activity/:userId", async (c) => {
    const session = await getSessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    const { run, task } = getAiActivityForUser(c.req.param("userId"));
    const after = Number(c.req.query("after") || "0") || 0;
    const logs = run ? listAgentLogs(run.id, after) : [];
    if (!run && taskRunsReady()) {
      const last = queryOne<{ id: string }>(
        `SELECT id FROM task_runs WHERE assignee_user_id = ?
         ORDER BY created_at DESC LIMIT 1`,
        [c.req.param("userId")],
      );
      if (last) {
        const lastRun = getTaskRun(last.id);
        const lastLogs = lastRun ? listAgentLogs(lastRun.id, after) : [];
        return c.json({
          run: lastRun,
          task: lastRun ? getTask(lastRun.task_id) : null,
          logs: lastLogs,
          host_bridge_ready: hostBridgeReady(),
        });
      }
    }
    return c.json({
      run,
      task,
      logs,
      host_bridge_ready: hostBridgeReady(),
    });
  });

  tasksRoutes.post("/runner/tick", async (c) => {
    const session = await getSessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    const result = await processAiTaskQueue();
    return c.json({
      ok: true,
      ...result,
      host_bridge_ready: hostBridgeReady(),
      max_concurrent: maxConcurrentAiRuns(),
    });
  });

  tasksRoutes.post("/logs/purge", async (c) => {
    const session = await getSessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    if (sessionIsImpersonating(session)) {
      return c.json(
        { error: "Revenez à votre compte pour cette action" },
        403,
      );
    }
    if (!sessionActorIsOwner(session)) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    const body = await c.req.json().catch(() => ({}));
    const days = Number((body as { days?: number }).days ?? 30) || 30;
    const result = purgeAgentLogsOlderThan(days);
    return c.json({ ok: true, days, ...result });
  });

  tasksRoutes.get("/:id", async (c) => {
    const actor = await getTaskActor(c);
    if (!actor) return c.json({ error: "Non authentifié" }, 401);
    const detail = await getTaskDetail(c.req.param("id"));
    if (!detail) return c.json({ error: "Tâche introuvable" }, 404);
    const runs = taskRunsReady() ? listTaskRunsForTask(detail.task.id) : [];
    const subtasks = listTasks({
      parentTaskId: detail.task.id,
      includeCancelled: true,
    });
    return c.json({ ...detail, runs, subtasks });
  });

  const createSchema = z.object({
    title: z.string().min(1).max(300),
    body: z.string().max(8000).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    executor_kind: z.enum(EXECUTOR_KINDS).optional(),
    assignee_user_id: z.string().min(1).nullable().optional(),
    parent_task_id: z.string().min(1).nullable().optional(),
    priority: z.number().int().optional(),
    recurring_schedule: z.string().max(120).nullable().optional(),
    dispatch: z.boolean().optional(),
    launch: z.boolean().optional(),
  });

  tasksRoutes.post("/", async (c) => {
    const actor = await getTaskActor(c);
    if (!actor) return c.json({ error: "Non authentifié" }, 401);
    const body = await c.req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Payload invalide", details: parsed.error.issues }, 400);
    }
    try {
      const { task, hermes, warning } = await createTask({
        title: parsed.data.title,
        body: parsed.data.body,
        status: parsed.data.status,
        executorKind: parsed.data.executor_kind,
        assigneeUserId: parsed.data.assignee_user_id,
        parentTaskId: parsed.data.parent_task_id,
        createdBy: actor.userId,
        priority: parsed.data.priority,
        recurringSchedule: parsed.data.recurring_schedule,
        dispatch: parsed.data.dispatch,
        source: "ui",
      });
      let run = null;
      const shouldLaunch =
        parsed.data.launch || parsed.data.status === "in_progress";
      if (shouldLaunch && task.executor_kind === "ai") {
        if (task.status === "backlog") {
          await updateTask(task.id, { status: "in_progress" });
        }
        run = enqueueAiRunForTask(task.id);
        void processAiTaskQueue();
      }
      return c.json(
        {
          ok: true,
          task: getTask(task.id),
          run,
          hermes_task_id: hermes?.id || null,
          warning: warning || null,
        },
        201,
      );
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  tasksRoutes.patch("/:id", async (c) => {
    const session = await getSessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    const body = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({
        title: z.string().min(1).max(300).optional(),
        body: z.string().max(8000).optional(),
        status: z.enum(TASK_STATUSES).optional(),
        assignee_user_id: z.string().min(1).nullable().optional(),
        priority: z.number().int().optional(),
        result: z.string().max(8000).optional(),
        launch: z.boolean().optional(),
      })
      .safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Payload invalide", details: parsed.error.issues }, 400);
    }
    try {
      const before = getTask(c.req.param("id"));
      if (!before) return c.json({ error: "Tâche introuvable" }, 404);
      const task = await updateTask(c.req.param("id"), {
        title: parsed.data.title,
        body: parsed.data.body,
        status: parsed.data.status,
        assigneeUserId: parsed.data.assignee_user_id,
        priority: parsed.data.priority,
        result: parsed.data.result,
      });
      let run = null;
      const movedToProgress =
        parsed.data.status === "in_progress" && before.status !== "in_progress";
      if (
        (parsed.data.launch || movedToProgress) &&
        task.executor_kind === "ai"
      ) {
        run = enqueueAiRunForTask(task.id);
        void processAiTaskQueue();
      }
      return c.json({ ok: true, task, run });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  tasksRoutes.delete("/:id", async (c) => {
    const session = await getSessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    const ok = await deleteTask(c.req.param("id"));
    if (!ok) return c.json({ error: "Tâche introuvable" }, 404);
    return c.json({ ok: true });
  });

  tasksRoutes.post("/:id/launch", async (c) => {
    const actor = await getTaskActor(c);
    if (!actor) return c.json({ error: "Non authentifié" }, 401);
    const task = getTask(c.req.param("id"));
    if (!task) return c.json({ error: "Tâche introuvable" }, 404);
    if (task.executor_kind !== "ai" || !task.assignee || task.assignee.kind !== "ai") {
      return c.json(
        { error: "La tâche doit être assignée à un collaborateur IA" },
        400,
      );
    }
    if (task.status === "backlog" || task.status === "done") {
      await updateTask(task.id, { status: "in_progress" });
    }
    let run;
    try {
      run = enqueueAiRunForTask(task.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("quota_exceeded")) {
        return c.json({ error: msg, code: "quota_exceeded" }, 429);
      }
      return c.json({ error: msg }, 400);
    }
    void processAiTaskQueue();
    return c.json({
      ok: true,
      task: getTask(task.id),
      run,
      host_bridge_ready: hostBridgeReady(),
    });
  });

  return tasksRoutes;
}
