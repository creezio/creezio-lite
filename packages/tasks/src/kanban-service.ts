/**
 * Kanban unifié « Tâches » (schéma tasks plateforme) — une tâche a un exécutant :
 * - `human`  : collaborateur humain (kanban simple)
 * - `ai`     : collaborateur IA (runs `task_runs` + workspace Electron dédié)
 * - `hermes` : agent central Hermes (carte kanban WebUI, sync bidirectionnelle)
 *
 * Remplace `cabinet-tasks.ts` et `todo-queries.ts`.
 */
import { randomUUID } from "node:crypto";
import {
  hermesCronCreate,
  hermesKanbanConfigured,
  hermesKanbanCreateTask,
  hermesKanbanDispatch,
  hermesKanbanGetTask,
  hermesKanbanListTasks,
  hermesKanbanPatchTask,
  type HermesKanbanStatus,
  type HermesKanbanTask,
  type HermesKanbanTaskDetail,
} from "@creezio/assistant";
import { requireTasksBrand, type TasksUser } from "./brand/config.js";
import { upsertKitPlatformTask } from "./env-bridge.js";

function getWriteDb() {
  return requireTasksBrand().db.getWriteDb();
}
function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  return requireTasksBrand().db.queryAll<T>(sql, params);
}
function queryOne<T>(sql: string, params: unknown[] = []): T | null | undefined {
  return requireTasksBrand().db.queryOne<T>(sql, params);
}
function tableExists(name: string): boolean {
  return requireTasksBrand().db.tableExists(name);
}
function getUserById(id: string): TasksUser | null {
  return requireTasksBrand().users.getById(id);
}

