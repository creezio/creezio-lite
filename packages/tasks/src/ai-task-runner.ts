/**
 * Runner host — exécute les tâches assignées à un collaborateur IA via la
 * boucle LLM (ai-task-agent). Persona ACL = user AI ; surface = workspace
 * Electron dédié (pas l'espace owner). Desktop bridge = host owner.
 *
 * Honnêteté des statuts (D4) : un run sans bridge desktop, sans LLM ou sans
 * `finish_task(success=true)` est `failed` — jamais de succès de complaisance.
 */
import {
  hasAiAgentModel,
  runAiTaskAgent,
} from "./ai-task-agent.js";
import { requireTasksBrand, tasksEnv } from "./brand/config.js";
import {
  getTask,
  listRecurringAiTasks,
  setTaskNextRun,
  updateTaskLocal,
  type Task,
} from "./kanban-service.js";
import {
  appendAgentLog,
  claimNextQueuedRun,
  clearHitlResponse,
  countRunsCreatedToday,
  enqueueTaskRun,
  finishTaskRun,
  getActiveRunForAssignee,
  getTaskRun,
  isHitlPaused,
  listRunningRuns,
  maxConcurrentAiRuns,
  setHitlPrompt,
  sumUsageTokensToday,
  type TaskRunRow,
} from "./task-runs.js";

function ensureAiWorkspaceOnHost(opts: {
  aiUserId: string;
  hostUserId: string;
  show?: boolean;
  label?: string;
}) {
  return requireTasksBrand().workspace.ensureOnHost(opts);
}
function isDesktopOnline(userId: string) {
  return requireTasksBrand().presence.isDesktopOnline(userId);
}
function listOnlineBridges() {
  return requireTasksBrand().presence.listOnlineBridges();
}
function getOwner() {
  return requireTasksBrand().users.getOwner();
}
function getUserById(id: string) {
  return requireTasksBrand().users.getById(id);
}

const g = globalThis as unknown as {
  __creezioTasksAiRunnerActive?: number;
  __creezioTasksAiRunnerTimer?: ReturnType<typeof setInterval> | null;
  __creezioTasksAiRecurrenceTimer?: ReturnType<typeof setInterval> | null;
  __creezioTasksAiRunnerInflight?: Set<string>;
};

function inflight(): Set<string> {
  if (!g.__creezioTasksAiRunnerInflight) g.__creezioTasksAiRunnerInflight = new Set();
  return g.__creezioTasksAiRunnerInflight;
}

/** Kill switch runner (`${envPrefix}_RUNNER_ENABLED=0` pour désactiver). */
export function aiRunnerEnabled(): boolean {
  const v = (tasksEnv("RUNNER_ENABLED", "1") || "1").toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}

export function hostBridgeReady(): boolean {
  const bridges = listOnlineBridges().filter((b) => b.online && b.bridgeConnected);
  if (bridges.length > 0) return true;
  const owner = getOwner();
  if (owner && isDesktopOnline(owner.id)) return true;
  return false;
}

export function resolveHostTargetUserId(): string | null {
  const owner = getOwner();
  if (owner && isDesktopOnline(owner.id)) return owner.id;
  const bridges = listOnlineBridges().filter((b) => b.online && b.bridgeConnected);
  return bridges[0]?.userId || owner?.id || null;
}

/** Quota env optionnel (null = illimité). */
function envQuota(suffix: string): number | null {
  const raw = Number(tasksEnv(suffix));
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
}

/**
 * Quotas journaliers (minuit UTC) : ${requireTasksBrand().envPrefix}_MAX_RUNS_PER_DAY (nombre de runs
 * créés) et ${requireTasksBrand().envPrefix}_MAX_TOKENS_PER_DAY (tokens LLM consommés). Non configurés
 * = illimité.
 */
