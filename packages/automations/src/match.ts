import type { AutomationRule, AutomationTriggerEvent } from "./types.js";

export function ruleMatches(
  rule: AutomationRule,
  event: AutomationTriggerEvent,
): boolean {
  if (!rule.enabled) return false;
  if (rule.trigger !== event.type) return false;
  const f = rule.filter;
  if (!f) return true;
  if (f.pluginId && f.pluginId !== event.pluginId) return false;
  if (f.orgId && f.orgId !== event.orgId) return false;
  if (f.dataLayer && f.dataLayer !== event.dataLayer) return false;
  return true;
}