export const TASK_STATUSES = [
  "backlog",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const EXECUTOR_KINDS = ["human", "ai", "hermes"] as const;
export type ExecutorKind = (typeof EXECUTOR_KINDS)[number];

export const KANBAN_COLUMNS = [
  { id: "backlog", label: "Backlog" },
  { id: "in_progress", label: "En cours" },
  { id: "blocked", label: "Bloqué" },
  { id: "done", label: "Terminé" },
] as const;

export type TaskSource = "assistant" | "ui" | "sync" | "hermes";

export type TaskRow = {
  id: string;
  title: string;
  body: string;
  status: TaskStatus;
  position: number;
  executor_kind: ExecutorKind;
  assignee_user_id: string | null;
  parent_task_id: string | null;
  created_by: string | null;
  priority: number;
  hermes_task_id: string | null;
  hermes_cron_id: string | null;
  hermes_status: string | null;
  recurring_schedule: string | null;
  source: TaskSource;
  conversation_id: string | null;
  idempotency_key: string | null;
  result: string | null;
  last_synced_at: string | null;
  /** Prochaine occurrence d'une tâche IA récurrente (migration 031). */
  next_run_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type Task = TaskRow & {
  assignee: TasksUser | null;
};

/** Statut Hermes (9 états) → statut kanban unifié (5 états). */
export function hermesToTaskStatus(status: string): TaskStatus {
  switch (status) {
    case "ready":
    case "running":
      return "in_progress";
    case "blocked":
    case "review":
      return "blocked";
    case "done":
      return "done";
    case "archived":
      return "cancelled";
    default:
      // triage / todo / scheduled / inconnu
      return "backlog";
  }
}

/** Statut kanban unifié → statut Hermes (pour pousser un drag & drop). */
export function taskToHermesStatus(status: TaskStatus): HermesKanbanStatus {
  switch (status) {
    case "backlog":
      return "todo";
    case "in_progress":
      return "ready";
    case "blocked":
      return "blocked";
    case "done":
      return "done";
    case "cancelled":
      return "archived";
  }
}

const enrich = (r: TaskRow): Task => ({
  ...r,
  assignee: r.assignee_user_id ? getUserById(r.assignee_user_id) : null,
});

export const tasksReady = () => tableExists("tasks");

function nowIso() {
  return new Date().toISOString();
}

function nextPosition(status: TaskStatus): number {
  return (
    (queryOne<{ m: number | null }>(
      "SELECT MAX(position) m FROM tasks WHERE status=?",
      [status],
    )?.m || 0) + 1
  );
}

export function listTasks(opts?: {
  status?: string;
  assigneeUserId?: string;
  executor?: string;
  parentTaskId?: string;
  includeCancelled?: boolean;
}): Task[] {
  if (!tasksReady()) return [];
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts?.status) {
    where.push("status=?");
    args.push(opts.status);
  } else if (!opts?.includeCancelled) {
    where.push("status != 'cancelled'");
  }
  if (opts?.assigneeUserId) {
    where.push("assignee_user_id=?");
    args.push(opts.assigneeUserId);
  }
  if (opts?.executor) {
    where.push("executor_kind=?");
    args.push(opts.executor);
  }
  if (opts?.parentTaskId) {
    where.push("parent_task_id=?");
    args.push(opts.parentTaskId);
  }
  const sql = `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY status, position, updated_at DESC`;
  return queryAll<TaskRow>(sql, args).map(enrich);
}

export const tasksByColumn = (tasks: Task[]) => ({
  backlog: tasks.filter((t) => t.status === "backlog"),
  in_progress: tasks.filter((t) => t.status === "in_progress"),
  blocked: tasks.filter((t) => t.status === "blocked"),
  done: tasks.filter((t) => t.status === "done"),
});

export const getTask = (id: string): Task | null => {
  const r = tasksReady()
    ? queryOne<TaskRow>("SELECT * FROM tasks WHERE id=?", [id])
    : null;
  return r ? enrich(r) : null;
};

export const getTaskByHermesId = (hermesId: string): Task | null => {
  const r = tasksReady()
    ? queryOne<TaskRow>("SELECT * FROM tasks WHERE hermes_task_id=?", [hermesId])
    : null;
  return r ? enrich(r) : null;
};

export const getTaskByIdempotency = (key: string): Task | null => {
  const r = tasksReady()
    ? queryOne<TaskRow>("SELECT * FROM tasks WHERE idempotency_key=?", [key])
    : null;
  return r ? enrich(r) : null;
};

export const listSubtasks = (parentTaskId: string): Task[] =>
  listTasks({ parentTaskId, includeCancelled: true });

export type CreateTaskInput = {
  title: string;
  body?: string;
  status?: TaskStatus;
  executorKind?: ExecutorKind;
  assigneeUserId?: string | null;
  parentTaskId?: string | null;
  createdBy?: string | null;
  priority?: number;
  source?: TaskSource;
  conversationId?: string | null;
  idempotencyKey?: string | null;
  /** Hermes uniquement — récurrence cron (ex. `every 1d`, `0 9 * * 1`). */
  recurringSchedule?: string | null;
  /** Hermes uniquement — dispatch immédiat (défaut true). */
  dispatch?: boolean;
};

/** Invariants exécutant / assigné (levés en Error → 400 côté API). */
function assertExecutorInvariants(
  executor: ExecutorKind,
  assigneeUserId: string | null | undefined,
) {
  if (executor === "hermes") {
    if (assigneeUserId) {
      throw new Error("Une tâche Hermes n'a pas d'assigné (exécutant central)");
    }
    return;
  }
  if (!assigneeUserId) {
    if (executor === "ai") {
      throw new Error("Une tâche IA doit être assignée à un collaborateur IA");
    }
    return;
  }
  const user = getUserById(assigneeUserId);
  if (!user) throw new Error("Assigné introuvable");
  if (executor === "ai" && user.kind !== "ai") {
    throw new Error("L'assigné d'une tâche IA doit être un collaborateur IA");
  }
  if (executor === "human" && user.kind !== "human") {
    throw new Error("L'assigné d'une tâche humaine doit être un humain");
  }
}

function insertLocal(row: TaskRow) {
  // C1 — SoT kit d’abord (même UUID), puis extension brand kanban/AI
  upsertKitPlatformTask({
    id: row.id,
    userId: row.assignee_user_id || row.created_by || "system",
    title: row.title,
    body: row.body || "",
    status:
      row.status === "done" || row.status === "cancelled"
        ? row.status
        : "open",
  });
  getWriteDb()
    .prepare(
      `INSERT INTO tasks (
        id, title, body, status, position, executor_kind, assignee_user_id,
        parent_task_id, created_by, priority, hermes_task_id, hermes_cron_id,
        hermes_status, recurring_schedule, source, conversation_id,
        idempotency_key, result, last_synced_at, created_at, updated_at
      ) VALUES (
        @id, @title, @body, @status, @position, @executor_kind, @assignee_user_id,
        @parent_task_id, @created_by, @priority, @hermes_task_id, @hermes_cron_id,
        @hermes_status, @recurring_schedule, @source, @conversation_id,
        @idempotency_key, @result, @last_synced_at, @created_at, @updated_at
      )`,
    )
    .run(row);
}

function updateLocal(
  id: string,
  patch: Partial<
    Pick<
      TaskRow,
      | "title"
      | "body"
      | "status"
      | "position"
      | "assignee_user_id"
      | "priority"
      | "hermes_task_id"
      | "hermes_cron_id"
      | "hermes_status"
      | "result"
      | "last_synced_at"
      | "recurring_schedule"
      | "executor_kind"
    >
  >,
): Task | null {
  const old = getTask(id);
  if (!old) return null;
  // Les clés `undefined` du patch ne doivent pas écraser les valeurs.
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  );
  const next: TaskRow = { ...old, ...defined, updated_at: nowIso() };
  // Changement de colonne → fin de colonne cible.
  if (patch.status && patch.status !== old.status && patch.position == null) {
    next.position = nextPosition(patch.status);
  }
  upsertKitPlatformTask({
    id: next.id,
    userId: next.assignee_user_id || next.created_by || "system",
    title: next.title,
    body: next.body || "",
    status:
      next.status === "done" || next.status === "cancelled"
        ? next.status
        : "open",
  });
  getWriteDb()
    .prepare(
      `UPDATE tasks SET
        title=@title, body=@body, status=@status, position=@position,
        executor_kind=@executor_kind, assignee_user_id=@assignee_user_id,
        priority=@priority, hermes_task_id=@hermes_task_id,
        hermes_cron_id=@hermes_cron_id, hermes_status=@hermes_status,
        recurring_schedule=@recurring_schedule, result=@result,
        last_synced_at=@last_synced_at, updated_at=@updated_at
      WHERE id=@id`,
    )
    .run(next);
  return getTask(id);
}

