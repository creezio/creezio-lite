/**
 * Moteur automations — dispatch trigger → rules → actions.
 */

import crypto from "node:crypto";
import { pluginN8nTag } from "@creezio/product-hub";
import { ruleMatches } from "./match.js";
import type {
  AutomationAction,
  AutomationEngineAdapters,
  AutomationRule,
  AutomationRunResult,
  AutomationTriggerEvent,
} from "./types.js";

function now(): string {
  return new Date().toISOString();
}

async function runAction(
  action: AutomationAction,
  event: AutomationTriggerEvent,
  rule: AutomationRule,
  adapters: AutomationEngineAdapters,
): Promise<AutomationRunResult["actions"][number]> {
  try {
    if (action.type === "emit_observability") {
      adapters.emitObservability?.({
        action: action.action,
        orgId: event.orgId,
        userId: event.userId,
        brandId: event.brandId,
        pluginId: event.pluginId,
        meta: {
          ...(action.meta || {}),
          trigger: event.type,
          ruleId: rule.id,
          ...(event.payload || {}),
        },
      });
      return { type: "emit_observability", ok: true };
    }

    if (action.type === "log") {
      const msg =
        action.message ||
        `automation ${rule.id} on ${event.type} plugin=${event.pluginId || "-"}`;
      adapters.log?.(action.level || "info", msg, { event, ruleId: rule.id });
      return { type: "log", ok: true, detail: { message: msg } };
    }

    if (action.type === "webhook") {
      const url =
        action.url ||
        adapters.defaultWebhookUrl ||
        process.env.N8N_AUTOMATION_WEBHOOK_URL ||
        "";
      if (!url) {
        return {
          type: "webhook",
          ok: true,
          detail: { skipped: true, reason: "no_webhook_url" },
        };
      }
      if (!adapters.postWebhook) {
        return {
          type: "webhook",
          ok: true,
          detail: { skipped: true, reason: "no_postWebhook_adapter" },
        };
      }
      const res = await adapters.postWebhook(url, {
        source: "creezio-automations",
        ruleId: rule.id,
        ruleName: rule.name,
        trigger: event.type,
        orgId: event.orgId ?? null,
        pluginId: event.pluginId ?? null,
        brandId: event.brandId ?? null,
        payload: event.payload || {},
        at: event.at || now(),
      });
      return {
        type: "webhook",
        ok: res.ok,
        detail: res,
        error: res.error,
      };
    }

    if (action.type === "n8n_tag_hint") {
      const id =
        action.pluginProductId ||
        event.pluginId ||
        String(event.payload?.pluginProductId || "");
      if (!id) {
        return {
          type: "n8n_tag_hint",
          ok: false,
          error: "pluginProductId manquant",
        };
      }
      const prefix = adapters.n8nTagPrefix || "creezio-plugin:";
      const tag = pluginN8nTag(id, prefix);
      return {
        type: "n8n_tag_hint",
        ok: true,
        detail: { tag, pluginProductId: id, mode: "tag-registry" },
      };
    }

    const _exhaustive: never = action;
    void _exhaustive;
    return { type: "log", ok: false, error: "action_inconnue" };
  } catch (e) {
    return {
      type: action.type,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export type AutomationEngine = {
  addRule(
    input: Omit<AutomationRule, "id" | "createdAt"> & {
      id?: string;
      createdAt?: string;
    },
  ): AutomationRule;
  removeRule(id: string): boolean;
  listRules(): AutomationRule[];
  getRule(id: string): AutomationRule | undefined;
  dispatch(event: AutomationTriggerEvent): Promise<AutomationRunResult[]>;
  /** Historique des runs (mémoire, borné). */
  listRuns(limit?: number): AutomationRunResult[];
};

export function createAutomationEngine(
  adapters: AutomationEngineAdapters = {},
): AutomationEngine {
  const persist = adapters.persist;
  const rules: AutomationRule[] = persist ? persist.loadRules() : [];
  const runs: AutomationRunResult[] = [];

  return {
    addRule(input) {
      const existingIdx = input.id
        ? rules.findIndex((r) => r.id === input.id)
        : -1;
      const rule: AutomationRule = {
        id: input.id || crypto.randomUUID(),
        name: input.name,
        enabled: input.enabled !== false,
        trigger: input.trigger,
        filter: input.filter,
        actions: input.actions,
        createdAt:
          existingIdx >= 0
            ? rules[existingIdx]!.createdAt
            : input.createdAt || now(),
      };
      if (existingIdx >= 0) rules[existingIdx] = rule;
      else rules.push(rule);
      persist?.saveRule(rule);
      return rule;
    },

    removeRule(id) {
      const idx = rules.findIndex((r) => r.id === id);
      if (idx < 0) return false;
      rules.splice(idx, 1);
      persist?.deleteRule(id);
      return true;
    },

    listRules() {
      return [...rules];
    },

    getRule(id) {
      return rules.find((r) => r.id === id);
    },

    async dispatch(event) {
      const at = event.at || now();
      const ev = { ...event, at };
      const matched = rules.filter((r) => ruleMatches(r, ev));
      const results: AutomationRunResult[] = [];
      for (const rule of matched) {
        const actions: AutomationRunResult["actions"] = [];
        for (const action of rule.actions) {
          actions.push(await runAction(action, ev, rule, adapters));
        }
        const result: AutomationRunResult = {
          ruleId: rule.id,
          trigger: ev.type,
          ok: actions.every((a) => a.ok),
          actions,
          at,
        };
        results.push(result);
        runs.push(result);
        if (runs.length > 500) runs.shift();
        persist?.appendRun(result);
      }
      return results;
    },

    listRuns(limit = 50) {
      if (persist) return persist.listRuns(limit);
      return runs.slice(-limit).reverse();
    },
  };
}

/** Règles demobrand / sandbox par défaut. */
export function defaultDemobrandAutomationRules(): Array<
  Omit<AutomationRule, "id" | "createdAt">
> {
  return [
    {
      name: "Obs — plugin installé",
      enabled: true,
      trigger: "plugin.installed",
      actions: [
        { type: "emit_observability", action: "automation.plugin_installed" },
        { type: "n8n_tag_hint" },
        { type: "log", message: "plugin installed → automation" },
      ],
    },
    {
      name: "Obs — données plugin changées",
      enabled: true,
      trigger: "org.data_changed",
      filter: { dataLayer: "plugin" },
      actions: [
        {
          type: "emit_observability",
          action: "automation.data_changed",
        },
        { type: "webhook" },
      ],
    },
    {
      name: "Obs — factory matérialisée",
      enabled: true,
      trigger: "factory.materialized",
      actions: [
        {
          type: "emit_observability",
          action: "automation.factory_materialized",
        },
        { type: "n8n_tag_hint" },
      ],
    },
  ];
}
