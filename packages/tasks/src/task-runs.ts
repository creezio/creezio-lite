/**
 * Runs d'exécution des tâches IA + logs session agent.
 */
import { randomUUID } from "node:crypto";
import { requireTasksBrand, tasksEnv } from "./brand/config.js";

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

export const RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export type TaskRunRow = {
  id: string;
  task_id: string;
  assignee_user_id: string;
  status: RunStatus;
  host_device_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  step_count: number;
  hitl_prompt: string | null;
  hitl_response: string | null;
  retry_of: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentLogLevel =
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "tool"
  | "decision"
  | "nav";

export type AgentSessionLog = {
  id: string;
  run_id: string;
  seq: number;
  level: AgentLogLevel;
  event_type: string;
  message: string;
  payload_json: string | null;
  created_at: string;
};

export type AgentLogEvent = {
  run: TaskRunRow;
  log: AgentSessionLog;
};

type LogListener = (ev: AgentLogEvent) => void;
type RunListener = (run: TaskRunRow) => void;

const g = globalThis as unknown as {
  __creezioTasksAgentLogListeners?: Map<string, Set<LogListener>>;
  __creezioTasksAgentRunListeners?: Map<string, Set<RunListener>>;
};

const logListeners: Map<string, Set<LogListener>> =
  g.__creezioTasksAgentLogListeners ?? new Map();
g.__creezioTasksAgentLogListeners = logListeners;

const runListeners: Map<string, Set<RunListener>> =
  g.__creezioTasksAgentRunListeners ?? new Map();
g.__creezioTasksAgentRunListeners = runListeners;

function notifyLog(ev: AgentLogEvent): void {
  const keys = [ev.run.id, ev.run.assignee_user_id, "*"];
  for (const key of keys) {
    const set = logListeners.get(key);
    if (!set) continue;
    for (const fn of Array.from(set)) {
      try {
        fn(ev);
      } catch {
        /* ignore */
      }
    }
  }
}

function notifyRun(run: TaskRunRow): void {
  const keys = [run.id, run.assignee_user_id, "*"];
  for (const key of keys) {
    const set = runListeners.get(key);
    if (!set) continue;
    for (const fn of Array.from(set)) {
      try {
        fn(run);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Abonne aux logs d'un run, d'un user (assignee) ou `*` (tous). */
export function subscribeAgentLogs(
  key: string,
  fn: LogListener,
): () => void {
  let set = logListeners.get(key);
  if (!set) {
    set = new Set();
    logListeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) logListeners.delete(key);
  };
}

export function subscribeTaskRuns(
  key: string,
  fn: RunListener,
): () => void {
  let set = runListeners.get(key);
  if (!set) {
    set = new Set();
    runListeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) runListeners.delete(key);
  };
}

function normalizeRun(row: TaskRunRow | null): TaskRunRow | null {
  if (!row) return null;
  return {
    ...row,
    hitl_prompt: row.hitl_prompt ?? null,
    hitl_response: row.hitl_response ?? null,
    retry_of: row.retry_of ?? null,
  };
}

export function taskRunsReady(): boolean {
  return tableExists("task_runs") && tableExists("agent_session_logs");
}

export function taskRunsHitlReady(): boolean {
  if (!taskRunsReady()) return false;
  try {
    const cols = queryAll<{ name: string }>(`PRAGMA table_info(task_runs)`);
    return cols.some((c) => c.name === "hitl_prompt");
  } catch {
    return false;
  }
}

/** Colonne usage_tokens présente (migration 031). */
export function taskRunsTokensReady(): boolean {
  if (!taskRunsReady()) return false;
  try {
    const cols = queryAll<{ name: string }>(`PRAGMA table_info(task_runs)`);
    return cols.some((c) => c.name === "usage_tokens");
  } catch {
    return false;
  }
}

/** Runs créés depuis minuit UTC (quota MAX_RUNS_PER_DAY (envPrefix)). */
export function countRunsCreatedToday(): number {
  if (!taskRunsReady()) return 0;
  const row = queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM task_runs WHERE created_at >= date('now')`,
  );
  return row?.c ?? 0;
}

/** Tokens LLM consommés depuis minuit UTC (quota MAX_TOKENS_PER_DAY (envPrefix)). */
export function sumUsageTokensToday(): number {
  if (!taskRunsTokensReady()) return 0;
  const row = queryOne<{ s: number }>(
    `SELECT COALESCE(SUM(usage_tokens), 0) AS s FROM task_runs
     WHERE created_at >= date('now')`,
  );
  return row?.s ?? 0;
}

export function getTaskRun(id: string): TaskRunRow | null {
  if (!taskRunsReady()) return null;
  return normalizeRun(
    queryOne<TaskRunRow>(`SELECT * FROM task_runs WHERE id = ?`, [id]) ?? null,
  );
}

export function listTaskRunsForTask(taskId: string): TaskRunRow[] {
  if (!taskRunsReady()) return [];
  return queryAll<TaskRunRow>(
    `SELECT * FROM task_runs WHERE task_id = ? ORDER BY created_at DESC`,
    [taskId],
  ).map((r) => normalizeRun(r)!);
}

export function getActiveRunForAssignee(
  assigneeUserId: string,
): TaskRunRow | null {
  if (!taskRunsReady()) return null;
  return normalizeRun(
    queryOne<TaskRunRow>(
      `SELECT * FROM task_runs
       WHERE assignee_user_id = ? AND status IN ('queued','running')
       ORDER BY
         CASE status WHEN 'running' THEN 0 ELSE 1 END,
         created_at ASC
       LIMIT 1`,
      [assigneeUserId],
    ) ?? null,
  );
}

export function countRunningRuns(): number {
  if (!taskRunsReady()) return 0;
  const row = queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM task_runs WHERE status = 'running'`,
  );
  return row?.c ?? 0;
}

export function listRunningRuns(): TaskRunRow[] {
  if (!taskRunsReady()) return [];
  return queryAll<TaskRunRow>(
    `SELECT * FROM task_runs WHERE status = 'running' ORDER BY started_at ASC`,
  ).map((r) => normalizeRun(r)!);
}

export function getRunningRun(): TaskRunRow | null {
  return listRunningRuns()[0] ?? null;
}

/** Défaut 2 ; plafond dur 8. Env MAX_CONCURRENT (envPrefix). */
export function maxConcurrentAiRuns(): number {
  const raw = Number(tasksEnv("MAX_CONCURRENT", "2") || "2");
  if (!Number.isFinite(raw) || raw < 1) return 2;
  return Math.min(8, Math.floor(raw));
}

export function enqueueTaskRun(input: {
  taskId: string;
  assigneeUserId: string;
  retryOf?: string | null;
}): TaskRunRow {
  if (!taskRunsReady()) {
    throw new Error("schéma task_runs plateforme requis (task_runs)");
  }
  const existing = queryOne<TaskRunRow>(
    `SELECT * FROM task_runs
     WHERE task_id = ? AND status IN ('queued','running')
     LIMIT 1`,
    [input.taskId],
  );
  if (existing) return normalizeRun(existing)!;

  const id = randomUUID();
  if (taskRunsHitlReady()) {
    getWriteDb()
      .prepare(
        `INSERT INTO task_runs (id, task_id, assignee_user_id, status, retry_of)
         VALUES (?, ?, ?, 'queued', ?)`,
      )
      .run(id, input.taskId, input.assigneeUserId, input.retryOf ?? null);
  } else {
    getWriteDb()
      .prepare(
        `INSERT INTO task_runs (id, task_id, assignee_user_id, status)
         VALUES (?, ?, ?, 'queued')`,
      )
      .run(id, input.taskId, input.assigneeUserId);
  }
  const run = getTaskRun(id)!;
  notifyRun(run);
  return run;
}

/**
 * H4 « Hermes cerveau unique » — run HITL DÉTACHÉ : question posée par un
 * service (tool MCP `platform.ask_human`) sans boucle agent derrière.
 *
 * Réutilise l'infra `task_runs.hitl_prompt` (choix documenté : même canal de
 * réponse humain que le runner — kanban « en attente humain » +
 * `answer_ai_question`/`resumeHitlRun` — zéro table ni UI parallèle). Le run
 * est inséré directement en `running` + `hitl_prompt` (jamais `queued`, pour
 * que la boucle runner ne le claim pas). La réponse est relue par
 * `platform.get_human_answer`, qui clôt le run.
 */
export function openDetachedHitlRun(input: {
  taskId: string;
  assigneeUserId: string;
  prompt: string;
}): TaskRunRow | null {
  if (!taskRunsReady() || !taskRunsHitlReady()) return null;
  const id = randomUUID();
  getWriteDb()
    .prepare(
      `INSERT INTO task_runs
         (id, task_id, assignee_user_id, status, started_at, hitl_prompt)
       VALUES (?, ?, ?, 'running', datetime('now'), ?)`,
    )
    .run(id, input.taskId, input.assigneeUserId, input.prompt.slice(0, 4000));
  const run = getTaskRun(id);
  if (run) notifyRun(run);
  return run;
}

/**
 * Claim atomique d'un run queued si le nombre de runs running < maxConcurrent.
 */
export function claimNextQueuedRun(
  maxConcurrent = maxConcurrentAiRuns(),
): TaskRunRow | null {
  if (!taskRunsReady()) return null;
  if (countRunningRuns() >= maxConcurrent) return null;

  const next = queryOne<TaskRunRow>(
    `SELECT * FROM task_runs WHERE status = 'queued'
     ORDER BY created_at ASC LIMIT 1`,
  );
  if (!next) return null;

  const r = getWriteDb()
    .prepare(
      `UPDATE task_runs
       SET status = 'running',
           started_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ? AND status = 'queued'
         AND (
           SELECT COUNT(*) FROM task_runs WHERE status = 'running' AND id != ?
         ) < ?`,
    )
    .run(next.id, next.id, maxConcurrent);

  if (r.changes === 0) return null;
  const run = getTaskRun(next.id);
  if (run) notifyRun(run);
  return run;
}

export function finishTaskRun(
  id: string,
  result: {
    status: "succeeded" | "failed" | "cancelled";
    lastError?: string | null;
    hostDeviceId?: string | null;
    stepCount?: number;
    /** Tokens LLM consommés par la boucle (quota journalier). */
    usageTokens?: number;
  },
): TaskRunRow | null {
  if (!taskRunsReady()) return null;
  if (
    typeof result.usageTokens === "number" &&
    result.usageTokens > 0 &&
    taskRunsTokensReady()
  ) {
    getWriteDb()
      .prepare(`UPDATE task_runs SET usage_tokens = ? WHERE id = ?`)
      .run(Math.round(result.usageTokens), id);
  }
  if (taskRunsHitlReady()) {
    getWriteDb()
      .prepare(
        `UPDATE task_runs
         SET status = ?,
             last_error = ?,
             host_device_id = COALESCE(?, host_device_id),
             step_count = COALESCE(?, step_count),
             hitl_prompt = NULL,
             finished_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        result.status,
        result.lastError ?? null,
        result.hostDeviceId ?? null,
        result.stepCount ?? null,
        id,
      );
  } else {
    getWriteDb()
      .prepare(
        `UPDATE task_runs
         SET status = ?,
             last_error = ?,
             host_device_id = COALESCE(?, host_device_id),
             step_count = COALESCE(?, step_count),
             finished_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        result.status,
        result.lastError ?? null,
        result.hostDeviceId ?? null,
        result.stepCount ?? null,
        id,
      );
  }
  const run = getTaskRun(id);
  if (run) notifyRun(run);
  return run;
}

export function setHitlPrompt(
  id: string,
  prompt: string,
): TaskRunRow | null {
  if (!taskRunsHitlReady()) return null;
  getWriteDb()
    .prepare(
      `UPDATE task_runs
       SET hitl_prompt = ?,
           hitl_response = NULL,
           updated_at = datetime('now')
       WHERE id = ? AND status = 'running'`,
    )
    .run(prompt, id);
  const run = getTaskRun(id);
  if (run) notifyRun(run);
  return run;
}

export function resumeHitlRun(
  id: string,
  response = "ok",
): TaskRunRow | null {
  if (!taskRunsHitlReady()) return null;
  const current = getTaskRun(id);
  if (!current || current.status !== "running" || !current.hitl_prompt) {
    return null;
  }
  getWriteDb()
    .prepare(
      `UPDATE task_runs
       SET hitl_prompt = NULL,
           hitl_response = ?,
           updated_at = datetime('now')
       WHERE id = ? AND status = 'running'`,
    )
    .run(response.slice(0, 2000), id);
  const run = getTaskRun(id);
  if (run) notifyRun(run);
  return run;
}

export function clearHitlResponse(id: string): void {
  if (!taskRunsHitlReady()) return;
  getWriteDb()
    .prepare(
      `UPDATE task_runs SET hitl_response = NULL, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(id);
}

export function cancelTaskRun(id: string): TaskRunRow | null {
  const run = getTaskRun(id);
  if (!run) return null;
  if (run.status !== "queued" && run.status !== "running") return run;
  return finishTaskRun(id, {
    status: "cancelled",
    lastError: "cancelled_by_user",
  });
}

export function bumpRunStepCount(id: string): number {
  getWriteDb()
    .prepare(
      `UPDATE task_runs
       SET step_count = step_count + 1, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(id);
  const row = getTaskRun(id);
  return row?.step_count ?? 0;
}

export function appendAgentLog(input: {
  runId: string;
  level?: AgentLogLevel;
  eventType: string;
  message: string;
  payload?: unknown;
}): AgentSessionLog {
  if (!taskRunsReady()) {
    throw new Error("schéma task_runs plateforme requis (agent_session_logs)");
  }
  const seqRow = queryOne<{ m: number | null }>(
    `SELECT MAX(seq) AS m FROM agent_session_logs WHERE run_id = ?`,
    [input.runId],
  );
  const seq = (seqRow?.m ?? 0) + 1;
  const id = randomUUID();
  let payloadJson: string | null = null;
  if (input.payload !== undefined) {
    try {
      payloadJson = JSON.stringify(input.payload);
    } catch {
      payloadJson = null;
    }
  }
  getWriteDb()
    .prepare(
      `INSERT INTO agent_session_logs
        (id, run_id, seq, level, event_type, message, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.runId,
      seq,
      input.level || "info",
      input.eventType,
      input.message,
      payloadJson,
    );
  bumpRunStepCount(input.runId);
  const log: AgentSessionLog = {
    id,
    run_id: input.runId,
    seq,
    level: input.level || "info",
    event_type: input.eventType,
    message: input.message,
    payload_json: payloadJson,
    created_at: new Date().toISOString(),
  };
  const run = getTaskRun(input.runId);
  if (run) notifyLog({ run, log });
  return log;
}

export function listAgentLogs(
  runId: string,
  afterSeq = 0,
  limit = 200,
): AgentSessionLog[] {
  if (!taskRunsReady()) return [];
  return queryAll<AgentSessionLog>(
    `SELECT * FROM agent_session_logs
     WHERE run_id = ? AND seq > ?
     ORDER BY seq ASC
     LIMIT ?`,
    [runId, afterSeq, limit],
  );
}

/** Purge logs (+ runs terminés) plus vieux que N jours. */
export function purgeAgentLogsOlderThan(days: number): {
  logsDeleted: number;
  runsDeleted: number;
} {
  if (!taskRunsReady()) return { logsDeleted: 0, runsDeleted: 0 };
  const d = Math.max(1, Math.floor(days));
  const logs = getWriteDb()
    .prepare(
      `DELETE FROM agent_session_logs
       WHERE created_at < datetime('now', ?)`,
    )
    .run(`-${d} days`);
  const runs = getWriteDb()
    .prepare(
      `DELETE FROM task_runs
       WHERE status IN ('succeeded','failed','cancelled')
         AND COALESCE(finished_at, created_at) < datetime('now', ?)`,
    )
    .run(`-${d} days`);
  return { logsDeleted: logs.changes, runsDeleted: runs.changes };
}

export function isHitlPaused(run: TaskRunRow | null | undefined): boolean {
  return Boolean(run?.status === "running" && run.hitl_prompt);
}