/**
 * Pousse une tâche executor=hermes vers le kanban Hermes WebUI.
 * Retourne la carte, ou une erreur (tâche laissée `blocked` par l'appelant).
 */
async function pushTaskToHermes(task: Task, opts?: { dispatch?: boolean }): Promise<{
  hermes?: HermesKanbanTask;
  cronId?: string | null;
  error?: string;
}> {
  if (!hermesKanbanConfigured()) {
    return { error: "Hermes non configuré (gateway/WebUI hors ligne)" };
  }
  try {
    const hermes = await hermesKanbanCreateTask({
      title: task.title,
      body: [
        task.body,
        "",
        "—",
        `Source: ${requireTasksBrand().hermesSourceLabel}`,
        task.conversation_id ? `Conversation: ${task.conversation_id}` : null,
        `CRM task: ${task.id}`,
        task.recurring_schedule ? `Récurrence: ${task.recurring_schedule}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      status: "ready",
      priority: task.priority,
      idempotencyKey: task.idempotency_key || `${requireTasksBrand().idempotencyPrefix}:${task.id}`,
    });
    let cronId: string | null = null;
    let error: string | undefined;
    if (task.recurring_schedule?.trim()) {
      try {
        const cron = await hermesCronCreate({
          schedule: task.recurring_schedule.trim(),
          name: task.title.slice(0, 80),
          prompt: [
            `Tâche récurrente ${requireTasksBrand().hermesSourceLabel} « ${task.title} ».`,
            task.body || "Exécute la mission et mets à jour le kanban.",
            `Charge le skill ${requireTasksBrand().hermesSkill}.`,
            `CRM task id: ${task.id}`,
          ].join("\n"),
        });
        cronId = cron.id || null;
      } catch (e) {
        error = `cron: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    if (opts?.dispatch !== false && hermes.status === "ready") {
      try {
        await hermesKanbanDispatch();
      } catch {
        /* dispatch best-effort */
      }
    }
    return { hermes, cronId, error };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Crée une tâche. Pour executor=hermes : pousse la carte Hermes ; si Hermes
 * est indisponible la tâche reste `blocked` et sera re-poussée à la synchro.
 */
export async function createTask(
  input: CreateTaskInput,
): Promise<{ task: Task; hermes?: HermesKanbanTask; warning?: string }> {
  if (!tasksReady()) throw new Error("Table tasks absente (schéma tasks plateforme requis)");
  const title = input.title.trim();
  if (!title) throw new Error("title requis");
  const executor: ExecutorKind = input.executorKind || "human";
  assertExecutorInvariants(executor, input.assigneeUserId);
  if (input.parentTaskId && !getTask(input.parentTaskId)) {
    throw new Error("Tâche parente introuvable");
  }

  if (input.idempotencyKey) {
    const existing = getTaskByIdempotency(input.idempotencyKey);
    if (existing) return { task: existing };
  }

  const ts = nowIso();
  const id = randomUUID();
  const status: TaskStatus = input.status || "backlog";
  const row: TaskRow = {
    id,
    title,
    body: (input.body || "").trim(),
    status,
    position: nextPosition(status),
    executor_kind: executor,
    assignee_user_id: input.assigneeUserId || null,
    parent_task_id: input.parentTaskId || null,
    created_by: input.createdBy || null,
    priority: input.priority || 0,
    hermes_task_id: null,
    hermes_cron_id: null,
    hermes_status: null,
    recurring_schedule: input.recurringSchedule?.trim() || null,
    source: input.source || "ui",
    conversation_id: input.conversationId || null,
    idempotency_key: input.idempotencyKey?.trim() || `${requireTasksBrand().idempotencyPrefix}:${id}`,
    result: null,
    last_synced_at: null,
    created_at: ts,
    updated_at: ts,
  };
  insertLocal(row);

  if (executor !== "hermes") {
    return { task: getTask(id)! };
  }

  const pushed = await pushTaskToHermes(getTask(id)!, {
    dispatch: input.dispatch,
  });
  if (pushed.hermes) {
    updateLocal(id, {
      hermes_task_id: pushed.hermes.id,
      hermes_cron_id: pushed.cronId ?? null,
      hermes_status: String(pushed.hermes.status || "ready"),
      status: hermesToTaskStatus(String(pushed.hermes.status || "ready")),
      last_synced_at: nowIso(),
    });
    return { task: getTask(id)!, hermes: pushed.hermes, warning: pushed.error };
  }
  // Hermes indisponible : la tâche attend, re-push à la prochaine synchro.
  updateLocal(id, {
    status: "blocked",
    result: `En attente d'Hermes — ${pushed.error || "indisponible"}`,
  });
  return { task: getTask(id)!, warning: pushed.error };
}

export type UpdateTaskInput = {
  title?: string;
  body?: string;
  status?: TaskStatus;
  assigneeUserId?: string | null;
  priority?: number;
  result?: string;
};

/**
 * Met à jour une tâche ; si elle est liée à une carte Hermes, propage le
 * changement (statut traduit) avant l'écriture locale.
 */
export async function updateTask(
  id: string,
  patch: UpdateTaskInput,
): Promise<Task> {
  const old = getTask(id);
  if (!old) throw new Error("Tâche introuvable");
  if (patch.assigneeUserId !== undefined && old.executor_kind !== "hermes") {
    assertExecutorInvariants(old.executor_kind, patch.assigneeUserId);
  }
  if (patch.assigneeUserId && old.executor_kind === "hermes") {
    throw new Error("Une tâche Hermes n'a pas d'assigné");
  }

  let hermesStatus: string | null | undefined;
  if (old.hermes_task_id && hermesKanbanConfigured()) {
    try {
      const ht = await hermesKanbanPatchTask(old.hermes_task_id, {
        title: patch.title,
        body: patch.body,
        status: patch.status ? taskToHermesStatus(patch.status) : undefined,
        priority: patch.priority,
        result: patch.result,
      });
      hermesStatus = String(ht.status || "");
    } catch {
      /* Hermes injoignable — mise à jour locale quand même, resync plus tard */
    }
  }

  return updateLocal(id, {
    title: patch.title,
    body: patch.body,
    status: patch.status,
    assignee_user_id:
      patch.assigneeUserId === undefined ? old.assignee_user_id : patch.assigneeUserId,
    priority: patch.priority,
    result: patch.result,
    ...(hermesStatus ? { hermes_status: hermesStatus, last_synced_at: nowIso() } : {}),
  })!;
}

/** Mise à jour locale directe (runner / interne — pas de propagation Hermes). */
export function updateTaskLocal(
  id: string,
  patch: Partial<Pick<TaskRow, "status" | "result">>,
): Task | null {
  return updateLocal(id, patch);
}

/** Colonne next_run_at présente (migration 031 — récurrence IA). */
export function tasksRecurrenceReady(): boolean {
  if (!tasksReady()) return false;
  try {
    const cols = queryAll<{ name: string }>(`PRAGMA table_info(tasks)`);
    return cols.some((c) => c.name === "next_run_at");
  } catch {
    return false;
  }
}

/** Tâches IA récurrentes actives (pilotées par le tick du runner). */
export function listRecurringAiTasks(): Task[] {
  if (!tasksRecurrenceReady()) return [];
  return queryAll<TaskRow>(
    `SELECT * FROM tasks
     WHERE executor_kind = 'ai'
       AND recurring_schedule IS NOT NULL AND recurring_schedule != ''
       AND status != 'cancelled'
     ORDER BY created_at ASC`,
  ).map(enrich);
}

export function setTaskNextRun(id: string, nextRunAt: string | null): void {
  if (!tasksRecurrenceReady()) return;
  getWriteDb()
    .prepare(`UPDATE tasks SET next_run_at = ?, updated_at = ? WHERE id = ?`)
    .run(nextRunAt, nowIso(), id);
}

export async function deleteTask(id: string): Promise<boolean> {
  const task = getTask(id);
  if (!task) return false;
  if (task.hermes_task_id && hermesKanbanConfigured()) {
    try {
      await hermesKanbanPatchTask(task.hermes_task_id, { status: "archived" });
    } catch {
      /* best-effort */
    }
  }
  return getWriteDb().prepare("DELETE FROM tasks WHERE id=?").run(id).changes > 0;
}

/**
 * Synchronisation Hermes ↔ tasks :
 * 1. tire le board WebUI → met à jour les tâches liées (statut mappé, résultat) ;
 * 2. importe les cartes inconnues (source `hermes`) ;
 * 3. re-pousse les tâches executor=hermes jamais liées (création hors ligne).
 */
export async function syncHermesTasks(): Promise<{
  updated: number;
  created: number;
  pushed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  if (!tasksReady()) {
    return { updated: 0, created: 0, pushed: 0, errors: ["table tasks absente"] };
  }
  if (!hermesKanbanConfigured()) {
    return { updated: 0, created: 0, pushed: 0, errors: ["Hermes non configuré"] };
  }

  let remote: HermesKanbanTask[] = [];
  try {
    remote = await hermesKanbanListTasks();
  } catch (e) {
    return {
      updated: 0,
      created: 0,
      pushed: 0,
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }

  let updated = 0;
  let created = 0;
  let pushed = 0;
  const ts = nowIso();

  for (const ht of remote) {
    try {
      const local = getTaskByHermesId(ht.id);
      if (local) {
        const mapped = hermesToTaskStatus(String(ht.status));
        const changed =
          local.hermes_status !== String(ht.status) ||
          local.title !== ht.title ||
          (ht.result && local.result !== ht.result);
        updateLocal(local.id, {
          title: ht.title,
          body: ht.body || local.body,
          status: mapped,
          hermes_status: String(ht.status),
          priority: ht.priority ?? local.priority,
          result: ht.result ?? local.result,
          last_synced_at: ts,
        });
        if (changed) updated += 1;
      } else {
        const id = randomUUID();
        insertLocal({
          id,
          title: ht.title,
          body: ht.body || "",
          status: hermesToTaskStatus(String(ht.status)),
          position: nextPosition(hermesToTaskStatus(String(ht.status))),
          executor_kind: "hermes",
          assignee_user_id: null,
          parent_task_id: null,
          created_by: null,
          priority: ht.priority ?? 0,
          hermes_task_id: ht.id,
          hermes_cron_id: null,
          hermes_status: String(ht.status),
          recurring_schedule: null,
          source: "hermes",
          conversation_id: null,
          idempotency_key: ht.idempotency_key || `hermes:${ht.id}`,
          result: ht.result || null,
          last_synced_at: ts,
          created_at: ts,
          updated_at: ts,
        });
        created += 1;
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  // Re-push des tâches Hermes créées hors ligne (jamais liées).
  const pending = queryAll<TaskRow>(
    `SELECT * FROM tasks
     WHERE executor_kind='hermes' AND hermes_task_id IS NULL
       AND status NOT IN ('done','cancelled')`,
  );
  for (const row of pending) {
    try {
      const result = await pushTaskToHermes(enrich(row));
      if (result.hermes) {
        updateLocal(row.id, {
          hermes_task_id: result.hermes.id,
          hermes_cron_id: result.cronId ?? null,
          hermes_status: String(result.hermes.status || "ready"),
          status: hermesToTaskStatus(String(result.hermes.status || "ready")),
          result: null,
          last_synced_at: ts,
        });
        pushed += 1;
      } else if (result.error) {
        errors.push(result.error);
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return { updated, created, pushed, errors };
}

/** Détail tâche + rafraîchissement Hermes si liée. */
export async function getTaskDetail(id: string): Promise<{
  task: Task;
  hermes: HermesKanbanTaskDetail | null;
  hermesError: string | null;
} | null> {
  const task = getTask(id);
  if (!task) return null;

  if (task.hermes_task_id && hermesKanbanConfigured()) {
    try {
      const hermes = await hermesKanbanGetTask(task.hermes_task_id);
      const ht = hermes.task;
      if (
        String(ht.status) !== task.hermes_status ||
        (ht.result && ht.result !== task.result) ||
        ht.title !== task.title
      ) {
        updateLocal(task.id, {
          title: ht.title,
          body: ht.body || task.body,
          status: hermesToTaskStatus(String(ht.status)),
          hermes_status: String(ht.status),
          result: ht.result ?? task.result,
          last_synced_at: nowIso(),
        });
      }
      return { task: getTask(id)!, hermes, hermesError: null };
    } catch (e) {
      return {
        task,
        hermes: null,
        hermesError: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return { task, hermes: null, hermesError: null };
}
