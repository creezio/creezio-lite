/**
 * Migration one-shot brand.db → core.db (Product Hub).
 * Copie ids conservés ; pas de dual-write ensuite.
 */

import fs from "node:fs";
import {
  openNodeSqliteDatabase,
  type OpenSqliteDatabase,
  type SqliteDatabase,
} from "./sqlite-driver.js";
import type { SqliteProductHubStore } from "./sqlite-store.js";

const TABLES: Array<{ table: string; columns: string[] }> = [
  {
    table: "plugin_products",
    columns: [
      "id",
      "plugin_id",
      "name",
      "description",
      "lifecycle_state",
      "conversation_id",
      "decision",
      "archived_at",
      "created_at",
      "updated_at",
    ],
  },
  {
    table: "plugin_prd_revisions",
    columns: [
      "id",
      "plugin_product_id",
      "problem",
      "users",
      "scope",
      "out_of_scope",
      "acceptance_criteria",
      "sections_json",
      "version",
      "validated_by",
      "validated_at",
      "created_at",
    ],
  },
  {
    table: "plugin_tasks",
    columns: [
      "id",
      "plugin_product_id",
      "title",
      "body",
      "status",
      "priority",
      "hermes_task_id",
      "blocked",
      "blocked_reason",
      "cancelled_at",
      "archived_at",
      "position",
      "created_at",
      "updated_at",
    ],
  },
  {
    table: "plugin_task_dependencies",
    columns: ["task_id", "depends_on_task_id"],
  },
  {
    table: "plugin_impact_reports",
    columns: [
      "id",
      "plugin_product_id",
      "recommendation",
      "summary",
      "evidence_json",
      "created_at",
    ],
  },
  {
    table: "plugin_clarifications",
    columns: [
      "id",
      "plugin_product_id",
      "round",
      "questions_json",
      "answers_json",
      "status",
      "created_at",
      "answered_at",
    ],
  },
  {
    table: "plugin_documents",
    columns: [
      "id",
      "plugin_product_id",
      "filename",
      "media_type",
      "storage_path",
      "sha256",
      "size_bytes",
      "context_enabled",
      "created_at",
    ],
  },
  {
    table: "plugin_tickets",
    columns: [
      "id",
      "plugin_product_id",
      "title",
      "body",
      "status",
      "priority",
      "created_at",
      "updated_at",
    ],
  },
  {
    table: "plugin_changelog_entries",
    columns: [
      "id",
      "plugin_product_id",
      "version",
      "title",
      "body",
      "git_sha",
      "released_at",
    ],
  },
  {
    table: "plugin_gate_runs",
    columns: [
      "id",
      "plugin_product_id",
      "gate",
      "status",
      "details_json",
      "git_sha",
      "started_at",
      "finished_at",
    ],
  },
  {
    table: "plugin_test_definitions",
    columns: [
      "id",
      "plugin_product_id",
      "name",
      "relative_path",
      "timeout_ms",
      "enabled",
      "created_at",
    ],
  },
  {
    table: "plugin_test_runs",
    columns: [
      "id",
      "plugin_product_id",
      "definition_id",
      "status",
      "git_sha",
      "exit_code",
      "stdout",
      "stderr",
      "started_at",
      "finished_at",
    ],
  },
  {
    table: "plugin_n8n_resources",
    columns: [
      "id",
      "plugin_product_id",
      "resource_type",
      "external_id",
      "name",
      "tag",
      "metadata_json",
      "archived_at",
      "created_at",
    ],
  },
  {
    table: "plugin_execution_grants",
    columns: [
      "id",
      "plugin_product_id",
      "prd_revision_id",
      "token_hash",
      "issued_to",
      "expires_at",
      "used_at",
      "revoked_at",
      "created_at",
    ],
  },
  { table: "plugin_acl", columns: ["plugin_id", "user_id", "created_at"] },
  { table: "plugin_acl_org", columns: ["plugin_id", "org_id", "created_at"] },
  {
    table: "plugin_acl_capability",
    columns: [
      "plugin_id",
      "subject_kind",
      "subject_id",
      "capability",
      "created_at",
    ],
  },
  {
    table: "plugin_org_binding",
    columns: ["plugin_id", "owner_org_id", "created_at"],
  },
];

export type MigrateLegacyBrandProductHubOnceOptions = {
  store: SqliteProductHubStore;
  brandDbPath: string;
  /** Défaut : node:sqlite. Injecter better-sqlite3 si besoin. */
  openDatabase?: OpenSqliteDatabase;
};

/**
 * Si core est vide et brand.db a `plugin_products`, copie vers le store kit.
 * @returns true si une copie a eu lieu.
 */
export function migrateLegacyBrandProductHubOnce(
  opts: MigrateLegacyBrandProductHubOnceOptions,
): boolean {
  if (opts.store.listProducts().length > 0) return false;
  const brandPath = String(opts.brandDbPath || "").trim();
  if (!brandPath || !fs.existsSync(brandPath)) return false;

  const open = opts.openDatabase || openNodeSqliteDatabase;
  let legacy: SqliteDatabase;
  try {
    legacy = open(brandPath);
  } catch {
    return false;
  }

  const tableExists = (name: string): boolean => {
    const row = legacy
      .prepare(
        `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`,
      )
      .get(name) as { ok: number } | undefined;
    return Boolean(row);
  };

  const tableColumnSet = (name: string): Set<string> => {
    if (!tableExists(name)) return new Set();
    const rows = legacy
      .prepare(`PRAGMA table_info(${JSON.stringify(name).slice(1, -1)})`)
      .all() as Array<{ name: string }>;
    return new Set(rows.map((r) => r.name));
  };

  try {
    if (!tableExists("plugin_products")) return false;
    const productCount = legacy
      .prepare(`SELECT COUNT(*) AS c FROM plugin_products`)
      .get() as { c: number };
    if (!Number(productCount?.c)) return false;

    for (const { table, columns } of TABLES) {
      if (!tableExists(table)) continue;
      // N4 gap : brand.db peut avoir appliqué 028 sans 030 → pas de
      // `sections_json` ; ne SELECT que les colonnes réellement présentes.
      const present = tableColumnSet(table);
      const colsList = columns.filter((c) => present.has(c));
      if (!colsList.length) continue;
      const cols = colsList.join(", ");
      const rows = legacy
        .prepare(`SELECT ${cols} FROM ${table}`)
        .all() as Record<string, unknown>[];
      if (!rows.length) continue;
      const placeholders = colsList.map(() => "?").join(", ");
      const ins = opts.store.prepare(
        `INSERT OR IGNORE INTO ${table} (${cols}) VALUES (${placeholders})`,
      );
      for (const row of rows) {
        ins.run(...colsList.map((c) => row[c] ?? null));
      }
    }
    return true;
  } finally {
    legacy.close?.();
  }
}
