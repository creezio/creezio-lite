/**
 * Mount api-kernel `/api/v1/modules/granola/*` (dbLayer brand).
 *
 * Routes :
 * - `POST   webhook`                → récepteur des livraisons Granola
 *   (Standard Webhooks, vérif HMAC fail-closed dès qu'un secret est
 *   configuré, dédup par `event_id`, sync note best-effort).
 * - `GET    webhook-info`           → URL webhook à coller dans Granola.
 * - `POST   register-webhook`       → enregistre l'endpoint via l'API
 *   Granola et stocke le `signing_secret` (retourné une seule fois).
 * - `GET/PUT/DELETE config`         → config module (secrets masqués en GET).
 * - `GET    events`                 → livraisons webhook reçues (locales).
 * - `GET    notes` / `notes/:id`    → notes synchronisées (locales).
 * - `GET    notes/:id/transcript`   → proxy `client.getTranscript` (jamais
 *   d'appel Granola depuis le browser).
 * - `POST   notes/:id/sync`         → re-fetch d'une note via l'API.
 * - `GET    remote/notes[...]`, `remote/folders`,
 *   `GET/DELETE/PATCH remote/webhook-endpoints[...]` → proxys API Granola.
 *
 * db absent → 503 `db_unavailable` ; jamais de throw.
 */

import type { ApiMount, ApiRequest, ApiResponse } from "@creezio/api-kernel";

import {
  GRANOLA_CONFIG_KEYS,
  type GranolaModuleConfig,
  maskSecret,
  mergeGranolaConfig,
} from "./config.js";
import {
  createGranolaClient,
  type GranolaFetch,
  type GranolaQuery,
} from "./client.js";
import { verifyGranolaSignature } from "./signature.js";

const CONFIG_KEY = "config";

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

