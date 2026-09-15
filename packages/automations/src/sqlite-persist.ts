/**
 * Persistance SQLite rules/runs automations (C4).
 */

import crypto from "node:crypto";
import {
  openNodeSqliteDatabase,
  type OpenSqliteDatabase,
} from "@creezio/platform-core";
import type { SqliteDatabase } from "@creezio/platform-core";
import { AUTOMATIONS_CORE_SQL } from "./schema.js";
import type {
  AutomationAction,
  AutomationRule,
  AutomationRunResult,
  AutomationTriggerType,
} from "./types.js";

export type AutomationPersistStore = {
  readonly dbPath: string;
  loadRules(): AutomationRule[];
  saveRule(rule: AutomationRule): void;
  deleteRule(id: string): boolean;
  appendRun(run: AutomationRunResult): void;
  listRuns(limit?: number): AutomationRunResult[];
  close(): void;
};

export type CreateSqliteAutomationPersistOptions = {
  coreDbPath: string;
  openDatabase?: OpenSqliteDatabase;
};

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowRule(r: Record<string, unknown>): AutomationRule {
  return {
    id: String(r.id),
    name: String(r.name),
    enabled: Number(r.enabled) !== 0,
    trigger: String(r.trigger) as AutomationTriggerType,
    filter: parseJson(String(r.filter_json || "{}"), undefined),
    actions: parseJson<AutomationAction[]>(String(r.actions_json || "[]"), []),
    createdAt: String(r.created_at),
  };
}

export function createSqliteAutomationPersist(
  opts: CreateSqliteAutomationPersistOptions,
): AutomationPersistStore {
  const open = opts.openDatabase || openNodeSqliteDatabase;
  const db: SqliteDatabase = open(opts.coreDbPath);
  db.exec(AUTOMATIONS_CORE_SQL);

  return {
    dbPath: opts.coreDbPath,

    loadRules() {
      const rows = db
        .prepare(
          `SELECT * FROM creezio_automation_rules ORDER BY created_at ASC`,
        )
        .all() as Record<string, unknown>[];
      return rows.map(rowRule);
    },

    saveRule(rule) {
      db.prepare(
        `INSERT INTO creezio_automation_rules
          (id, name, enabled, trigger, filter_json, actions_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           enabled = excluded.enabled,
           trigger = excluded.trigger,
           filter_json = excluded.filter_json,
           actions_json = excluded.actions_json`,
      ).run(
        rule.id,
        rule.name,
        rule.enabled ? 1 : 0,
        rule.trigger,
        JSON.stringify(rule.filter || {}),
        JSON.stringify(rule.actions || []),
        rule.createdAt,
      );
    },

    deleteRule(id) {
      const r = db
        .prepare(`DELETE FROM creezio_automation_rules WHERE id = ?`)
        .run(id) as { changes?: number };
      return Number(r.changes || 0) > 0;
    },

    appendRun(run) {
      db.prepare(
        `INSERT INTO creezio_automation_runs
          (id, rule_id, trigger, ok, actions_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        run.ruleId,
        run.trigger,
        run.ok ? 1 : 0,
        JSON.stringify(run.actions || []),
        run.at,
      );
      // garde-fou taille (~2000 runs)
      const cutoff = db
        .prepare(
          `SELECT created_at FROM creezio_automation_runs
           ORDER BY created_at DESC LIMIT 1 OFFSET 1999`,
        )
        .get() as { created_at?: string } | undefined;
      if (cutoff?.created_at) {
        db.prepare(
          `DELETE FROM creezio_automation_runs WHERE created_at < ?`,
        ).run(cutoff.created_at);
      }
    },

    listRuns(limit = 50) {
      const rows = db
        .prepare(
          `SELECT * FROM creezio_automation_runs
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(Math.min(Math.max(limit, 1), 500)) as Record<string, unknown>[];
      return rows.map((r) => ({
        ruleId: String(r.rule_id),
        trigger: String(r.trigger) as AutomationTriggerType,
        ok: Number(r.ok) !== 0,
        actions: parseJson(String(r.actions_json || "[]"), []),
        at: String(r.created_at),
      }));
    },

    close() {
      db.close?.();
    },
  };
}
