/**
 * Middlewares de collecte des logs API / MCP → ring buffer mémoire.
 * Ne doit jamais faire échouer la requête (tout est try/catch).
 * O5 — gold.
 */
import type { Context, MiddlewareHandler } from "hono";
import {
  extractApiErrorMessage,
  pushRequestLog,
  redactSecrets,
  shouldSkipRequestLog,
  summarizeMcpRequest,
  summarizeMcpResponse,
  type RequestLogDetail,
  type RequestLogSource,
} from "./request-logs.js";

async function safeReadText(resOrReq: {
  text: () => Promise<string>;
}): Promise<string | null> {
  try {
    return await resOrReq.text();
  } catch {
    return null;
  }
}

function safeJsonParse(text: string | null): unknown {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function queryRecord(c: Context): Record<string, string> | undefined {
  try {
    const url = new URL(c.req.url);
    const out: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      out[k] = isSecretLookingParam(k) ? "[redacted]" : String(redactSecrets(v));
    });
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

function isSecretLookingParam(key: string): boolean {
  return /token|secret|password|key|jwt|auth/i.test(key);
}

async function readRequestJson(c: Context): Promise<unknown> {
  const method = c.req.method.toUpperCase();
  if (
    method === "GET" ||
    method === "HEAD" ||
    method === "OPTIONS" ||
    method === "DELETE"
  ) {
    return null;
  }
  const ct = (c.req.header("content-type") || "").toLowerCase();
  if (ct && !ct.includes("json") && !ct.includes("text/plain")) {
    return { _skipped: `content-type ${ct.split(";")[0]}` };
  }
  const text = await safeReadText(c.req.raw.clone());
  if (!text) return null;
  if (text.length > 64_000) {
    return { _truncated: true, preview: redactSecrets(text.slice(0, 2000)) };
  }
  const parsed = safeJsonParse(text);
  return parsed != null
    ? redactSecrets(parsed)
    : { _raw: redactSecrets(text.slice(0, 500)) };
}

async function readResponseJson(c: Context): Promise<unknown> {
  const res = c.res;
  if (!res) return null;
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct && !ct.includes("json") && !ct.includes("text/plain")) return null;
  const len = res.headers.get("content-length");
  if (len && Number(len) > 256_000) return null;
  const text = await safeReadText(res.clone());
  if (!text || text.length > 256_000) return null;
  return safeJsonParse(text);
}

function commitLog(
  source: RequestLogSource,
  c: Context,
  started: number,
  detail: RequestLogDetail,
): void {
  try {
    const pathName = c.req.path || new URL(c.req.url).pathname;
    if (shouldSkipRequestLog(pathName)) return;
    const status = c.res?.status ?? 0;
    pushRequestLog({
      ts: new Date(started).toISOString(),
      source,
      method: c.req.method.toUpperCase(),
      path: pathName,
      status,
      durationMs: Math.max(0, Date.now() - started),
      detail,
    });
  } catch (err) {
    console.error("[request-logs] commit failed", err);
  }
}

/** Middleware API v1 — à brancher tôt (avant auth). */
export const requestLogApiMiddleware: MiddlewareHandler = async (c, next) => {
  const started = Date.now();
  const pathName = c.req.path || "";
  if (shouldSkipRequestLog(pathName) || c.req.method.toUpperCase() === "OPTIONS") {
    await next();
    return;
  }

  let body: unknown = null;
  try {
    body = await readRequestJson(c);
  } catch {
    body = null;
  }

  try {
    await next();
  } catch (err) {
    commitLog("api", c, started, {
      query: queryRecord(c),
      body: body ?? undefined,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const detail: RequestLogDetail = {
    query: queryRecord(c),
    body: body ?? undefined,
  };
  const status = c.res?.status ?? 0;
  if (status >= 400) {
    try {
      const resp = await readResponseJson(c);
      const msg = extractApiErrorMessage(resp);
      if (msg) detail.error = msg;
      detail.ok = false;
    } catch {
      detail.ok = false;
    }
  } else {
    detail.ok = true;
  }
  commitLog("api", c, started, detail);
};

/** Middleware MCP `/mcp` uniquement (pas OAuth). */
export const requestLogMcpMiddleware: MiddlewareHandler = async (c, next) => {
  const started = Date.now();
  if (c.req.method.toUpperCase() === "OPTIONS") {
    await next();
    return;
  }

  let detail: RequestLogDetail = {};
  try {
    const text = await safeReadText(c.req.raw.clone());
    const parsed = safeJsonParse(text);
    if (parsed != null) {
      detail = summarizeMcpRequest(parsed);
    }
  } catch {
    /* ignore */
  }

  try {
    await next();
  } catch (err) {
    detail.ok = false;
    detail.error = err instanceof Error ? err.message : String(err);
    commitLog("mcp", c, started, detail);
    throw err;
  }

  try {
    const auth = c.get("mcpAuth") as
      | {
          authType?: "api_key" | "oauth";
          clientId?: string;
          userId?: string | null;
        }
      | undefined;
    if (auth) {
      detail.authType = auth.authType;
      detail.clientId = auth.clientId;
      detail.userId = auth.userId;
    }
    const resp = await readResponseJson(c);
    if (resp != null) {
      const summary = summarizeMcpResponse(resp);
      detail = { ...detail, ...summary };
    } else {
      const status = c.res?.status ?? 0;
      detail.ok = status > 0 && status < 400;
      if (!detail.ok && status >= 400) {
        detail.error = detail.error || `HTTP ${status}`;
      }
    }
  } catch {
    /* ignore */
  }

  commitLog("mcp", c, started, detail);
};
