/**
 * Bridge assistant ↔ façade MCP marque (O4r).
 * Surface métier = listTools / callTool — pas BrandTools.executeTool.
 */
import { assistantMcp } from "../brand/registry.js";
import type {
  AssistantMcpCallResult,
  AssistantMcpToolDef,
  AssistantToolDefinition,
} from "../brand/types.js";
import { openaiSafeToolName } from "./openai-tool-payload.js";

export { openaiSafeToolName } from "./openai-tool-payload.js";

let cache: {
  at: number;
  tools: AssistantMcpToolDef[];
  /** Noms exposés au LLM (safe) + canoniques MCP. */
  names: Set<string>;
  /** safe OpenAI → nom MCP canonique. */
  safeToCanonical: Map<string, string>;
} = {
  at: 0,
  tools: [],
  names: new Set(),
  safeToCanonical: new Map(),
};

function ttlMs(): number {
  return assistantMcp()?.listCacheTtlMs ?? 30_000;
}

/** Résout un nom LLM (safe ou canonique) → nom MCP à appeler. */
export function resolveMcpToolName(name: string): string {
  return cache.safeToCanonical.get(name) || name;
}

export function mcpToolDefToAssistant(
  t: AssistantMcpToolDef,
): AssistantToolDefinition {
  const schema =
    t.inputSchema && typeof t.inputSchema === "object"
      ? t.inputSchema
      : { type: "object", properties: {} };
  const parameters =
    "type" in schema || "properties" in schema
      ? schema
      : { type: "object", properties: schema as Record<string, unknown> };
  const safe = openaiSafeToolName(t.name);
  return {
    type: "function",
    function: {
      name: safe,
      description:
        safe === t.name
          ? t.description || t.name
          : `${t.description || t.name} [${t.name}]`,
      parameters: parameters as Record<string, unknown>,
    },
  };
}

export async function refreshMcpToolCache(): Promise<void> {
  const mcp = assistantMcp();
  if (!mcp?.listTools) {
    cache = {
      at: Date.now(),
      tools: [],
      names: new Set(),
      safeToCanonical: new Map(),
    };
    return;
  }
  const bearer = mcp.bearerToken ? await mcp.bearerToken() : null;
  const tools = await mcp.listTools({ bearerToken: bearer });
  const list = Array.isArray(tools) ? tools : [];
  const safeToCanonical = new Map<string, string>();
  const names = new Set<string>();
  for (const t of list) {
    names.add(t.name);
    const safe = openaiSafeToolName(t.name);
    names.add(safe);
    safeToCanonical.set(safe, t.name);
    // Identité si déjà safe
    if (safe === t.name) safeToCanonical.set(t.name, t.name);
  }
  cache = {
    at: Date.now(),
    tools: list,
    names,
    safeToCanonical,
  };
}

export function cachedMcpToolDefinitions(): AssistantToolDefinition[] {
  return cache.tools.map(mcpToolDefToAssistant);
}

export function cachedMcpToolNames(): Set<string> {
  return cache.names;
}

export async function ensureMcpToolCache(): Promise<void> {
  if (Date.now() - cache.at < ttlMs() && cache.at > 0) return;
  await refreshMcpToolCache();
}

export function looksLikeMcpToolName(name: string): boolean {
  return (
    name.startsWith("module.") ||
    name.startsWith("plugin.") ||
    name.startsWith("creezio.") ||
    name.startsWith("core.") ||
    name.startsWith("module_") ||
    name.startsWith("plugin_") ||
    name.startsWith("creezio_") ||
    name.startsWith("core_")
  );
}

/** true si le nom est dans le cache discovery ou namespacé MCP. */
export function mcpOwnsToolName(name: string): boolean {
  if (!assistantMcp()?.callTool) return false;
  if (cache.names.has(name)) return true;
  return looksLikeMcpToolName(name);
}

