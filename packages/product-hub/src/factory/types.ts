/**
 * Contrats fabrique plugins conversationnelle (vision V1).
 */

import type { PluginImpactEvidence, PluginImpactReport } from "../impact.js";
import type { PluginAclActor } from "../acl.js";
import type {
  PluginClarificationRecord,
  PluginPrdRevisionRecord,
  PluginProductRecord,
  ProductHubStore,
} from "../store/types.js";
import type { PrdDrafter } from "./prd-drafter.js";

export type FactoryPhase =
  | "intention_received"
  | "analyzing"
  | "clarification_required"
  | "prd_ready"
  | "awaiting_approval"
  | "ready_to_materialize"
  | "materialized"
  | "iterating"
  | "failed";

export type FactorySessionSnapshot = {
  productId: string;
  pluginId: string | null;
  phase: FactoryPhase;
  product: PluginProductRecord;
  impact: PluginImpactReport | null;
  prd: PluginPrdRevisionRecord | null;
  openClarification: PluginClarificationRecord | null;
  message: string;
  suggestedPluginId: string | null;
};

export type FactoryMaterializeResult = {
  ok: true;
  pluginId: string;
  dir: string;
  dbOpened: boolean;
  filesWritten: string[];
  session: FactorySessionSnapshot;
} | {
  ok: false;
  error: string;
  session?: FactorySessionSnapshot;
};

export type FactoryScaffoldResult =
  | { ok: true; plugin: { id: string; dir: string } }
  | { ok: false; error: string };

export type FactoryWriteFilesResult =
  | { ok: true; written: string[] }
  | { ok: false; error: string };

/**
 * Adapters runtime — demobrand / marques branchent openPlugin + ACL ici.
 */
export type ConversationalPluginFactoryAdapters = {
  store: ProductHubStore;
  /** Evidence pour impact (manifests, products existants…). */
  collectEvidence?: () => PluginImpactEvidence[];
  /** Crée le dossier plugin + manifest minimal. */
  scaffoldPlugin: (input: {
    id: string;
    name?: string;
    description?: string;
  }) => Promise<FactoryScaffoldResult> | FactoryScaffoldResult;
  /** Écrit les fichiers générés (PRD, index, …). */
  writePluginFiles: (
    id: string,
    files: Record<string, string>,
  ) => Promise<FactoryWriteFilesResult> | FactoryWriteFilesResult;
  /**
   * Ouvre DB plugin/<id> + bind ACL + mounts API.
   * Doit être idempotent si déjà installé.
   */
  installRuntime: (
    pluginId: string,
    actor: PluginAclActor,
  ) => Promise<{ dbOpened: boolean }> | { dbOpened: boolean };
  /**
   * Brouillon PRD pluggable (C3) — sync ou async.
   * Défaut : déterministe. LLM via `createOptionalLlmPrdDrafter`.
   */
  draftPrd?: PrdDrafter;
  /** Prefixe conversation assistant (défaut demobrand). */
  conversationPrefix?: string;
};

export type ConversationalPluginFactory = {
  submitIntention(input: {
    text: string;
    name?: string;
    pluginId?: string;
    conversationId?: string;
    /** Force clarification même si intention longue. */
    forceClarification?: boolean;
  }): Promise<FactorySessionSnapshot>;

  answerClarifications(input: {
    productId: string;
    clarificationId: string;
    answers: Record<string, string | string[]>;
  }): Promise<FactorySessionSnapshot>;

  approvePrd(input: {
    productId: string;
    userId: string;
    revisionId?: string;
  }): FactorySessionSnapshot;

  materialize(input: {
    productId: string;
    actor: PluginAclActor;
    pluginId?: string;
  }): Promise<FactoryMaterializeResult>;

  /** Nouvelle intention sur un plugin existant (evolve). */
  iterate(input: {
    pluginId: string;
    text: string;
    conversationId?: string;
  }): Promise<FactorySessionSnapshot>;

  getSession(productId: string): FactorySessionSnapshot | undefined;
  listSessions(): FactorySessionSnapshot[];
};
