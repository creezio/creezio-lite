import crypto from "node:crypto";
import { OBSERVABILITY_CORE_SQL } from "./schema.js";
import {
  openNodeSqliteDatabase,
  type OpenSqliteDatabase,
  type SqliteDatabase,
} from "./sqlite-driver.js";
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

function rowEvent(r: Record<string, unknown>): ObservabilityEvent {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(String(r.meta_json || "{}")) as Record<string, unknown>;
  } catch {
    meta = {};
  }
  return {
    id: String(r.id),
    kind: String(r.kind) as ObservabilityEvent["kind"],
    action: String(r.action),
    orgId: r.org_id == null ? null : String(r.org_id),
    userId: r.user_id == null ? null : String(r.user_id),
    brandId: r.brand_id == null ? null : String(r.brand_id),
    pluginId: r.plugin_id == null ? null : String(r.plugin_id),
    meta,
    createdAt: String(r.created_at),
  };
}

export type SqliteObservabilityStore = ObservabilityStore & {
  close(): void;
  readonly dbPath: string;
};

export type CreateSqliteObservabilityStoreOptions = {
  coreDbPath: string;
  openDatabase?: OpenSqliteDatabase;
};

export function createSqliteObservabilityStore(
  opts: CreateSqliteObservabilityStoreOptions,
): SqliteObservabilityStore {
  const open = opts.openDatabase || openNodeSqliteDatabase;
  const db: SqliteDatabase = open(opts.coreDbPath);
  db.exec(OBSERVABILITY_CORE_SQL);

  const store: SqliteObservabilityStore = {
    dbPath: opts.coreDbPath,

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
      db.prepare(
        `INSERT INTO creezio_obs_events
          (id, kind, action, org_id, user_id, brand_id, plugin_id, meta_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        event.id,
        event.kind,
        event.action,
        event.orgId,
        event.userId,
        event.brandId,
        event.pluginId,
        JSON.stringify(event.meta),
        event.createdAt,
      );
      return event;
    },

    list(query) {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (query?.kind) {
        clauses.push("kind = ?");
        params.push(query.kind);
      }
      if (query?.orgId) {
        clauses.push("org_id = ?");
        params.push(query.orgId);
      }
      if (query?.pluginId) {
        clauses.push("plugin_id = ?");
        params.push(query.pluginId);
      }
      if (query?.action) {
        clauses.push("action = ?");
        params.push(query.action);
      }
      if (query?.since) {
        clauses.push("created_at >= ?");
        params.push(query.since);
      }
      if (query?.until) {
        clauses.push("created_at <= ?");
        params.push(query.until);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const limit = query?.limit ?? 100;
      params.push(limit);
      const rows = db
        .prepare(
          `SELECT * FROM creezio_obs_events ${where}
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(...params) as Array<Record<string, unknown>>;
      return rows.map(rowEvent);
    },

    count(query) {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (query?.kind) {
        clauses.push("kind = ?");
        params.push(query.kind);
      }
      if (query?.orgId) {
        clauses.push("org_id = ?");
        params.push(query.orgId);
      }
      if (query?.pluginId) {
        clauses.push("plugin_id = ?");
        params.push(query.pluginId);
      }
      if (query?.action) {
        clauses.push("action = ?");
        params.push(query.action);
      }
      if (query?.since) {
        clauses.push("created_at >= ?");
        params.push(query.since);
      }
      if (query?.until) {
        clauses.push("created_at <= ?");
        params.push(query.until);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const row = db
        .prepare(`SELECT COUNT(*) AS c FROM creezio_obs_events ${where}`)
        .get(...params) as { c: number };
      return Number(row?.c || 0);
    },

    aggregatePluginUsage(opts) {
      const clauses = [`kind = 'plugin_usage'`, `plugin_id IS NOT NULL`];
      const params: unknown[] = [];
      if (opts?.orgId) {
        clauses.push("org_id = ?");
        params.push(opts.orgId);
      }
      if (opts?.since) {
        clauses.push("created_at >= ?");
        params.push(opts.since);
      }
      const limit = opts?.limit ?? 50;
      params.push(limit);
      const rows = db
        .prepare(
          `SELECT plugin_id, org_id, COUNT(*) AS c, MAX(created_at) AS last_at
           FROM creezio_obs_events
           WHERE ${clauses.join(" AND ")}
           GROUP BY plugin_id, org_id
           ORDER BY c DESC
           LIMIT ?`,
        )
        .all(...params) as Array<Record<string, unknown>>;
      return rows.map(
        (r): PluginUsageAggregate => ({
          pluginId: String(r.plugin_id),
          orgId: r.org_id == null ? null : String(r.org_id),
          count: Number(r.c),
          lastAt: String(r.last_at),
        }),
      );
    },

    aggregateOrgActivity(opts) {
      const clauses = [`kind = 'activity'`, `org_id IS NOT NULL`];
      const params: unknown[] = [];
      if (opts?.since) {
        clauses.push("created_at >= ?");
        params.push(opts.since);
      }
      const limit = opts?.limit ?? 50;
      params.push(limit);
      const rows = db
        .prepare(
          `SELECT org_id, COUNT(*) AS c, MAX(created_at) AS last_at
           FROM creezio_obs_events
           WHERE ${clauses.join(" AND ")}
           GROUP BY org_id
           ORDER BY c DESC
           LIMIT ?`,
        )
        .all(...params) as Array<Record<string, unknown>>;
      return rows.map(
        (r): OrgActivityAggregate => ({
          orgId: String(r.org_id),
          count: Number(r.c),
          lastAt: String(r.last_at),
        }),
      );
    },

    close() {
      db.close?.();
    },
  };

  return store;
}
