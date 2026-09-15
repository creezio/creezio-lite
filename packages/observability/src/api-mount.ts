/**
 * Mount API observabilité — /api/v1/platform/observability/...
 */

import type { ApiMount } from "@creezio/api-kernel";
import type { ObservabilityEventKind, ObservabilityStore } from "./types.js";
import { OBSERVABILITY_EVENT_KINDS } from "./types.js";

function asKind(v: unknown): ObservabilityEventKind | undefined {
  const s = String(v || "");
  return (OBSERVABILITY_EVENT_KINDS as readonly string[]).includes(s)
    ? (s as ObservabilityEventKind)
    : undefined;
}

export function createObservabilityApiMount(
  store: ObservabilityStore,
): ApiMount {
  return {
    handle: async ({ req, subPath }) => {
      const method = req.method.toUpperCase();
      const body =
        req.body && typeof req.body === "object"
          ? (req.body as Record<string, unknown>)
          : {};

      if ((subPath === "" || subPath === "events") && method === "GET") {
        const q = req.query || {};
        const orgId = q.orgId != null ? String(q.orgId) : undefined;
        const pluginId = q.pluginId != null ? String(q.pluginId) : undefined;
        const action = q.action != null ? String(q.action) : undefined;
        const since = q.since != null ? String(q.since) : undefined;
        const kind = asKind(q.kind);
        const limit = q.limit != null ? Number(q.limit) : 100;
        const events = store.list({
          kind,
          orgId,
          pluginId,
          action,
          since,
          limit,
        });
        return {
          status: 200,
          body: {
            ok: true,
            count: events.length,
            total: store.count({ kind, orgId, pluginId }),
            events,
          },
        };
      }

      if (subPath === "events" && method === "POST") {
        try {
          const kind = asKind(body.kind);
          if (!kind) {
            return {
              status: 400,
              body: { ok: false, error: "kind invalide" },
            };
          }
          const event = store.record({
            kind,
            action: String(body.action || "custom"),
            orgId: body.orgId != null ? String(body.orgId) : null,
            userId: body.userId != null ? String(body.userId) : null,
            brandId: body.brandId != null ? String(body.brandId) : null,
            pluginId: body.pluginId != null ? String(body.pluginId) : null,
            meta:
              body.meta && typeof body.meta === "object"
                ? (body.meta as Record<string, unknown>)
                : {},
          });
          return { status: 201, body: { ok: true, event } };
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

      if (subPath === "usage" && method === "GET") {
        const q = req.query || {};
        const usage = store.aggregatePluginUsage({
          orgId: q.orgId != null ? String(q.orgId) : undefined,
          since: q.since != null ? String(q.since) : undefined,
          limit: q.limit != null ? Number(q.limit) : 50,
        });
        return { status: 200, body: { ok: true, usage } };
      }

      if (subPath === "orgs" && method === "GET") {
        const q = req.query || {};
        const orgs = store.aggregateOrgActivity({
          since: q.since != null ? String(q.since) : undefined,
          limit: q.limit != null ? Number(q.limit) : 50,
        });
        return { status: 200, body: { ok: true, orgs } };
      }

      if (subPath === "summary" && method === "GET") {
        return {
          status: 200,
          body: {
            ok: true,
            summary: {
              activity: store.count({ kind: "activity" }),
              plugin_usage: store.count({ kind: "plugin_usage" }),
              control_plane: store.count({ kind: "control_plane" }),
              total: store.count(),
            },
            usage: store.aggregatePluginUsage({ limit: 20 }),
            orgs: store.aggregateOrgActivity({ limit: 20 }),
            recent: store.list({ limit: 20 }),
          },
        };
      }

      return { status: 404, body: { ok: false, error: "not_found" } };
    },
  };
}
