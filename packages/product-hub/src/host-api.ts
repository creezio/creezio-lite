/**
 * API Product Hub côté app (Next / CRM) — logique hors façade marque.
 * La marque ne garde que le câblage store + env pluginsDir.
 */

import fs from "node:fs";
import path from "node:path";
import type { PluginClarificationQuestion } from "./clarifications.js";
import {
  buildPluginImpactReport,
  collectPluginManifestEvidence,
  type PluginImpactReport,
} from "./impact.js";
import type { PluginLifecycleState, PluginTaskStatus } from "./lifecycle.js";
import { parsePluginPrdSections, type PluginPrdSections } from "./prd.js";
import type { SqliteProductHubStore } from "./store/sqlite-store.js";
import type {
  PluginProductRecord,
  ProductHubStore,
} from "./store/types.js";

export type ProductHubHostDeps = {
  requireStore: () => SqliteProductHubStore;
  getStore: () => SqliteProductHubStore | null;
  /** Répertoire plugins runtime (manifests pour impact). */
  pluginsDir: () => string;
};

export type ProductHubHost = {
  createPluginRequest(input: {
    name: string;
    description?: string;
    conversationId?: string;
  }): { product: PluginProductRecord; impactReport: Record<string, unknown> };
  buildPluginImpactReport(input: {
    name: string;
    description: string;
  }): PluginImpactReport & { candidatePluginId: string | null };
  listPluginProducts(): PluginProductRecord[];
  getPluginProduct(productId: string): PluginProductRecord | undefined;
  transitionPluginProduct(
    productId: string,
    next: PluginLifecycleState,
  ): PluginProductRecord;
  savePluginPrd(input: {
    productId: string;
    problem: string;
    users: string;
    scope: string;
    outOfScope?: string;
    acceptanceCriteria: string;
    sections?: Partial<PluginPrdSections>;
  }): Record<string, unknown>;
  validatePluginPrd(input: {
    productId: string;
    revisionId: string;
    userId: string;
  }): Record<string, unknown>;
  createPluginClarification(input: {
    productId: string;
    questions: PluginClarificationQuestion[];
  }): Record<string, unknown>;
  answerPluginClarification(input: {
    productId: string;
    clarificationId: string;
    answers: Record<string, string | string[]>;
  }): Record<string, unknown>;
  listPluginClarifications(productId: string): Array<Record<string, unknown>>;
  countDonePluginTasks(productId: string): number;
  hasPassedPluginTestRun(productId: string): boolean;
  pluginProductDetails(
    productId: string,
  ): Record<string, unknown> | undefined;
  createPluginTask(input: {
    productId: string;
    title: string;
    body?: string;
    status?: PluginTaskStatus;
    priority?: number;
  }): Record<string, unknown>;
  updatePluginTask(
    productId: string,
    taskId: string,
    patch: {
      status?: PluginTaskStatus;
      blocked?: boolean;
      blockedReason?: string | null;
      hermesTaskId?: string | null;
    },
  ): Record<string, unknown>;
  syncTasksFromUserStories(productId: string): number;
};

function collectStoreEvidence(
  hub: ProductHubStore & { prepare?: (sql: string) => { all: () => unknown[] } },
): Array<Record<string, unknown>> {
  const evidence: Array<Record<string, unknown>> = [];
  for (const product of hub.listProducts()) {
    if (product.archived_at) continue;
    evidence.push({
      type: "product_prd",
      id: product.id,
      plugin_id: product.plugin_id,
      name: product.name,
      description: product.description,
    });
  }
  if (!hub.prepare) return evidence;
  try {
    const workflows = hub
      .prepare(
        `SELECT plugin_product_id, external_id, name, tag
         FROM plugin_n8n_resources WHERE archived_at IS NULL LIMIT 200`,
      )
      .all() as Array<Record<string, unknown>>;
    for (const workflow of workflows) {
      evidence.push({ type: "n8n_workflow", ...workflow });
    }
  } catch {
    /* table absente */
  }
  try {
    const tables = hub
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    for (const table of tables.filter((row) =>
      /plugin|workflow/i.test(row.name),
    )) {
      evidence.push({ type: "sqlite_table", table: table.name });
    }
  } catch {
    /* ok */
  }
  return evidence;
}

