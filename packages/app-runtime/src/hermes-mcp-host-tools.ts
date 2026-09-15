/**
 * H1/H4 « Hermes cerveau unique » — branche les tools host tasks
 * (`createAiTaskHostMcpTools`) + workspace (`createAiWorkspaceMcpTools`,
 * @creezio/tasks) sur la façade MCP kit, dans le harness Docker ET le
 * desktop (`start-brand-desktop`).
 *
 * Décision d'acteur (documentée) :
 * - la façade est montée `allowUnauthenticated: true` → les tools « qui
 *   agissent » portent leur propre gate (`actorIsOwner`, @creezio/tasks) ;
 * - la clé CRM service Hermes est provisionnée par `ensure-crm-key-db`
 *   (electron-shell) avec `user_id NULL` + scopes `full` (parité kit gold).
 *   `createApiKeyBearerActorResolver` vérifie le Bearer contre la table
 *   `api_keys` (sha256, non révoquée) et MAPPE une clé service full-scope
 *   sans user sur L'OWNER — même niveau de confiance que l'API REST CRM
 *   complète que cette clé ouvre déjà. Pas de scope `tasks:run` dédié :
 *   `normalizeScopes` (auth) ne conserve que `full`/`crm:*`, et une clé
 *   restreinte n'est PAS mappée owner (fail-closed sur les tools owner).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type {
  McpBearerActor,
  McpFacade,
  McpToolCallActor,
  McpToolCallResult,
} from "@creezio/mcp-facade";
import {
  aiTaskToolJsonSchema,
  createAiTaskHostMcpTools,
  createAiWorkspaceMcpTools,
  getTasksBrandConfig,
  parseAiTaskToolInput,
  type AiTaskHostMcpRegisterFn,
} from "@creezio/tasks";

/* ── Acteur courant (AsyncLocalStorage → getActorUserId des tools tasks) ── */

const actorStore = new AsyncLocalStorage<{ actorId: string | null }>();

/* ── Résolution Bearer opaque → acteur (clé API service) ── */

export type ApiKeyRow = {
  id: string;
  name: string | null;
  scopes: string | null;
  user_id: string | null;
};

export type CreateApiKeyBearerActorResolverOptions = {
  /** DB brand (table `api_keys`) — null si pas encore ouverte. */
  getBrandDb: () =>
    | { prepare(sql: string): { get(...args: unknown[]): unknown } }
    | null;
  /** Owner à mapper pour une clé service full sans user (défaut : tasks). */
  getOwnerId?: () => string | null;
};

/**
 * Vérifie un Bearer opaque contre `api_keys` (sha256(token), non révoquée).
 * - clé liée à un user → subject = user_id ;
 * - clé service `full` sans user (clé CRM Hermes) → subject = OWNER ;
 * - clé à scopes restreints sans user → subject `api-key:<id>` (identifiée
 *   mais PAS owner — les tools owner la refusent, fail-closed) ;
 * - token inconnu / JWT → null (fallback verifyMcpBearer inchangé).
 */
export function createApiKeyBearerActorResolver(
  opts: CreateApiKeyBearerActorResolverOptions,
): (token: string) => McpBearerActor | null {
  return (token: string) => {
    const raw = String(token || "").trim();
    // Un JWT (3 segments base64url) suit la voie verifyMcpBearer.
    if (!raw || raw.split(".").length === 3) return null;
    let db: ReturnType<CreateApiKeyBearerActorResolverOptions["getBrandDb"]>;
    try {
      db = opts.getBrandDb();
    } catch {
      return null;
    }
    if (!db) return null;
    try {
      const hash = createHash("sha256").update(raw, "utf8").digest("hex");
      const row = db
        .prepare(
          `SELECT id, name, scopes, user_id FROM api_keys
           WHERE key_hash = ? AND revoked_at IS NULL`,
        )
        .get(hash) as ApiKeyRow | undefined;
      if (!row) return null;
      const scopes = String(row.scopes || "");
      const scopeList = scopes
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const fullScope = scopeList.includes("full");
      let subject = row.user_id ? String(row.user_id) : "";
      if (!subject && fullScope) {
        subject =
          opts.getOwnerId?.() ||
          getTasksBrandConfig()?.users.getOwner()?.id ||
          "";
      }
      if (!subject) subject = `api-key:${row.id}`;
      return {
        subject,
        claims: {
          api_key: true,
          api_key_id: row.id,
          api_key_name: row.name || null,
          scopes,
        },
      };
    } catch {
      // Table absente / DB fermée → fallback JWT (jamais de crash auth).
      return null;
    }
  };
}

/* ── Adaptation registerTool tasks → façade MCP (namespace + schéma) ── */

/** Convertit le résultat MCP-envelope des tools tasks en McpToolCallResult. */
function toFacadeResult(raw: unknown): McpToolCallResult {
  const r = raw as {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  } | null;
  if (r && Array.isArray(r.content)) {
    const text = r.content
      .filter((c) => c?.type === "text")
      .map((c) => c.text || "")
      .join("\n");
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* texte brut */
    }
    if (r.isError) {
      const message =
        (parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error?: unknown }).error || "")
          : "") ||
        text ||
        "tool_error";
      return { ok: false, error: message };
    }
    return { ok: true, content: parsed };
  }
  return { ok: true, content: raw ?? null };
}

export type RegisterHermesHostMcpToolsOptions = {
  mcp: McpFacade;
  /** : expose aussi `list_tasks`. Défaut false. */
  includeListTasks?: boolean;
  log?: (line: string) => void;
};

/**
 * Enregistre sur la façade les tools host tasks (H1 : create_ai_task,
 * get_ai_task, get_ai_run_logs, answer_ai_question, list_ai_collaborators)
 * et workspace/HITL (H4 : workspace.*, platform.ask_human/get_human_answer).
 *
 * Canonique `module.tasks.<nom>` + alias legacy `<nom>` (surface
 * `legacy-preferred` → Hermes voit les noms courts de la mission).
 */
export function registerHermesHostMcpTools(
  opts: RegisterHermesHostMcpToolsOptions,
): { registered: string[] } {
  const { mcp } = opts;
  const registered: string[] = [];

  const registerTool: AiTaskHostMcpRegisterFn = (name, config, handler) => {
    const canonical = `module.tasks.${name}`;
    const shape = config.inputSchema || {};
    const hasShape = Object.keys(shape).length > 0;
    mcp.registerTool({
      name: canonical,
      description: config.description,
      space: "module",
      ownerId: "tasks",
      inputSchema: hasShape ? aiTaskToolJsonSchema(shape) : { type: "object" },
      handler: async (args, actor?: McpToolCallActor) => {
        const parsed = parseAiTaskToolInput(shape, args || {});
        if (!parsed.ok) return { ok: false, error: parsed.error };
        const input = parsed.input;
        const actorId =
          actor?.subject && actor.subject !== "anonymous"
            ? actor.subject
            : null;
        try {
          const raw = await actorStore.run({ actorId }, () => handler(input));
          return toFacadeResult(raw);
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    });
    mcp.registerAlias(name, canonical);
    registered.push(name);
  };

  const getActorUserId = () => actorStore.getStore()?.actorId ?? null;

  createAiTaskHostMcpTools({
    registerTool,
    getActorUserId,
    ...(opts.includeListTasks ? { includeListTasks: true } : {}),
  });
  createAiWorkspaceMcpTools({ registerTool, getActorUserId });

  opts.log?.(
    `mcp host tools tasks/workspace enregistrés (${registered.length}) : ${registered.join(", ")}`,
  );
  return { registered };
}
