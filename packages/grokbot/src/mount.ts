/**
 * Mount api-kernel `/api/v1/modules/grokbot/*` (dbLayer brand).
 *
 * Pilotage des agents cloud (API Cursor v1) depuis l'app marque :
 *
 * - `GET/PUT/DELETE config`      → token Cursor + défauts (masqué en GET).
 * - `GET status`                 → vérifie la clé via GET /v1/me.
 * - `GET models`                 → modèles disponibles (proxy).
 * - `GET repositories`           → repos GitHub accessibles — mis en cache
 *   en DB (rate limit officiel : 1 req/min/user) ; `?refresh=1` force.
 * - `GET  agents`                → liste distante + miroir local
 *   (`?source=local` = lecture hors-ligne du miroir).
 * - `POST agents`                → lance un agent (prompt, repo, modèle…).
 * - `GET/DELETE agents/:id`, `POST agents/:id/archive|unarchive`.
 * - `GET/POST agents/:id/runs`, `GET agents/:id/runs/:runId`,
 *   `POST agents/:id/runs/:runId/cancel`.
 * - `GET agents/:id/usage[?runId]`, `GET agents/:id/artifacts`,
 *   `GET agents/:id/artifacts/download?path=…`.
 *
 * db absent → 503 `db_unavailable` ; token absent → 409
 * `cursor_api_key_missing` ; erreurs amont → passthrough du status avec
 * `error: "cursor_api_error"` ; jamais de throw.
 */

import type { ApiMount, ApiRequest, ApiResponse } from "@creezio/api-kernel";

import {
  GROKBOT_CONFIG_KEYS,
  type GrokbotModuleConfig,
  maskToken,
  mergeGrokbotConfig,
} from "./config.js";
import {
  createCursorAgentsClient,
  type CursorApiResult,
  type CursorCreateAgentBody,
  type CursorCreateRunBody,
  type CursorFetch,
  type CursorQuery,
} from "./client.js";

const CONFIG_KEY = "config";
const REPOS_CACHE_KEY = "repositories_cache";
/** TTL cache repos — rate limit officiel : 1 req/min et 30 req/h par user. */
const REPOS_CACHE_TTL_MS = 60 * 60 * 1000;

type Db = {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => unknown;
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
};

function nowIso(): string {
  return new Date().toISOString();
}

function readSetting(db: Db, key: string): unknown {
  try {
    const row = db
      .prepare(`SELECT value_json FROM grokbot_settings WHERE key = ?`)
      .get(key) as { value_json?: string } | undefined;
    if (!row?.value_json) return null;
    return JSON.parse(row.value_json) as unknown;
  } catch {
    return null;
  }
}

function writeSetting(db: Db, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO grokbot_settings (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), nowIso());
}

function readOverride(db: Db): Partial<GrokbotModuleConfig> | null {
  const parsed = readSetting(db, CONFIG_KEY);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Partial<GrokbotModuleConfig>;
}

function queryValue(req: ApiRequest, name: string): string {
  const raw = req.query?.[name];
  return String(Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").trim();
}

function queryToObject(req: ApiRequest): CursorQuery {
  const out: CursorQuery = {};
  for (const [k, v] of Object.entries(req.query ?? {})) {
    const val = Array.isArray(v) ? v[0] : v;
    if (typeof val === "string" && val !== "") out[k] = val;
  }
  return out;
}

function jsonBody(req: ApiRequest): Record<string, unknown> | null {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    return req.body as Record<string, unknown>;
  }
  return null;
}

type AgentRecord = Record<string, unknown>;