/** JWT session depuis Cookie / Authorization de la requête chat OS. */
export function sessionAuthFromRequest(req: Request): {
  bearerToken: string | null;
  headers: Record<string, string>;
} {
  const cookie = req.headers.get("cookie") || "";
  const authorization = req.headers.get("authorization") || "";
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (authorization) headers.authorization = authorization;
  let bearer = "";
  const m = authorization.match(/^Bearer\s+(.+)$/i);
  if (m?.[1] && m[1].trim().split(".").length === 3) {
    bearer = m[1].trim();
  }
  if (!bearer && cookie) {
    for (const part of cookie.split(";")) {
      const val = part.split("=").slice(1).join("=").trim();
      if (!val || val.split(".").length !== 3) continue;
      try {
        bearer = decodeURIComponent(val);
      } catch {
        bearer = val;
      }
      break;
    }
  }
  if (bearer && !headers.authorization) {
    headers.authorization = `Bearer ${bearer}`;
  }
  return { bearerToken: bearer || null, headers };
}

export async function callAssistantMcpTool(
  name: string,
  args: Record<string, unknown>,
  ctx: Record<string, unknown>,
): Promise<AssistantMcpCallResult | null> {
  const mcp = assistantMcp();
  if (!mcp?.callTool) return null;
  await ensureMcpToolCache();
  if (!mcpOwnsToolName(name)) return null;
  const canonical = resolveMcpToolName(name);
  const ctxBearer =
    typeof ctx.bearerToken === "string" && ctx.bearerToken.trim()
      ? ctx.bearerToken.trim()
      : null;
  const ctxHeaders =
    ctx.sessionHeaders &&
    typeof ctx.sessionHeaders === "object" &&
    !Array.isArray(ctx.sessionHeaders)
      ? (ctx.sessionHeaders as Record<string, string>)
      : undefined;
  const serviceBearer = mcp.bearerToken ? await mcp.bearerToken() : null;
  const bearer = ctxBearer || serviceBearer;
  try {
    const result = await mcp.callTool(canonical, args, {
      bearerToken: bearer,
      ...(ctxHeaders && Object.keys(ctxHeaders).length
        ? { headers: ctxHeaders }
        : {}),
      ctx,
    });
    // tool_not_found → laisser tomber vers « outil inconnu » (pas d’erreur opaque)
    if (
      result &&
      result.ok === false &&
      result.error === "tool_not_found" &&
      !cache.names.has(name) &&
      !cache.names.has(canonical)
    ) {
      return null;
    }
    return result;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function summarizeMcpResult(
  name: string,
  result: AssistantMcpCallResult,
): string {
  if (typeof result.uiSummary === "string" && result.uiSummary) {
    return result.uiSummary;
  }
  if (!result.ok) return result.error || `échec ${name}`;
  const c = result.content;
  if (c && typeof c === "object" && !Array.isArray(c)) {
    const o = c as Record<string, unknown>;
    if (typeof o.uiSummary === "string") return o.uiSummary;
    if (o.commande_id != null) return `panier #${o.commande_id}`;
    if (Array.isArray(o.lignes)) return `panier · ${o.lignes.length} ligne(s)`;
  }
  return `mcp ${name}`;
}

/** Helper marque : adapter une McpFacade kit → AssistantMcpConfig. */
export function mcpFacadeToAssistantConfig(facade: {
  listTools: (opts?: {
    bearerToken?: string | null;
    space?: "core" | "module" | "plugin";
    publicSurface?: "legacy-preferred" | "canonical" | "both";
  }) => Promise<{ tools: Array<{
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    space?: string;
  }> }>;
  callTool: (
    name: string,
    args?: Record<string, unknown>,
    opts?: { bearerToken?: string | null; headers?: Record<string, string> },
  ) => Promise<AssistantMcpCallResult>;
  listAliases?: () => Record<string, string>;
}): import("../brand/types.js").AssistantMcpConfig {
  return {
    listCacheTtlMs: 30_000,
    async listTools(opts) {
      // Surface canonique : LLM voit module.panier.* (pas double legacy)
      const res = await facade.listTools({
        bearerToken: opts?.bearerToken,
        publicSurface: "canonical",
      });
      const tools = (res.tools || []).filter(
        (t) => t.space === "module" || t.space === "plugin" || !t.space,
      );
      // Canonique seul : ne pas réinjecter les alias Hermes (add_to_panier, …)
      // dans le payload chat OS — ça doublait la liste et dépassait le plafond
      // OpenAI 128. callTool résout encore les alias via la façade.
      return tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    },
    async callTool(name, args, opts) {
      return facade.callTool(name, args, {
        bearerToken: opts?.bearerToken,
        ...(opts?.headers ? { headers: opts.headers } : {}),
      });
    },
  };
}
