/**
 * Client REST API Cursor Cloud Agents v1 (https://api.cursor.com).
 *
 * Couvre toute la surface documentée (cursor.com/docs/cloud-agent/api) :
 * - POST   /v1/agents                         (créer un agent + run initial)
 * - GET    /v1/agents                         (liste paginée)
 * - GET    /v1/agents/{id}                    (métadonnées durables)
 * - DELETE /v1/agents/{id}                    (suppression définitive)
 * - POST   /v1/agents/{id}/archive|unarchive  (soft delete réversible)
 * - POST   /v1/agents/{id}/runs               (prompt de suivi)
 * - GET    /v1/agents/{id}/runs[/{runId}]     (état des runs, résultat final)
 * - POST   /v1/agents/{id}/runs/{runId}/cancel
 * - GET    /v1/agents/{id}/usage[?runId=]     (tokens consommés)
 * - GET    /v1/agents/{id}/artifacts[/download?path=]
 * - GET    /v1/me                             (infos clé API)
 * - GET    /v1/models                         (modèles + params/variants)
 * - GET    /v1/repositories                   (repos GitHub — rate limit strict)
 *
 * Auth : `Authorization: Bearer <clé API Cursor>`. `fetchImpl` injectable
 * (tests, proxy). Le streaming SSE (`GET …/runs/{runId}/stream`) n'est pas
 * couvert : le mount lit l'état terminal via Get A Run.
 */

import { GROKBOT_DEFAULT_API_BASE_URL } from "./config.js";

export type CursorFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<{
  status: number;
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
}>;

export type CursorApiResult = {
  ok: boolean;
  status: number;
  body: unknown;
};

export type CursorClientOptions = {
  apiKey: string;
  /** Défaut : `https://api.cursor.com`. */
  baseUrl?: string;
  fetchImpl?: CursorFetch;
};

export type CursorQuery = Record<
  string,
  string | number | boolean | undefined
>;

export type CursorPromptInput = {
  text: string;
  images?: Array<Record<string, unknown>>;
};

export type CursorCreateAgentBody = {
  prompt: CursorPromptInput;
  model?: { id: string; params?: Array<{ id: string; value: string }> };
  name?: string;
  env?: { type: "cloud" | "pool" | "machine"; name?: string };
  repos?: Array<{ url: string; startingRef?: string; prUrl?: string }>;
  workOnCurrentBranch?: boolean;
  autoCreatePR?: boolean;
  skipReviewerRequest?: boolean;
  envVars?: Record<string, string>;
  mcpServers?: Array<Record<string, unknown>>;
  customSubagents?: Array<Record<string, unknown>>;
  mode?: "agent" | "plan";
  agentId?: string;
};

export type CursorCreateRunBody = {
  prompt: CursorPromptInput;
  mcpServers?: Array<Record<string, unknown>>;
  mode?: "agent" | "plan";
};

export type CursorAgentsClient = {
  request(
    method: string,
    path: string,
    opts?: { query?: CursorQuery; body?: unknown },
  ): Promise<CursorApiResult>;
  me(): Promise<CursorApiResult>;
  listModels(): Promise<CursorApiResult>;
  listRepositories(): Promise<CursorApiResult>;
  createAgent(body: CursorCreateAgentBody): Promise<CursorApiResult>;
  listAgents(query?: CursorQuery): Promise<CursorApiResult>;
  getAgent(agentId: string): Promise<CursorApiResult>;
  deleteAgent(agentId: string): Promise<CursorApiResult>;
  archiveAgent(agentId: string): Promise<CursorApiResult>;
  unarchiveAgent(agentId: string): Promise<CursorApiResult>;
  createRun(agentId: string, body: CursorCreateRunBody): Promise<CursorApiResult>;
  listRuns(agentId: string, query?: CursorQuery): Promise<CursorApiResult>;
  getRun(agentId: string, runId: string): Promise<CursorApiResult>;
  cancelRun(agentId: string, runId: string): Promise<CursorApiResult>;
  getUsage(agentId: string, runId?: string): Promise<CursorApiResult>;
  listArtifacts(agentId: string): Promise<CursorApiResult>;
  downloadArtifact(agentId: string, path: string): Promise<CursorApiResult>;
};

function buildQuery(query?: CursorQuery): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === "") continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function createCursorAgentsClient(
  opts: CursorClientOptions,
): CursorAgentsClient {
  const baseUrl = (opts.baseUrl || GROKBOT_DEFAULT_API_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const fetchImpl: CursorFetch =
    opts.fetchImpl ?? (globalThis.fetch as unknown as CursorFetch);

  async function request(
    method: string,
    path: string,
    reqOpts?: { query?: CursorQuery; body?: unknown },
  ): Promise<CursorApiResult> {
    const url = `${baseUrl}${path}${buildQuery(reqOpts?.query)}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${opts.apiKey}`,
      accept: "application/json",
    };
    const init: { method: string; headers: Record<string, string>; body?: string } =
      { method, headers };
    if (reqOpts?.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(reqOpts.body);
    }
    try {
      const res = await fetchImpl(url, init);
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { ok: res.status >= 200 && res.status < 300, status: res.status, body };
    } catch (err) {
      return {
        ok: false,
        status: 502,
        body: {
          error: "cursor_unreachable",
          detail: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  const enc = encodeURIComponent;

  return {
    request,
    me: () => request("GET", "/v1/me"),
    listModels: () => request("GET", "/v1/models"),
    listRepositories: () => request("GET", "/v1/repositories"),
    createAgent: (body) => request("POST", "/v1/agents", { body }),
    listAgents: (query) => request("GET", "/v1/agents", { query }),
    getAgent: (id) => request("GET", `/v1/agents/${enc(id)}`),
    deleteAgent: (id) => request("DELETE", `/v1/agents/${enc(id)}`),
    archiveAgent: (id) => request("POST", `/v1/agents/${enc(id)}/archive`),
    unarchiveAgent: (id) => request("POST", `/v1/agents/${enc(id)}/unarchive`),
    createRun: (id, body) =>
      request("POST", `/v1/agents/${enc(id)}/runs`, { body }),
    listRuns: (id, query) =>
      request("GET", `/v1/agents/${enc(id)}/runs`, { query }),
    getRun: (id, runId) =>
      request("GET", `/v1/agents/${enc(id)}/runs/${enc(runId)}`),
    cancelRun: (id, runId) =>
      request("POST", `/v1/agents/${enc(id)}/runs/${enc(runId)}/cancel`),
    getUsage: (id, runId) =>
      request("GET", `/v1/agents/${enc(id)}/usage`, {
        query: runId ? { runId } : undefined,
      }),
    listArtifacts: (id) => request("GET", `/v1/agents/${enc(id)}/artifacts`),
    downloadArtifact: (id, path) =>
      request("GET", `/v1/agents/${enc(id)}/artifacts/download`, {
        query: { path },
      }),
  };
}
