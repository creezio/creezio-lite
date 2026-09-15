/**
 * Store Product Hub persisté dans sqlite **core** (Phase H1.8).
 */

import crypto from "node:crypto";
import {
  PRODUCT_HUB_ACL_H5_SQL,
  PRODUCT_HUB_ACL_ORG_SQL,
  PRODUCT_HUB_ACL_USER_SQL,
  PRODUCT_HUB_CORE_SQL,
  PRODUCT_HUB_RUNTIME_SQL,
} from "../schema-sql.js";
import {
  assertPluginLifecycleTransition,
  PLUGIN_TASK_STATUSES,
  type PluginLifecycleState,
  type PluginTaskStatus,
} from "../lifecycle.js";
import {
  missingPrdCoreFields,
  missingPrdSections,
  type PluginPrdSections,
} from "../prd.js";
import { assertClarificationQuestions } from "../clarifications.js";
import type { PluginImpactReport } from "../impact.js";
import type { PluginClarificationQuestion } from "../clarifications.js";
import type {
  PluginClarificationRecord,
  PluginImpactReportRecord,
  PluginPrdRevisionRecord,
  PluginProductRecord,
  PluginTaskRecord,
  ProductHubStore,
} from "./types.js";
import {
  openNodeSqliteDatabase,
  type OpenSqliteDatabase,
  type SqliteDatabase,
  type SqliteStatement,
} from "./sqlite-driver.js";
import {
  aclEntryToPolicy,
  type PluginAclCapability,
  type PluginAclCapabilityGrant,
  type PluginAclEntry,
  type PluginAclPolicy,
} from "../acl.js";

