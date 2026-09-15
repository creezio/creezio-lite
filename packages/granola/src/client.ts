/**
 * Client REST API publique Granola (https://public-api.granola.ai).
 *
 * Couvre toute la surface documentée (docs.granola.ai) :
 * - GET  /v1/notes                        (liste paginée, filtres date/dossier)
 * - GET  /v1/notes/{note_id}              (note + summary, `include=transcript`)
 * - GET  /v1/notes/{note_id}/transcript   (transcript paginé par curseur)
 * - GET  /v1/folders                      (dossiers + hiérarchie)
 * - GET/POST /v1/webhook-endpoints        (gestion endpoints webhook)
 * - PATCH/DELETE /v1/webhook-endpoints/{id}
 *
 * Auth : `Authorization: Bearer grn_…`. Aucune dépendance réseau imposée :
 * `fetchImpl` injectable (tests, proxy).
 */

import { GRANOLA_DEFAULT_API_BASE_URL } from "./config.js";

export type GranolaFetch = (
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

export type GranolaApiResult = {
  ok: boolean;
  status: number;
  body: unknown;
};

export type GranolaClientOptions = {
  apiKey: string;
  /** Défaut : `https://public-api.granola.ai`. */
  baseUrl?: string;
  fetchImpl?: GranolaFetch;
};

export type GranolaQuery = Record<
  string,
  string | number | boolean | undefined
>;

export type GranolaClient = {
  request(
    method: string,
    path: string,
    opts?: { query?: GranolaQuery; body?: unknown },
  ): Promise<GranolaApiResult>;
  listNotes(query?: GranolaQuery): Promise<GranolaApiResult>;
  getNote(
    noteId: string,
    opts?: { include?: string },
  ): Promise<GranolaApiResult>;
  getTranscript(
    noteId: string,
    query?: GranolaQuery,
  ): Promise<GranolaApiResult>;
  listFolders(query?: GranolaQuery): Promise<GranolaApiResult>;
  listWebhookEndpoints(): Promise<GranolaApiResult>;
  createWebhookEndpoint(body: {
    url: string;
    scopes: string[];
    events?: string[];
    folder_ids?: string[];
  }): Promise<GranolaApiResult>;
  updateWebhookEndpoint(
    endpointId: string,
    patch: Record<string, unknown>,
  ): Promise<GranolaApiResult>;
  deleteWebhookEndpoint(endpointId: string): Promise<GranolaApiResult>;
};

function buildQuery(query?: GranolaQuery): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === "") continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function createGranolaClient(
  opts: GranolaClientOptions,
): GranolaClient {
  const baseUrl = (opts.baseUrl || GRANOLA_DEFAULT_API_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const fetchImpl: GranolaFetch =
    opts.fetchImpl ?? (globalThis.fetch as unknown as GranolaFetch);

  async function request(
    method: string,
    path: string,
    reqOpts?: { query?: GranolaQuery; body?: unknown },
  ): Promise<GranolaApiResult> {
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
          error: "granola_unreachable",
          detail: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  return {
    request,
    listNotes: (query) => request("GET", "/v1/notes", { query }),
    getNote: (noteId, o) =>
      request("GET", `/v1/notes/${encodeURIComponent(noteId)}`, {
        query: o?.include ? { include: o.include } : undefined,
      }),
    getTranscript: (noteId, query) =>
      request(
        "GET",
        `/v1/notes/${encodeURIComponent(noteId)}/transcript`,
        { query },
      ),
    listFolders: (query) => request("GET", "/v1/folders", { query }),
    listWebhookEndpoints: () => request("GET", "/v1/webhook-endpoints"),
    createWebhookEndpoint: (body) =>
      request("POST", "/v1/webhook-endpoints", { body }),
    updateWebhookEndpoint: (endpointId, patch) =>
      request(
        "PATCH",
        `/v1/webhook-endpoints/${encodeURIComponent(endpointId)}`,
        { body: patch },
      ),
    deleteWebhookEndpoint: (endpointId) =>
      request(
        "DELETE",
        `/v1/webhook-endpoints/${encodeURIComponent(endpointId)}`,
      ),
  };
}