/** Upsert du miroir local depuis un objet agent de l'API Cursor. */
function upsertAgent(
  db: Db,
  agent: AgentRecord,
  extra?: { prompt?: string; model?: string },
): void {
  const id = typeof agent.id === "string" ? agent.id : "";
  if (!id) return;
  const repos = Array.isArray(agent.repos) ? (agent.repos as AgentRecord[]) : [];
  const repoUrl =
    repos.length && typeof repos[0]?.url === "string"
      ? (repos[0].url as string)
      : null;
  const git =
    agent.git && typeof agent.git === "object"
      ? (agent.git as { branches?: Array<Record<string, unknown>> })
      : null;
  const branch0 = git?.branches?.[0];
  const prev = db
    .prepare(`SELECT prompt, model FROM grokbot_agents WHERE id = ?`)
    .get(id) as { prompt?: string; model?: string } | undefined;
  db.prepare(
    `INSERT INTO grokbot_agents
       (id, name, status, prompt, repo_url, branch, pr_url, model, url,
        latest_run_id, created_at, updated_at, synced_at, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       status = excluded.status,
       prompt = COALESCE(excluded.prompt, grokbot_agents.prompt),
       repo_url = COALESCE(excluded.repo_url, grokbot_agents.repo_url),
       branch = COALESCE(excluded.branch, grokbot_agents.branch),
       pr_url = COALESCE(excluded.pr_url, grokbot_agents.pr_url),
       model = COALESCE(excluded.model, grokbot_agents.model),
       url = excluded.url,
       latest_run_id = COALESCE(excluded.latest_run_id, grokbot_agents.latest_run_id),
       created_at = COALESCE(excluded.created_at, grokbot_agents.created_at),
       updated_at = excluded.updated_at,
       synced_at = excluded.synced_at,
       payload_json = excluded.payload_json`,
  ).run(
    id,
    typeof agent.name === "string" ? agent.name : null,
    typeof agent.status === "string" ? agent.status : null,
    extra?.prompt ?? prev?.prompt ?? null,
    repoUrl,
    branch0 && typeof branch0.branch === "string" ? branch0.branch : null,
    branch0 && typeof branch0.prUrl === "string" ? branch0.prUrl : null,
    extra?.model ?? prev?.model ?? null,
    typeof agent.url === "string" ? agent.url : null,
    typeof agent.latestRunId === "string" ? agent.latestRunId : null,
    typeof agent.createdAt === "string" ? agent.createdAt : null,
    typeof agent.updatedAt === "string" ? agent.updatedAt : null,
    nowIso(),
    JSON.stringify(agent),
  );
}

export type GrokbotMountOptions = {
  /** Défauts marque (token via env, dépôt/modèle par défaut…). */
  defaults?: GrokbotModuleConfig;
  /** Fetch injectable (tests / proxy sortant). */
  fetchImpl?: CursorFetch;
  /**
   * Permission HTTP requise pour tout le mount (recommandé : le token
   * Cursor pilote des agents qui poussent du code).
   */
  permission?: string;
};

