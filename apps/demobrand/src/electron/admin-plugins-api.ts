/**
 * Mount API Admin Plugins L3 (I5) — surface demobrand / tests.
 * Paths : /api/v1/modules/admin-plugins/...
 */

import type { ApiMount, ApiRequest } from "@creezio/api-kernel";
import {
  PLUGIN_ACL_OWNER_HEADER,
  clearPluginAclAdmin,
  getPluginAclAdmin,
  listPluginAclAdmin,
  previewPluginAclAccess,
  resolvePluginAclActorFromHeaders,
  upsertPluginAclAdmin,
  type PluginAclAdminStore,
  type PluginAclCapability,
} from "@creezio/product-hub";

function requireAdmin(req: ApiRequest): { ok: true } | { ok: false; status: number; body: unknown } {
  const actor = resolvePluginAclActorFromHeaders(req.headers || {});
  if (actor.isOwner || actor.isServiceKey) return { ok: true };
  // Sandbox : header owner explicite
  const h = req.headers?.[PLUGIN_ACL_OWNER_HEADER];
  if (h === "1" || h === "true") return { ok: true };
  return {
    ok: false,
    status: 403,
    body: { ok: false, error: "admin_required" },
  };
}

export function createAdminPluginsApiMount(
  store: PluginAclAdminStore,
): ApiMount {
  return {
    handle: async ({ req, subPath }) => {
      const method = req.method.toUpperCase();

      if ((subPath === "" || subPath === "list") && method === "GET") {
        return { status: 200, body: { ok: true, plugins: listPluginAclAdmin(store) } };
      }

      if (subPath === "preview" && method === "POST") {
        const body = (req.body || {}) as {
          pluginId?: string;
          action?: PluginAclCapability;
        };
        const actor = resolvePluginAclActorFromHeaders(req.headers || {});
        const pluginId = String(body.pluginId || "");
        const action = (body.action || "see") as PluginAclCapability;
        const decision = previewPluginAclAccess(store, pluginId, actor, action);
        return { status: 200, body: { ok: true, decision, actor, action } };
      }

      if ((subPath === "" || subPath === "upsert") && method === "POST") {
        const gate = requireAdmin(req);
        if (!gate.ok) return { status: gate.status, body: gate.body };
        try {
          const body = (req.body || {}) as {
            pluginId?: string;
            ownerOrgId?: string;
            orgIds?: string[];
            orgCapabilities?: Array<{
              orgId: string;
              capabilities: PluginAclCapability[];
            }>;
          };
          const row = upsertPluginAclAdmin(store, {
            pluginId: String(body.pluginId || ""),
            ownerOrgId: String(body.ownerOrgId || ""),
            orgIds: body.orgIds,
            orgCapabilities: body.orgCapabilities,
          });
          return { status: 200, body: { ok: true, plugin: row } };
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

      const idMatch = subPath.match(/^([a-z][a-z0-9-]{1,62})$/i);
      if (idMatch && method === "GET") {
        const row = getPluginAclAdmin(store, idMatch[1]!);
        if (!row) return { status: 404, body: { ok: false, error: "not_found" } };
        return { status: 200, body: { ok: true, plugin: row } };
      }
      if (idMatch && method === "DELETE") {
        const gate = requireAdmin(req);
        if (!gate.ok) return { status: gate.status, body: gate.body };
        const cleared = clearPluginAclAdmin(store, idMatch[1]!);
        return { status: cleared ? 200 : 404, body: { ok: cleared } };
      }

      return { status: 404, body: { ok: false, error: "not_found" } };
    },
  };
}
