/**
 * Store Product Hub en mémoire — sandbox DemoBrand + tests kit.
 * Les apps prod utilisent SQLite (vertical) en implémentant ProductHubStore.
 */

import crypto from "node:crypto";
import {
  assertPluginLifecycleTransition,
  type PluginLifecycleState,
  type PluginTaskStatus,
} from "../lifecycle.js";
import {
  missingPrdCoreFields,
  missingPrdSections,
} from "../prd.js";
import { assertClarificationQuestions } from "../clarifications.js";
import type {
  PluginClarificationRecord,
  PluginImpactReportRecord,
  PluginPrdRevisionRecord,
  PluginProductRecord,
  PluginTaskRecord,
  ProductHubStore,
} from "./types.js";
import type { PluginImpactReport } from "../impact.js";
import type { PluginPrdSections } from "../prd.js";
import type { PluginClarificationQuestion } from "../clarifications.js";

function id(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

export function createMemoryProductHubStore(opts?: {
  conversationPrefix?: string;
}): ProductHubStore {
  const prefix = opts?.conversationPrefix || "crm";
  const products = new Map<string, PluginProductRecord>();
  const prds = new Map<string, PluginPrdRevisionRecord[]>();
  const tasks = new Map<string, PluginTaskRecord[]>();
  const impacts = new Map<string, PluginImpactReportRecord[]>();
  const clarifications = new Map<string, PluginClarificationRecord[]>();

  const store: ProductHubStore = {
    createRequest(input) {
      const productId = id();
      const conversationId = input.conversationId || `${prefix}-${id()}`;
      const ts = now();
      const product: PluginProductRecord = {
        id: productId,
        plugin_id: input.impact.candidatePluginId,
        name: input.name,
        description: input.description || "",
        lifecycle_state: "impact_analysis",
        conversation_id: conversationId,
        decision: input.impact.recommendation,
        archived_at: null,
        created_at: ts,
        updated_at: ts,
      };
      products.set(productId, product);
      const report: PluginImpactReportRecord = {
        id: id(),
        plugin_product_id: productId,
        recommendation: input.impact.recommendation,
        summary: input.impact.summary,
        evidence_json: JSON.stringify(input.impact.evidence),
        created_at: ts,
      };
      impacts.set(productId, [report]);
      return { product, impactReport: report };
    },

    listProducts() {
      return Array.from(products.values()).sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at),
      );
    },

    getProduct(productId) {
      return products.get(productId);
    },

    transition(productId, next) {
      const product = products.get(productId);
      if (!product) throw new Error("Produit plugin introuvable");
      assertPluginLifecycleTransition(product.lifecycle_state, next);
      const updated: PluginProductRecord = {
        ...product,
        lifecycle_state: next,
        updated_at: now(),
      };
      products.set(productId, updated);
      return updated;
    },

    savePrd(input) {
      const product = products.get(input.productId);
      if (!product) throw new Error("Produit plugin introuvable");
      const list = prds.get(input.productId) || [];
      const version = list.reduce((m, r) => Math.max(m, r.version), 0) + 1;
      const revision: PluginPrdRevisionRecord = {
        id: id(),
        plugin_product_id: input.productId,
        problem: input.problem,
        users: input.users,
        scope: input.scope,
        out_of_scope: input.outOfScope || "",
        acceptance_criteria: input.acceptanceCriteria,
        sections_json: JSON.stringify(input.sections || {}),
        version,
        validated_by: null,
        validated_at: null,
        created_at: now(),
      };
      list.push(revision);
      prds.set(input.productId, list);
      // Avance la machine d'état vers awaiting_prd_approval (chemins légaux).
      const advance: PluginLifecycleState[] = [];
      const state = products.get(input.productId)!.lifecycle_state;
      if (state === "impact_analysis" || state === "clarification_required") {
        advance.push("prd_draft", "awaiting_prd_approval");
      } else if (state === "prd_draft") {
        advance.push("awaiting_prd_approval");
      } else if (state === "awaiting_prd_approval") {
        /* déjà en place */
      }
      for (const next of advance) {
        try {
          store.transition(input.productId, next);
        } catch {
          break;
        }
      }
      return revision;
    },

    validatePrd(input) {
      const list = prds.get(input.productId) || [];
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
      revision.validated_by = input.userId;
      revision.validated_at = now();
      const product = products.get(input.productId);
      if (product?.lifecycle_state === "awaiting_prd_approval") {
        store.transition(input.productId, "planning");
      }
      // Sync user stories → tâches ready
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
        (tasks.get(input.productId) || []).map((t) => t.title),
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
      return revision;
    },

    listPrdRevisions(productId) {
      return [...(prds.get(productId) || [])].sort(
        (a, b) => b.version - a.version,
      );
    },

    createClarification(input) {
      const product = products.get(input.productId);
      if (!product) throw new Error("Produit plugin introuvable");
      assertClarificationQuestions(input.questions);
      const list = clarifications.get(input.productId) || [];
      const round = list.reduce((m, c) => Math.max(m, c.round), 0) + 1;
      const row: PluginClarificationRecord = {
        id: id(),
        plugin_product_id: input.productId,
        round,
        questions_json: JSON.stringify(input.questions),
        answers_json: null,
        status: "open",
        created_at: now(),
        answered_at: null,
      };
      list.push(row);
      clarifications.set(input.productId, list);
      try {
        store.transition(input.productId, "clarification_required");
      } catch {
        /* */
      }
      return row;
    },

    answerClarification(input) {
      const list = clarifications.get(input.productId) || [];
      const row = list.find((c) => c.id === input.clarificationId);
      if (!row) throw new Error("Round de questions introuvable");
      if (row.status === "answered") throw new Error("Round déjà répondu");
      row.answers_json = JSON.stringify(input.answers);
      row.status = "answered";
      row.answered_at = now();
      return row;
    },

    listClarifications(productId) {
      return [...(clarifications.get(productId) || [])].sort(
        (a, b) => a.round - b.round,
      );
    },

    createTask(input) {
      if (!products.get(input.productId)) {
        throw new Error("Produit plugin introuvable");
      }
      const list = tasks.get(input.productId) || [];
      const position =
        list.reduce((m, t) => Math.max(m, t.position), -1) + 1;
      const ts = now();
      const task: PluginTaskRecord = {
        id: id(),
        plugin_product_id: input.productId,
        title: input.title,
        body: input.body || "",
        status: (input.status || "backlog") as PluginTaskStatus,
        priority: input.priority || 0,
        hermes_task_id: null,
        blocked: 0,
        blocked_reason: null,
        position,
        created_at: ts,
        updated_at: ts,
      };
      list.push(task);
      tasks.set(input.productId, list);
      return task;
    },

    listTasks(productId) {
      return [...(tasks.get(productId) || [])].sort(
        (a, b) => a.position - b.position,
      );
    },

    linkRuntime(productId, pluginId) {
      const product = products.get(productId);
      if (!product) throw new Error("Produit plugin introuvable");
      const updated: PluginProductRecord = {
        ...product,
        plugin_id: pluginId,
        updated_at: now(),
      };
      products.set(productId, updated);
      return updated;
    },

    productDetails(productId) {
      const product = products.get(productId);
      if (!product) return undefined;
      return {
        product,
        prdRevisions: store.listPrdRevisions(productId),
        tasks: store.listTasks(productId),
        impactReports: impacts.get(productId) || [],
        clarifications: store.listClarifications(productId),
      };
    },
  };

  return store;
}

/** Helper : crée une demande + impact en une fois (sandbox). */
export function createProductRequest(
  store: ProductHubStore,
  input: {
    name: string;
    description?: string;
    conversationId?: string;
    impact: PluginImpactReport;
  },
): ReturnType<ProductHubStore["createRequest"]> {
  return store.createRequest(input);
}

export type { PluginClarificationQuestion };
