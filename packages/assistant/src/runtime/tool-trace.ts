import { randomUUID } from "crypto";
import { getAssistantDb } from "./chat-db.js";

const MAX_ARGS_CHARS = 8000;
const MAX_RESULT_CHARS = 24000;
const MAX_PREVIEW_CHARS = 2000;

export type TraceRunStatus =
  | "running"
  | "ok"
  | "error"
  | "timeout"
  | "fallback_anthropic"
  | "tool_limit"
  | "cancelled";

export type TraceRunRow = {
  id: string;
  conversation_id: string;
  user_message_preview: string | null;
  provider: string;
  model: string;
  status: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  rounds: number;
  meta_json: string | null;
};

export type TraceToolCallRow = {
  id: string;
  run_id: string;
  conversation_id: string;
  round: number;
  tool_name: string;
  arguments_json: string | null;
  result_json: string | null;
  result_ok: number;
  mode: string | null;
  error: string | null;
  duration_ms: number | null;
  sources_json: string | null;
  created_at: string;
};

export type TraceLlmRoundRow = {
  id: string;
  run_id: string;
  conversation_id: string;
  round: number;
  provider: string;
  model: string;
  http_status: number | null;
  finish_reason: string | null;
  tool_call_count: number;
  request_chars: number | null;
  response_preview: string | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function clip(s: string, max: number) {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…[truncated ${s.length - max} chars]`;
}

function safeJson(value: unknown, max: number): string {
  try {
    return clip(JSON.stringify(value), max);
  } catch {
    return clip(String(value), max);
  }
}

export function ensureToolTraceTables() {
  const db = getAssistantDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_message_preview TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      rounds INTEGER NOT NULL DEFAULT 0,
      meta_json TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_assistant_runs_conversation
      ON assistant_runs(conversation_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS assistant_tool_calls (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      tool_name TEXT NOT NULL,
      arguments_json TEXT,
      result_json TEXT,
      result_ok INTEGER NOT NULL DEFAULT 1,
      mode TEXT,
      error TEXT,
      duration_ms INTEGER,
      sources_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES assistant_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_assistant_tool_calls_run
      ON assistant_tool_calls(run_id, round, created_at);
    CREATE INDEX IF NOT EXISTS idx_assistant_tool_calls_conversation
      ON assistant_tool_calls(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS assistant_llm_rounds (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      http_status INTEGER,
      finish_reason TEXT,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      request_chars INTEGER,
      response_preview TEXT,
      error TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES assistant_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_assistant_llm_rounds_run
      ON assistant_llm_rounds(run_id, round);
  `);
}

function logLine(event: string, payload: Record<string, unknown>) {
  try {
    console.log(
      JSON.stringify({
        ts: nowIso(),
        scope: "assistant",
        event,
        ...payload,
      }),
    );
  } catch {
    /* ignore */
  }
}

/**
 * FK trace : les conversations peuvent vivre dans le store kit (core.db —
 * C1) alors que les tables de trace restent dans la DB legacy. Miroir stub
 * idempotent pour satisfaire `REFERENCES conversations(id)` dans les deux
 * layouts (en legacy pur, la ligne existe déjà → IGNORE).
 */
function ensureTraceConversationRow(conversationId: string) {
  const db = getAssistantDb();
  const now = nowIso();
  db.prepare(
    `INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at)
     VALUES (?, 'Nouvelle conversation', ?, ?)`,
  ).run(conversationId, now, now);
}

export function startAssistantRun(opts: {
  conversationId: string;
  userMessage: string;
  provider: string;
  model: string;
  meta?: Record<string, unknown>;
}): string {
  ensureToolTraceTables();
  ensureTraceConversationRow(opts.conversationId);
  const db = getAssistantDb();
  const id = randomUUID();
  const started = nowIso();
  db.prepare(
    `INSERT INTO assistant_runs
      (id, conversation_id, user_message_preview, provider, model, status, started_at, rounds, meta_json)
     VALUES (?, ?, ?, ?, ?, 'running', ?, 0, ?)`,
  ).run(
    id,
    opts.conversationId,
    clip(opts.userMessage, 500),
    opts.provider,
    opts.model,
    started,
    opts.meta ? safeJson(opts.meta, 4000) : null,
  );
  logLine("run_start", {
    runId: id,
    conversationId: opts.conversationId,
    provider: opts.provider,
    model: opts.model,
    userPreview: clip(opts.userMessage, 120),
  });
  return id;
}

