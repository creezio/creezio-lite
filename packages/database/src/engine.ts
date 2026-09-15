import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "./sqlite-driver.js";
import { getDatabaseEngineAdapters, getDatabaseWebhookBrand } from "./adapters.js";
import { listAutomations, type Automation, type AutomationAction } from "./automations-store.js";
import { evaluateConditions } from "./conditions.js";
import {
  deliverWebhook,
  MAX_WEBHOOK_ATTEMPTS,
  retryDelaySeconds,
} from "./webhooks.js";

export type AutomationEvent = {
  id: number;
  table_name: string;
  row_rowid: number | null;
  op: string;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
  status: string;
};

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function triggerMatches(auto: Automation, op: string): boolean {
  if (auto.triggerType === "row_added") return op === "insert";
  if (auto.triggerType === "row_updated") return op === "update";
  if (auto.triggerType === "row_deleted") return op === "delete";
  return false;
}

function watchColumnsMatch(
  auto: Automation,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): boolean {
  if (!auto.watchColumns?.length) return true;
  if (!before || !after) return true;
  return auto.watchColumns.some(
    (col) => String(before[col] ?? "") !== String(after[col] ?? ""),
  );
}

function buildPayload(
  auto: Automation,
  event: AutomationEvent,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  action: AutomationAction,
) {
  const base = {
    automationId: auto.id,
    automationName: auto.name,
    table: event.table_name,
    op: event.op,
    rowid: event.row_rowid,
    at: event.created_at,
    before,
    after,
  };
  if (action.type === "webhook") {
    if (action.bodyTemplate === "row_before") return { ...base, row: before };
    if (action.bodyTemplate === "row_after") return { ...base, row: after };
  }
  return base;
}

async function runAction(
  action: AutomationAction,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (action.type === "webhook") {
    return deliverWebhook({
      url: action.url,
      method: action.method,
      headers: action.headers,
      secret: action.secret,
      body: payload,
    });
  }
  if (action.type === "plugin_event") {
    try {
      const { emitPluginEvent } = getDatabaseEngineAdapters();
      if (emitPluginEvent) {
        emitPluginEvent(action.event || "database.automation", payload);
      }
      return { ok: true, status: 200 };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "plugin_event failed",
      };
    }
  }
  if (action.type === "n8n_webhook") {
    const adapters = getDatabaseEngineAdapters();
    const baseUrl =
      adapters.n8nWebhookBaseUrl ?? process.env.N8N_WEBHOOK_BASE_URL ?? "";
    const url =
      action.url ||
      (baseUrl
        ? `${String(baseUrl).replace(/\/$/, "")}/${(action.path || "").replace(/^\//, "")}`
        : "");
    if (!url) {
      return { ok: false, error: "URL n8n manquante (N8N_WEBHOOK_BASE_URL ou action.url)" };
    }
    const prevLoop = process.env.CREEZIO_WEBHOOK_ALLOW_LOOPBACK;
    const prevTf = process.env.TF2_WEBHOOK_ALLOW_LOOPBACK;
    process.env.CREEZIO_WEBHOOK_ALLOW_LOOPBACK = "1";
    process.env.TF2_WEBHOOK_ALLOW_LOOPBACK = "1";
    const brand = getDatabaseWebhookBrand();
    try {
      return await deliverWebhook({
        url,
        body: payload,
        headers: { [brand.sourceHeader]: brand.sourceHeaderValue },
      });
    } finally {
      if (prevLoop === undefined) delete process.env.CREEZIO_WEBHOOK_ALLOW_LOOPBACK;
      else process.env.CREEZIO_WEBHOOK_ALLOW_LOOPBACK = prevLoop;
      if (prevTf === undefined) delete process.env.TF2_WEBHOOK_ALLOW_LOOPBACK;
      else process.env.TF2_WEBHOOK_ALLOW_LOOPBACK = prevTf;
    }
  }
  return { ok: false, error: "Action inconnue" };
}

