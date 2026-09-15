/**
 * Ring buffer en mémoire des appels API v1 + MCP (diagnostic desktop).
 * Pas de persistance SQLite pour le MVP — process-local, max ~1000 entrées.
 * O5 — gold, marque-agnostique.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveFleetStateDir } from "./config.js";

export type RequestLogSource = "api" | "mcp";

export type RequestLogDetail = {
  jsonrpcMethod?: string;
  tool?: string;
  args?: unknown;
  query?: Record<string, string>;
  body?: unknown;
  error?: string;
  ok?: boolean;
  authType?: "api_key" | "oauth";
  clientId?: string;
  userId?: string | null;
};

export type RequestLogEntry = {
  id: string;
  ts: string;
  source: RequestLogSource;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  detail: RequestLogDetail;
};

const DEFAULT_CAPACITY = 1000;
const MAX_STRING = 400;
const MAX_ARRAY = 20;
const MAX_DEPTH = 6;
const MAX_KEYS = 40;

/** Clés / noms de champs considérés secrets — jamais loggés en clair. */
const SECRET_KEY_RE =
  /^(authorization|cookie|set-cookie|password|passwd|pwd|secret|token|access_token|refresh_token|id_token|api[_-]?key|x-api-key|x-agent-key|mcp_jwt|mcp.jwt|client_secret|client_assertion|bearer|session|jwt)$/i;

/** Couvre les clés API marque (`*_live_*`), Bearer et JWT. */
const SECRET_VALUE_RE =
  /\b([a-z0-9]+_live_[A-Za-z0-9]+|Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i;

let capacity = DEFAULT_CAPACITY;
const buffer: RequestLogEntry[] = [];
let seq = 0;

export function getRequestLogCapacity(): number {
  return capacity;
}

/** Test-only : redimensionne / vide. */
export function _resetRequestLogsForTests(nextCapacity = DEFAULT_CAPACITY): void {
  capacity = nextCapacity;
  buffer.length = 0;
  seq = 0;
}

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key.trim());
}

export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[…]";
  if (value == null) return value;
  if (typeof value === "string") {
    let s = value;
    if (SECRET_VALUE_RE.test(s)) {
      s = s.replace(SECRET_VALUE_RE, "[redacted]");
    }
    if (s.length > MAX_STRING) {
      return `${s.slice(0, MAX_STRING)}…(+${s.length - MAX_STRING})`;
    }
    return s;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY)
      .map((v) => redactSecrets(v, depth + 1));
    if (value.length > MAX_ARRAY) {
      items.push(`…(+${value.length - MAX_ARRAY} items)`);
    }
    return items;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    let i = 0;
    for (const [k, v] of entries) {
      if (i >= MAX_KEYS) {
        out["…"] = `+${entries.length - MAX_KEYS} keys`;
        break;
      }
      out[k] = isSecretKey(k) ? "[redacted]" : redactSecrets(v, depth + 1);
      i++;
    }
    return out;
  }
  return String(value);
}

export function pushRequestLog(
  entry: Omit<RequestLogEntry, "id" | "detail"> & {
    id?: string;
    detail?: RequestLogDetail;
  },
): RequestLogEntry {
  const full: RequestLogEntry = {
    id: entry.id ?? `rl_${++seq}_${Date.now().toString(36)}`,
    ts: entry.ts,
    source: entry.source,
    method: entry.method,
    path: entry.path,
    status: entry.status,
    durationMs: entry.durationMs,
    detail: entry.detail ?? {},
  };
  buffer.push(full);
  if (buffer.length > capacity) {
    buffer.splice(0, buffer.length - capacity);
  }
  mirrorRequestLogToFile(full);
  return full;
}

/** Miroir jsonl pour l’agent flotte Electron. */
function mirrorRequestLogToFile(entry: RequestLogEntry): void {
  try {
    const dir = resolveFleetStateDir();
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "request-logs.jsonl");
    const line =
      JSON.stringify({
        at: entry.ts,
        timestamp: entry.ts,
        method: entry.method,
        path: entry.path,
        status: entry.status,
        durationMs: entry.durationMs,
        source: entry.source,
        summary: `${entry.method} ${entry.path} → ${entry.status}`,
      }) + "\n";
    fs.appendFileSync(file, line);
    try {
      const st = fs.statSync(file);
      if (st.size > 2_000_000) {
        const raw = fs.readFileSync(file, "utf8");
        const lines = raw.trim().split("\n");
        fs.writeFileSync(file, `${lines.slice(-500).join("\n")}\n`);
      }
    } catch {
      /* ignore */
    }
  } catch {
    /* best-effort */
  }
}