export function createGrokbotMount(opts?: GrokbotMountOptions): ApiMount {
  const defaults = opts?.defaults;

  function clientFor(cfg: GrokbotModuleConfig) {
    if (!cfg.apiKey) return null;
    return createCursorAgentsClient({
      apiKey: cfg.apiKey,
      baseUrl: cfg.apiBaseUrl,
      fetchImpl: opts?.fetchImpl,
    });
  }

  const missingKey: ApiResponse = {
    status: 409,
    body: { ok: false, error: "cursor_api_key_missing" },
  };

  const proxy = (res: CursorApiResult): ApiResponse => ({
    status: res.status,
    body: res.ok
      ? { ok: true, data: res.body }
      : {
          ok: false,
          error: "cursor_api_error",
          status: res.status,
          detail: res.body,
        },
  });

  return {
    dbLayer: "brand",
    ...(opts?.permission ? { permission: opts.permission } : {}),
    accessJustification: opts?.permission
      ? undefined
      : "Garde session de bordure de la marque ; passer options.permission " +
        "pour restreindre le pilotage des agents à un rôle dédié.",
    operations: [
      {
        id: "get-config",
        method: "GET",
        path: "/config",
        description: "Config du module (token Cursor masqué)",
      },
      {
        id: "put-config",
        method: "PUT",
        path: "/config",
        description: "Enregistre le token Cursor et les défauts (repo, modèle)",
      },
      {
        id: "delete-config",
        method: "DELETE",
        path: "/config",
        description: "Supprime l'override DB (retour aux défauts marque)",
      },
      {
        id: "status",
        method: "GET",
        path: "/status",
        description: "Vérifie le token via GET /v1/me (nom de clé, email)",
      },
      {
        id: "models",
        method: "GET",
        path: "/models",
        description: "Modèles disponibles pour les agents (GET /v1/models)",
      },
      {
        id: "repositories",
        method: "GET",
        path: "/repositories",
        description:
          "Dépôts GitHub accessibles (cache DB 1 h — rate limit strict amont)",
      },
      {
        id: "list-agents",
        method: "GET",
        path: "/agents",
        description: "Liste des agents (distant + miroir local)",
        mcpPublishDefault: true,
      },
      {
        id: "create-agent",
        method: "POST",
        path: "/agents",
        description:
          "Lance un agent cloud (prompt, repo, modèle, autoCreatePR…)",
        mcpPublishDefault: true,
      },
      {
        id: "get-agent",
        method: "GET",
        path: "/agents/:id",
        description: "Métadonnées durables d'un agent",
        mcpPublishDefault: true,
      },
      {
        id: "delete-agent",
        method: "DELETE",
        path: "/agents/:id",
        description: "Supprime définitivement un agent",
      },
      {
        id: "archive-agent",
        method: "POST",
        path: "/agents/:id/archive",
        description: "Archive un agent (réversible)",
      },
      {
        id: "unarchive-agent",
        method: "POST",
        path: "/agents/:id/unarchive",
        description: "Désarchive un agent",
      },
      {
        id: "list-runs",
        method: "GET",
        path: "/agents/:id/runs",
        description: "Runs d'un agent (plus récents d'abord)",
      },
      {
        id: "create-run",
        method: "POST",
        path: "/agents/:id/runs",
        description: "Envoie un prompt de suivi à un agent actif",
        mcpPublishDefault: true,
      },
      {
        id: "get-run",
        method: "GET",
        path: "/agents/:id/runs/:runId",
        description: "État d'un run (résultat final, durée, branches poussées)",
        mcpPublishDefault: true,
      },
      {
        id: "cancel-run",
        method: "POST",
        path: "/agents/:id/runs/:runId/cancel",
        description: "Annule le run actif",
      },
      {
        id: "usage",
        method: "GET",
        path: "/agents/:id/usage",
        description: "Usage tokens de l'agent (par run)",
      },
      {
        id: "artifacts",
        method: "GET",
        path: "/agents/:id/artifacts",
        description: "Artefacts produits par l'agent",
      },
    ],
    handle: async ({ req, subPath, db }) => {
      if (!db) {
        return { status: 503, body: { ok: false, error: "db_unavailable" } };
      }
      const method = req.method.toUpperCase();
      const parts = subPath.split("/").filter(Boolean);
      const head = parts[0] || "";
      const cfg = mergeGrokbotConfig(defaults, readOverride(db as Db));
      const client = clientFor(cfg);

      /* ---------------------------------------------------------- config */
      if (head === "config" && parts.length === 1) {
        if (method === "GET") {
          const override = readOverride(db as Db);
          return {
            status: 200,
            body: {
              ok: true,
              config: {
                apiKey: maskToken(cfg.apiKey),
                apiBaseUrl: cfg.apiBaseUrl ?? null,
                defaultRepoUrl: cfg.defaultRepoUrl ?? null,
                defaultModelId: cfg.defaultModelId ?? null,
              },
              hasOverride: override != null,
            },
          };
        }
        if (method === "PUT") {
          const body = jsonBody(req);
          if (!body) {
            return { status: 400, body: { ok: false, error: "invalid_body" } };
          }
          const override = readOverride(db as Db) ?? {};
          for (const key of GROKBOT_CONFIG_KEYS) {
            const v = body[key];
            if (typeof v === "string") {
              if (v.trim()) {
                (override as Record<string, string>)[key] = v.trim();
              } else {
                delete (override as Record<string, unknown>)[key];
              }
            }
          }
          writeSetting(db as Db, CONFIG_KEY, override);
          const next = mergeGrokbotConfig(defaults, override);
          return {
            status: 200,
            body: {
              ok: true,
              config: {
                apiKey: maskToken(next.apiKey),
                apiBaseUrl: next.apiBaseUrl ?? null,
                defaultRepoUrl: next.defaultRepoUrl ?? null,
                defaultModelId: next.defaultModelId ?? null,
              },
              hasOverride: true,
            },
          };
        }
        if (method === "DELETE") {
          (db as Db)
            .prepare(`DELETE FROM grokbot_settings WHERE key = ?`)
            .run(CONFIG_KEY);
          return { status: 200, body: { ok: true, hasOverride: false } };
        }
        return { status: 405, body: { ok: false, error: "method_not_allowed" } };
      }

      /* ---------------------------------------------------------- status */
      if (head === "status" && parts.length === 1 && method === "GET") {
        if (!client) {
          return {
            status: 200,
            body: { ok: true, connected: false, reason: "cursor_api_key_missing" },
          };
        }
        const res = await client.me();
        if (!res.ok) {
          return {
            status: 200,
            body: {
              ok: true,
              connected: false,
              reason: "cursor_api_error",
              status: res.status,
            },
          };
        }
        const me = (res.body ?? {}) as Record<string, unknown>;
        return {
          status: 200,
          body: {
            ok: true,
            connected: true,
            apiKeyName: me.apiKeyName ?? null,
            userEmail: me.userEmail ?? null,
          },
        };
      }

      /* ---------------------------------------------------------- models */
      if (head === "models" && parts.length === 1 && method === "GET") {
        if (!client) return missingKey;
        return proxy(await client.listModels());
      }

      /* ---------------------------------------------------- repositories */
      if (head === "repositories" && parts.length === 1 && method === "GET") {
        if (!client) return missingKey;
        const refresh = queryValue(req, "refresh") === "1";
        const cached = readSetting(db as Db, REPOS_CACHE_KEY) as {
          fetchedAt?: string;
          data?: unknown;
        } | null;
        if (!refresh && cached?.fetchedAt && cached.data !== undefined) {
          const age = Date.now() - Date.parse(cached.fetchedAt);
          if (Number.isFinite(age) && age >= 0 && age < REPOS_CACHE_TTL_MS) {
            return {
              status: 200,
              body: { ok: true, data: cached.data, cached: true },
            };
          }
        }
        const res = await client.listRepositories();
        if (!res.ok) {
          // Amont indisponible / rate-limité : servir le cache même périmé.
          if (cached?.data !== undefined) {
            return {
              status: 200,
              body: { ok: true, data: cached.data, cached: true, stale: true },
            };
          }
          return proxy(res);
        }
        writeSetting(db as Db, REPOS_CACHE_KEY, {
          fetchedAt: nowIso(),
          data: res.body,
        });
        return { status: 200, body: { ok: true, data: res.body, cached: false } };
      }

      /* ---------------------------------------------------------- agents */
      if (head === "agents") {
        // GET agents (liste) — ?source=local pour lire le miroir hors-ligne.
        if (parts.length === 1 && method === "GET") {
          if (queryValue(req, "source") === "local" || !client) {
            const rows = (db as Db)
              .prepare(
                `SELECT id, name, status, prompt, repo_url, branch, pr_url,
                        model, url, latest_run_id, created_at, updated_at, synced_at
                 FROM grokbot_agents ORDER BY created_at DESC`,
              )
              .all();
            if (!client && queryValue(req, "source") !== "local") {
              return {
                status: 200,
                body: {
                  ok: true,
                  items: rows,
                  source: "local",
                  warning: "cursor_api_key_missing",
                },
              };
            }
            return { status: 200, body: { ok: true, items: rows, source: "local" } };
          }
          const res = await client.listAgents(queryToObject(req));
          if (!res.ok) return proxy(res);
          const data = (res.body ?? {}) as {
            items?: AgentRecord[];
            nextCursor?: string;
          };
          for (const agent of data.items ?? []) upsertAgent(db as Db, agent);
          return {
            status: 200,
            body: {
              ok: true,
              items: data.items ?? [],
              nextCursor: data.nextCursor,
              source: "remote",
            },
          };
        }

        // POST agents — lance un agent.
        if (parts.length === 1 && method === "POST") {
          if (!client) return missingKey;
          const body = jsonBody(req);
          const promptText =
            typeof body?.prompt === "object" &&
            body.prompt &&
            typeof (body.prompt as Record<string, unknown>).text === "string"
              ? String((body.prompt as Record<string, unknown>).text)
              : typeof body?.text === "string"
                ? body.text
                : "";
          if (!body || !promptText.trim()) {
            return {
              status: 400,
              body: { ok: false, error: "prompt_text_required" },
            };
          }
          const create: CursorCreateAgentBody = {
            prompt: { text: promptText.trim() },
          };
          const promptImages =
            typeof body.prompt === "object" && body.prompt
              ? (body.prompt as Record<string, unknown>).images
              : undefined;
          if (Array.isArray(promptImages)) {
            create.prompt.images = promptImages as Array<Record<string, unknown>>;
          }
          const modelId =
            typeof body.modelId === "string" && body.modelId.trim()
              ? body.modelId.trim()
              : typeof body.model === "object" &&
                  body.model &&
                  typeof (body.model as Record<string, unknown>).id === "string"
                ? String((body.model as Record<string, unknown>).id)
                : cfg.defaultModelId;
          if (modelId) {
            create.model = { id: modelId };
            const params =
              typeof body.model === "object" && body.model
                ? (body.model as Record<string, unknown>).params
                : undefined;
            if (Array.isArray(params)) {
              create.model.params = params as Array<{ id: string; value: string }>;
            }
          }
          if (typeof body.name === "string" && body.name.trim()) {
            create.name = body.name.trim();
          }
          if (Array.isArray(body.repos) && body.repos.length) {
            create.repos = body.repos as CursorCreateAgentBody["repos"];
          } else {
            const repoUrl =
              typeof body.repoUrl === "string" && body.repoUrl.trim()
                ? body.repoUrl.trim()
                : cfg.defaultRepoUrl;
            if (repoUrl) {
              const repo: { url: string; startingRef?: string; prUrl?: string } = {
                url: repoUrl,
              };
              if (typeof body.ref === "string" && body.ref.trim()) {
                repo.startingRef = body.ref.trim();
              }
              if (typeof body.prUrl === "string" && body.prUrl.trim()) {
                repo.prUrl = body.prUrl.trim();
              }
              create.repos = [repo];
            }
          }
          if (typeof body.env === "object" && body.env) {
            create.env = body.env as CursorCreateAgentBody["env"];
          }
          if (typeof body.autoCreatePR === "boolean") {
            create.autoCreatePR = body.autoCreatePR;
          }
          if (typeof body.workOnCurrentBranch === "boolean") {
            create.workOnCurrentBranch = body.workOnCurrentBranch;
          }
          if (typeof body.skipReviewerRequest === "boolean") {
            create.skipReviewerRequest = body.skipReviewerRequest;
          }
          if (body.mode === "agent" || body.mode === "plan") {
            create.mode = body.mode;
          }
          if (Array.isArray(body.mcpServers)) {
            create.mcpServers = body.mcpServers as Array<Record<string, unknown>>;
          }
          const res = await client.createAgent(create);
          if (!res.ok) return proxy(res);
          const data = (res.body ?? {}) as { agent?: AgentRecord; run?: unknown };
          if (data.agent) {
            upsertAgent(db as Db, data.agent, {
              prompt: promptText.trim(),
              model: modelId,
            });
          }
          return {
            status: 200,
            body: { ok: true, agent: data.agent ?? null, run: data.run ?? null },
          };
        }

        const agentId = parts[1] ?? "";
        if (!agentId) {
          return { status: 404, body: { ok: false, error: "not_found" } };
        }

        // GET/DELETE agents/:id
        if (parts.length === 2) {
          if (method === "GET") {
            if (!client) return missingKey;
            const res = await client.getAgent(agentId);
            if (!res.ok) return proxy(res);
            upsertAgent(db as Db, res.body as AgentRecord);
            return { status: 200, body: { ok: true, agent: res.body } };
          }
          if (method === "DELETE") {
            if (!client) return missingKey;
            const res = await client.deleteAgent(agentId);
            if (!res.ok) return proxy(res);
            (db as Db)
              .prepare(`DELETE FROM grokbot_agents WHERE id = ?`)
              .run(agentId);
            return { status: 200, body: { ok: true, id: agentId } };
          }
          return {
            status: 405,
            body: { ok: false, error: "method_not_allowed" },
          };
        }

        // POST agents/:id/archive | unarchive
        if (
          parts.length === 3 &&
          (parts[2] === "archive" || parts[2] === "unarchive") &&
          method === "POST"
        ) {
          if (!client) return missingKey;
          const res =
            parts[2] === "archive"
              ? await client.archiveAgent(agentId)
              : await client.unarchiveAgent(agentId);
          if (!res.ok) return proxy(res);
          (db as Db)
            .prepare(`UPDATE grokbot_agents SET status = ?, synced_at = ? WHERE id = ?`)
            .run(parts[2] === "archive" ? "ARCHIVED" : "IDLE", nowIso(), agentId);
          return { status: 200, body: { ok: true, id: agentId } };
        }

        // agents/:id/runs[…]
        if (parts[2] === "runs") {
          if (!client) return missingKey;
          if (parts.length === 3 && method === "GET") {
            return proxy(await client.listRuns(agentId, queryToObject(req)));
          }
          if (parts.length === 3 && method === "POST") {
            const body = jsonBody(req);
            const promptText =
              typeof body?.prompt === "object" &&
              body.prompt &&
              typeof (body.prompt as Record<string, unknown>).text === "string"
                ? String((body.prompt as Record<string, unknown>).text)
                : typeof body?.text === "string"
                  ? body.text
                  : "";
            if (!promptText.trim()) {
              return {
                status: 400,
                body: { ok: false, error: "prompt_text_required" },
              };
            }
            const run: CursorCreateRunBody = { prompt: { text: promptText.trim() } };
            if (body?.mode === "agent" || body?.mode === "plan") {
              run.mode = body.mode;
            }
            if (Array.isArray(body?.mcpServers)) {
              run.mcpServers = body.mcpServers as Array<Record<string, unknown>>;
            }
            return proxy(await client.createRun(agentId, run));
          }
          const runId = parts[3] ?? "";
          if (parts.length === 4 && method === "GET") {
            return proxy(await client.getRun(agentId, runId));
          }
          if (parts.length === 5 && parts[4] === "cancel" && method === "POST") {
            return proxy(await client.cancelRun(agentId, runId));
          }
          return { status: 404, body: { ok: false, error: "not_found" } };
        }

        // agents/:id/usage
        if (parts.length === 3 && parts[2] === "usage" && method === "GET") {
          if (!client) return missingKey;
          const runId = queryValue(req, "runId");
          return proxy(await client.getUsage(agentId, runId || undefined));
        }

        // agents/:id/artifacts[…]
        if (parts[2] === "artifacts") {
          if (!client) return missingKey;
          if (parts.length === 3 && method === "GET") {
            return proxy(await client.listArtifacts(agentId));
          }
          if (parts.length === 4 && parts[3] === "download" && method === "GET") {
            const path = queryValue(req, "path");
            if (!path) {
              return { status: 400, body: { ok: false, error: "path_required" } };
            }
            return proxy(await client.downloadArtifact(agentId, path));
          }
        }

        return { status: 404, body: { ok: false, error: "not_found" } };
      }

      return { status: 404, body: { ok: false, error: "not_found" } };
    },
  };
}