function recordRun(
  db: SqliteDatabase,
  input: {
    automationId: string;
    eventId: number;
    status: string;
    attempt: number;
    responseCode?: number | null;
    error?: string | null;
    nextRetryAt?: string | null;
  },
) {
  db.prepare(
    `INSERT INTO db_automation_runs
      (id, automation_id, event_id, status, attempt, response_code, error, finished_at, next_retry_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
  ).run(
    randomUUID(),
    input.automationId,
    input.eventId,
    input.status,
    input.attempt,
    input.responseCode ?? null,
    input.error ?? null,
    input.nextRetryAt ?? null,
  );
}

export async function processAutomationEvent(
  db: SqliteDatabase,
  event: AutomationEvent,
): Promise<number> {
  const before = parseJson(event.before_json);
  const after = parseJson(event.after_json);
  const autos = listAutomations(db, event.table_name).filter((a) => a.enabled);
  let matched = 0;

  for (const auto of autos) {
    if (!triggerMatches(auto, event.op)) continue;
    if (!watchColumnsMatch(auto, before, after)) continue;
    if (!evaluateConditions(auto.conditions, { before, after })) continue;
    matched++;

    let attempt = 0;
    let lastError: string | undefined;
    let lastStatus: number | undefined;
    let ok = false;

    for (const action of auto.actions) {
      attempt = 1;
      const payload = buildPayload(auto, event, before, after, action);
      const result = await runAction(action, payload);
      lastStatus = result.status;
      if (result.ok) {
        ok = true;
      } else {
        lastError = result.error;
        ok = false;
        break;
      }
    }

    if (ok) {
      recordRun(db, {
        automationId: auto.id,
        eventId: event.id,
        status: "success",
        attempt,
        responseCode: lastStatus ?? 200,
      });
    } else {
      const next = new Date(Date.now() + retryDelaySeconds(1) * 1000).toISOString();
      recordRun(db, {
        automationId: auto.id,
        eventId: event.id,
        status: "retrying",
        attempt: 1,
        responseCode: lastStatus ?? null,
        error: lastError ?? "échec",
        nextRetryAt: next,
      });
    }
  }

  db.prepare(
    `UPDATE db_automation_events
     SET status = 'processed', processed_at = datetime('now')
     WHERE id = ?`,
  ).run(event.id);

  return matched;
}

export async function processPendingEvents(
  db: SqliteDatabase,
  limit = 20,
): Promise<{ processed: number; matched: number }> {
  const events = db
    .prepare(
      `SELECT * FROM db_automation_events
       WHERE status = 'pending'
       ORDER BY id ASC
       LIMIT ?`,
    )
    .all(limit) as AutomationEvent[];

  let matched = 0;
  for (const event of events) {
    matched += await processAutomationEvent(db, event);
  }
  return { processed: events.length, matched };
}

/** Retry des runs en échec (dead-letter après MAX attempts). */
export async function processRetries(db: SqliteDatabase, limit = 10): Promise<number> {
  const runs = db
    .prepare(
      `SELECT * FROM db_automation_runs
       WHERE status = 'retrying'
         AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
       ORDER BY started_at ASC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    automation_id: string;
    event_id: number;
    attempt: number;
  }>;

  let done = 0;
  for (const run of runs) {
    const event = db
      .prepare(`SELECT * FROM db_automation_events WHERE id = ?`)
      .get(run.event_id) as AutomationEvent | undefined;
    const auto = listAutomations(db).find((a) => a.id === run.automation_id);
    if (!event || !auto) {
      db.prepare(
        `UPDATE db_automation_runs SET status='dead', error='event/automation manquant', finished_at=datetime('now') WHERE id=?`,
      ).run(run.id);
      done++;
      continue;
    }

    const before = parseJson(event.before_json);
    const after = parseJson(event.after_json);
    const attempt = run.attempt + 1;
    let ok = true;
    let lastStatus: number | undefined;
    let lastError: string | undefined;

    for (const action of auto.actions) {
      const payload = buildPayload(auto, event, before, after, action);
      const result = await runAction(action, payload);
      lastStatus = result.status;
      if (!result.ok) {
        ok = false;
        lastError = result.error;
        break;
      }
    }

    if (ok) {
      db.prepare(
        `UPDATE db_automation_runs
         SET status='success', attempt=?, response_code=?, error=NULL,
             finished_at=datetime('now'), next_retry_at=NULL
         WHERE id=?`,
      ).run(attempt, lastStatus ?? 200, run.id);
    } else if (attempt >= MAX_WEBHOOK_ATTEMPTS) {
      db.prepare(
        `UPDATE db_automation_runs
         SET status='dead', attempt=?, response_code=?, error=?,
             finished_at=datetime('now'), next_retry_at=NULL
         WHERE id=?`,
      ).run(attempt, lastStatus ?? null, lastError ?? "max attempts", run.id);
    } else {
      const next = new Date(
        Date.now() + retryDelaySeconds(attempt) * 1000,
      ).toISOString();
      db.prepare(
        `UPDATE db_automation_runs
         SET status='retrying', attempt=?, response_code=?, error=?,
             next_retry_at=?, finished_at=datetime('now')
         WHERE id=?`,
      ).run(attempt, lastStatus ?? null, lastError ?? "échec", next, run.id);
    }
    done++;
  }
  return done;
}

