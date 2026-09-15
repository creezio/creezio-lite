/**
 * Proxy façade Electron → Hono `/mcp` (D1/C2 → M9 SoT kit).
 *
 * Parle le transport Streamable HTTP JSON (même shape que test-mcp-oauth).
 * Si l'upstream est absent ou en erreur et `fallbackLocal`, délègue à la
 * façade locale (brand mounts) — zéro perte offline / tests.
 */

import type { McpFacade } from "./facade.js";
import {
  resolveMcpFacadeRole,
  type McpFacadeMode,
  type McpUpstreamRef,
} from "./runtime.js";
import type {
  McpToolCallResult,
  McpToolDefinition,
  McpToolsBySpace,
} from "./types.js";

export type WrapMcpFacadeWithHonoProxyOptions = {
  local: McpFacade;
  upstream: McpUpstreamRef;
  /** Défaut `hono-preferred` (proxy si upstream, sinon local). */
  mode?: McpFacadeMode;
  /** Si proxy échoue, retomber sur local (défaut true sauf mode hono-proxy strict). */
  fallbackLocal?: boolean;
  /** clientInfo JSON-RPC (défaut creezio-mcp-proxy). */
  clientName?: string;
  clientVersion?: string;
};

type JsonRpcOk = {
  result?: {
    tools?: Array<{ name: string; description?: string }>;
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
    serverInfo?: { name?: string };
  };
  error?: { message?: string; code?: number };
};

async function mcpJsonRpc(
  baseUrl: string,
  apiKey: string | null,
  body: Record<string, unknown>,
): Promise<{ status: number; json: JsonRpcOk | null; text: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: JsonRpcOk | null = null;
  try {
    if (text.startsWith("event:") || text.startsWith("data:")) {
      const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
      json = dataLine ? (JSON.parse(dataLine.slice(5)) as JsonRpcOk) : null;
    } else {
      json = JSON.parse(text) as JsonRpcOk;
    }
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

function spaceForToolName(name: string): McpToolDefinition["space"] {
  if (name.startsWith("creezio.") || name.startsWith("core.")) return "core";
  if (name.startsWith("plugin.")) return "plugin";
  return "module";
}

function ownerFromName(name: string): string | undefined {
  const m = /^module\.([^.]+)\./.exec(name);
  return m?.[1];
}

async function honoListTools(
  baseUrl: string,
  apiKey: string | null,
  clientName: string,
  clientVersion: string,
): Promise<McpToolDefinition[]> {
  await mcpJsonRpc(baseUrl, apiKey, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: clientName, version: clientVersion },
    },
  });
  const listed = await mcpJsonRpc(baseUrl, apiKey, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });
  if (listed.status >= 400 || !listed.json?.result?.tools) {
    throw new Error(
      `hono_mcp_list_failed: status=${listed.status} ${listed.text.slice(0, 200)}`,
    );
  }
  return listed.json.result.tools.map((t) => ({
    name: t.name,
    description: t.description || t.name,
    space: spaceForToolName(t.name),
    ...(ownerFromName(t.name) ? { ownerId: ownerFromName(t.name) } : {}),
  }));
}

async function honoCallTool(
  baseUrl: string,
  apiKey: string | null,
  name: string,
  args: Record<string, unknown>,
  clientName: string,
  clientVersion: string,
): Promise<McpToolCallResult> {
  await mcpJsonRpc(baseUrl, apiKey, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: clientName, version: clientVersion },
    },
  });
  const call = await mcpJsonRpc(baseUrl, apiKey, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: args },
  });
  if (call.status >= 400) {
    return {
      ok: false,
      error: `hono_http_${call.status}`,
      content: { text: call.text.slice(0, 500) },
    };
  }
  if (call.json?.error) {
    return {
      ok: false,
      error: call.json.error.message || "hono_rpc_error",
    };
  }
  const raw = call.json?.result?.content?.[0]?.text;
  let content: unknown = raw;
  if (typeof raw === "string") {
    try {
      content = JSON.parse(raw);
    } catch {
      content = { text: raw };
    }
  }
  const isErr = Boolean(call.json?.result?.isError);
  return { ok: !isErr, content, ...(isErr ? { error: "hono_tool_error" } : {}) };
}

function groupBySpace(defs: McpToolDefinition[]): McpToolsBySpace {
  const out: McpToolsBySpace = { core: [], module: [], plugin: [] };
  for (const d of defs) {
    const space = d.space || "module";
    if (space === "core" || space === "plugin" || space === "module") {
      out[space].push(d);
    } else {
      out.module.push(d);
    }
  }
  return out;
}

/**
 * Enrobe une façade locale : dès qu'un upstream Hono est disponible
 * (mode hono-proxy / hono-preferred), list/call passent par `/mcp`.
 */
export function wrapMcpFacadeWithHonoProxy(
  opts: WrapMcpFacadeWithHonoProxyOptions,
): McpFacade {
  const mode = opts.mode ?? "hono-preferred";
  const fallbackLocal = opts.fallbackLocal ?? mode !== "hono-proxy";
  const local = opts.local;
  const clientName = opts.clientName ?? "creezio-mcp-proxy";
  const clientVersion = opts.clientVersion ?? "m9";

  async function viaHono<T>(
    run: (base: string, key: string | null) => Promise<T>,
    localRun: () => Promise<T>,
  ): Promise<T> {
    const base = opts.upstream.getBaseUrl();
    const role = resolveMcpFacadeRole(mode, base);
    if (role !== "hono-proxy" || !base) {
      return localRun();
    }
    try {
      return await run(base, opts.upstream.getApiKey());
    } catch (err) {
      if (!fallbackLocal) throw err;
      return localRun();
    }
  }

  return {
    setDiscoverTools: (fn) => local.setDiscoverTools(fn),
    setDiscoverToolsBySpace: (fn) => local.setDiscoverToolsBySpace(fn),
    registerTool: (t) => local.registerTool(t),
    registerAlias: (a, c) => local.registerAlias(a, c),
    unregisterTool: (n) => local.unregisterTool(n),
    listAliases: () => local.listAliases(),
    resolveToolName: (n) => local.resolveToolName(n),

    async listTools(listOpts) {
      return viaHono(
        async (base, key) => {
          const tools = await honoListTools(
            base,
            key,
            clientName,
            clientVersion,
          );
          return { tools };
        },
        () => local.listTools(listOpts),
      );
    },

    async listToolsBySpace(listOpts) {
      return viaHono(
        async (base, key) =>
          groupBySpace(
            await honoListTools(base, key, clientName, clientVersion),
          ),
        () => local.listToolsBySpace(listOpts),
      );
    },

    async callTool(name, args = {}, callOpts) {
      return viaHono(
        (base, key) =>
          honoCallTool(base, key, name, args, clientName, clientVersion),
        () => local.callTool(name, args, callOpts),
      );
    },
  };
}

/** Helpers testables sans façade complète. */
export const __mcpHonoProxyTest = {
  honoListTools,
  honoCallTool,
  groupBySpace,
  mcpJsonRpc,
};