export function finishAssistantRun(opts: {
  runId: string;
  status: TraceRunStatus;
  error?: string | null;
  rounds?: number;
  model?: string;
  provider?: string;
}) {
  ensureToolTraceTables();
  const db = getAssistantDb();
  const row = db
    .prepare(`SELECT started_at FROM assistant_runs WHERE id = ?`)
    .get(opts.runId) as { started_at?: string } | undefined;
  const finished = nowIso();
  const durationMs = row?.started_at
    ? Math.max(0, Date.parse(finished) - Date.parse(row.started_at))
    : null;
  db.prepare(
    `UPDATE assistant_runs
     SET status = ?, error = ?, finished_at = ?, duration_ms = ?,
         rounds = COALESCE(?, rounds),
         model = COALESCE(?, model),
         provider = COALESCE(?, provider)
     WHERE id = ?`,
  ).run(
    opts.status,
    opts.error ? clip(opts.error, 2000) : null,
    finished,
    durationMs,
    opts.rounds ?? null,
    opts.model ?? null,
    opts.provider ?? null,
    opts.runId,
  );
  logLine("run_finish", {
    runId: opts.runId,
    status: opts.status,
    durationMs,
    rounds: opts.rounds ?? null,
    error: opts.error ? clip(opts.error, 300) : null,
  });
}

