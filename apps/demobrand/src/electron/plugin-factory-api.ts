/**
 * Mount API fabrique plugins V1 — /api/v1/modules/plugin-factory/...
 */

import type { ApiMount, ApiRequest } from "@creezio/api-kernel";
import {
  PLUGIN_ACL_OWNER_HEADER,
  resolvePluginAclActorFromHeaders,
  type ConversationalPluginFactory,
  type PluginAclActor,
} from "@creezio/product-hub";

function requireFactoryActor(
  req: ApiRequest,
): { ok: true; actor: PluginAclActor } | { ok: false; status: number; body: unknown } {
  const actor = resolvePluginAclActorFromHeaders(req.headers || {});
  const h = req.headers?.[PLUGIN_ACL_OWNER_HEADER];
  if (h === "1" || h === "true") {
    return { ok: true, actor: { ...actor, isOwner: true } };
  }
  if (actor.isOwner || actor.isServiceKey) return { ok: true, actor };
  // Intention / lecture : org authentifiée suffit pour submit ; materialize exige owner
  return { ok: true, actor };
}

export function createPluginFactoryApiMount(
  factory: ConversationalPluginFactory,
): ApiMount {
  return {
    handle: async ({ req, subPath }) => {
      const method = req.method.toUpperCase();
      const body =
        req.body && typeof req.body === "object"
          ? (req.body as Record<string, unknown>)
          : {};

      if ((subPath === "" || subPath === "sessions") && method === "GET") {
        return {
          status: 200,
          body: { ok: true, sessions: factory.listSessions() },
        };
      }

      if (subPath === "intention" && method === "POST") {
        const gate = requireFactoryActor(req);
        if (!gate.ok) return { status: gate.status, body: gate.body };
        try {
          const session = await factory.submitIntention({
            text: String(body.text || body.intention || ""),
            name: body.name ? String(body.name) : undefined,
            pluginId: body.pluginId ? String(body.pluginId) : undefined,
            conversationId: body.conversationId
              ? String(body.conversationId)
              : undefined,
            forceClarification: Boolean(body.forceClarification),
          });
          return { status: 201, body: { ok: true, session } };
        } catch (e) {
          return {
            status: 400,
            body: {
              ok: false,
              error: e instanceof Error ? e.message : "error",
            },
          };
        }
      }

      if (subPath === "clarify" && method === "POST") {
        try {
          const session = await factory.answerClarifications({
            productId: String(body.productId || ""),
            clarificationId: String(body.clarificationId || ""),
            answers: (body.answers || {}) as Record<string, string | string[]>,
          });
          return { status: 200, body: { ok: true, session } };
        } catch (e) {
          return {
            status: 400,
            body: {
              ok: false,
              error: e instanceof Error ? e.message : "error",
            },
          };
        }
      }

      if (subPath === "approve" && method === "POST") {
        try {
          const session = factory.approvePrd({
            productId: String(body.productId || ""),
            userId: String(body.userId || "demobrand-user"),
            revisionId: body.revisionId
              ? String(body.revisionId)
              : undefined,
          });
          return { status: 200, body: { ok: true, session } };
        } catch (e) {
          return {
            status: 400,
            body: {
              ok: false,
              error: e instanceof Error ? e.message : "error",
            },
          };
        }
      }

      if (subPath === "materialize" && method === "POST") {
        const gate = requireFactoryActor(req);
        if (!gate.ok) return { status: gate.status, body: gate.body };
        if (!gate.actor.isOwner && !gate.actor.isServiceKey) {
          return {
            status: 403,
            body: { ok: false, error: "acl_install_denied" },
          };
        }
        const result = await factory.materialize({
          productId: String(body.productId || ""),
          actor: gate.actor,
          pluginId: body.pluginId ? String(body.pluginId) : undefined,
        });
        if (!result.ok) {
          return {
            status: 400,
            body: {
              ok: false,
              error: result.error,
              session: result.session,
            },
          };
        }
        return {
          status: 201,
          body: {
            ok: true,
            pluginId: result.pluginId,
            dir: result.dir,
            dbOpened: result.dbOpened,
            filesWritten: result.filesWritten,
            session: result.session,
          },
        };
      }

      if (subPath === "iterate" && method === "POST") {
        try {
          const session = await factory.iterate({
            pluginId: String(body.pluginId || ""),
            text: String(body.text || body.intention || ""),
            conversationId: body.conversationId
              ? String(body.conversationId)
              : undefined,
          });
          return { status: 201, body: { ok: true, session } };
        } catch (e) {
          return {
            status: 400,
            body: {
              ok: false,
              error: e instanceof Error ? e.message : "error",
            },
          };
        }
      }

      const idMatch = subPath.match(
        /^sessions\/([0-9a-f-]{36}|[A-Za-z0-9_-]{4,80})$/i,
      );
      if (idMatch && method === "GET") {
        const session = factory.getSession(idMatch[1]!);
        if (!session) {
          return { status: 404, body: { ok: false, error: "not_found" } };
        }
        return { status: 200, body: { ok: true, session } };
      }

      return { status: 404, body: { ok: false, error: "not_found" } };
    },
  };
}