function id(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

export type SqliteProductHubStore = ProductHubStore & {
  /** Persistance ACL L3/L4 (+ H5 caps / binding) dans core. */
  upsertAcl(entry: PluginAclEntry): void;
  getAcl(pluginId: string): PluginAclEntry;
  listAcl(): PluginAclEntry[];
  /** Binding org propriétaire (install). */
  bindPluginOrg(pluginId: string, ownerOrgId: string): void;
  getPluginOwnerOrg(pluginId: string): string | null;
  clearAcl(pluginId: string): void;
  /** Policy prête pour decidePluginAccess. */
  getAclPolicy(pluginId: string): PluginAclPolicy;
  listAclPolicies(): PluginAclPolicy[];
  /** SQL runtime (documents, tests, n8n…) — même connexion core.db. */
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  archiveProduct(productId: string): PluginProductRecord;
  deleteProduct(productId: string): void;
  close(): void;
  readonly dbPath: string;
};

export type CreateSqliteProductHubStoreOptions = {
  /** Chemin sqlite core (`resolveCoreDbPath`). */
  coreDbPath: string;
  conversationPrefix?: string;
  /** Injecteur DB (better-sqlite3) ; défaut = node:sqlite. */
  openDatabase?: OpenSqliteDatabase;
};

function rowProduct(r: Record<string, unknown>): PluginProductRecord {
  return {
    id: String(r.id),
    plugin_id: r.plugin_id == null ? null : String(r.plugin_id),
    name: String(r.name),
    description: String(r.description ?? ""),
    lifecycle_state: r.lifecycle_state as PluginLifecycleState,
    conversation_id: String(r.conversation_id),
    decision:
      r.decision == null ? null : (r.decision as "create" | "evolve"),
    archived_at: r.archived_at == null ? null : String(r.archived_at),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export function createSqliteProductHubStore(
  opts: CreateSqliteProductHubStoreOptions,
): SqliteProductHubStore {
  const open = opts.openDatabase || openNodeSqliteDatabase;
  const db: SqliteDatabase = open(opts.coreDbPath);
  const prefix = opts.conversationPrefix || "crm";

  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(PRODUCT_HUB_CORE_SQL);
  db.exec(PRODUCT_HUB_RUNTIME_SQL);
  db.exec(PRODUCT_HUB_ACL_USER_SQL);
  db.exec(PRODUCT_HUB_ACL_ORG_SQL);
  db.exec(PRODUCT_HUB_ACL_H5_SQL);

  function recordDeliveryChangelog(product: PluginProductRecord): void {
    const version = new Date().toISOString().slice(0, 10);
    const delivered = db
      .prepare(
        `SELECT title FROM plugin_tasks WHERE plugin_product_id = ? AND status = 'done'
         ORDER BY updated_at`,
      )
      .all(product.id) as Array<{ title: string }>;
    db.prepare(
      `INSERT INTO plugin_changelog_entries
       (id, plugin_product_id, version, title, body, git_sha)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run(
      id(),
      product.id,
      version,
      `Livraison ${version} — en attente de validation`,
      delivered.length
        ? delivered.map((task) => `- ${task.title}`).join("\n")
        : "- Module livré, tests automatiques passés",
    );
  }

  const store: SqliteProductHubStore = {
    dbPath: opts.coreDbPath,

    prepare(sql) {
      return db.prepare(sql);
    },

    exec(sql) {
      db.exec(sql);
    },

    close() {
      db.close?.();
    },

    createRequest(input) {
      const productId = id();
      const conversationId = input.conversationId || `${prefix}-${id()}`;
      const ts = now();
      db.prepare(
        `INSERT INTO plugin_products
        (id, plugin_id, name, description, lifecycle_state, conversation_id, decision, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'impact_analysis', ?, ?, NULL, ?, ?)`,
      ).run(
        productId,
        input.impact.candidatePluginId ?? null,
        input.name,
        input.description || "",
        conversationId,
        input.impact.recommendation,
        ts,
        ts,
      );
      const reportId = id();
      db.prepare(
        `INSERT INTO plugin_impact_reports
        (id, plugin_product_id, recommendation, summary, evidence_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        reportId,
        productId,
        input.impact.recommendation,
        input.impact.summary,
        JSON.stringify(input.impact.evidence),
        ts,
      );
      const product = store.getProduct(productId)!;
      const impactReport: PluginImpactReportRecord = {
        id: reportId,
        plugin_product_id: productId,
        recommendation: input.impact.recommendation,
        summary: input.impact.summary,
        evidence_json: JSON.stringify(input.impact.evidence),
        created_at: ts,
      };
      return { product, impactReport };
    },

    listProducts() {
      const rows = db
        .prepare(
          `SELECT * FROM plugin_products ORDER BY updated_at DESC`,
        )
        .all() as Record<string, unknown>[];
      return rows.map(rowProduct);
    },

    getProduct(productId) {
      const r = db
        .prepare(`SELECT * FROM plugin_products WHERE id = ?`)
        .get(productId) as Record<string, unknown> | undefined;
      return r ? rowProduct(r) : undefined;
    },

    transition(productId, next) {
      const product = store.getProduct(productId);
      if (!product) throw new Error("Produit plugin introuvable");
      assertPluginLifecycleTransition(product.lifecycle_state, next);
      const ts = now();
      db.prepare(
        `UPDATE plugin_products SET lifecycle_state = ?, updated_at = ? WHERE id = ?`,
      ).run(next, ts, productId);
      const updated = store.getProduct(productId)!;
      if (next === "awaiting_human_qa") {
        try {
          recordDeliveryChangelog(updated);
        } catch {
          /* changelog best-effort — ne bloque jamais la transition */
        }
      }
      return updated;
    },

    savePrd(input) {
      const product = store.getProduct(input.productId);
      if (!product) throw new Error("Produit plugin introuvable");
      const versionRow = db
        .prepare(
          `SELECT COALESCE(MAX(version), 0) AS v FROM plugin_prd_revisions WHERE plugin_product_id = ?`,
        )
        .get(input.productId) as { v: number };
      const version = Number(versionRow?.v || 0) + 1;
      const revisionId = id();
      const ts = now();
      db.prepare(
        `INSERT INTO plugin_prd_revisions
        (id, plugin_product_id, problem, users, scope, out_of_scope, acceptance_criteria, sections_json, version, validated_by, validated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      ).run(
        revisionId,
        input.productId,
        input.problem,
        input.users,
        input.scope,
        input.outOfScope || "",
        input.acceptanceCriteria,
        JSON.stringify(input.sections || {}),
        version,
        ts,
      );
      const state = store.getProduct(input.productId)!.lifecycle_state;
      const advance: PluginLifecycleState[] = [];
      if (state === "impact_analysis" || state === "clarification_required") {
        advance.push("prd_draft", "awaiting_prd_approval");
      } else if (state === "prd_draft") {
        advance.push("awaiting_prd_approval");
      }
      for (const next of advance) {
        try {
          store.transition(input.productId, next);
        } catch {
          break;
        }
      }
      return store.listPrdRevisions(input.productId).find((r) => r.id === revisionId)!;
    },

    validatePrd(input) {
      const list = store.listPrdRevisions(input.productId);
      const revision = list.find((r) => r.id === input.revisionId);
      if (!revision) throw new Error("Révision PRD introuvable");
      const core = missingPrdCoreFields(revision);
      if (core.length) {
        throw new Error(
          `PRD incomplet : problème, périmètre et critères requis (${core.join(", ")})`,
        );
      }
      const missing = missingPrdSections(revision.sections_json);
      if (missing.length) {
        throw new Error(
          `PRD incomplet : sections manquantes (${missing.join(", ")})`,
        );
      }
      const ts = now();
      db.prepare(
        `UPDATE plugin_prd_revisions SET validated_by = ?, validated_at = ? WHERE id = ?`,
      ).run(input.userId, ts, input.revisionId);
      const product = store.getProduct(input.productId);
      if (product?.lifecycle_state === "awaiting_prd_approval") {
        store.transition(input.productId, "planning");
      }
      let sections: Partial<PluginPrdSections> = {};
      try {
        sections = JSON.parse(revision.sections_json) as Partial<PluginPrdSections>;
      } catch {
        sections = {};
      }
      const stories = Array.isArray(sections.user_stories)
        ? sections.user_stories.map((s) => String(s).trim()).filter(Boolean)
        : [];
      const existing = new Set(
        store.listTasks(input.productId).map((t) => t.title),
      );
      for (const story of stories) {
        const title = story.slice(0, 300);
        if (existing.has(title)) continue;
        store.createTask({
          productId: input.productId,
          title,
          body: story,
          status: "ready",
        });
        existing.add(title);
      }
      return store.listPrdRevisions(input.productId).find((r) => r.id === input.revisionId)!;
    },

    listPrdRevisions(productId) {
      const rows = db
        .prepare(
          `SELECT * FROM plugin_prd_revisions WHERE plugin_product_id = ? ORDER BY version DESC`,
        )
        .all(productId) as Record<string, unknown>[];
      return rows.map((r) => ({
        id: String(r.id),
        plugin_product_id: String(r.plugin_product_id),
        problem: String(r.problem ?? ""),
        users: String(r.users ?? ""),
        scope: String(r.scope ?? ""),
        out_of_scope: String(r.out_of_scope ?? ""),
        acceptance_criteria: String(r.acceptance_criteria ?? ""),
        sections_json: String(r.sections_json ?? "{}"),
        version: Number(r.version),
        validated_by: r.validated_by == null ? null : String(r.validated_by),
        validated_at: r.validated_at == null ? null : String(r.validated_at),
        created_at: String(r.created_at),
      })) satisfies PluginPrdRevisionRecord[];
    },

    createClarification(input) {
      if (!store.getProduct(input.productId)) {
        throw new Error("Produit plugin introuvable");
      }
      assertClarificationQuestions(input.questions);
      const roundRow = db
        .prepare(
          `SELECT COALESCE(MAX(round), 0) AS r FROM plugin_clarifications WHERE plugin_product_id = ?`,
        )
        .get(input.productId) as { r: number };
      const round = Number(roundRow?.r || 0) + 1;
      const rowId = id();
      const ts = now();
      db.prepare(
        `INSERT INTO plugin_clarifications
        (id, plugin_product_id, round, questions_json, answers_json, status, created_at, answered_at)
        VALUES (?, ?, ?, ?, NULL, 'open', ?, NULL)`,
      ).run(rowId, input.productId, round, JSON.stringify(input.questions), ts);
      try {
        store.transition(input.productId, "clarification_required");
      } catch {
        /* */
      }
      return store.listClarifications(input.productId).find((c) => c.id === rowId)!;
    },

    answerClarification(input) {
      const list = store.listClarifications(input.productId);
      const row = list.find((c) => c.id === input.clarificationId);
      if (!row) throw new Error("Round de questions introuvable");
      if (row.status === "answered") throw new Error("Round déjà répondu");
      const ts = now();
      db.prepare(
        `UPDATE plugin_clarifications SET answers_json = ?, status = 'answered', answered_at = ? WHERE id = ?`,
      ).run(JSON.stringify(input.answers), ts, input.clarificationId);
      return store.listClarifications(input.productId).find((c) => c.id === input.clarificationId)!;
    },

    listClarifications(productId) {
      const rows = db
        .prepare(
          `SELECT * FROM plugin_clarifications WHERE plugin_product_id = ? ORDER BY round ASC`,
        )
        .all(productId) as Record<string, unknown>[];
      return rows.map(
        (r) =>
          ({
            id: String(r.id),
            plugin_product_id: String(r.plugin_product_id),
            round: Number(r.round),
            questions_json: String(r.questions_json ?? "[]"),
            answers_json: r.answers_json == null ? null : String(r.answers_json),
            status: r.status as "open" | "answered",
            created_at: String(r.created_at),
            answered_at: r.answered_at == null ? null : String(r.answered_at),
          }) satisfies PluginClarificationRecord,
      );
    },

    createTask(input) {
      if (!store.getProduct(input.productId)) {
        throw new Error("Produit plugin introuvable");
      }
      const posRow = db
        .prepare(
          `SELECT COALESCE(MAX(position), -1) AS p FROM plugin_tasks WHERE plugin_product_id = ?`,
        )
        .get(input.productId) as { p: number };
      const position = Number(posRow?.p ?? -1) + 1;
      const ts = now();
      const taskId = id();
      db.prepare(
        `INSERT INTO plugin_tasks
        (id, plugin_product_id, title, body, status, priority, hermes_task_id, blocked, blocked_reason, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?, ?, ?)`,
      ).run(
        taskId,
        input.productId,
        input.title,
        input.body || "",
        (input.status || "backlog") as PluginTaskStatus,
        input.priority || 0,
        position,
        ts,
        ts,
      );
      return store.listTasks(input.productId).find((t) => t.id === taskId)!;
    },

    updateTask(productId, taskId, patch) {
      const current = store.listTasks(productId).find((t) => t.id === taskId);
      if (!current) throw new Error("Tâche plugin introuvable");
      const status = patch.status || current.status;
      if (!PLUGIN_TASK_STATUSES.includes(status)) {
        throw new Error("Statut de tâche invalide");
      }
      const ts = now();
      db.prepare(
        `UPDATE plugin_tasks SET status = ?, blocked = ?, blocked_reason = ?,
         hermes_task_id = COALESCE(?, hermes_task_id), updated_at = ? WHERE id = ?`,
      ).run(
        status,
        patch.blocked == null ? current.blocked : patch.blocked ? 1 : 0,
        patch.blockedReason === undefined
          ? current.blocked_reason
          : patch.blockedReason,
        patch.hermesTaskId ?? null,
        ts,
        taskId,
      );
      return store.listTasks(productId).find((t) => t.id === taskId)!;
    },

    countDoneTasks(productId) {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS c FROM plugin_tasks
           WHERE plugin_product_id = ? AND status = 'done'`,
        )
        .get(productId) as { c: number };
      return Number(row?.c || 0);
    },

    hasPassedTestRun(productId) {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS c FROM plugin_test_runs
           WHERE plugin_product_id = ? AND status = 'passed'`,
        )
        .get(productId) as { c: number };
      return Number(row?.c || 0) > 0;
    },

    archiveProduct(productId) {
      if (!store.getProduct(productId)) {
        throw new Error("Produit plugin introuvable");
      }
      const ts = now();
      db.prepare(
        `UPDATE plugin_products SET archived_at = ?, updated_at = ? WHERE id = ?`,
      ).run(ts, ts, productId);
      return store.getProduct(productId)!;
    },

    deleteProduct(productId) {
      db.prepare(`DELETE FROM plugin_products WHERE id = ?`).run(productId);
    },

    listTasks(productId) {
      const rows = db
        .prepare(
          `SELECT * FROM plugin_tasks WHERE plugin_product_id = ? ORDER BY position ASC`,
        )
        .all(productId) as Record<string, unknown>[];
      return rows.map(
        (r) =>
          ({
            id: String(r.id),
            plugin_product_id: String(r.plugin_product_id),
            title: String(r.title),
            body: String(r.body ?? ""),
            status: r.status as PluginTaskStatus,
            priority: Number(r.priority || 0),
            hermes_task_id:
              r.hermes_task_id == null ? null : String(r.hermes_task_id),
            blocked: Number(r.blocked || 0),
            blocked_reason:
              r.blocked_reason == null ? null : String(r.blocked_reason),
            position: Number(r.position || 0),
            created_at: String(r.created_at),
            updated_at: String(r.updated_at),
          }) satisfies PluginTaskRecord,
      );
    },

    linkRuntime(productId, pluginId) {
      if (!store.getProduct(productId)) throw new Error("Produit plugin introuvable");
      const ts = now();
      db.prepare(
        `UPDATE plugin_products SET plugin_id = ?, updated_at = ? WHERE id = ?`,
      ).run(pluginId, ts, productId);
      return store.getProduct(productId)!;
    },

    productDetails(productId) {
      const product = store.getProduct(productId);
      if (!product) return undefined;
      const impactRows = db
        .prepare(
          `SELECT * FROM plugin_impact_reports WHERE plugin_product_id = ? ORDER BY created_at DESC`,
        )
        .all(productId) as Record<string, unknown>[];
      const all = (table: string, order = "created_at DESC") =>
        db
          .prepare(
            `SELECT * FROM ${table} WHERE plugin_product_id = ? ORDER BY ${order}`,
          )
          .all(productId) as Record<string, unknown>[];
      return {
        product,
        prdRevisions: store.listPrdRevisions(productId),
        tasks: store.listTasks(productId),
        impactReports: impactRows.map(
          (r) =>
            ({
              id: String(r.id),
              plugin_product_id: String(r.plugin_product_id),
              recommendation: r.recommendation as "create" | "evolve",
              summary: String(r.summary),
              evidence_json: String(r.evidence_json ?? "[]"),
              created_at: String(r.created_at),
            }) satisfies PluginImpactReportRecord,
        ),
        clarifications: store.listClarifications(productId),
        documents: all("plugin_documents"),
        tickets: all("plugin_tickets"),
        tests: all("plugin_test_runs", "started_at DESC"),
        n8nResources: all("plugin_n8n_resources"),
        changelog: all("plugin_changelog_entries", "released_at DESC"),
        gates: all("plugin_gate_runs", "started_at DESC"),
      };
    },

    upsertAcl(entry) {
      db.prepare(`DELETE FROM plugin_acl WHERE plugin_id = ?`).run(entry.pluginId);
      db.prepare(`DELETE FROM plugin_acl_org WHERE plugin_id = ?`).run(
        entry.pluginId,
      );
      db.prepare(`DELETE FROM plugin_acl_capability WHERE plugin_id = ?`).run(
        entry.pluginId,
      );
      const ts = now();
      for (const userId of entry.userIds) {
        db.prepare(
          `INSERT INTO plugin_acl (plugin_id, user_id, created_at) VALUES (?, ?, ?)`,
        ).run(entry.pluginId, userId, ts);
      }
      for (const orgId of entry.orgIds) {
        db.prepare(
          `INSERT INTO plugin_acl_org (plugin_id, org_id, created_at) VALUES (?, ?, ?)`,
        ).run(entry.pluginId, orgId, ts);
      }
      for (const g of entry.capabilities || []) {
        db.prepare(
          `INSERT INTO plugin_acl_capability
            (plugin_id, subject_kind, subject_id, capability, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(entry.pluginId, g.subjectKind, g.subjectId, g.capability, ts);
      }
      if (entry.ownerOrgId) {
        store.bindPluginOrg(entry.pluginId, entry.ownerOrgId);
      }
    },

    bindPluginOrg(pluginId, ownerOrgId) {
      const ts = now();
      db.prepare(
        `INSERT INTO plugin_org_binding (plugin_id, owner_org_id, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(plugin_id) DO UPDATE SET owner_org_id = excluded.owner_org_id`,
      ).run(pluginId, ownerOrgId, ts);
    },

    getPluginOwnerOrg(pluginId) {
      const row = db
        .prepare(
          `SELECT owner_org_id FROM plugin_org_binding WHERE plugin_id = ?`,
        )
        .get(pluginId) as { owner_org_id: string } | undefined;
      return row ? String(row.owner_org_id) : null;
    },

    clearAcl(pluginId) {
      db.prepare(`DELETE FROM plugin_acl WHERE plugin_id = ?`).run(pluginId);
      db.prepare(`DELETE FROM plugin_acl_org WHERE plugin_id = ?`).run(pluginId);
      db.prepare(`DELETE FROM plugin_acl_capability WHERE plugin_id = ?`).run(
        pluginId,
      );
      db.prepare(`DELETE FROM plugin_org_binding WHERE plugin_id = ?`).run(
        pluginId,
      );
    },

    getAcl(pluginId) {
      const users = db
        .prepare(`SELECT user_id FROM plugin_acl WHERE plugin_id = ?`)
        .all(pluginId) as Array<{ user_id: string }>;
      const orgs = db
        .prepare(`SELECT org_id FROM plugin_acl_org WHERE plugin_id = ?`)
        .all(pluginId) as Array<{ org_id: string }>;
      const caps = db
        .prepare(
          `SELECT subject_kind, subject_id, capability
           FROM plugin_acl_capability WHERE plugin_id = ?`,
        )
        .all(pluginId) as Array<{
        subject_kind: string;
        subject_id: string;
        capability: string;
      }>;
      const capabilities: PluginAclCapabilityGrant[] = caps.map((c) => ({
        subjectKind: c.subject_kind as "org" | "user",
        subjectId: String(c.subject_id),
        capability: c.capability as PluginAclCapability,
      }));
      return {
        pluginId,
        userIds: users.map((u) => String(u.user_id)),
        orgIds: orgs.map((o) => String(o.org_id)),
        ownerOrgId: store.getPluginOwnerOrg(pluginId),
        ...(capabilities.length > 0 ? { capabilities } : {}),
      };
    },

    getAclPolicy(pluginId) {
      return aclEntryToPolicy(store.getAcl(pluginId));
    },

    listAclPolicies() {
      return store.listAcl().map(aclEntryToPolicy);
    },

    listAcl() {
      const pluginIds = new Set<string>();
      for (const r of db.prepare(`SELECT DISTINCT plugin_id FROM plugin_acl`).all() as Array<{
        plugin_id: string;
      }>) {
        pluginIds.add(String(r.plugin_id));
      }
      for (const r of db
        .prepare(`SELECT DISTINCT plugin_id FROM plugin_acl_org`)
        .all() as Array<{ plugin_id: string }>) {
        pluginIds.add(String(r.plugin_id));
      }
      for (const r of db
        .prepare(`SELECT DISTINCT plugin_id FROM plugin_org_binding`)
        .all() as Array<{ plugin_id: string }>) {
        pluginIds.add(String(r.plugin_id));
      }
      return [...pluginIds].sort().map((pid) => store.getAcl(pid));
    },
  };

  return store;
}

/** Helper typé pour createRequest + impact. */
export function createSqliteProductRequest(
  store: ProductHubStore,
  input: {
    name: string;
    description?: string;
    conversationId?: string;
    impact: PluginImpactReport;
  },
) {
  return store.createRequest(input);
}

export type { PluginClarificationQuestion };
