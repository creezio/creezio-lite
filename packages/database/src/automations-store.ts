import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "./sqlite-driver.js";
import { canAutomateTable } from "./whitelist.js";
import { parseConditions, type ConditionGroup } from "./conditions.js";
import { syncAutomationTriggers } from "./triggers.js";

export type AutomationTriggerType =
  | "row_added"
  | "row_updated"
  | "row_deleted"
  | "button_pressed";

export type WebhookAction = {
  type: "webhook";
  method?: "POST" | "PUT";
  url: string;
  headers?: Record<string, string>;
  bodyTemplate?: "row_after" | "row_before" | "event";
  secret?: string;
};

export type PluginAction = {
  type: "plugin_event";
  event: string;
};

export type N8nAction = {
  type: "n8n_webhook";
  path?: string;
  url?: string;
};

export type AutomationAction = WebhookAction | PluginAction | N8nAction;

export type Automation = {
  id: string;
  tableName: string;
  name: string;
  enabled: boolean;
  triggerType: AutomationTriggerType;
  watchColumns: string[] | null;
  conditions: ConditionGroup;
  actions: AutomationAction[];
  createdAt: string;
  updatedAt: string;
};

function mapAutomation(row: {
  id: string;
  table_name: string;
  name: string;
  enabled: number;
  trigger_type: string;
  watch_columns: string | null;
  conditions: string;
  actions: string;
  created_at: string;
  updated_at: string;
}): Automation {
  let watchColumns: string[] | null = null;
  if (row.watch_columns) {
    try {
      watchColumns = JSON.parse(row.watch_columns) as string[];
    } catch {
      watchColumns = null;
    }
  }
  let actions: AutomationAction[] = [];
  try {
    actions = JSON.parse(row.actions) as AutomationAction[];
  } catch {
    actions = [];
  }
  let conditions: ConditionGroup = { op: "and", rules: [] };
  try {
    conditions = parseConditions(JSON.parse(row.conditions));
  } catch {
    conditions = { op: "and", rules: [] };
  }
  return {
    id: row.id,
    tableName: row.table_name,
    name: row.name,
    enabled: Boolean(row.enabled),
    triggerType: row.trigger_type as AutomationTriggerType,
    watchColumns,
    conditions,
    actions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAutomations(
  db: SqliteDatabase,
  tableName?: string,
): Automation[] {
  const rows = (
    tableName
      ? db
          .prepare(
            `SELECT * FROM db_automations WHERE table_name = ? ORDER BY name COLLATE NOCASE`,
          )
          .all(tableName)
      : db
          .prepare(`SELECT * FROM db_automations ORDER BY table_name, name COLLATE NOCASE`)
          .all()
  ) as Array<Parameters<typeof mapAutomation>[0]>;
  return rows.map(mapAutomation);
}

export function getAutomation(db: SqliteDatabase, id: string): Automation | null {
  const row = db.prepare(`SELECT * FROM db_automations WHERE id = ?`).get(id) as
    | Parameters<typeof mapAutomation>[0]
    | undefined;
  return row ? mapAutomation(row) : null;
}

export function createAutomation(
  db: SqliteDatabase,
  input: {
    tableName: string;
    name: string;
    triggerType: AutomationTriggerType;
    watchColumns?: string[] | null;
    conditions?: ConditionGroup;
    actions: AutomationAction[];
    enabled?: boolean;
  },
): Automation {
  if (!canAutomateTable(input.tableName)) {
    throw new Error("Table non automatisable");
  }
  if (!input.actions?.length) throw new Error("Au moins une action est requise");
  const id = randomUUID();
  db.prepare(
    `INSERT INTO db_automations
      (id, table_name, name, enabled, trigger_type, watch_columns, conditions, actions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.tableName,
    input.name.trim() || "Automation",
    input.enabled === false ? 0 : 1,
    input.triggerType,
    input.watchColumns ? JSON.stringify(input.watchColumns) : null,
    JSON.stringify(input.conditions ?? { op: "and", rules: [] }),
    JSON.stringify(input.actions),
  );
  syncAutomationTriggers(db, input.tableName);
  return getAutomation(db, id)!;
}

export function updateAutomation(
  db: SqliteDatabase,
  id: string,
  patch: Partial<{
    name: string;
    enabled: boolean;
    triggerType: AutomationTriggerType;
    watchColumns: string[] | null;
    conditions: ConditionGroup;
    actions: AutomationAction[];
  }>,
): Automation | null {
  const current = getAutomation(db, id);
  if (!current) return null;
  db.prepare(
    `UPDATE db_automations SET
      name = ?,
      enabled = ?,
      trigger_type = ?,
      watch_columns = ?,
      conditions = ?,
      actions = ?,
      updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    patch.name?.trim() || current.name,
    patch.enabled === undefined ? (current.enabled ? 1 : 0) : patch.enabled ? 1 : 0,
    patch.triggerType || current.triggerType,
    patch.watchColumns !== undefined
      ? patch.watchColumns
        ? JSON.stringify(patch.watchColumns)
        : null
      : current.watchColumns
        ? JSON.stringify(current.watchColumns)
        : null,
    JSON.stringify(patch.conditions ?? current.conditions),
    JSON.stringify(patch.actions ?? current.actions),
    id,
  );
  syncAutomationTriggers(db, current.tableName);
  return getAutomation(db, id);
}

export function deleteAutomation(db: SqliteDatabase, id: string): boolean {
  const current = getAutomation(db, id);
  if (!current) return false;
  const ok = db.prepare(`DELETE FROM db_automations WHERE id = ?`).run(id).changes > 0;
  syncAutomationTriggers(db, current.tableName);
  return ok;
}

export function listAutomationRuns(
  db: SqliteDatabase,
  opts: { automationId?: string; limit?: number } = {},
) {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  if (opts.automationId) {
    return db
      .prepare(
        `SELECT * FROM db_automation_runs
         WHERE automation_id = ?
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(opts.automationId, limit);
  }
  return db
    .prepare(
      `SELECT * FROM db_automation_runs
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(limit);
}