export function checkAiRunQuotas(): { ok: boolean; reason?: string } {
  const maxRuns = envQuota("MAX_RUNS_PER_DAY");
  if (maxRuns !== null) {
    const used = countRunsCreatedToday();
    if (used >= maxRuns) {
      return {
        ok: false,
        reason: `quota journalier de runs atteint (${used}/${maxRuns} — ${requireTasksBrand().envPrefix}_MAX_RUNS_PER_DAY)`,
      };
    }
  }
  const maxTokens = envQuota("MAX_TOKENS_PER_DAY");
  if (maxTokens !== null) {
    const used = sumUsageTokensToday();
    if (used >= maxTokens) {
      return {
        ok: false,
        reason: `quota journalier de tokens atteint (${used}/${maxTokens} — ${requireTasksBrand().envPrefix}_MAX_TOKENS_PER_DAY)`,
      };
    }
  }
  return { ok: true };
}

/**
 * Enfile un run si la tâche (executor ai) est assignée à une IA active.
 * Retourne le run (existant ou nouveau) ou null si non applicable.
 * Lève `quota_exceeded: …` si un quota journalier est atteint.
 */
export function enqueueAiRunForTask(
  taskId: string,
  opts?: { retryOf?: string | null },
): TaskRunRow | null {
  const task = getTask(taskId);
  if (!task?.assignee_user_id) return null;
  if (task.executor_kind !== "ai") return null;
  const assignee = getUserById(task.assignee_user_id);
  if (!assignee || assignee.kind !== "ai" || !assignee.active) return null;
  const quota = checkAiRunQuotas();
  if (!quota.ok) {
    throw new Error(`quota_exceeded: ${quota.reason}`);
  }
  return enqueueTaskRun({
    taskId: task.id,
    assigneeUserId: assignee.id,
    retryOf: opts?.retryOf ?? null,
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function hitlEnabled(task: Task): boolean {
  const env = tasksEnv("HITL").toLowerCase();
  if (env === "1" || env === "true") return true;
  const body = task.body || "";
  return /\[\[confirm\]\]/i.test(body) || /\[\[hitl\]\]/i.test(body);
}

/** Pause HITL : prompt visible côté UI, reprise via /runs/:id/resume. */
async function waitForHitl(
  runId: string,
  prompt: string,
): Promise<{ outcome: "resumed" | "cancelled" | "timeout"; response?: string }> {
  setHitlPrompt(runId, prompt);
  appendAgentLog({
    runId,
    level: "decision",
    eventType: "await_human",
    message: prompt,
    payload: { hitl: true },
  });

  const deadline = Date.now() + 30 * 60 * 1000; // 30 min
  while (Date.now() < deadline) {
    await sleep(500);
    const fresh = getTaskRun(runId);
    if (!fresh || fresh.status !== "running") return { outcome: "cancelled" };
    if (!fresh.hitl_prompt && fresh.hitl_response) {
      const response = fresh.hitl_response;
      appendAgentLog({
        runId,
        level: "info",
        eventType: "hitl_resume",
        message: `Reprise humaine : ${response}`,
      });
      clearHitlResponse(runId);
      return { outcome: "resumed", response };
    }
    if (!fresh.hitl_prompt) {
      // resume cleared prompt without response edge-case
      return { outcome: "resumed" };
    }
  }
  appendAgentLog({
    runId,
    level: "error",
    eventType: "hitl_timeout",
    message: "Timeout human-in-the-loop (30 min)",
  });
  return { outcome: "timeout" };
}

async function runSteps(run: TaskRunRow, task: Task): Promise<void> {
  const assignee = getUserById(run.assignee_user_id);
  const hostUserId = resolveHostTargetUserId();
  const hostDevice =
    listOnlineBridges().find((b) => b.userId === hostUserId)?.deviceId || null;
  const perms = assignee?.permissions || [];

  appendAgentLog({
    runId: run.id,
    level: "info",
    eventType: "run_start",
    message: `Démarrage du run pour « ${task.title} »`,
    payload: {
      task_id: task.id,
      assignee: assignee?.username || run.assignee_user_id,
      assignee_kind: assignee?.kind || "ai",
      permissions: perms,
      host_user_id: hostUserId,
      host_online: hostBridgeReady(),
      max_concurrent: maxConcurrentAiRuns(),
      retry_of: run.retry_of,
    },
  });

  appendAgentLog({
    runId: run.id,
    level: "decision",
    eventType: "acl_check",
    message: "ACL collaborateur IA appliquées (pas de bypass owner)",
    payload: {
      role: assignee?.role,
      permissions: perms,
    },
  });

  // D4 : pas de bridge desktop = échec explicite, jamais un faux succès.
  if (!hostBridgeReady() || !hostUserId || !assignee) {
    appendAgentLog({
      runId: run.id,
      level: "error",
      eventType: "desktop_offline",
      message:
        "Bridge desktop hors ligne — l'IA ne peut pas travailler sans son workspace. Run en échec (relancer quand l'app desktop est ouverte).",
    });
    finishTaskRun(run.id, {
      status: "failed",
      lastError: "desktop_offline",
      hostDeviceId: hostDevice,
    });
    return;
  }

  // D4 : pas de LLM (BYOK OpenAI absent) = échec explicite.
  if (!hasAiAgentModel()) {
    appendAgentLog({
      runId: run.id,
      level: "error",
      eventType: "llm_missing",
      message:
        "Aucune clé OpenAI (BYOK) — configurer Configuration → Clés IA avant de lancer un collaborateur IA.",
    });
    finishTaskRun(run.id, {
      status: "failed",
      lastError: "llm_missing",
      hostDeviceId: hostDevice,
    });
    return;
  }

  if (task.body?.trim()) {
    appendAgentLog({
      runId: run.id,
      level: "info",
      eventType: "brief",
      message: task.body.trim().slice(0, 500),
    });
  }

  // Workspace Electron dédié de CETTE IA (partition + cookie persona).
  appendAgentLog({
    runId: run.id,
    level: "tool",
    eventType: "tool_call",
    message: `ai_workspace_ensure → ${assignee.username}`,
    payload: {
      tool: "ai_workspace_ensure",
      ai_user_id: assignee.id,
      target_user_id: hostUserId,
    },
  });
  try {
    const ensured = await ensureAiWorkspaceOnHost({
      aiUserId: assignee.id,
      hostUserId,
      show: true,
      label: assignee.username,
    });
    appendAgentLog({
      runId: run.id,
      level: ensured.ok === false ? "warn" : "tool",
      eventType: "tool_result",
      message:
        ensured.ok === false
          ? String(ensured.error || "Échec ensure workspace IA")
          : "Espace workspace IA prêt (vue Electron)",
      payload: {
        ok: ensured.ok !== false,
        code: ensured.code || null,
        workspace: ensured.workspace || null,
      },
    });
    if (ensured.ok === false) {
      finishTaskRun(run.id, {
        status: "failed",
        lastError: String(ensured.error || "workspace_ensure_failed"),
        hostDeviceId: hostDevice,
      });
      return;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendAgentLog({
      runId: run.id,
      level: "error",
      eventType: "tool_result",
      message: msg,
    });
    finishTaskRun(run.id, {
      status: "failed",
      lastError: msg,
      hostDeviceId: hostDevice,
    });
    return;
  }

  // HITL pré-run ([[confirm]]/[[hitl]] dans le brief, ou HITL (envPrefix)=1).
  if (hitlEnabled(task)) {
    const gate = await waitForHitl(
      run.id,
      "Validation humaine requise avant de démarrer le run (HITL).",
    );
    if (gate.outcome !== "resumed") {
      finishTaskRun(run.id, {
        status: gate.outcome === "timeout" ? "failed" : "cancelled",
        lastError: gate.outcome === "timeout" ? "hitl_timeout" : "hitl_cancelled",
        hostDeviceId: hostDevice,
      });
      return;
    }
  }

  appendAgentLog({
    runId: run.id,
    level: "decision",
    eventType: "plan",
    message: "Boucle LLM démarrée (navigate / UI / delegate_to_hermes / finish_task)",
  });

  // Boucle LLM — chaque étape journalisée pour l'AiActivityPanel.
  const outcome = await runAiTaskAgent({
    task,
    assignee,
    hostUserId,
    runId: run.id,
    askHuman: (question) => waitForHitl(run.id, question),
    onStep: (ev) => {
      if (ev.kind === "assistant") {
        appendAgentLog({
          runId: run.id,
          level: "decision",
          eventType: "assistant_message",
          message: ev.content.slice(0, 1000),
        });
      } else if (ev.kind === "tool_call") {
        appendAgentLog({
          runId: run.id,
          level: "tool",
          eventType: "tool_call",
          message: ev.name,
          payload: { tool: ev.name, args: ev.args },
        });
      } else {
        appendAgentLog({
          runId: run.id,
          level: ev.result.ok === false ? "warn" : "tool",
          eventType: "tool_result",
          message:
            ev.result.ok === false
              ? String(ev.result.error || `${ev.name} en échec`)
              : `${ev.name} ok`,
          payload: { tool: ev.name, result: ev.result },
        });
      }
    },
  });

  // Le run a pu être annulé pendant la boucle (HITL cancel, UI).
  const still = getTaskRun(run.id);
  if (!still || still.status !== "running") return;

  if (outcome.success) {
    appendAgentLog({
      runId: run.id,
      level: "info",
      eventType: "run_end",
      message: outcome.summary || "Run terminé avec succès",
      payload: { steps: outcome.loop.steps, tokens: outcome.loop.usageTokens },
    });
    finishTaskRun(run.id, {
      status: "succeeded",
      hostDeviceId: hostDevice,
      usageTokens: outcome.loop.usageTokens,
    });
    const fresh = getTask(task.id);
    if (fresh && fresh.status === "in_progress") {
      updateTaskLocal(task.id, { status: "done", result: outcome.summary });
    }
    return;
  }

  appendAgentLog({
    runId: run.id,
    level: "error",
    eventType: "run_end",
    message: outcome.summary || `Run en échec (${outcome.loop.status})`,
    payload: {
      steps: outcome.loop.steps,
      tokens: outcome.loop.usageTokens,
      loop_status: outcome.loop.status,
    },
  });
  finishTaskRun(run.id, {
    status: "failed",
    lastError: outcome.summary.slice(0, 500) || outcome.loop.status,
    hostDeviceId: hostDevice,
    usageTokens: outcome.loop.usageTokens,
  });
  updateTaskLocal(task.id, { result: outcome.summary });
}

async function executeClaimedRun(run: TaskRunRow): Promise<{
  processed: boolean;
  runId: string;
  error?: string;
}> {
  const active = inflight();
  if (active.has(run.id)) {
    return { processed: false, runId: run.id, error: "inflight" };
  }
  active.add(run.id);
  try {
    const task = getTask(run.task_id);
    if (!task) {
      finishTaskRun(run.id, {
        status: "failed",
        lastError: "Tâche introuvable",
      });
      return { processed: true, runId: run.id, error: "task_missing" };
    }

    const assignee = getUserById(run.assignee_user_id);
    if (!assignee || assignee.kind !== "ai") {
      finishTaskRun(run.id, {
        status: "failed",
        lastError: "Assigné non-IA",
      });
      return { processed: true, runId: run.id, error: "not_ai" };
    }

    try {
      await runSteps(run, task);
      return { processed: true, runId: run.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendAgentLog({
        runId: run.id,
        level: "error",
        eventType: "run_end",
        message: msg,
      });
      finishTaskRun(run.id, { status: "failed", lastError: msg });
      return { processed: true, runId: run.id, error: msg };
    }
  } finally {
    active.delete(run.id);
  }
}

/**
 * Claim et lance jusqu'à `maxConcurrent` runs en parallèle.
 * Les runs déjà en HITL restent « running » mais ne sont pas re-claimés.
 */
export async function processAiTaskQueue(): Promise<{
  processed: boolean;
  runIds?: string[];
  /** @deprecated compat P0 */
  runId?: string;
  error?: string;
  maxConcurrent?: number;
}> {
  if (!aiRunnerEnabled()) {
    return { processed: false, error: "runner_disabled" };
  }
  const max = maxConcurrentAiRuns();
  const claimed: TaskRunRow[] = [];
  for (let i = 0; i < max; i++) {
    const run = claimNextQueuedRun(max);
    if (!run) break;
    if (isHitlPaused(run)) continue;
    if (inflight().has(run.id)) continue;
    claimed.push(run);
  }

  if (claimed.length === 0) {
    return { processed: false, maxConcurrent: max };
  }

  const results = await Promise.all(
    claimed.map((run) => executeClaimedRun(run)),
  );
  const runIds = results.map((r) => r.runId);
  const err = results.find((r) => r.error)?.error;
  return {
    processed: true,
    runIds,
    runId: runIds[0],
    error: err,
    maxConcurrent: max,
  };
}

/**
 * Récupération après redémarrage : les runs `running` qui n'appartiennent à
 * aucune boucle de CE process sont orphelins (app/serveur redémarré pendant
 * l'exécution). D4 : ils passent `failed` (motif `app_restart`) — et si la
 * tâche est toujours `in_progress`, un nouveau run est ré-enfilé.
 */
export function recoverInterruptedRuns(): { recovered: number; requeued: number } {
  let recovered = 0;
  let requeued = 0;
  for (const run of listRunningRuns()) {
    if (inflight().has(run.id)) continue; // vraiment en cours ici
    appendAgentLog({
      runId: run.id,
      level: "error",
      eventType: "run_end",
      message:
        "Run interrompu par un redémarrage de l'application — marqué failed (app_restart).",
      payload: { recovered: true },
    });
    finishTaskRun(run.id, { status: "failed", lastError: "app_restart" });
    recovered += 1;
    const task = getTask(run.task_id);
    if (task && task.executor_kind === "ai" && task.status === "in_progress") {
      try {
        if (enqueueAiRunForTask(task.id, { retryOf: run.id })) requeued += 1;
      } catch {
        /* quota atteint — la tâche reste in_progress, relançable à la main */
      }
    }
  }
  return { recovered, requeued };
}

/* ── Récurrence (tâches IA) ────────────────────────────────────────────── */

/**
 * Parseur minimal de `recurring_schedule` pour les tâches IA :
 * - `every 15m` / `every 2h` / `every 1d` (aussi `min`, `j`) ;
 * - `daily@HH:MM` (heure locale serveur).
 * Retourne une fonction « prochaine occurrence après `from` », ou null si la
 * syntaxe n'est pas reconnue (les crons Hermes restent gérés par Hermes).
 */
export function parseRecurringSchedule(
  raw: string | null | undefined,
): ((from: Date) => Date) | null {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  const every = s.match(/^every\s+(\d+)\s*(m|min|mins|minutes?|h|heures?|hours?|d|j|jours?|days?)$/);
  if (every) {
    const n = Number(every[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    const unit = (every[2] || "d")[0]; // m / h / d / j
    const ms =
      unit === "m" ? n * 60_000 : unit === "h" ? n * 3_600_000 : n * 86_400_000;
    if (ms < 60_000) return null; // plancher 1 min
    return (from) => new Date(from.getTime() + ms);
  }
  const daily = s.match(/^daily\s*@\s*(\d{1,2}):(\d{2})$/);
  if (daily) {
    const hh = Number(daily[1]);
    const mm = Number(daily[2]);
    if (hh > 23 || mm > 59) return null;
    return (from) => {
      const next = new Date(from);
      next.setHours(hh, mm, 0, 0);
      if (next.getTime() <= from.getTime()) {
        next.setDate(next.getDate() + 1);
      }
      return next;
    };
  }
  return null;
}

/**
 * Tick récurrence (1/min) : (ré)enfile les tâches IA récurrentes échues.
 * Première passe : initialise next_run_at sans lancer (la création a déjà
 * lancé un premier run le cas échéant).
 */
export function processRecurringAiTasks(now: Date = new Date()): {
  launched: string[];
  scheduled: number;
} {
  if (!aiRunnerEnabled()) return { launched: [], scheduled: 0 };
  const launched: string[] = [];
  let scheduled = 0;
  for (const task of listRecurringAiTasks()) {
    const next = parseRecurringSchedule(task.recurring_schedule);
    if (!next) continue; // syntaxe non gérée (cron Hermes, etc.)
    if (!task.next_run_at) {
      setTaskNextRun(task.id, next(now).toISOString());
      scheduled += 1;
      continue;
    }
    if (new Date(task.next_run_at).getTime() > now.getTime()) continue;
    // Occurrence échue : replanifier d'abord (pas de rafale si erreur).
    setTaskNextRun(task.id, next(now).toISOString());
    scheduled += 1;
    try {
      if (task.status !== "in_progress") {
        updateTaskLocal(task.id, { status: "in_progress" });
      }
      const run = enqueueAiRunForTask(task.id);
      if (run) launched.push(run.id);
    } catch {
      /* quota atteint — occurrence sautée, la suivante retentera */
    }
  }
  if (launched.length > 0) void processAiTaskQueue();
  return { launched, scheduled };
}

function unrefTimer(timer: ReturnType<typeof setInterval> | null): void {
  if (timer && typeof timer === "object" && "unref" in timer) {
    try {
      (timer as NodeJS.Timeout).unref();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Arrête les boucles runner + récurrence (teardown). Sans cet arrêt, le
 * setInterval process-global continue de tick après la fermeture de la
 * surface plateforme : le tick suivant jette `requireTasksBrand()` en
 * unhandledRejection (config brand désormais absente) — vécu gate PNM.2.
 * Un prochain appel à `ensureAiRunnerLoop` (requête tasks) relance tout.
 */
export function stopAiRunnerLoop(): void {
  if (g.__creezioTasksAiRunnerTimer) {
    clearInterval(g.__creezioTasksAiRunnerTimer);
    g.__creezioTasksAiRunnerTimer = null;
  }
  if (g.__creezioTasksAiRecurrenceTimer) {
    clearInterval(g.__creezioTasksAiRecurrenceTimer);
    g.__creezioTasksAiRecurrenceTimer = null;
  }
}

/** Démarre un poll léger du runner (idempotent, process-local). */
export function ensureAiRunnerLoop(intervalMs = 2000): void {
  if (!aiRunnerEnabled()) return;
  if (!g.__creezioTasksAiRecurrenceTimer) {
    g.__creezioTasksAiRecurrenceTimer = setInterval(() => {
      try {
        processRecurringAiTasks();
      } catch {
        /* jamais bloquant */
      }
    }, 60_000);
    unrefTimer(g.__creezioTasksAiRecurrenceTimer);
  }
  if (g.__creezioTasksAiRunnerTimer) return;
  g.__creezioTasksAiRunnerTimer = setInterval(() => {
    void processAiTaskQueue();
  }, intervalMs);
  unrefTimer(g.__creezioTasksAiRunnerTimer);
}

export function getAiActivityForUser(userId: string): {
  run: TaskRunRow | null;
  task: Task | null;
} {
  const active = getActiveRunForAssignee(userId);
  if (!active) return { run: null, task: null };
  return { run: active, task: getTask(active.task_id) };
}

export function retryFailedRun(runId: string): TaskRunRow | null {
  const prev = getTaskRun(runId);
  if (!prev) return null;
  if (prev.status !== "failed" && prev.status !== "cancelled") return null;
  const task = getTask(prev.task_id);
  if (!task) return null;
  if (task.status === "done" || task.status === "cancelled") {
    updateTaskLocal(task.id, { status: "in_progress" });
  }
  return enqueueAiRunForTask(task.id, { retryOf: prev.id });
}
