/**
 * ApiMount `platform-mails` — canal programmatique interne (modules marque).
 * v2 : réaligné sur l'outbox durable (`enqueue` / `sendDraft`) — même
 * surface (list/draft/send), plus `POST /send` direct.
 */
import type { ApiMount } from "@creezio/api-kernel";
import type { SqliteMailsStore } from "./sqlite-store.js";
import { isMailTransportConfigured } from "./transport-resolve.js";

function actorFromReq(req: {
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}): string | null {
  const h = req.headers?.["x-creezio-user-id"];
  if (typeof h === "string" && h.trim()) return h.trim();
  const body = req.body as { userId?: string } | undefined;
  if (body?.userId) return String(body.userId);
  return null;
}

export function createMailsApiMount(store: SqliteMailsStore): ApiMount {
  return {
    handle: async ({ req, subPath }) => {
      const method = req.method.toUpperCase();
      const userId = actorFromReq(req);
      if (!userId) {
        return { status: 401, body: { ok: false, error: "user_required" } };
      }

      if ((subPath === "" || subPath === "list") && method === "GET") {
        return { status: 200, body: { ok: true, mails: store.list(userId) } };
      }

      if ((subPath === "" || subPath === "draft") && method === "POST") {
        const body = (req.body || {}) as {
          to?: string | string[];
          cc?: string | string[];
          bcc?: string | string[];
          subject?: string;
          body?: string;
          text?: string;
          html?: string;
        };
        const mail = store.createDraft({
          userId,
          to: body.to,
          cc: body.cc,
          bcc: body.bcc,
          subject: String(body.subject || ""),
          text: body.text ?? body.body ?? null,
          html: body.html ?? null,
        });
        return { status: 201, body: { ok: true, mail } };
      }

      // Enqueue direct (jamais bloquant) — modules marque.
      if (subPath === "send" && method === "POST") {
        const transportGate = isMailTransportConfigured(store);
        if (!transportGate.ok) {
          return {
            status: 503,
            body: {
              ok: false,
              error: transportGate.error,
              code: transportGate.code,
            },
          };
        }
        const body = (req.body || {}) as {
          to?: string | string[];
          cc?: string | string[];
          bcc?: string | string[];
          replyTo?: string;
          subject?: string;
          text?: string;
          html?: string;
          inReplyTo?: string;
        };
        try {
          const mail = store.enqueue({
            userId,
            to: body.to || [],
            cc: body.cc,
            bcc: body.bcc,
            replyTo: body.replyTo,
            subject: String(body.subject || ""),
            text: body.text ?? null,
            html: body.html ?? null,
            inReplyTo: body.inReplyTo ?? null,
          });
          return { status: 202, body: { ok: true, mail } };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "error";
          return { status: 422, body: { ok: false, error: msg } };
        }
      }

      const sendMatch = subPath.match(/^([0-9a-f-]{36})\/send$/i);
      if (sendMatch && method === "POST") {
        const transportGate = isMailTransportConfigured(store);
        if (!transportGate.ok) {
          return {
            status: 503,
            body: {
              ok: false,
              error: transportGate.error,
              code: transportGate.code,
            },
          };
        }
        try {
          const mail = store.sendDraft(sendMatch[1]!, userId);
          return { status: 202, body: { ok: true, mail } };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "error";
          return {
            status:
              msg === "forbidden" ? 403 : msg === "not_found" ? 404 : 422,
            body: { ok: false, error: msg },
          };
        }
      }

      return { status: 404, body: { ok: false, error: "not_found" } };
    },
  };
}
