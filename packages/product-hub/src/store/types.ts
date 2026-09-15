/**
 * Contrat store Product Hub — implémentations : mémoire (kit) / SQLite (apps).
 */

import type { PluginLifecycleState, PluginTaskStatus } from "../lifecycle.js";
import type { PluginPrdSections } from "../prd.js";
import type { PluginClarificationQuestion } from "../clarifications.js";
import type { PluginImpactReport } from "../impact.js";

export type PluginProductRecord = {
  id: string;
  plugin_id: string | null;
  name: string;
  description: string;
  lifecycle_state: PluginLifecycleState;
  conversation_id: string;
  decision: "create" | "evolve" | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PluginPrdRevisionRecord = {
  id: string;
  plugin_product_id: string;
  problem: string;
  users: string;
  scope: string;
  out_of_scope: string;
  acceptance_criteria: string;
  sections_json: string;
  version: number;
  validated_by: string | null;
  validated_at: string | null;
  created_at: string;
};

export type PluginTaskRecord = {
  id: string;
  plugin_product_id: string;
  title: string;
  body: string;
  status: PluginTaskStatus;
  priority: number;
  hermes_task_id: string | null;
  blocked: number;
  blocked_reason: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type PluginClarificationRecord = {
  id: string;
  plugin_product_id: string;
  round: number;
  questions_json: string;
  answers_json: string | null;
  status: "open" | "answered";
  created_at: string;
  answered_at: string | null;
};

export type PluginImpactReportRecord = {
  id: string;
  plugin_product_id: string;
  recommendation: "create" | "evolve";
  summary: string;
  evidence_json: string;
  created_at: string;
};

export type ProductHubStore = {
  createRequest(input: {
    name: string;
    description?: string;
    conversationId?: string;
    impact: PluginImpactReport;
  }): { product: PluginProductRecord; impactReport: PluginImpactReportRecord };

  listProducts(): PluginProductRecord[];
  getProduct(productId: string): PluginProductRecord | undefined;

  transition(
    productId: string,
    next: PluginLifecycleState,
  ): PluginProductRecord;

  savePrd(input: {
    productId: string;
    problem: string;
    users: string;
    scope: string;
    outOfScope?: string;
    acceptanceCriteria: string;
    sections?: Partial<PluginPrdSections>;
  }): PluginPrdRevisionRecord;

  validatePrd(input: {
    productId: string;
    revisionId: string;
    userId: string;
  }): PluginPrdRevisionRecord;

  listPrdRevisions(productId: string): PluginPrdRevisionRecord[];

  createClarification(input: {
    productId: string;
    questions: PluginClarificationQuestion[];
  }): PluginClarificationRecord;

  answerClarification(input: {
    productId: string;
    clarificationId: string;
    answers: Record<string, string | string[]>;
  }): PluginClarificationRecord;

  listClarifications(productId: string): PluginClarificationRecord[];

  createTask(input: {
    productId: string;
    title: string;
    body?: string;
    status?: PluginTaskStatus;
    priority?: number;
  }): PluginTaskRecord;

  updateTask?(
    productId: string,
    taskId: string,
    patch: {
      status?: PluginTaskStatus;
      blocked?: boolean;
      blockedReason?: string | null;
      hermesTaskId?: string | null;
    },
  ): PluginTaskRecord;

  listTasks(productId: string): PluginTaskRecord[];

  linkRuntime(productId: string, pluginId: string): PluginProductRecord;

  countDoneTasks?(productId: string): number;
  hasPassedTestRun?(productId: string): boolean;

  productDetails(productId: string): {
    product: PluginProductRecord;
    prdRevisions: PluginPrdRevisionRecord[];
    tasks: PluginTaskRecord[];
    impactReports: PluginImpactReportRecord[];
    clarifications: PluginClarificationRecord[];
    documents?: Record<string, unknown>[];
    tickets?: Record<string, unknown>[];
    tests?: Record<string, unknown>[];
    n8nResources?: Record<string, unknown>[];
    changelog?: Record<string, unknown>[];
    gates?: Record<string, unknown>[];
  } | undefined;
};
