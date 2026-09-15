import crypto from "node:crypto";
import type {
  ObservabilityEvent,
  ObservabilityQuery,
  ObservabilityStore,
  OrgActivityAggregate,
  PluginUsageAggregate,
  RecordObservabilityEventInput,
} from "./types.js";

function now(): string {
  return new Date().toISOString();
}

function match(e: ObservabilityEvent, q?: ObservabilityQuery): boolean {
  if (!q) return true;
  if (q.kind && e.kind !== q.kind) return false;
  if (q.orgId && e.orgId !== q.orgId) return false;
  if (q.pluginId && e.pluginId !== q.pluginId) return false;
  if (q.action && e.action !== q.action) return false;
  if (q.since && e.createdAt < q.since) return false;
  if (q.until && e.createdAt > q.until) return false;
  return true;
}

export function createMemoryObservabilityStore(): ObservabilityStore {
  const events: ObservabilityEvent[] = [];

  return {
    record(input: RecordObservabilityEventInput) {
      const event: ObservabilityEvent = {
        id: input.id || crypto.randomUUID(),
        kind: input.kind,
        action: input.action,
        orgId: input.orgId ?? null,
        userId: input.userId ?? null,
        brandId: input.brandId ?? null,
        pluginId: input.pluginId ?? null,
        meta: input.meta || {},
        createdAt: input.createdAt || now(),
      };
      events.push(event);
      return event;
    },

    list(query) {
      const limit = query?.limit ?? 100;
      return events
        .filter((e) => match(e, query))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    },

    count(query) {
      return events.filter((e) => match(e, query)).length;
    },

    aggregatePluginUsage(opts) {
      const since = opts?.since;
      const orgId = opts?.orgId;
      const map = new Map<string, PluginUsageAggregate>();
      for (const e of events) {
        if (e.kind !== "plugin_usage") continue;
        if (!e.pluginId) continue;
        if (orgId && e.orgId !== orgId) continue;
        if (since && e.createdAt < since) continue;
        const key = `${e.pluginId}::${e.orgId || ""}`;
        const cur = map.get(key);
        if (!cur) {
          map.set(key, {
            pluginId: e.pluginId,
            orgId: e.orgId,
            count: 1,
            lastAt: e.createdAt,
          });
        } else {
          cur.count += 1;
          if (e.createdAt > cur.lastAt) cur.lastAt = e.createdAt;
        }
      }
      return Array.from(map.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, opts?.limit ?? 50);
    },

    aggregateOrgActivity(opts) {
      const since = opts?.since;
      const map = new Map<string, OrgActivityAggregate>();
      for (const e of events) {
        if (e.kind !== "activity") continue;
        if (!e.orgId) continue;
        if (since && e.createdAt < since) continue;
        const cur = map.get(e.orgId);
        if (!cur) {
          map.set(e.orgId, {
            orgId: e.orgId,
            count: 1,
            lastAt: e.createdAt,
          });
        } else {
          cur.count += 1;
          if (e.createdAt > cur.lastAt) cur.lastAt = e.createdAt;
        }
      }
      return Array.from(map.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, opts?.limit ?? 50);
    },
  };
}