export type ListRequestLogsOpts = {
  limit?: number;
  source?: RequestLogSource | "all";
  q?: string;
  errorsOnly?: boolean;
};

function entryMatchesQuery(entry: RequestLogEntry, q: string): boolean {
  const hay = [
    entry.method,
    entry.path,
    entry.source,
    String(entry.status),
    entry.detail.jsonrpcMethod ?? "",
    entry.detail.tool ?? "",
    entry.detail.error ?? "",
    JSON.stringify(entry.detail.args ?? ""),
    JSON.stringify(entry.detail.body ?? ""),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function listRequestLogs(opts: ListRequestLogsOpts = {}): {
  logs: RequestLogEntry[];
  total: number;
  capacity: number;
} {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), capacity);
  const source = opts.source && opts.source !== "all" ? opts.source : null;
  const q = (opts.q || "").trim().toLowerCase();
  const errorsOnly = opts.errorsOnly === true;

  let items = buffer.slice().reverse();
  if (source) items = items.filter((e) => e.source === source);
  if (errorsOnly) {
    items = items.filter(
      (e) =>
        e.status >= 400 ||
        e.detail.ok === false ||
        Boolean(e.detail.error),
    );
  }
  if (q) items = items.filter((e) => entryMatchesQuery(e, q));

  return {
    logs: items.slice(0, limit),
    total: items.length,
    capacity,
  };
}

export function clearRequestLogs(): { cleared: number } {
  const cleared = buffer.length;
  buffer.length = 0;
  return { cleared };
}

export function parseJsonRpcMessages(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return [raw];
  return [];
}

/** Extrait method / tool / args d'un corps JSON-RPC MCP. */
export function summarizeMcpRequest(body: unknown): RequestLogDetail {
  const msgs = parseJsonRpcMessages(body);
  const first = msgs[0] as Record<string, unknown> | undefined;
  if (!first) return {};
  const method = typeof first.method === "string" ? first.method : undefined;
  const params =
    first.params && typeof first.params === "object"
      ? (first.params as Record<string, unknown>)
      : undefined;
  const detail: RequestLogDetail = { jsonrpcMethod: method };
  if (method === "tools/call" && params) {
    if (typeof params.name === "string") detail.tool = params.name;
    if ("arguments" in params) {
      detail.args = redactSecrets(params.arguments);
    }
  } else if (params) {
    detail.args = redactSecrets(params);
  }
  return detail;
}

/** Extrait erreur / isError du résultat JSON-RPC MCP. */
export function summarizeMcpResponse(body: unknown): Pick<
  RequestLogDetail,
  "ok" | "error"
> {
  const msgs = parseJsonRpcMessages(body);
  const first = msgs[0] as Record<string, unknown> | undefined;
  if (!first) return { ok: true };

  if (first.error && typeof first.error === "object") {
    const err = first.error as Record<string, unknown>;
    const message =
      typeof err.message === "string"
        ? err.message
        : JSON.stringify(redactSecrets(err));
    return { ok: false, error: message };
  }

  const result = first.result;
  if (result && typeof result === "object") {
    const r = result as {
      isError?: boolean;
      content?: Array<{ type?: string; text?: string }>;
    };
    if (r.isError) {
      const texts = (r.content || [])
        .map((c) => (typeof c.text === "string" ? c.text : ""))
        .filter(Boolean);
      let error = texts.join("\n") || "MCP tool error";
      try {
        const parsed = JSON.parse(error) as { error?: string };
        if (typeof parsed?.error === "string") error = parsed.error;
      } catch {
        /* texte brut */
      }
      if (error.length > 2000) error = `${error.slice(0, 2000)}…`;
      return { ok: false, error };
    }
  }
  return { ok: true };
}

/** Extrait un message d'erreur métier d'une réponse API JSON. */
export function extractApiErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const o = body as Record<string, unknown>;
  if (typeof o.error === "string") return o.error;
  if (o.error && typeof o.error === "object") {
    const e = o.error as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
    if (typeof e.code === "string" && typeof e.message !== "string") {
      return e.code;
    }
  }
  if (typeof o.message === "string") return o.message;
  return undefined;
}

export function shouldSkipRequestLog(pathName: string): boolean {
  const p = pathName.split("?")[0] || pathName;
  return (
    p.endsWith("/admin/request-logs") ||
    p.includes("/admin/request-logs/")
  );
}
