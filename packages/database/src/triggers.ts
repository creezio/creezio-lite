import type { SqliteDatabase } from "./sqlite-driver.js";
import { isSafeIdentifier, quoteIdent } from "./identifiers.js";
import { canAutomateTable } from "./whitelist.js";

function triggerName(table: string, kind: "ai" | "au" | "bd"): string {
  return `trg_db_auto_${table}_${kind}`;
}

function jsonObjectExpr(alias: "NEW" | "OLD", columns: string[]): string {
  if (!columns.length) return "'{}'";
  const parts = columns.map((col) => {
    const q = quoteIdent(col);
    // Cast BLOB en hex pour JSON valide
    return `'${col.replace(/'/g, "''")}', CASE WHEN typeof(${alias}.${q}) = 'blob' THEN hex(${alias}.${q}) ELSE ${alias}.${q} END`;
  });
  return `json_object(${parts.join(", ")})`;
}

function dropTriggers(db: SqliteDatabase, table: string): void {
  for (const kind of ["ai", "au", "bd"] as const) {
    db.exec(`DROP TRIGGER IF EXISTS ${quoteIdent(triggerName(table, kind))}`);
  }
}

/**
 * Installe / retire les triggers SQLite d'outbox pour une table
 * selon les automations actives (hors button_pressed).
 */
export function syncAutomationTriggers(db: SqliteDatabase, table: string): void {
  if (!isSafeIdentifier(table) || !canAutomateTable(table)) return;

  const active = db
    .prepare(
      `SELECT COUNT(*) AS c FROM db_automations
       WHERE table_name = ? AND enabled = 1
         AND trigger_type IN ('row_added','row_updated','row_deleted')`,
    )
    .get(table) as { c: number };

  dropTriggers(db, table);
  if (!active.c) return;

  const columns = (
    db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>
  )
    .map((c) => c.name)
    .filter((name) => isSafeIdentifier(name));

  if (!columns.length) return;

  const newJson = jsonObjectExpr("NEW", columns);
  const oldJson = jsonObjectExpr("OLD", columns);
  const t = quoteIdent(table);
  const tableLit = `'${table.replaceAll("'", "''")}'`;

  db.exec(`
CREATE TRIGGER ${quoteIdent(triggerName(table, "ai"))}
AFTER INSERT ON ${t}
BEGIN
  INSERT INTO db_automation_events (table_name, row_rowid, op, after_json, status)
  VALUES (${tableLit}, NEW.rowid, 'insert', ${newJson}, 'pending');
END;
`);

  db.exec(`
CREATE TRIGGER ${quoteIdent(triggerName(table, "au"))}
AFTER UPDATE ON ${t}
BEGIN
  INSERT INTO db_automation_events (table_name, row_rowid, op, before_json, after_json, status)
  VALUES (${tableLit}, NEW.rowid, 'update', ${oldJson}, ${newJson}, 'pending');
END;
`);

  db.exec(`
CREATE TRIGGER ${quoteIdent(triggerName(table, "bd"))}
BEFORE DELETE ON ${t}
BEGIN
  INSERT INTO db_automation_events (table_name, row_rowid, op, before_json, status)
  VALUES (${tableLit}, OLD.rowid, 'delete', ${oldJson}, 'pending');
END;
`);
}

/** Resynchronise toutes les tables ayant des automations. */
export function syncAllAutomationTriggers(db: SqliteDatabase): void {
  const tables = db
    .prepare(`SELECT DISTINCT table_name AS name FROM db_automations`)
    .all() as Array<{ name: string }>;
  for (const { name } of tables) {
    syncAutomationTriggers(db, name);
  }
}