function readOverride(db: Db): Partial<GranolaModuleConfig> | null {
  try {
    const row = db
      .prepare(`SELECT value_json FROM granola_settings WHERE key = ?`)
      .get(CONFIG_KEY) as { value_json?: string } | undefined;
    if (!row?.value_json) return null;
    const parsed = JSON.parse(row.value_json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Partial<GranolaModuleConfig>;
  } catch {
    return null;
  }
}

function writeOverride(db: Db, override: Partial<GranolaModuleConfig>): void {
  db.prepare(
    `INSERT INTO granola_settings (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`,
  ).run(CONFIG_KEY, JSON.stringify(override), nowIso());
}

function queryValue(req: ApiRequest, name: string): string {
  const raw = req.query?.[name];
  return String(Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").trim();
}

function queryToObject(req: ApiRequest): GranolaQuery {
  const out: GranolaQuery = {};
  for (const [k, v] of Object.entries(req.query ?? {})) {
    const val = Array.isArray(v) ? v[0] : v;
    if (typeof val === "string" && val !== "") out[k] = val;
  }
  return out;
}

/** Dérive l'origine publique depuis les en-têtes (reverse-proxy inclus). */
function deriveBaseUrl(req: ApiRequest): string | null {
  const h = req.headers ?? {};
  const pick = (name: string): string => {
    const v = h[name] ?? h[name.toLowerCase()];
    if (Array.isArray(v)) return v[0] ?? "";
    return typeof v === "string" ? v : "";
  };
  const host = pick("x-forwarded-host") || pick("host");
  if (!host) return null;
  const proto = pick("x-forwarded-proto") || "https";
  return `${(proto.split(",")[0] ?? proto).trim()}://${(host.split(",")[0] ?? host).trim()}`;
}

function webhookUrlFor(cfg: GranolaModuleConfig, req: ApiRequest): string | null {
  const base = cfg.publicBaseUrl || deriveBaseUrl(req);
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/api/v1/modules/granola/webhook`;
}

type NoteRecord = Record<string, unknown>;

function noteFolderId(note: NoteRecord): string | null {
  if (typeof note.folder_id === "string" && note.folder_id) return note.folder_id;
  const folder = note.folder;
  if (folder && typeof folder === "object" && !Array.isArray(folder)) {
    const id = (folder as Record<string, unknown>).id;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

function noteTranscriptJson(note: NoteRecord): string | null {
  if (note.transcript == null) return null;
  try {
    return JSON.stringify(note.transcript);
  } catch {
    return null;
  }
}

function upsertNote(db: Db, note: NoteRecord): void {
  const id = typeof note.id === "string" ? note.id : "";
  if (!id) return;
  const title = typeof note.title === "string" && note.title ? note.title : null;
  const summary =
    typeof note.summary === "string" && note.summary ? note.summary : null;
  db.prepare(
    `INSERT INTO granola_notes
       (id, title, summary, owner_json, note_created_at, note_updated_at, synced_at, payload_json, folder_id, transcript_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = COALESCE(excluded.title, granola_notes.title),
       summary = COALESCE(excluded.summary, granola_notes.summary),
       owner_json = excluded.owner_json,
       note_created_at = excluded.note_created_at,
       note_updated_at = excluded.note_updated_at,
       synced_at = excluded.synced_at,
       payload_json = excluded.payload_json,
       folder_id = COALESCE(excluded.folder_id, granola_notes.folder_id),
       transcript_json = COALESCE(excluded.transcript_json, granola_notes.transcript_json)`,
  ).run(
    id,
    title,
    summary,
    note.owner ? JSON.stringify(note.owner) : null,
    typeof note.created_at === "string" ? note.created_at : null,
    typeof note.updated_at === "string" ? note.updated_at : null,
    nowIso(),
    JSON.stringify(note),
    noteFolderId(note),
    noteTranscriptJson(note),
  );
}

export type GranolaMountOptions = {
  /** Défauts marque (fichier explicite `brand-granola-content.ts` ou env). */
  defaults?: GranolaModuleConfig;
  /** Fetch injectable (tests / proxy sortant). */
  fetchImpl?: GranolaFetch;
  /**
   * Si true, la sync note déclenchée par un webhook est attendue avant la
   * réponse (tests). Défaut false : la réponse 2xx part tout de suite
   * (budget 15 s Granola), la sync se fait en tâche de fond.
   */
  awaitWebhookSync?: boolean;
};

function stripWebhookEndpointSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripWebhookEndpointSecrets);
  }
  if (!value || typeof value !== "object") return value;
  const rec = { ...(value as Record<string, unknown>) };
  delete rec.signing_secret;
  if (rec.webhook_endpoints !== undefined) {
    rec.webhook_endpoints = stripWebhookEndpointSecrets(rec.webhook_endpoints);
  }
  if (rec.data !== undefined) {
    rec.data = stripWebhookEndpointSecrets(rec.data);
  }
  return rec;
}

function webhookEndpointPatch(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") out.enabled = body.enabled;
  if (typeof body.url === "string" && body.url.trim()) {
    out.url = body.url.trim();
  }
  if (Array.isArray(body.scopes)) {
    out.scopes = body.scopes.filter((s) => typeof s === "string");
  }
  if (Array.isArray(body.events)) {
    out.events = body.events.filter((s) => typeof s === "string");
  }
  if (Array.isArray(body.folder_ids)) {
    out.folder_ids = body.folder_ids.filter((s) => typeof s === "string");
  }
  return out;
}

function jsonBody(req: ApiRequest): Record<string, unknown> | null {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    return req.body as Record<string, unknown>;
  }
  if (typeof req.rawBody === "string" && req.rawBody) {
    try {
      const parsed = JSON.parse(req.rawBody) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function createGranolaMount(opts?: GranolaMountOptions): ApiMount {
  const defaults = opts?.defaults;

  function clientFor(cfg: GranolaModuleConfig) {
    if (!cfg.apiKey) return null;
    return createGranolaClient({
      apiKey: cfg.apiKey,
      baseUrl: cfg.apiBaseUrl,
      fetchImpl: opts?.fetchImpl,
    });
  }

  async function syncNote(
    db: Db,
    cfg: GranolaModuleConfig,
    noteId: string,
  ): Promise<ApiResponse> {
    const client = clientFor(cfg);
    if (!client) {
      return {
        status: 409,
        body: { ok: false, error: "granola_api_key_missing" },
      };
    }
    const res = await client.getNote(noteId, { include: "transcript" });
    if (!res.ok || !res.body || typeof res.body !== "object") {
      return {
        status: res.status === 502 ? 502 : res.status,
        body: {
          ok: false,
          error: "granola_api_error",
          status: res.status,
          detail: res.body,
        },
      };
    }
    upsertNote(db, res.body as NoteRecord);
    return { status: 200, body: { ok: true, note: res.body } };
  }

  return {
    dbLayer: "brand",
    accessJustification:
      "POST webhook = route machine publique signée (Standard Webhooks HMAC, " +
      "fail-closed dès qu'un secret est configuré) ; les autres routes restent " +
      "derrière la garde session de bordure de la marque.",
    operations: [
      {
        id: "webhook",
        method: "POST",
        path: "/webhook",
        description:
          "Récepteur des livraisons webhook Granola (note.generated / note.edited / note.access_granted)",
      },
      {
        id: "webhook-info",
        method: "GET",
        path: "/webhook-info",
        description: "URL webhook publique à coller dans Granola",
      },
      {
        id: "register-webhook",
        method: "POST",
        path: "/register-webhook",
        description:
          "Enregistre cette URL comme endpoint webhook via l'API Granola et stocke le signing secret",
      },
      {
        id: "get-config",
        method: "GET",
        path: "/config",
        description: "Config du module (secrets masqués)",
      },
      {
        id: "put-config",
        method: "PUT",
        path: "/config",
        description: "Met à jour la config (clé API, signing secret, base URL publique)",
      },
      {
        id: "delete-config",
        method: "DELETE",
        path: "/config",
        description: "Supprime l'override DB (retour aux défauts marque)",
      },
      {
        id: "list-events",
        method: "GET",
        path: "/events",
        description: "Livraisons webhook reçues (dédupliquées par event_id)",
      },
      {
        id: "list-notes",
        method: "GET",
        path: "/notes",
        description: "Notes Granola synchronisées localement",
      },
      {
        id: "get-note",
        method: "GET",
        path: "/notes/:id",
        description: "Note synchronisée (payload complet)",
      },
      {
        id: "get-note-transcript",
        method: "GET",
        path: "/notes/:id/transcript",
        description:
          "Proxy GET /v1/notes/{id}/transcript (pagination curseur) — jamais d'appel Granola depuis le browser",
      },
      {
        id: "sync-note",
        method: "POST",
        path: "/notes/:id/sync",
        description: "Re-synchronise une note depuis l'API Granola",
      },
      {
        id: "remote-notes",
        method: "GET",
        path: "/remote/notes",
        description: "Proxy GET /v1/notes de l'API Granola (pagination, filtres)",
      },
      {
        id: "remote-folders",
        method: "GET",
        path: "/remote/folders",
        description: "Proxy GET /v1/folders de l'API Granola",
      },
      {
        id: "remote-webhook-endpoints",
        method: "GET",
        path: "/remote/webhook-endpoints",
        description: "Proxy GET /v1/webhook-endpoints de l'API Granola",
      },
      {
        id: "patch-remote-webhook-endpoint",
        method: "PATCH",
        path: "/remote/webhook-endpoints/:id",
        description:
          "Proxy PATCH /v1/webhook-endpoints/{id} (enabled, url, scopes, events)",
      },
      {
        id: "delete-remote-webhook-endpoint",
        method: "DELETE",
        path: "/remote/webhook-endpoints/:id",
        description: "Proxy DELETE /v1/webhook-endpoints/{id}",
      },
    ],
    handle: async ({ req, subPath, db }) => {
      if (!db) {
        return { status: 503, body: { ok: false, error: "db_unavailable" } };
      }
      const method = req.method.toUpperCase();
      const parts = subPath.split("/").filter(Boolean);
      const head = parts[0] || "";
      const cfg = mergeGranolaConfig(defaults, readOverride(db as Db));

      /* ------------------------------------------------------- webhook */
      if (head === "webhook" && parts.length === 1) {
        if (method !== "POST") {
          return {
            status: 405,
            body: { ok: false, error: "method_not_allowed" },
          };
        }
        const rawBody =
          typeof req.rawBody === "string" && req.rawBody
            ? req.rawBody
            : JSON.stringify(req.body ?? null);
        let verified = false;
        if (cfg.signingSecret) {
          const check = verifyGranolaSignature(
            req.headers ?? {},
            rawBody,
            cfg.signingSecret,
          );
          if (!check.valid) {
            return {
              status: 401,
              body: { ok: false, error: "invalid_signature", reason: check.reason },
            };
          }
          verified = true;
        }
        const payload = jsonBody(req);
        const eventId =
          typeof payload?.event_id === "string" ? payload.event_id : "";
        const eventType =
          typeof payload?.event_type === "string" ? payload.event_type : "";
        if (!payload || !eventId || !eventType) {
          return { status: 400, body: { ok: false, error: "invalid_payload" } };
        }
        const noteId =
          typeof payload.note_id === "string" ? payload.note_id : null;
        const existing = (db as Db)
          .prepare(`SELECT event_id FROM granola_events WHERE event_id = ?`)
          .get(eventId) as { event_id?: string } | undefined;
        const duplicate = Boolean(existing?.event_id);
        if (duplicate) {
          (db as Db)
            .prepare(
              `UPDATE granola_events SET deliveries = deliveries + 1 WHERE event_id = ?`,
            )
            .run(eventId);
        } else {
          (db as Db)
            .prepare(
              `INSERT INTO granola_events
                 (event_id, event_type, note_id, occurred_at, received_at, verified, deliveries, payload_json)
               VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
            )
            .run(
              eventId,
              eventType,
              noteId,
              typeof payload.occurred_at === "string" ? payload.occurred_at : null,
              nowIso(),
              verified ? 1 : 0,
              rawBody,
            );
        }
        // Sync best-effort de la note référencée (le payload ne porte
        // jamais le contenu — accès revérifié côté API au fetch).
        let synced = false;
        if (!duplicate && noteId && cfg.apiKey) {
          const p = syncNote(db as Db, cfg, noteId)
            .then((r) => {
              synced = r.status === 200;
            })
            .catch(() => {});
          if (opts?.awaitWebhookSync) await p;
        }
        return {
          status: 200,
          body: { ok: true, received: true, duplicate, verified, synced },
        };
      }

      /* -------------------------------------------------- webhook-info */
      if (head === "webhook-info" && parts.length === 1 && method === "GET") {
        const url = webhookUrlFor(cfg, req);
        return {
          status: 200,
          body: {
            ok: true,
            url,
            apiKeyConfigured: Boolean(cfg.apiKey),
            signingSecretConfigured: Boolean(cfg.signingSecret),
            webhookEndpointId: cfg.webhookEndpointId ?? null,
            instructions:
              "Collez cette URL dans Granola (Settings → Connectors → Webhooks) " +
              "ou appelez POST register-webhook pour l'enregistrer via l'API.",
          },
        };
      }

      /* ---------------------------------------------- register-webhook */
      if (head === "register-webhook" && parts.length === 1 && method === "POST") {
        const client = clientFor(cfg);
        if (!client) {
          return {
            status: 409,
            body: { ok: false, error: "granola_api_key_missing" },
          };
        }
        const url = webhookUrlFor(cfg, req);
        if (!url || !url.startsWith("https://")) {
          return {
            status: 409,
            body: {
              ok: false,
              error: "public_https_url_required",
              detail:
                "Configurer publicBaseUrl (HTTPS public) avant d'enregistrer le webhook.",
            },
          };
        }
        const body = jsonBody(req) ?? {};
        const scopes = Array.isArray(body.scopes)
          ? (body.scopes as string[]).filter((s) => typeof s === "string")
          : ["personal", "public"];
        const payload: {
          url: string;
          scopes: string[];
          events?: string[];
          folder_ids?: string[];
        } = { url, scopes };
        if (Array.isArray(body.events)) {
          payload.events = (body.events as string[]).filter(
            (s) => typeof s === "string",
          );
        }
        if (Array.isArray(body.folder_ids)) {
          payload.folder_ids = (body.folder_ids as string[]).filter(
            (s) => typeof s === "string",
          );
        }
        const res = await client.createWebhookEndpoint(payload);
        if (!res.ok || !res.body || typeof res.body !== "object") {
          return {
            status: res.status,
            body: {
              ok: false,
              error: "granola_api_error",
              status: res.status,
              detail: res.body,
            },
          };
        }
        const endpoint = res.body as Record<string, unknown>;
        const override = readOverride(db as Db) ?? {};
        let secretStored = false;
        if (typeof endpoint.signing_secret === "string") {
          override.signingSecret = endpoint.signing_secret;
          secretStored = true;
        }
        if (typeof endpoint.id === "string") {
          override.webhookEndpointId = endpoint.id;
        }
        writeOverride(db as Db, override);
        const { signing_secret: _secret, ...publicEndpoint } = endpoint;
        return {
          status: 200,
          body: { ok: true, endpoint: publicEndpoint, secretStored },
        };
      }

      /* ---------------------------------------------------------- config */
      if (head === "config" && parts.length === 1) {
        if (method === "GET") {
          const override = readOverride(db as Db);
          return {
            status: 200,
            body: {
              ok: true,
              config: {
                apiKey: maskSecret(cfg.apiKey),
                signingSecret: maskSecret(cfg.signingSecret),
                publicBaseUrl: cfg.publicBaseUrl ?? null,
                apiBaseUrl: cfg.apiBaseUrl ?? null,
                webhookEndpointId: cfg.webhookEndpointId ?? null,
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
          for (const key of GRANOLA_CONFIG_KEYS) {
            const v = body[key];
            if (typeof v === "string") {
              if (v.trim()) {
                (override as Record<string, string>)[key] = v.trim();
              } else {
                delete (override as Record<string, unknown>)[key];
              }
            }
          }
          writeOverride(db as Db, override);
          const next = mergeGranolaConfig(defaults, override);
          return {
            status: 200,
            body: {
              ok: true,
              config: {
                apiKey: maskSecret(next.apiKey),
                signingSecret: maskSecret(next.signingSecret),
                publicBaseUrl: next.publicBaseUrl ?? null,
                apiBaseUrl: next.apiBaseUrl ?? null,
                webhookEndpointId: next.webhookEndpointId ?? null,
              },
              hasOverride: true,
            },
          };
        }
        if (method === "DELETE") {
          (db as Db)
            .prepare(`DELETE FROM granola_settings WHERE key = ?`)
            .run(CONFIG_KEY);
          return { status: 200, body: { ok: true, hasOverride: false } };
        }
        return { status: 405, body: { ok: false, error: "method_not_allowed" } };
      }

      /* ---------------------------------------------------------- events */
      if (head === "events" && parts.length === 1 && method === "GET") {
        const limitRaw = Number(queryValue(req, "limit") || "50");
        const limit = Number.isFinite(limitRaw)
          ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200)
          : 50;
        const rows = (db as Db)
          .prepare(
            `SELECT event_id, event_type, note_id, occurred_at, received_at, verified, deliveries
             FROM granola_events ORDER BY received_at DESC LIMIT ?`,
          )
          .all(limit);
        return { status: 200, body: { ok: true, items: rows } };
      }

      /* ----------------------------------------------------------- notes */
      if (head === "notes") {
        if (parts.length === 1 && method === "GET") {
          const limitRaw = Number(queryValue(req, "limit") || "50");
          const limit = Number.isFinite(limitRaw)
            ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200)
            : 50;
          const rows = (db as Db)
            .prepare(
              `SELECT id, title, summary, note_created_at, note_updated_at, synced_at, folder_id
               FROM granola_notes ORDER BY synced_at DESC LIMIT ?`,
            )
            .all(limit);
          return { status: 200, body: { ok: true, items: rows } };
        }
        if (parts.length === 2 && method === "GET") {
          const row = (db as Db)
            .prepare(
              `SELECT payload_json, synced_at, folder_id, transcript_json
               FROM granola_notes WHERE id = ?`,
            )
            .get(parts[1]) as
            | {
                payload_json?: string;
                synced_at?: string;
                folder_id?: string | null;
                transcript_json?: string | null;
              }
            | undefined;
          if (!row?.payload_json) {
            return { status: 404, body: { ok: false, error: "not_found" } };
          }
          let note: unknown = null;
          try {
            note = JSON.parse(row.payload_json);
          } catch {
            note = null;
          }
          if (note && typeof note === "object" && !Array.isArray(note)) {
            const rec = note as Record<string, unknown>;
            if (rec.transcript == null && row.transcript_json) {
              try {
                rec.transcript = JSON.parse(row.transcript_json);
              } catch {
                /* payload transcript illisible — ignorer */
              }
            }
            if (rec.folder_id == null && row.folder_id) {
              rec.folder_id = row.folder_id;
            }
          }
          return {
            status: 200,
            body: { ok: true, note, syncedAt: row.synced_at ?? null },
          };
        }
        if (parts.length === 3 && parts[2] === "transcript" && method === "GET") {
          const client = clientFor(cfg);
          if (!client) {
            return {
              status: 409,
              body: { ok: false, error: "granola_api_key_missing" },
            };
          }
          const noteId = parts[1] ?? "";
          const res = await client.getTranscript(noteId, queryToObject(req));
          if (!res.ok || res.body == null) {
            return {
              status: res.status === 502 ? 502 : res.status,
              body: {
                ok: false,
                error: "granola_api_error",
                status: res.status,
                detail: res.body,
              },
            };
          }
          if (res.body && typeof res.body === "object") {
            try {
              const transcriptValue =
                typeof res.body === "object" &&
                !Array.isArray(res.body) &&
                (res.body as Record<string, unknown>).transcript != null
                  ? (res.body as Record<string, unknown>).transcript
                  : res.body;
              (db as Db)
                .prepare(
                  `UPDATE granola_notes SET transcript_json = ? WHERE id = ?`,
                )
                .run(JSON.stringify(transcriptValue), noteId);
            } catch {
              /* persist best-effort */
            }
          }
          return { status: 200, body: { ok: true, data: res.body } };
        }
        if (parts.length === 3 && parts[2] === "sync" && method === "POST") {
          return syncNote(db as Db, cfg, parts[1] ?? "");
        }
        return { status: 404, body: { ok: false, error: "not_found" } };
      }

      /* ---------------------------------------------------------- remote */
      if (head === "remote") {
        const client = clientFor(cfg);
        if (!client) {
          return {
            status: 409,
            body: { ok: false, error: "granola_api_key_missing" },
          };
        }
        const proxy = (res: {
          ok: boolean;
          status: number;
          body: unknown;
        }): ApiResponse => ({
          status: res.status,
          body: res.ok
            ? { ok: true, data: res.body }
            : {
                ok: false,
                error: "granola_api_error",
                status: res.status,
                detail: res.body,
              },
        });

        if (parts[1] === "notes") {
          const noteId = parts[2] ?? "";
          if (parts.length === 2 && method === "GET") {
            return proxy(await client.listNotes(queryToObject(req)));
          }
          if (parts.length === 3 && method === "GET") {
            const include = queryValue(req, "include");
            return proxy(
              await client.getNote(noteId, include ? { include } : undefined),
            );
          }
          if (parts.length === 4 && parts[3] === "transcript" && method === "GET") {
            return proxy(await client.getTranscript(noteId, queryToObject(req)));
          }
        }
        if (parts[1] === "folders" && parts.length === 2 && method === "GET") {
          return proxy(await client.listFolders(queryToObject(req)));
        }
        if (parts[1] === "webhook-endpoints") {
          const endpointId = parts[2] ?? "";
          const proxyEndpoints = (res: {
            ok: boolean;
            status: number;
            body: unknown;
          }): ApiResponse => {
            const next = proxy({
              ...res,
              body: stripWebhookEndpointSecrets(res.body),
            });
            return next;
          };
          if (parts.length === 2 && method === "GET") {
            return proxyEndpoints(await client.listWebhookEndpoints());
          }
          if (parts.length === 3 && method === "PATCH") {
            if (!endpointId) {
              return { status: 400, body: { ok: false, error: "invalid_id" } };
            }
            const patch = webhookEndpointPatch(jsonBody(req) ?? {});
            if (Object.keys(patch).length === 0) {
              return {
                status: 400,
                body: { ok: false, error: "invalid_body" },
              };
            }
            return proxyEndpoints(
              await client.updateWebhookEndpoint(endpointId, patch),
            );
          }
          if (parts.length === 3 && method === "DELETE") {
            if (!endpointId) {
              return { status: 400, body: { ok: false, error: "invalid_id" } };
            }
            return proxyEndpoints(
              await client.deleteWebhookEndpoint(endpointId),
            );
          }
        }
        return { status: 404, body: { ok: false, error: "not_found" } };
      }

      return { status: 404, body: { ok: false, error: "not_found" } };
    },
  };
}