function collectManifestEvidence(
  pluginsDir: string,
): Array<Record<string, unknown>> {
  const root = String(pluginsDir || "").trim();
  if (!root || !fs.existsSync(root)) return [];
  const manifests: Array<{
    id: string;
    name?: string;
    description?: string;
    path?: string;
  }> = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(root, entry.name, "manifest.json");
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        id?: string;
        name?: string;
        description?: string;
      };
      manifests.push({
        id: manifest.id || entry.name,
        name: manifest.name || entry.name,
        description: manifest.description || "",
        path: manifestPath,
      });
    } catch {
      /* manifeste absent ou invalide */
    }
  }
  return collectPluginManifestEvidence(manifests);
}

/** Host Product Hub pour routes CRM — SoT = store kit (core.db). */
export function createProductHubHost(
  deps: ProductHubHostDeps,
): ProductHubHost {
  const store = () => deps.requireStore();

  function buildImpact(input: {
    name: string;
    description: string;
  }): PluginImpactReport {
    const evidence: Array<Record<string, unknown>> = [
      ...collectManifestEvidence(deps.pluginsDir()),
    ];
    const hub = deps.getStore();
    if (hub) evidence.push(...collectStoreEvidence(hub));
    return buildPluginImpactReport({
      name: input.name,
      description: input.description,
      evidence: evidence as Parameters<
        typeof buildPluginImpactReport
      >[0]["evidence"],
    });
  }

  return {
    buildPluginImpactReport(input) {
      return buildImpact(input);
    },

    createPluginRequest(input) {
      const impact = buildImpact({
        name: input.name,
        description: input.description || "",
      });
      const created = store().createRequest({
        name: input.name,
        description: input.description,
        conversationId: input.conversationId,
        impact,
      });
      return {
        product: created.product,
        impactReport: {
          id: created.impactReport.id,
          recommendation: impact.recommendation,
          summary: impact.summary,
          evidence: impact.evidence,
          candidatePluginId: impact.candidatePluginId,
        },
      };
    },

    listPluginProducts() {
      return store().listProducts();
    },

    getPluginProduct(productId) {
      return store().getProduct(productId);
    },

    transitionPluginProduct(productId, next) {
      return store().transition(productId, next);
    },

    savePluginPrd(input) {
      return { ...store().savePrd(input) };
    },

    validatePluginPrd(input) {
      return { ...store().validatePrd(input) };
    },

    createPluginClarification(input) {
      return { ...store().createClarification(input) };
    },

    answerPluginClarification(input) {
      return { ...store().answerClarification(input) };
    },

    listPluginClarifications(productId) {
      return store().listClarifications(productId) as Array<
        Record<string, unknown>
      >;
    },

    countDonePluginTasks(productId) {
      return store().countDoneTasks?.(productId) ?? 0;
    },

    hasPassedPluginTestRun(productId) {
      return store().hasPassedTestRun?.(productId) ?? false;
    },

    pluginProductDetails(productId) {
      const details = store().productDetails(productId);
      if (!details) return undefined;
      return {
        product: details.product,
        prdRevisions: details.prdRevisions,
        tasks: details.tasks,
        impactReports: details.impactReports,
        documents: details.documents || [],
        tickets: details.tickets || [],
        tests: details.tests || [],
        n8nResources: details.n8nResources || [],
        changelog: details.changelog || [],
        gates: details.gates || [],
        clarifications: details.clarifications,
      };
    },

    createPluginTask(input) {
      return { ...store().createTask(input) };
    },

    updatePluginTask(productId, taskId, patch) {
      const hub = store();
      if (!hub.updateTask) throw new Error("updateTask indisponible");
      return { ...hub.updateTask(productId, taskId, patch) };
    },

    syncTasksFromUserStories(productId) {
      const hub = store();
      const revisions = hub.listPrdRevisions(productId);
      const revision = revisions.find((r) => r.validated_at);
      if (!revision) return 0;
      const sections = parsePluginPrdSections(revision.sections_json);
      const stories = Array.isArray(sections.user_stories)
        ? sections.user_stories
            .map((story) => String(story).trim())
            .filter(Boolean)
        : [];
      if (!stories.length) return 0;
      const existing = new Set(hub.listTasks(productId).map((t) => t.title));
      let created = 0;
      for (const story of stories) {
        const title = story.slice(0, 300);
        if (existing.has(title)) continue;
        hub.createTask({
          productId,
          title,
          body: story,
          status: "ready",
        });
        existing.add(title);
        created += 1;
      }
      return created;
    },
  };
}