/** Déclenchement manuel (bouton) pour une ligne. */
export async function fireButtonAutomations(
  db: SqliteDatabase,
  input: {
    tableName: string;
    row: Record<string, unknown>;
    rowid?: number | null;
    automationId?: string;
  },
): Promise<number> {
  const autos = listAutomations(db, input.tableName).filter(
    (a) =>
      a.enabled &&
      a.triggerType === "button_pressed" &&
      (!input.automationId || a.id === input.automationId),
  );
  if (!autos.length) return 0;

  const insert = db.prepare(
    `INSERT INTO db_automation_events (table_name, row_rowid, op, after_json, status)
     VALUES (?, ?, 'button', ?, 'pending')`,
  );
  const info = insert.run(
    input.tableName,
    input.rowid ?? null,
    JSON.stringify(input.row),
  );
  const event = db
    .prepare(`SELECT * FROM db_automation_events WHERE id = ?`)
    .get(Number(info.lastInsertRowid)) as AutomationEvent;

  const before = null;
  const after = input.row;
  let matched = 0;
  for (const auto of autos) {
    if (!evaluateConditions(auto.conditions, { before, after })) continue;
    matched++;
    let ok = true;
    let lastStatus: number | undefined;
    let lastError: string | undefined;
    for (const action of auto.actions) {
      const payload = buildPayload(auto, event, before, after, action);
      const result = await runAction(action, payload);
      lastStatus = result.status;
      if (!result.ok) {
        ok = false;
        lastError = result.error;
        break;
      }
    }
    recordRun(db, {
      automationId: auto.id,
      eventId: event.id,
      status: ok ? "success" : "failed",
      attempt: 1,
      responseCode: lastStatus ?? null,
      error: lastError ?? null,
    });
  }
  db.prepare(
    `UPDATE db_automation_events SET status='processed', processed_at=datetime('now') WHERE id=?`,
  ).run(event.id);
  return matched;
}

let workerTimer: ReturnType<typeof setInterval> | null = null;

export function startAutomationWorker(
  getDb: () => SqliteDatabase,
  intervalMs = 2000,
): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    try {
      const db = getDb();
      processPendingEvents(db, 25).catch(() => {
        /* tick suivant */
      });
      processRetries(db, 10).catch(() => {
        /* tick suivant */
      });
    } catch {
      /* db pas prête */
    }
  }, intervalMs);
  if (typeof workerTimer === "object" && "unref" in workerTimer) {
    workerTimer.unref?.();
  }
}
