/**
 * Orchestration chat assistant (SSE / tools / Work Hermes) — Phase O4 / O4r.
 *
 * SoT générique : surface/ui/supplier, explore SQL, Meili, boucles OpenAI/Anthropic.
 * Métier = discovery MCP (`configureAssistantBrand({ mcp })`).
 * Tasks = adapter kit (`configureAssistantBrand({ tasks })`).
 * Projections = getEntity / entitySources / Meili (pas d’executeTool métier).
 *
 * BrandTools.executeTool = legacy mort (O4r).
 */

import {
  assistantBrandTools,
  assistantHermes,
  assistantIdentity,
  requireAssistantBrand,
} from "../brand/registry.js";
import type {
  AssistantAuthSession,
  AssistantBrandConfig,
} from "../brand/types.js";
import { pageInfoFor } from "../brand/app-map-shim.js";
import {
  buildSystemPrompt,
  getToolDefinitions,
  maxToolRounds,
  shouldAuditDistribution,
  shouldForceRunSql,
  shouldPreferSearchKnowledge,
} from "../brand/prompts-shim.js";
import {
  collectSourcesFromSqlRows,
  type AssistantSource,
} from "../brand/sources-shim.js";
import {
  callAssistantMcpTool,
  ensureMcpToolCache,
  sessionAuthFromRequest,
  summarizeMcpResult,
} from "./mcp-tools.js";
import { executeTaskTool } from "./tasks-tools.js";
import { isExternalActiveSurface,
  formatActiveSurfaceRuntimeBlock,
  looksLikeSurfaceCommand,
  parseActiveSurface,
  parseSupplierTabSummaries,
  type ActiveSurface,
} from "./active-surface.js";
import { searchKnowledge } from "./meili-rag.js";
import {
  describeTable,
  findColumns,
  listDistinctValues,
  listTables,
  summarizeExploreResult,
} from "./explore-tools.js";
import { runSql } from "./run-sql.js";
import { enrichEmptySqlWithDistinctHints } from "./sql-process-guard.js";
import {
  addMessage,
  adoptOrphanConversations,
  canAccessConversation,
  ensureConversation,
  getAgentProfile,
  getConversation,
  updateConversationModel,
} from "./chat-db.js";
import {
  hermesChatCompletion,
  hermesChatCompletionStream,
  hermesConfigured,
} from "./hermes-client.js";
import {
  bareHermesModelName,
  ensureHermesWorkModel,
} from "./hermes-models.js";
import {
  buildHermesWorkSystemBrief,
  buildPersonalAgentWorkBrief,
  parseAssistantMode,
  type AssistantMode,
  type HermesWorkUser,
} from "./modes.js";
import { resolveModel, supportsTemperature } from "./models.js";
import {
  anthropicKey,
  anthropicModel,
  callAnthropic,
  toAnthropicUserHistory,
  type AnthropicMessage,
} from "./anthropic-chat.js";
import {
  finishAssistantRun,
  logLlmRound,
  logToolCall,
  startAssistantRun,
  type TraceRunStatus,
} from "./tool-trace.js";
import {
  dispatchSupplierAction,
  dispatchUiAction,
  isSupplierTool,
  isSurfaceTool,
  isUiTool,
  type SupplierActionType,
} from "./ui-actions.js";
import { routeSurfaceTool } from "./surface-router.js";

type AssistantSession = NonNullable<
  Awaited<ReturnType<NonNullable<NonNullable<AssistantBrandConfig["auth"]>["getSession"]>>>
>;

