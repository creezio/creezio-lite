/**
 * Mount API automations — /api/v1/platform/automations/...
 */

import type { ApiMount } from "@creezio/api-kernel";
import type { AutomationEngine } from "./engine.js";
import {
  AUTOMATION_TRIGGER_TYPES,
  type AutomationAction,
  type AutomationTriggerType,
} from "./types.js";

function asTrigger(v: unknown): AutomationTriggerType | null {
  const s = String(v || "");
  return (AUTOMATION_TRIGGER_TYPES as readonly string[]).includes(s)
    ? (s as AutomationTriggerType)
    : null;
}

export function createAutomationsApiMount(engine: AutomationEngine): ApiMount {
  return {
    handle: async ({ req, subPath }) => {
      const method = req.method.toUpperCase();
      const body =
        req.body && typeof req.body === "object"
          ? (req.body as Record<string, unknown>)
          : {};

      if ((subPath === "" || subPath === "rules") && method === "GET") {
        return {
          status: 200,
          body: { ok: true, rules: engine.listRules() },
        };
      }

      if (subPath === "rules" && method === "POST") {
        try {
          const trigger = asTrigger(body.trigger);
          if (!trigger) {
            return {
              status: 400,
              body: { ok: false, error: "trigger invalide" },
            };
          }
          const actions = Array.isArray(body.actions)
            ? (body.actions as AutomationAction[])
            : [];
          if (!actions.length) {
            return {
              status: 400,
              body: { ok: false, error: "actions requises" },
            };
          }
          const rule = engine.addRule({
            name: String(body.name || trigger),
            enabled: body.enabled !== false,
            trigger,
            filter: body.filter as AutomationRuleFilter | undefined,
            actions,
          });
          return { status: 201, body: { ok: true, rule } };
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

      if (subPath === "dispatch" && method === "POST") {
        const type = asTrigger(body.type || body.trigger);
        if (!type) {
          return {
            status: 400,
            body: { ok: false, error: "trigger invalide" },
          };
        }
        const results = await engine.dispatch({
          type,
          orgId: body.orgId != null ? String(body.orgId) : null,
          userId: body.userId != null ? String(body.userId) : null,
          brandId: body.brandId != null ? String(body.brandId) : null,
          pluginId: body.pluginId != null ? String(body.pluginId) : null,
          dataLayer: body.dataLayer as
            | "core"
            | "brand"
            | "plugin"
            | null
            | undefined,
          payload:
            body.payload && typeof body.payload === "object"
              ? (body.payload as Record<string, unknown>)
              : {},
        });
        return { status: 200, body: { ok: true, results } };
      }

      if (subPath === "runs" && method === "GET") {
        const q = req.query || {};
        const limit = q.limit != null ? Number(q.limit) : 50;
        return {
          status: 200,
          body: { ok: true, runs: engine.listRuns(limit) },
        };
      }

      const del = subPath.match(/^rules\/([A-Za-z0-9_-]{4,80})$/);
      if (del && method === "DELETE") {
        const ok = engine.removeRule(del[1]!);
        return {
          status: ok ? 200 : 404,
          body: { ok },
        };
      }

      return { status: 404, body: { ok: false, error: "not_found" } };
    },
  };
}

type AutomationRuleFilter = {
  pluginId?: string;
  orgId?: string;
  dataLayer?: "core" | "brand" | "plugin";
};