export function logLlmRound(opts: {
  runId: string;
  conversationId: string;
  round: number;
  provider: string;
  model: string;
  httpStatus?: number | null;
  finishReason?: string | null;
  toolCallCount?: number;
  requestChars?: number | null;
  responsePreview?: string | null;
  error?: string | null;
  durationMs?: number | null;
}) {
  ensureToolTraceTables();
  const db = getAssistantDb();
  const id = randomUUID();
  const created = nowIso();
  db.prepare(
    `INSERT INTO assistant_llm_rounds
      (id, run_id, conversation_id, round, provider, model, http_status, finish_reason,
       tool_call_count, request_chars, response_preview, error, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    opts.runId,
    opts.conversationId,
    opts.round,
    opts.provider,
    opts.model,
    opts.httpStatus ?? null,
    opts.finishReason ?? null,
    opts.toolCallCount ?? 0,
    opts.requestChars ?? null,
    opts.responsePreview ? clip(opts.responsePreview, MAX_PREVIEW_CHARS) : null,
    opts.error ? clip(opts.error, 2000) : null,
    opts.durationMs ?? null,
    created,
  );
  db.prepare(`UPDATE assistant_runs SET rounds = MAX(rounds, ?) WHERE id = ?`).run(
    opts.round + 1,
    opts.runId,
  );
  logLine("llm_round", {
    runId: opts.runId,
    conversationId: opts.conversationId,
    round: opts.round,
    provider: opts.provider,
    model: opts.model,
    httpStatus: opts.httpStatus ?? null,
    finishReason: opts.finishReason ?? null,
    toolCallCount: opts.toolCallCount ?? 0,
    durationMs: opts.durationMs ?? null,
    error: opts.error ? clip(opts.error, 200) : null,
  });
  return id;
}

/** Extrait un résumé debug (SQL + lignes) pour logs / UI — sans secrets. */
export function summarizeToolCall(toolName: string, args: unknown, result: unknown) {
  const summary: Record<string, unknown> = { tool: toolName };
  const a = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const r = result && typeof result === "object" ? (result as Record<string, unknown>) : null;

  if (toolName === "run_sql") {
    const sql = typeof a.sql === "string" ? a.sql : typeof r?.sql === "string" ? r.sql : null;
    if (sql) summary.sql = clip(sql, 2000);
    if (r) {
      summary.ok = r.ok;
      summary.rowCount = r.rowCount ?? null;
      const meta =
        r.metadata && typeof r.metadata === "object"
          ? (r.metadata as Record<string, unknown>)
          : null;
      summary.totalMatching = r.totalMatching ?? meta?.totalMatching ?? null;
      if (Array.isArray(r.rows)) {
        summary.rowsPreview = r.rows.slice(0, 8);
      }
      if (r.error) summary.resultError = clip(String(r.error), 400);
      const ph =
        r.processHint && typeof r.processHint === "object"
          ? (r.processHint as {
              kind?: string;
              filters?: { table?: string; column?: string; triedLiteral?: string }[];
            })
          : null;
      if (ph?.kind) {
        summary.processHintKind = ph.kind;
        summary.processHintFilters = (ph.filters || []).map((f) => ({
          table: f.table,
          column: f.column,
          triedLiteral: f.triedLiteral,
        }));
      }
    }
  } else if (toolName === "search_knowledge") {
    if (typeof a.query === "string") summary.query = clip(a.query, 240);
    if (r) {
      summary.mode = r.mode ?? null;
      summary.hitCount = r.hitCount ?? (Array.isArray(r.hits) ? r.hits.length : null);
    }
  } else if (toolName === "get_entity") {
    summary.kind = a.kind ?? null;
    summary.id = a.id ?? null;
    if (r && r.entity && typeof r.entity === "object") {
      const ent = r.entity as Record<string, unknown>;
      summary.entityKeys = Object.keys(ent).slice(0, 20);
      if (ent.internal_vehicle_status != null) {
        summary.internal_vehicle_status = ent.internal_vehicle_status;
      }
    }
  } else if (toolName === "list_tables") {
    if (typeof a.q === "string") summary.query = clip(a.q, 120);
    if (r) {
      summary.totalTables = r.totalTables ?? null;
      summary.returnedTables = Array.isArray(r.tables) ? r.tables.length : null;
    }
  } else if (toolName === "describe_table") {
    summary.table = a.table ?? null;
    if (r) {
      summary.ok = r.ok;
      summary.rowCount = r.rowCount ?? null;
      summary.columnCount = Array.isArray(r.columns) ? r.columns.length : null;
      if (Array.isArray(r.distinctSamples)) {
        summary.enumCols = r.distinctSamples.map(
          (s: { column?: string }) => s.column,
        );
      }
      if (r.error) summary.resultError = clip(String(r.error), 400);
    }
  } else if (toolName === "list_distinct_values") {
    summary.table = a.table ?? null;
    summary.column = a.column ?? null;
    if (r && Array.isArray(r.values)) {
      summary.valuesPreview = r.values.slice(0, 12);
      summary.distinctCount = r.distinctNonNullCount ?? r.distinctCount ?? r.values.length;
      summary.nullCount = r.nullCount ?? null;
      summary.groupByBucketCount = r.groupByBucketCount ?? null;
    }
    if (r?.error) summary.resultError = clip(String(r.error), 400);
  } else if (toolName === "find_columns") {
    summary.query = typeof a.q === "string" ? clip(a.q, 120) : null;
    summary.scope = a.scope ?? "both";
    if (r && Array.isArray(r.hits)) {
      summary.hitCount = r.hits.length;
      summary.hitsPreview = r.hits.slice(0, 8).map((h: { table?: string; column?: string; match?: string }) => ({
        table: h.table,
        column: h.column,
        match: h.match,
      }));
    }
    if (r?.error) summary.resultError = clip(String(r.error), 400);
  }
  return summary;
}

export function logToolCall(opts: {
  runId: string;
  conversationId: string;
  round: number;
  toolName: string;
  args: unknown;
  result: unknown;
  resultOk?: boolean;
  mode?: string | null;
  error?: string | null;
  durationMs?: number | null;
  sources?: unknown;
}) {
  ensureToolTraceTables();
  const db = getAssistantDb();
  const id = randomUUID();
  const created = nowIso();
  const argsJson = safeJson(opts.args, MAX_ARGS_CHARS);
  const resultJson = safeJson(opts.result, MAX_RESULT_CHARS);
  const summary = summarizeToolCall(opts.toolName, opts.args, opts.result);
  db.prepare(
    `INSERT INTO assistant_tool_calls
      (id, run_id, conversation_id, round, tool_name, arguments_json, result_json,
       result_ok, mode, error, duration_ms, sources_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    opts.runId,
    opts.conversationId,
    opts.round,
    opts.toolName,
    argsJson,
    resultJson,
    opts.resultOk === false ? 0 : 1,
    opts.mode ?? null,
    opts.error ? clip(opts.error, 2000) : null,
    opts.durationMs ?? null,
    opts.sources ? safeJson(opts.sources, 4000) : null,
    created,
  );
  logLine("tool_call", {
    runId: opts.runId,
    conversationId: opts.conversationId,
    round: opts.round,
    tool: opts.toolName,
    mode: opts.mode ?? null,
    durationMs: opts.durationMs ?? null,
    resultOk: opts.resultOk !== false,
    argsPreview: clip(argsJson, 240),
    error: opts.error ? clip(opts.error, 200) : null,
    ...summary,
  });
  return id;
}

export function getConversationTrace(conversationId: string) {
  ensureToolTraceTables();
  const db = getAssistantDb();
  const runs = db
    .prepare(
      `SELECT * FROM assistant_runs
       WHERE conversation_id = ?
       ORDER BY started_at ASC`,
    )
    .all(conversationId) as TraceRunRow[];
  const toolCalls = db
    .prepare(
      `SELECT * FROM assistant_tool_calls
       WHERE conversation_id = ?
       ORDER BY created_at ASC`,
    )
    .all(conversationId) as TraceToolCallRow[];
  const llmRounds = db
    .prepare(
      `SELECT * FROM assistant_llm_rounds
       WHERE conversation_id = ?
       ORDER BY created_at ASC`,
    )
    .all(conversationId) as TraceLlmRoundRow[];
  return { runs, toolCalls, llmRounds };
}