async function requireSession(): Promise<AssistantSession | Response> {
  requireAssistantBrand();
  const getSession = requireAssistantBrand().auth?.getSession;
  if (!getSession) {
    return new Response(
      JSON.stringify({
        error:
          "@creezio/assistant: configureAssistantBrand({ auth: { getSession } }) requis",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Non authentifié" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return session;
}

/**
 * Session déjà résolue par la surface HTTP (Hono kit — cookie/Bearer par
 * requête). Évite d'exiger un `auth.getSession` sans contexte (legacy Next).
 */
function sessionFromProvided(
  session: AssistantAuthSession | null,
): AssistantSession | Response {
  requireAssistantBrand();
  if (!session?.sub) {
    return new Response(JSON.stringify({ error: "Non authentifié" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return session;
}

function workSkills(): string[] {
  const h = assistantHermes();
  if (h.workSkills?.length) return [...h.workSkills];
  if (h.defaultSkills?.length) return [...h.defaultSkills];
  return [];
}

function sessionIdFor(conversationId: string): string {
  const prefix = (assistantHermes().sessionIdPrefix || "creezio-crm").trim();
  return `${prefix}-${conversationId}`;
}

function workThinkingLabel(personal: boolean): string {
  if (personal) return "Délégation à votre agent personnel…";
  const skills = workSkills();
  const label = skills[0] || assistantIdentity().productName;
  return `Délégation à Hermes (skills ${label})…`;
}

function workArgsPreview(personal: boolean): string {
  if (personal) return "Hermes Work · agent personnel";
  const skills = workSkills();
  return skills[0]
    ? `Hermes Work · ${skills[0]}`
    : `Hermes Work · ${assistantIdentity().productName}`;
}

type ToolChoice =
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

function isOpenAiQuotaError(status: number, detail: string): boolean {
  if (status === 429) return true;
  const d = detail.toLowerCase();
  return d.includes("insufficient_quota") || d.includes("exceeded your current quota");
}

function mapUpstreamStatus(status: number): number {
  if (status === 401 || status === 403) return 503;
  if (status === 429) return 429;
  if (status >= 500) return 502;
  if (status >= 400) return 502;
  return 502;
}

/**
 * Thread = conversation locale (SQLite assistant_chats.db) + messages envoyés
 * à OpenAI Chat Completions avec tools locaux.
 * Streaming SSE progressif : tool_start / tool_result / thinking / token / done.
 */

export const maxDuration = 300;

type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
};

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function openaiKey() {
  return (process.env.OPENAI_API_KEY || "").trim();
}

async function callOpenAI(
  model: string,
  messages: ChatMessage[],
  stream: boolean,
  toolChoice: ToolChoice = "auto",
  signal?: AbortSignal,
) {
  const key = openaiKey();
  if (!key) throw new Error("OPENAI_API_KEY manquante");

  const body: Record<string, unknown> = {
    model,
    messages,
    tools: getToolDefinitions(),
    tool_choice: toolChoice,
    stream,
  };
  if (supportsTemperature(model)) {
    body.temperature = 0.1;
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 55000);
  const onParentAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onParentAbort, { once: true });
  }
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    return res;
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener("abort", onParentAbort);
  }
}

function argsPreviewForUi(name: string, args: Record<string, unknown>): string {
  if (name === "run_sql" && typeof args.sql === "string") {
    const sql = args.sql.replace(/\s+/g, " ").trim();
    return sql.length > 220 ? `${sql.slice(0, 220)}…` : sql;
  }
  if (name === "ui_list_targets") {
    return args.q ? `q=${args.q}` : "éléments visibles";
  }
  if (name === "ui_click") {
    return String(args.label || args.ref || "?");
  }
  if (name === "ui_type") {
    return `« ${String(args.text || "")} » → ${String(args.label || args.ref || "champ")}`;
  }
  if (name === "ui_scroll") {
    return String(args.direction || "down");
  }
  if (name === "supplier_list_tabs") {
    return "onglets fournisseurs ouverts";
  }
  if (name === "supplier_open_tab") {
    return `fournisseur ${args.fournisseur_id} → ${String(args.url || "")}`;
  }
  if (name === "supplier_list_targets") {
    return `${args.tabId || "?"}${args.q ? ` · q=${args.q}` : ""}`;
  }
  if (name === "supplier_click") {
    return `${String(args.label || args.ref || "?")} · ${args.tabId || "?"}`;
  }
  if (name === "supplier_type") {
    return `« ${String(args.text || "")} » → ${String(args.label || args.ref || "champ")} · ${args.tabId || "?"}`;
  }
  if (name === "supplier_scroll") {
    return `${String(args.direction || "down")} · ${args.tabId || "?"}`;
  }
  if (name === "supplier_read") {
    return `${args.tabId || "?"}${args.q ? ` · q=${args.q}` : ""}`;
  }
  {
    const brandPreview = assistantBrandTools().argsPreview;
    if (brandPreview) {
      const p = brandPreview(name, args);
      if (p != null) return p;
    }
  }
  if (name === "search_knowledge" && typeof args.query === "string") {
    return args.query.slice(0, 160);
  }
  if (name === "get_entity") {
    return `${args.kind || "?"} · ${args.id || "?"}`;
  }
  if (name === "list_tables") {
    return args.q ? `q=${args.q}` : "toutes les tables";
  }
  if (name === "describe_table") {
    return String(args.table || "?");
  }
  if (name === "list_distinct_values") {
    return `${args.table || "?"}.${args.column || "?"}`;
  }
  if (name === "find_columns") {
    return `q=${args.q || "?"}${args.scope ? ` · ${args.scope}` : ""}`;
  }
  try {
    const s = JSON.stringify(args);
    return s.length > 180 ? `${s.slice(0, 180)}…` : s;
  } catch {
    return "";
  }
}

function uiActionSummary(name: string, result: Record<string, unknown>): string {
  if (result.ok === false) {
    return String(result.error || "action UI échouée");
  }
  const page = result.page as { path?: string; title?: string; url?: string } | undefined;
  if (name === "ui_list_targets") {
    const targets = Array.isArray(result.targets) ? result.targets.length : 0;
    return `${targets} cibles visibles${page?.path ? ` · ${page.path}` : ""}`;
  }
  if (name === "ui_click") {
    return `clic effectué${page?.path ? ` → ${page.path}` : ""}`;
  }
  if (name === "ui_type") {
    return `texte saisi${page?.path ? ` · ${page.path}` : ""}`;
  }
  if (name === "ui_scroll") {
    return "défilement effectué";
  }
  if (name === "supplier_list_tabs") {
    const tabs = Array.isArray(result.tabs) ? result.tabs.length : 0;
    return `${tabs} onglet(s) fournisseur ouvert(s)`;
  }
  if (name === "supplier_open_tab") {
    return `onglet ouvert${result.tabId ? ` (${result.tabId})` : ""}${page?.title ? ` · ${page.title}` : ""}`;
  }
  if (name === "supplier_list_targets") {
    const targets = Array.isArray(result.targets) ? result.targets.length : 0;
    return `${targets} cibles visibles${page?.title ? ` · ${page.title}` : ""}`;
  }
  if (name === "supplier_click") {
    return `clic effectué${page?.title ? ` → ${page.title}` : ""}`;
  }
  if (name === "supplier_type") {
    return `texte saisi${page?.title ? ` · ${page.title}` : ""}`;
  }
  if (name === "supplier_scroll") {
    return "défilement effectué (onglet site externe)";
  }
  if (name === "supplier_read" || name === "surface_read") {
    const chars = typeof result.text === "string" ? result.text.length : 0;
    return `${chars} caractères lus${page?.title ? ` · ${page.title}` : ""}`;
  }
  if (name.startsWith("surface_")) {
    const n = Array.isArray(result.targets) ? result.targets.length : null;
    if (n != null) return `${n} cibles surface${page?.title || page?.url ? ` · ${page.title || page.url}` : ""}`;
    return "action surface effectuée";
  }
  return "action UI effectuée";
}

async function executeTool(
  name: string,
  argsRaw: string,
  trace?: { runId: string; conversationId: string; round: number },
  emit?: ((event: string, data: unknown) => void) | null,
  activeSurface?: ActiveSurface | null,
  sessionAuth?: { bearerToken: string | null; headers: Record<string, string> } | null,
): Promise<{ content: string; sources: AssistantSource[]; uiSummary: string; resultOk: boolean }> {
  const started = Date.now();
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsRaw || "{}") as Record<string, unknown>;
  } catch {
    const content = JSON.stringify({ error: "arguments JSON invalides" });
    if (trace) {
      logToolCall({
        runId: trace.runId,
        conversationId: trace.conversationId,
        round: trace.round,
        toolName: name,
        args: { raw: argsRaw },
        result: { error: "arguments JSON invalides" },
        resultOk: false,
        error: "arguments JSON invalides",
        durationMs: Date.now() - started,
      });
    }
    return {
      content,
      sources: [],
      uiSummary: "arguments JSON invalides",
      resultOk: false,
    };
  }

  const sources: AssistantSource[] = [];
  let mode: string | null = null;
  let resultOk = true;
  let error: string | null = null;
  let parsedResult: unknown = null;
  let uiSummary = "";

  try {
    // Façade unifiée surface_* / garde ui_* selon activeSurface.
    if (isSurfaceTool(name) || isUiTool(name)) {
      const route = routeSurfaceTool(name, args, activeSurface);
      if (route.kind === "reject") {
        resultOk = false;
        error = route.error;
        parsedResult = {
          ok: false,
          error: route.error,
          hint: route.hint,
          activeSurface: activeSurface || null,
        };
        uiSummary = route.error;
        return {
          content: JSON.stringify(parsedResult).slice(0, 14000),
          sources,
          uiSummary,
          resultOk,
        };
      }
      if (route.kind === "supplier" || route.kind === "external") {
        const result = await dispatchSupplierAction(
          route.tool,
          route.args,
          route.tabId,
        );
        result.routedVia = "supplier";
        result.activeSurface = activeSurface || null;
        resultOk = result.ok !== false;
        error = resultOk ? null : String(result.error || "action surface/supplier échouée");
        parsedResult = result;
        uiSummary = uiActionSummary(name, result);
        return {
          content: JSON.stringify(result).slice(0, 14000),
          sources,
          uiSummary,
          resultOk,
        };
      }
      // route.kind === "crm"
      if (!emit) {
        resultOk = false;
        error = "actions UI indisponibles sans streaming (mode JSON)";
        parsedResult = { ok: false, error };
        uiSummary = error;
        return { content: JSON.stringify(parsedResult), sources, uiSummary, resultOk };
      }
      const result = await dispatchUiAction(emit, route.tool, route.args);
      const page = result.page as { path?: string } | undefined;
      if (page?.path) {
        const info = pageInfoFor(page.path);
        if (info) result.pageInfo = info;
      }
      result.routedVia = "crm";
      result.activeSurface = activeSurface || null;
      resultOk = result.ok !== false;
      error = resultOk ? null : String(result.error || "action UI échouée");
      parsedResult = result;
      uiSummary = uiActionSummary(name, result);
      return {
        content: JSON.stringify(result).slice(0, 14000),
        sources,
        uiSummary,
        resultOk,
      };
    }

    if (isSupplierTool(name)) {
      // O4r : interception métier (ex. open_external_tab Fidu) via MCP, pas BrandTools.
      {
        const brandCtx: Record<string, unknown> = {
          conversationId: trace?.conversationId || null,
          round: trace?.round ?? null,
          runId: trace?.runId || null,
          activeSurface: activeSurface || null,
          emit: emit || null,
          phase: "supplier",
          ...(sessionAuth?.bearerToken
            ? { bearerToken: sessionAuth.bearerToken }
            : {}),
          ...(sessionAuth?.headers && Object.keys(sessionAuth.headers).length
            ? { sessionHeaders: sessionAuth.headers }
            : {}),
        };
        const mcpResult = await callAssistantMcpTool(name, args, brandCtx);
        if (mcpResult != null) {
          resultOk = mcpResult.ok !== false && !mcpResult.error;
          error = resultOk ? null : String(mcpResult.error || "outil MCP échoué");
          const content =
            mcpResult.content !== undefined ? mcpResult.content : mcpResult;
          parsedResult =
            typeof content === "object" && content !== null
              ? content
              : { ok: resultOk, content, error: mcpResult.error };
          if (Array.isArray(mcpResult.sources)) {
            for (const s of mcpResult.sources) sources.push(s as AssistantSource);
          }
          uiSummary = summarizeMcpResult(name, mcpResult);
          return {
            content: JSON.stringify(parsedResult).slice(0, 14000),
            sources,
            uiSummary,
            resultOk,
          };
        }
      }
      // Onglets fournisseurs (app desktop) : canal SSE dédié vers Electron.
      let tabId = typeof args.tabId === "string" ? args.tabId : undefined;
      if (!tabId && isExternalActiveSurface(activeSurface) && activeSurface.tabId) {
        tabId = activeSurface.tabId;
        args = { ...args, tabId };
      }
      const targetUserId =
        typeof args.targetUserId === "string" ? args.targetUserId : undefined;
      const result = await dispatchSupplierAction(
        name as SupplierActionType,
        args,
        tabId,
        targetUserId
          ? { targetUserId, requireTargetOnline: true }
          : undefined,
      );
      resultOk = result.ok !== false;
      error = resultOk ? null : String(result.error || "action fournisseur échouée");
      parsedResult = result;
      uiSummary = uiActionSummary(name, result);
      return {
        content: JSON.stringify(result).slice(0, 14000),
        sources,
        uiSummary,
        resultOk,
      };
    }

    if (name === "list_tables") {
      parsedResult = listTables({
        q: typeof args.q === "string" ? args.q : undefined,
        limit: Number(args.limit) || undefined,
      });
      uiSummary = summarizeExploreResult(name, args, parsedResult);
      return { content: JSON.stringify(parsedResult).slice(0, 14000), sources, uiSummary, resultOk };
    }

    if (name === "describe_table") {
      parsedResult = describeTable(String(args.table || ""), {
        sampleDistinct: args.sample_distinct !== false,
      });
      resultOk = Boolean((parsedResult as { ok?: boolean }).ok);
      if (!resultOk) error = String((parsedResult as { error?: string }).error || "describe_table");
      uiSummary = summarizeExploreResult(name, args, parsedResult);
      return { content: JSON.stringify(parsedResult).slice(0, 14000), sources, uiSummary, resultOk };
    }

    if (name === "list_distinct_values") {
      parsedResult = listDistinctValues(String(args.table || ""), String(args.column || ""), {
        limit: Number(args.limit) || undefined,
      });
      resultOk = Boolean((parsedResult as { ok?: boolean }).ok);
      if (!resultOk) {
        error = String((parsedResult as { error?: string }).error || "list_distinct_values");
      }
      uiSummary = summarizeExploreResult(name, args, parsedResult);
      return { content: JSON.stringify(parsedResult).slice(0, 14000), sources, uiSummary, resultOk };
    }

    if (name === "find_columns") {
      parsedResult = findColumns({
        q: String(args.q || ""),
        limit: Number(args.limit) || undefined,
        scope:
          args.scope === "columns" || args.scope === "values" || args.scope === "both"
            ? args.scope
            : undefined,
      });
      resultOk = Boolean((parsedResult as { ok?: boolean }).ok);
      if (!resultOk) {
        error = String((parsedResult as { error?: string }).error || "find_columns");
      }
      uiSummary = summarizeExploreResult(name, args, parsedResult);
      return { content: JSON.stringify(parsedResult).slice(0, 14000), sources, uiSummary, resultOk };
    }

    if (name === "search_knowledge") {
      const query = String(args.query || "");
      const limit = Number(args.limit) || 5;
      const ville =
        typeof args.ville === "string" && args.ville.trim()
          ? args.ville.trim()
          : undefined;
      const sk = await searchKnowledge(query, { limit, ville });
      mode = sk.mode;
      error = sk.error || null;
      // 0 hit + hint ville = preuve exploitable (pas un échec outil)
      resultOk =
        sk.hits.length > 0 || Boolean(sk.hint) || (sk.mode === "keyword" && !sk.error);
      for (const h of sk.hits) {
        if (h.url) {
          sources.push({
            title: h.title,
            url: h.url,
            type: h.type as AssistantSource["type"],
          });
        }
      }
      parsedResult = {
        mode,
        error: error,
        hitCount: sk.hits.length,
        estimatedTotalHits: sk.estimatedTotalHits ?? null,
        villeFilter: sk.villeFilter ?? null,
        sampleVilles: sk.sampleVilles ?? null,
        hint: sk.hint ?? null,
        hits: sk.hits.map((h) => {
          const formatHit = assistantBrandTools().formatSearchHit;
          if (formatHit) return formatHit(h);
          return {
            id: h.id,
            title: h.title,
            type: h.type,
            url: h.url,
            ville: h.ville,
            pays: h.pays,
            status: h.status,
            excerpt: h.body.slice(0, 500),
            ...Object.fromEntries(
              Object.entries(h).filter(
                ([k]) =>
                  ![
                    "id",
                    "title",
                    "type",
                    "url",
                    "ville",
                    "pays",
                    "status",
                    "body",
                    "index",
                    "score",
                  ].includes(k),
              ),
            ),
          };
        }),
      };
      uiSummary = summarizeExploreResult(name, args, parsedResult);
      return { content: JSON.stringify(parsedResult), sources, uiSummary, resultOk };
    }

    if (name === "run_sql") {
      const sql = String(args.sql || "");
      const raw = runSql(sql);
      // Garde-fou process : 0 résultat + filtre égalité texte → injecter DISTINCT réels
      const result = enrichEmptySqlWithDistinctHints(sql, raw);
      resultOk = Boolean(result.ok);
      error = result.error || null;
      if (result.ok && result.rows) {
        sources.push(...collectSourcesFromSqlRows(result.rows));
      }
      parsedResult = result;
      uiSummary = summarizeExploreResult(name, args, parsedResult);
      return {
        content: JSON.stringify(result).slice(0, 14000),
        sources,
        uiSummary,
        resultOk,
      };
    }

    if (name === "get_entity") {
      const kind = String(args.kind || "");
      const id = String(args.id || "");
      const getEntity = assistantBrandTools().getEntity;
      if (!getEntity) {
        resultOk = false;
        error = "get_entity non configuré (configureAssistantBrand tools.getEntity)";
        parsedResult = { ok: false, error };
        uiSummary = error;
        return { content: JSON.stringify(parsedResult), sources, uiSummary, resultOk };
      }
      const entity = getEntity(kind, id);
      const ent = entity.entity as Record<string, unknown> | null;
      resultOk = Boolean(ent);
      if (!ent) error = `entité introuvable: ${kind}/${id}`;
      const entitySources = assistantBrandTools().entitySources;
      if (entitySources) {
        sources.push(
          ...(entitySources(kind, id, ent) as AssistantSource[]),
        );
      }
      if (entity.related) {
        for (const val of Object.values(entity.related)) {
          if (Array.isArray(val)) {
            sources.push(...collectSourcesFromSqlRows(val as Record<string, unknown>[]));
          }
        }
      }
      const slim = entity.entity
        ? Object.fromEntries(
            Object.entries(entity.entity).filter(
              ([k]) =>
                !k.startsWith("_") &&
                !k.endsWith("_json") &&
                k !== "payload1" &&
                k !== "payload2",
            ),
          )
        : null;
      parsedResult = {
        kind: entity.kind,
        entity: slim,
        related: entity.related,
      };
      uiSummary = summarizeExploreResult(name, args, parsedResult);
      return {
        content: JSON.stringify(parsedResult).slice(0, 14000),
        sources,
        uiSummary,
        resultOk,
      };
    }

    // Tasks plateforme (create_task / list_tasks / aliases todo)
    {
      const brandCtx: Record<string, unknown> = {
        conversationId: trace?.conversationId || null,
        round: trace?.round ?? null,
        runId: trace?.runId || null,
        activeSurface: activeSurface || null,
        emit: emit || null,
      };
      const taskResult = await executeTaskTool(name, args, brandCtx);
      if (taskResult != null) {
        resultOk = taskResult.ok !== false && !taskResult.error;
        error = resultOk ? null : String(taskResult.error || "tâche échouée");
        parsedResult = taskResult;
        const taskSources = Array.isArray(taskResult.sources)
          ? (taskResult.sources as AssistantSource[])
          : [];
        for (const s of taskSources) sources.push(s);
        uiSummary =
          typeof taskResult.uiSummary === "string" && taskResult.uiSummary
            ? taskResult.uiSummary
            : resultOk
              ? `outil ${name}`
              : error || `échec ${name}`;
        return {
          content: JSON.stringify(parsedResult).slice(0, 14000),
          sources,
          uiSummary,
          resultOk,
        };
      }
    }

    // Métier découvert MCP (module.* / plugin.* / aliases legacy)
    {
      const brandCtx: Record<string, unknown> = {
        conversationId: trace?.conversationId || null,
        round: trace?.round ?? null,
        runId: trace?.runId || null,
        activeSurface: activeSurface || null,
        emit: emit || null,
        ...(sessionAuth?.bearerToken
          ? { bearerToken: sessionAuth.bearerToken }
          : {}),
        ...(sessionAuth?.headers && Object.keys(sessionAuth.headers).length
          ? { sessionHeaders: sessionAuth.headers }
          : {}),
      };
      const mcpResult = await callAssistantMcpTool(name, args, brandCtx);
      if (mcpResult != null) {
        resultOk = mcpResult.ok !== false && !mcpResult.error;
        error = resultOk ? null : String(mcpResult.error || "outil MCP échoué");
        const body =
          mcpResult.content !== undefined ? mcpResult.content : mcpResult;
        parsedResult =
          typeof body === "object" && body !== null
            ? { ok: resultOk, ...(body as object), error: mcpResult.error }
            : { ok: resultOk, content: body, error: mcpResult.error };
        if (Array.isArray(mcpResult.sources)) {
          for (const s of mcpResult.sources) sources.push(s as AssistantSource);
        }
        // sources éventuellement dans content
        if (
          body &&
          typeof body === "object" &&
          Array.isArray((body as { sources?: unknown }).sources)
        ) {
          for (const s of (body as { sources: AssistantSource[] }).sources) {
            sources.push(s);
          }
        }
        uiSummary = summarizeMcpResult(name, mcpResult);
        return {
          content: JSON.stringify(parsedResult).slice(0, 14000),
          sources,
          uiSummary,
          resultOk,
        };
      }
    }

    resultOk = false;
    error = `outil inconnu: ${name}`;
    parsedResult = { error };
    uiSummary = error;
    return { content: JSON.stringify(parsedResult), sources: [], uiSummary, resultOk };
  } finally {
    if (trace) {
      logToolCall({
        runId: trace.runId,
        conversationId: trace.conversationId,
        round: trace.round,
        toolName: name,
        args,
        result: parsedResult ?? { note: "result non capturé" },
        resultOk,
        mode,
        error,
        durationMs: Date.now() - started,
        sources,
      });
    }
  }
}

function sseEncode(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

type OAMessage = ChatMessage & {
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
};

type EmitFn = (event: string, data: unknown) => void;

async function handleWorkViaHermes(opts: {
  req: Request;
  conversationId: string;
  model: string;
  incoming: { role: "user" | "assistant"; content: string }[];
  lastUserContent: string;
  wantStream: boolean;
  /** Utilisateur de session (D2) : brief personnalisé + header Hermes. */
  user?: HermesWorkUser | null;
}): Promise<Response> {
  const { req, conversationId, incoming, lastUserContent, wantStream, user } = opts;
  let model = opts.model || "hermes-agent";

  // D3 : profil d'agent — `personal` route la session Work vers le Hermes
  // propre à l'utilisateur (URL + clé stockées dans agent_profiles).
  const profile = user ? getAgentProfile(user.id) : undefined;
  const personalEndpoint =
    profile?.kind === "personal" && profile.api_url && profile.api_key
      ? { baseUrl: profile.api_url, apiKey: profile.api_key }
      : null;

  if (!personalEndpoint && !hermesConfigured()) {
    return new Response(
      JSON.stringify({
        error:
          "Mode Work : HERMES_API_SERVER_KEY manquante. Configurer le pont Hermes (API :8642).",
        conversationId,
        mode: "work",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    // Agent personnel : son LLM est configuré chez lui, on ne pilote pas
    // le WebUI d'un Hermes distant.
    const applied = personalEndpoint
      ? { id: model }
      : await ensureHermesWorkModel(opts.model, req.signal);
    model = applied.id;
    try {
      updateConversationModel(conversationId, applied.id);
    } catch {
      /* ignore */
    }
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Impossible d'appliquer le modèle Hermes";
    return new Response(
      JSON.stringify({ error: message, conversationId, mode: "work" }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  const runId = startAssistantRun({
    conversationId,
    userMessage: lastUserContent,
    provider: "hermes",
    model,
    meta: {
      mode: "work",
      delegate: "hermes",
      agentProfile: personalEndpoint ? "personal" : "company",
      stream: wantStream,
      skills: personalEndpoint ? [] : workSkills(),
      hermesModel: bareHermesModelName(model),
    },
  });

  const hermesMessages = [
    {
      role: "system" as const,
      content: personalEndpoint
        ? buildPersonalAgentWorkBrief(new Date().toISOString(), user)
        : buildHermesWorkSystemBrief(new Date().toISOString(), user),
    },
    ...incoming.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const persistAssistant = (content: string) => {
    try {
      addMessage({ conversationId, role: "assistant", content });
    } catch {
      /* ignore */
    }
  };

  // Alias API Hermes ; le LLM réel vient de config.yaml (ensureHermesWorkModel).
  const apiModel = process.env.HERMES_MODEL || "hermes-agent";

  if (!wantStream) {
    try {
      const result = await hermesChatCompletion({
        sessionId: sessionIdFor(conversationId),
        userId: user?.id ?? null,
        messages: hermesMessages,
        signal: req.signal,
        model: apiModel,
        endpoint: personalEndpoint,
        ...(personalEndpoint ? { skillsHint: [] } : {}),
      });
      model = result.model && result.model !== "hermes-agent" ? result.model : model;
      finishAssistantRun({
        runId,
        status: result.failed ? "error" : "ok",
        error: result.error || null,
        model,
      });
      if (!result.failed) persistAssistant(result.content);
      else persistAssistant(result.content);
      return Response.json({
        content: result.content,
        sources: [],
        conversationId,
        model,
        mode: "work",
        runId,
        hermesSessionId: result.sessionId,
        failed: result.failed,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erreur Hermes";
      finishAssistantRun({ runId, status: "error", error: message, model });
      return new Response(
        JSON.stringify({ error: message, conversationId, mode: "work", runId }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const emit: EmitFn = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(sseEncode(event, data)));
        } catch {
          closed = true;
        }
      };

      emit("meta", {
        conversationId,
        model,
        runId,
        mode: "work",
        delegate: "hermes",
        maxToolRounds: null,
        tools: ["hermes-agent"],
      });
      emit("thinking", {
        text: personalEndpoint
          ? workThinkingLabel(true)
          : workThinkingLabel(false),
      });
      if (profile?.kind === "personal" && !personalEndpoint) {
        // Profil personnel incomplet (URL ou clé manquante) : fallback
        // entreprise — le dire plutôt que basculer en silence.
        emit("thinking", {
          text: "Profil « agent personnel » incomplet (URL/clé) — l'agent de l'entreprise est utilisé. Complétez Configuration → Compte & clés.",
        });
      }
      emit("tool_start", {
        id: `hermes-${runId}`,
        toolName: "hermes_work",
        args: {
          skills: personalEndpoint ? [] : workSkills(),
          agentProfile: personalEndpoint ? "personal" : "company",
        },
        argsPreview: workArgsPreview(Boolean(personalEndpoint)),
        round: 0,
      });

      try {
        let streamed = "";
        const result = await hermesChatCompletionStream({
          sessionId: sessionIdFor(conversationId),
          userId: user?.id ?? null,
          messages: hermesMessages,
          signal: req.signal,
          model: apiModel,
          endpoint: personalEndpoint,
          ...(personalEndpoint ? { skillsHint: [] } : {}),
          onToken: (tok) => {
            streamed += tok;
            emit("token", { text: tok });
          },
        });
        model =
          result.model && result.model !== "hermes-agent" ? result.model : model;
        const answer = result.content || streamed;
        // Si le stream n'a rien émis mais sync a une réponse, envoyer en chunks
        if (!streamed && answer) {
          const chunkSize = 80;
          for (let i = 0; i < answer.length; i += chunkSize) {
            emit("token", { text: answer.slice(i, i + chunkSize) });
          }
        }
        emit("tool_result", {
          id: `hermes-${runId}`,
          toolName: "hermes_work",
          ok: !result.failed,
          summary: result.failed
            ? result.error || "échec Hermes"
            : "Mission Hermes terminée",
          durationMs: null,
          round: 0,
        });
        finishAssistantRun({
          runId,
          status: result.failed ? "error" : "ok",
          error: result.error || null,
          model,
        });
        persistAssistant(answer);
        emit("done", {
          content: answer,
          sources: [],
          conversationId,
          model,
          mode: "work",
          runId,
          hermesSessionId: result.sessionId,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erreur Hermes";
        const aborted =
          req.signal.aborted || /abort|already closed|Invalid state/i.test(message);
        finishAssistantRun({
          runId,
          status: aborted ? "cancelled" : "error",
          error: aborted ? null : message,
          model,
        });
        if (!closed) {
          if (aborted) {
            emit("cancelled", { conversationId, model, runId, mode: "work" });
          } else {
            emit("error", {
              error: message,
              conversationId,
              model,
              runId,
              mode: "work",
            });
          }
        }
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function handleAssistantChat(
  req: Request,
  opts?: { session?: AssistantAuthSession | null },
) {
  // Session par requête fournie par la surface Hono kit (harness Docker /
  // desktop) ; fallback registry auth.getSession (Next legacy, cookies ALS).
  const sessionOrRes =
    opts && "session" in opts
      ? sessionFromProvided(opts.session ?? null)
      : await requireSession();
  if (sessionOrRes instanceof Response) return sessionOrRes;
  const session = sessionOrRes;
  const sessionAuth = sessionAuthFromRequest(req);

  // O4r : rafraîchir discovery MCP avant getToolDefinitions()
  try {
    await ensureMcpToolCache();
  } catch {
    /* cache vide → tools plateforme seulement */
  }

  let body: {
    messages?: { role: string; content: string }[];
    stream?: boolean;
    conversationId?: string | null;
    model?: string | null;
    mode?: string | null;
    activeSurface?: unknown;
    supplierTabs?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "JSON invalide" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const activeSurface = parseActiveSurface(body.activeSurface);
  const supplierTabs = parseSupplierTabSummaries(body.supplierTabs);

  const incoming = (body.messages || [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-12)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 4000) }));

  if (!incoming.length || incoming[incoming.length - 1].role !== "user") {
    return new Response(JSON.stringify({ error: "Dernier message utilisateur requis" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const lastUser = incoming[incoming.length - 1];
  let conversationId = "";
  let mode: AssistantMode = parseAssistantMode(body.mode, "chat");
  // Work : modèle Hermes (`provider::model`) — ne pas forcer la liste OpenAI Chat.
  let model =
    mode === "work"
      ? (body.model || "").trim()
      : resolveModel(body.model);

  const providerPref = (process.env.ASSISTANT_LLM_PROVIDER || "auto").trim().toLowerCase();
  const hasOpenAi = Boolean(openaiKey());
  const hasAnthropic = Boolean(anthropicKey());
  const desktopLocal = (process.env.DESKTOP_LOCAL || "").trim() === "1";
  // Clés LLM avant persistence : évite une conv/message orphelin puis 503
  // sans conversationId (l'UI ne peut pas rattacher le fil).
  if (desktopLocal && !hasOpenAi) {
    console.error(
      "[assistant] BYOK bloqué : OPENAI_API_KEY absente du process serveur (DESKTOP_LOCAL=1)",
    );
    return new Response(
      JSON.stringify({
        error:
          "Assistant désactivé — clé OpenAI requise (BYOK). Configurez-la dans Configuration → Clés IA.",
        code: "OPENAI_KEY_MISSING",
        byokRequired: true,
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  if (!desktopLocal && !hasOpenAi && !hasAnthropic) {
    return new Response(
      JSON.stringify({
        error: "Aucune clé LLM configurée (OPENAI_API_KEY / ANTHROPIC_API_KEY)",
        code: "LLM_KEYS_MISSING",
        byokRequired: false,
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  try {
    const conv = ensureConversation(
      body.conversationId,
      lastUser.content,
      body.model,
      // Mode figé : seulement à la création (ignore body.mode si conv existe)
      body.mode as AssistantMode | null,
      session.sub,
    );
    // Scoping D1 : refuser la reprise d'une conversation d'un autre user
    // (404 volontaire pour ne pas révéler son existence). L'owner adopte
    // au passage les conversations pré-multi-user (user_id NULL).
    if (!canAccessConversation(conv, session.sub, session.role)) {
      return new Response(
        JSON.stringify({ error: "Conversation introuvable" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    if (conv.user_id == null && session.role === "owner") {
      adoptOrphanConversations(session.sub);
    }
    conversationId = conv.id;
    mode = conv.mode;
    if (mode === "work") {
      const next = (body.model || conv.model || "").trim();
      if (body.model && body.model !== conv.model) {
        updateConversationModel(conversationId, body.model);
      }
      model = next;
    } else if (body.model && resolveModel(body.model) !== conv.model) {
      const updated = updateConversationModel(conversationId, body.model);
      model = resolveModel(updated?.model || body.model);
    } else {
      model = resolveModel(conv.model);
    }
    addMessage({
      conversationId,
      role: "user",
      content: lastUser.content,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur persistence";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stored = getConversation(conversationId);
  if (stored) {
    mode = stored.mode;
    model =
      mode === "work"
        ? (stored.model || model || "").trim()
        : resolveModel(stored.model);
  }

  // ── Work : délégation agentique à Hermes (skills marque) ──
  if (mode === "work") {
    return handleWorkViaHermes({
      req,
      conversationId,
      model,
      incoming,
      lastUserContent: lastUser.content,
      wantStream: body.stream !== false,
      user: {
        id: session.sub,
        name: session.email,
        role: session.role,
      },
    });
  }

  const wantStream = body.stream !== false;
  const allSources: { title: string; url: string; type?: string }[] = [];
  const seenSrc = new Set<string>();
  const clientSignal = req.signal;
  const toolRoundLimit = maxToolRounds();

  const pushSources = (list: AssistantSource[]) => {
    for (const s of list) {
      const k = s.url;
      if (!k || seenSrc.has(k)) continue;
      seenSrc.add(k);
      allSources.push(s);
    }
  };

  const persistAssistant = (content: string) => {
    try {
      addMessage({
        conversationId,
        role: "assistant",
        content,
        sources: allSources,
      });
    } catch {
      /* ne bloque pas la réponse client */
    }
  };

  const auditDistribution = shouldAuditDistribution(lastUser.content);
  const activeSurfaceBlock = activeSurface
    ? formatActiveSurfaceRuntimeBlock(activeSurface, supplierTabs)
    : "";
  const systemPrompt = buildSystemPrompt(new Date(), {
    auditDistribution,
    mode: "chat",
    activeSurfaceBlock,
  });
  // Meili-first pour découverte produit/fournisseur ; SQL forcé seulement pour COUNT/prix.
  // Sur surface supplier + commande UI → forcer surface_list_targets (pas ui_*).
  const preferSearchKnowledge = shouldPreferSearchKnowledge(lastUser.content);
  const forceRunSql = shouldForceRunSql(lastUser.content);
  const forceSurfaceList =
    !forceRunSql &&
    !preferSearchKnowledge &&
    looksLikeSurfaceCommand(lastUser.content) &&
    isExternalActiveSurface(activeSurface);
  const firstToolChoice: ToolChoice = forceRunSql
    ? { type: "function", function: { name: "run_sql" } }
    : preferSearchKnowledge
      ? { type: "function", function: { name: "search_knowledge" } }
      : forceSurfaceList
        ? { type: "function", function: { name: "surface_list_targets" } }
        : "required";

  const initialProvider = preferProviderLabel(providerPref, hasOpenAi, hasAnthropic);
  let activeRunId = startAssistantRun({
    conversationId,
    userMessage: lastUser.content,
    provider: initialProvider,
    model,
    meta: {
      forceRunSql,
      preferSearchKnowledge,
      forceSurfaceList,
      activeSurfaceKind: activeSurface?.kind || null,
      auditDistribution,
      stream: wantStream,
      providerPref,
      maxToolRounds: toolRoundLimit,
      tools: getToolDefinitions().map((t) => t.function.name),
    },
  });

  const isAborted = () => clientSignal.aborted;

  type LoopResult =
    | { kind: "answer"; answer: string; usedModel: string; status: TraceRunStatus }
    | { kind: "error"; body: Record<string, unknown>; status: number; runStatus: TraceRunStatus };

  const runAnthropicLoop = async (
    emit: EmitFn | null,
    asFallback = false,
  ): Promise<LoopResult> => {
    if (asFallback) {
      finishAssistantRun({
        runId: activeRunId,
        status: "fallback_anthropic",
        error: "bascule OpenAI → Anthropic",
      });
      activeRunId = startAssistantRun({
        conversationId,
        userMessage: lastUser.content,
        provider: "anthropic",
        model: anthropicModel(),
        meta: {
          fallbackFrom: "openai",
          forceRunSql,
          preferSearchKnowledge,
          auditDistribution,
        },
      });
      emit?.("meta", {
        conversationId,
        model: anthropicModel(),
        runId: activeRunId,
        provider: "anthropic",
      });
    }

    const usedModel = anthropicModel();
    const system = systemPrompt;
    const aMessages: AnthropicMessage[] = toAnthropicUserHistory(incoming);

    for (let round = 0; round < toolRoundLimit; round++) {
      if (isAborted()) {
        return {
          kind: "answer",
          answer: "(Génération interrompue)",
          usedModel,
          status: "cancelled",
        };
      }

      const toolChoice =
        round === 0
          ? forceRunSql
            ? ({ type: "tool", name: "run_sql" } as const)
            : preferSearchKnowledge
              ? ({ type: "tool", name: "search_knowledge" } as const)
              : ({ type: "any" } as const)
          : ({ type: "auto" } as const);

      const t0 = Date.now();
      const res = await callAnthropic({
        system,
        messages: aMessages,
        toolChoice,
        model: usedModel,
      });

      if (!res.ok) {
        logLlmRound({
          runId: activeRunId,
          conversationId,
          round,
          provider: "anthropic",
          model: usedModel,
          httpStatus: res.status,
          error: res.error || res.detail || "Erreur Anthropic",
          durationMs: Date.now() - t0,
        });
        return {
          kind: "error",
          body: {
            error: res.error || "Erreur Anthropic",
            detail: res.detail || null,
            conversationId,
            model: usedModel,
          },
          status: mapUpstreamStatus(res.status),
          runStatus: "error",
        };
      }

      logLlmRound({
        runId: activeRunId,
        conversationId,
        round,
        provider: "anthropic",
        model: usedModel,
        httpStatus: 200,
        finishReason: res.toolUses.length ? "tool_use" : "end_turn",
        toolCallCount: res.toolUses.length,
        responsePreview: res.text || null,
        durationMs: Date.now() - t0,
      });

      if (res.text?.trim()) {
        emit?.("thinking", { text: res.text.trim(), round });
      }

      if (!res.toolUses.length) {
        const answer =
          res.text.trim() || "Je n'ai pas trouvé d'information pertinente.";
        return { kind: "answer", answer, usedModel, status: "ok" };
      }

      aMessages.push({
        role: "assistant",
        content: [
          ...(res.text ? [{ type: "text" as const, text: res.text }] : []),
          ...res.toolUses.map((tu) => ({
            type: "tool_use" as const,
            id: tu.id,
            name: tu.name,
            input: tu.input,
          })),
        ],
      });

      const toolResults: Exclude<AnthropicMessage["content"], string> = [];
      for (const tu of res.toolUses) {
        if (isAborted()) {
          return {
            kind: "answer",
            answer: "(Génération interrompue)",
            usedModel,
            status: "cancelled",
          };
        }
        const argsObj = (tu.input || {}) as Record<string, unknown>;
        const stepId = tu.id;
        emit?.("tool_start", {
          id: stepId,
          toolName: tu.name,
          args: argsObj,
          argsPreview: argsPreviewForUi(tu.name, argsObj),
          round,
        });
        const tTool = Date.now();
        const { content, sources, uiSummary, resultOk } = await executeTool(
          tu.name,
          JSON.stringify(tu.input || {}),
          { runId: activeRunId, conversationId, round },
          emit,
          activeSurface,
          sessionAuth,
        );
        pushSources(sources);
        emit?.("tool_result", {
          id: stepId,
          toolName: tu.name,
          ok: resultOk,
          summary: uiSummary,
          durationMs: Date.now() - tTool,
          round,
          sources,
        });
        if (sources.length) emit?.("sources", { sources: allSources });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content,
        });
      }
      aMessages.push({ role: "user", content: toolResults });
    }

    return {
      kind: "answer",
      answer: "Limite d'outils atteinte — reformulez la question plus précisément.",
      usedModel,
      status: "tool_limit",
    };
  };

  const runOpenAiLoop = async (emit: EmitFn | null): Promise<LoopResult> => {
    const messages: OAMessage[] = [
      { role: "system", content: systemPrompt },
      ...incoming,
    ];

    for (let round = 0; round < toolRoundLimit; round++) {
      if (isAborted()) {
        return {
          kind: "answer",
          answer: "(Génération interrompue)",
          usedModel: model,
          status: "cancelled",
        };
      }

      const t0 = Date.now();
      const reqChars = JSON.stringify(messages).length;
      let res: Response;
      try {
        res = await callOpenAI(
          model,
          messages as ChatMessage[],
          false,
          round === 0 ? firstToolChoice : "auto",
          clientSignal,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erreur OpenAI";
        const aborted =
          isAborted() || message.toLowerCase().includes("abort");
        if (aborted) {
          return {
            kind: "answer",
            answer: "(Génération interrompue)",
            usedModel: model,
            status: "cancelled",
          };
        }
        if (hasAnthropic) return runAnthropicLoop(emit, true);
        return {
          kind: "error",
          body: { error: message, conversationId, model },
          status: 504,
          runStatus: "timeout",
        };
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        logLlmRound({
          runId: activeRunId,
          conversationId,
          round,
          provider: "openai",
          model,
          httpStatus: res.status,
          requestChars: reqChars,
          error: errText.slice(0, 500),
          durationMs: Date.now() - t0,
        });
        if (hasAnthropic && isOpenAiQuotaError(res.status, errText)) {
          return runAnthropicLoop(emit, true);
        }
        const quota = isOpenAiQuotaError(res.status, errText);
        return {
          kind: "error",
          body: {
            error: quota
              ? "Quota OpenAI dépassé — configurez ANTHROPIC_API_KEY ou rechargez le crédit OpenAI"
              : `OpenAI ${res.status}`,
            detail: errText.slice(0, 300),
            conversationId,
            model,
          },
          status: quota ? 429 : mapUpstreamStatus(res.status),
          runStatus: "error",
        };
      }

      const data = (await res.json()) as {
        choices?: {
          message?: OAMessage;
          finish_reason?: string;
        }[];
      };
      const msg = data.choices?.[0]?.message;
      if (!msg) {
        logLlmRound({
          runId: activeRunId,
          conversationId,
          round,
          provider: "openai",
          model,
          httpStatus: 200,
          requestChars: reqChars,
          error: "Réponse OpenAI vide",
          durationMs: Date.now() - t0,
        });
        if (hasAnthropic) return runAnthropicLoop(emit, true);
        return {
          kind: "error",
          body: { error: "Réponse OpenAI vide", conversationId, model },
          status: 502,
          runStatus: "error",
        };
      }

      const toolCalls = msg.tool_calls || [];
      const thinkingText = String(msg.content || "").trim();
      logLlmRound({
        runId: activeRunId,
        conversationId,
        round,
        provider: "openai",
        model,
        httpStatus: 200,
        finishReason: data.choices?.[0]?.finish_reason || null,
        toolCallCount: toolCalls.length,
        requestChars: reqChars,
        responsePreview: thinkingText.slice(0, 500) || null,
        durationMs: Date.now() - t0,
      });

      if (thinkingText) {
        emit?.("thinking", { text: thinkingText, round });
      }

      if (!toolCalls.length) {
        const answer =
          thinkingText || "Je n'ai pas trouvé d'information pertinente.";
        return { kind: "answer", answer, usedModel: model, status: "ok" };
      }

      messages.push({
        role: "assistant",
        content: msg.content || "",
        tool_calls: toolCalls,
      } as OAMessage);

      for (const tc of toolCalls) {
        if (isAborted()) {
          return {
            kind: "answer",
            answer: "(Génération interrompue)",
            usedModel: model,
            status: "cancelled",
          };
        }
        let argsObj: Record<string, unknown> = {};
        try {
          argsObj = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          argsObj = { raw: tc.function.arguments };
        }
        emit?.("tool_start", {
          id: tc.id,
          toolName: tc.function.name,
          args: argsObj,
          argsPreview: argsPreviewForUi(tc.function.name, argsObj),
          round,
        });
        const tTool = Date.now();
        const { content, sources, uiSummary, resultOk } = await executeTool(
          tc.function.name,
          tc.function.arguments || "{}",
          { runId: activeRunId, conversationId, round },
          emit,
          activeSurface,
          sessionAuth,
        );
        pushSources(sources);
        emit?.("tool_result", {
          id: tc.id,
          toolName: tc.function.name,
          ok: resultOk,
          summary: uiSummary,
          durationMs: Date.now() - tTool,
          round,
          sources,
        });
        if (sources.length) emit?.("sources", { sources: allSources });
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content,
        });
      }
    }

    return {
      kind: "answer",
      answer: "Limite d'outils atteinte — reformulez la question plus précisément.",
      usedModel: model,
      status: "tool_limit",
    };
  };

  const preferAnthropic =
    providerPref === "anthropic" ||
    (providerPref === "auto" && !hasOpenAi && hasAnthropic);

  const runMainLoop = async (emit: EmitFn | null): Promise<LoopResult> => {
    if (preferAnthropic) {
      if (!hasAnthropic) {
        return {
          kind: "error",
          body: { error: "ANTHROPIC_API_KEY non configurée", conversationId },
          status: 503,
          runStatus: "error",
        };
      }
      return runAnthropicLoop(emit);
    }
    try {
      return await runOpenAiLoop(emit);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erreur assistant";
      const aborted =
        isAborted() || message.toLowerCase().includes("abort");
      if (aborted) {
        return {
          kind: "answer",
          answer: "(Génération interrompue)",
          usedModel: model,
          status: "cancelled",
        };
      }
      if (hasAnthropic && !preferAnthropic) {
        try {
          return await runAnthropicLoop(emit, true);
        } catch {
          /* fall through */
        }
      }
      return {
        kind: "error",
        body: {
          error: message.toLowerCase().includes("abort")
            ? "Timeout LLM / réseau"
            : message,
          conversationId,
          model,
        },
        status: 504,
        runStatus: message.toLowerCase().includes("abort") ? "timeout" : "error",
      };
    }
  };

  // ── Non-stream JSON ──────────────────────────────────────────────
  if (!wantStream) {
    const result = await runMainLoop(null);
    if (result.kind === "error") {
      // Jamais de clé dans les logs — seulement code / message public.
      console.error(
        `[assistant] échec LLM conversation=${conversationId} status=${result.status} error=${String(result.body.error || "error").slice(0, 200)}`,
      );
      finishAssistantRun({
        runId: activeRunId,
        status: result.runStatus,
        error: String(result.body.error || "error"),
        model: typeof result.body.model === "string" ? result.body.model : model,
      });
      return new Response(JSON.stringify({ ...result.body, runId: activeRunId }), {
        status: result.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    finishAssistantRun({
      runId: activeRunId,
      status: result.status,
      model: result.usedModel,
    });
    if (result.status !== "cancelled") {
      persistAssistant(result.answer);
    }
    return Response.json({
      content: result.answer,
      sources: allSources,
      conversationId,
      model: result.usedModel,
      runId: activeRunId,
      cancelled: result.status === "cancelled",
    });
  }

  // ── SSE progressif ───────────────────────────────────────────────
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const emit: EmitFn = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(sseEncode(event, data)));
        } catch {
          closed = true;
        }
      };

      emit("meta", {
        conversationId,
        model,
        runId: activeRunId,
        maxToolRounds: toolRoundLimit,
        tools: getToolDefinitions().map((t) => t.function.name),
      });

      try {
        const result = await runMainLoop(emit);
        if (result.kind === "error") {
          console.error(
            `[assistant] échec LLM (SSE) conversation=${conversationId} status=${result.status} error=${String(result.body.error || "error").slice(0, 200)}`,
          );
          finishAssistantRun({
            runId: activeRunId,
            status: result.runStatus,
            error: String(result.body.error || "error"),
            model:
              typeof result.body.model === "string" ? result.body.model : model,
          });
          emit("error", { ...result.body, runId: activeRunId });
          closed = true;
          controller.close();
          return;
        }

        finishAssistantRun({
          runId: activeRunId,
          status: result.status,
          model: result.usedModel,
        });

        if (result.status === "cancelled") {
          emit("cancelled", {
            conversationId,
            model: result.usedModel,
            runId: activeRunId,
          });
          closed = true;
          controller.close();
          return;
        }

        persistAssistant(result.answer);
        emit("sources", { sources: allSources });
        const chunkSize = 80;
        for (let i = 0; i < result.answer.length; i += chunkSize) {
          if (isAborted()) break;
          emit("token", { text: result.answer.slice(i, i + chunkSize) });
        }
        emit("done", {
          content: result.answer,
          sources: allSources,
          conversationId,
          model: result.usedModel,
          runId: activeRunId,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erreur assistant";
        const aborted =
          isAborted() ||
          /abort|already closed|Invalid state/i.test(message);
        finishAssistantRun({
          runId: activeRunId,
          status: aborted ? "cancelled" : "error",
          error: aborted ? null : message,
          model,
        });
        if (!closed) {
          if (aborted) {
            emit("cancelled", { conversationId, model, runId: activeRunId });
          } else {
            emit("error", {
              error: message,
              conversationId,
              model,
              runId: activeRunId,
            });
          }
        }
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        }
      }
    },
    cancel() {
      /* client AbortController → req.signal.aborted */
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function preferProviderLabel(
  providerPref: string,
  hasOpenAi: boolean,
  hasAnthropic: boolean,
): string {
  if (providerPref === "anthropic") return "anthropic";
  if (providerPref === "openai") return "openai";
  if (hasOpenAi) return "openai";
  if (hasAnthropic) return "anthropic";
  return "none";
}
