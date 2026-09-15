/**
 * Orchestrateur fabrique plugins conversationnelle (V1).
 *
 * Flux : intention → analyse (impact) → [clarification] → PRD → approve →
 * scaffold + openPlugin (adapter) → tools MCP space plugin (runtime marque).
 */

import {
  buildPluginImpactReport,
  type PluginImpactEvidence,
} from "../impact.js";
import type { PluginAclActor } from "../acl.js";
import type {
  PluginImpactReportRecord,
  PluginProductRecord,
} from "../store/types.js";
import {
  defaultClarificationQuestions,
  draftPrdFromIntention,
  needsClarification,
  type DraftPrdFromIntentionInput,
} from "./draft-prd.js";
import { buildPluginScaffoldFiles } from "./scaffold-files.js";
import { derivePluginIdentity } from "./slug.js";
import type {
  ConversationalPluginFactory,
  ConversationalPluginFactoryAdapters,
  FactoryMaterializeResult,
  FactoryPhase,
  FactorySessionSnapshot,
} from "./types.js";

async function resolveDraft(
  adapters: ConversationalPluginFactoryAdapters,
  input: DraftPrdFromIntentionInput,
) {
  if (adapters.draftPrd) {
    return await adapters.draftPrd(input);
  }
  return draftPrdFromIntention(input);
}

function impactFromRecord(
  row: PluginImpactReportRecord | undefined,
): FactorySessionSnapshot["impact"] {
  if (!row) return null;
  let evidence: PluginImpactEvidence[] = [];
  try {
    evidence = JSON.parse(row.evidence_json) as PluginImpactEvidence[];
  } catch {
    evidence = [];
  }
  return {
    recommendation: row.recommendation,
    summary: row.summary,
    evidence,
    candidatePluginId: null,
    score: 0,
  };
}

function snapshotFor(
  store: ConversationalPluginFactoryAdapters["store"],
  product: PluginProductRecord,
  extras?: {
    phase?: FactoryPhase;
    message?: string;
    suggestedPluginId?: string | null;
  },
): FactorySessionSnapshot {
  const details = store.productDetails(product.id);
  const impactRow = details?.impactReports?.[0];
  const prd = details?.prdRevisions?.[0] || null;
  const openClarification =
    details?.clarifications?.find((c) => c.status === "open") || null;

  let phase: FactoryPhase =
    extras?.phase ||
    (product.lifecycle_state === "released"
      ? "materialized"
      : product.lifecycle_state === "clarification_required"
        ? "clarification_required"
        : product.lifecycle_state === "awaiting_prd_approval"
          ? "awaiting_approval"
          : product.lifecycle_state === "ready_for_execution" ||
              product.lifecycle_state === "planning"
            ? "ready_to_materialize"
            : product.lifecycle_state === "prd_draft"
              ? "prd_ready"
              : "analyzing");

  return {
    productId: product.id,
    pluginId: product.plugin_id,
    phase,
    product: store.getProduct(product.id)!,
    impact: impactFromRecord(impactRow),
    prd,
    openClarification,
    message:
      extras?.message ||
      impactRow?.summary ||
      `État : ${product.lifecycle_state}`,
    suggestedPluginId:
      extras?.suggestedPluginId ?? product.plugin_id ?? null,
  };
}

function advanceTo(
  store: ConversationalPluginFactoryAdapters["store"],
  productId: string,
  targets: Array<
    | "planning"
    | "ready_for_execution"
    | "executing"
    | "automated_testing"
    | "awaiting_human_qa"
    | "released"
  >,
): void {
  for (const next of targets) {
    const p = store.getProduct(productId);
    if (!p) return;
    if (p.lifecycle_state === next) continue;
    try {
      store.transition(productId, next);
    } catch {
      break;
    }
  }
}

/**
 * Crée la fabrique conversationnelle branchée sur un ProductHubStore + adapters runtime.
 */
export function createConversationalPluginFactory(
  adapters: ConversationalPluginFactoryAdapters,
): ConversationalPluginFactory {
  const { store } = adapters;
  const intentionByProduct = new Map<string, string>();

  const factory: ConversationalPluginFactory = {
    async submitIntention(input) {
      const text = String(input.text || "").trim();
      if (!text) {
        throw new Error("intention_vide");
      }
      const identity = derivePluginIdentity(text);
      const name = String(input.name || identity.name).trim();
      const suggestedPluginId = String(
        input.pluginId || identity.suggestedPluginId,
      ).trim();

      const evidence = adapters.collectEvidence?.() || [];
      const impact = buildPluginImpactReport({
        name,
        description: text,
        evidence,
      });

      const { product } = store.createRequest({
        name,
        description: text,
        conversationId: input.conversationId,
        impact: {
          ...impact,
          candidatePluginId:
            impact.recommendation === "evolve"
              ? impact.candidatePluginId
              : suggestedPluginId,
        },
      });
      intentionByProduct.set(product.id, text);

      const askClarify =
        input.forceClarification === true || needsClarification(text);

      if (askClarify) {
        store.createClarification({
          productId: product.id,
          questions: defaultClarificationQuestions(),
        });
        return snapshotFor(store, store.getProduct(product.id)!, {
          phase: "clarification_required",
          message:
            "Intention reçue — précisions nécessaires avant brouillon PRD.",
          suggestedPluginId,
        });
      }

      const draft = await resolveDraft(adapters, { name, intention: text });
      store.savePrd({
        productId: product.id,
        problem: draft.problem,
        users: draft.users,
        scope: draft.scope,
        outOfScope: draft.outOfScope,
        acceptanceCriteria: draft.acceptanceCriteria,
        sections: draft.sections,
      });

      return snapshotFor(store, store.getProduct(product.id)!, {
        phase: "awaiting_approval",
        message: `${impact.summary} PRD prêt — approuver puis matérialiser.`,
        suggestedPluginId:
          impact.recommendation === "evolve"
            ? impact.candidatePluginId
            : suggestedPluginId,
      });
    },

    async answerClarifications(input) {
      store.answerClarification({
        productId: input.productId,
        clarificationId: input.clarificationId,
        answers: input.answers,
      });
      const product = store.getProduct(input.productId);
      if (!product) throw new Error("Produit plugin introuvable");
      const intention =
        intentionByProduct.get(input.productId) || product.description;
      const draft = await resolveDraft(adapters, {
        name: product.name,
        intention,
        clarificationAnswers: input.answers,
      });
      // clarification_required → prd_draft → awaiting_prd_approval via savePrd
      store.savePrd({
        productId: input.productId,
        problem: draft.problem,
        users: draft.users,
        scope: draft.scope,
        outOfScope: draft.outOfScope,
        acceptanceCriteria: draft.acceptanceCriteria,
        sections: draft.sections,
      });
      return snapshotFor(store, store.getProduct(input.productId)!, {
        phase: "awaiting_approval",
        message: "Clarifications intégrées — PRD prêt à approuver.",
        suggestedPluginId: product.plugin_id,
      });
    },

    approvePrd(input) {
      const revisions = store.listPrdRevisions(input.productId);
      const revision =
        revisions.find((r) => r.id === input.revisionId) || revisions[0];
      if (!revision) throw new Error("Aucune révision PRD");
      store.validatePrd({
        productId: input.productId,
        revisionId: revision.id,
        userId: input.userId,
      });
      advanceTo(store, input.productId, ["planning", "ready_for_execution"]);
      return snapshotFor(store, store.getProduct(input.productId)!, {
        phase: "ready_to_materialize",
        message: "PRD approuvé — prêt à scaffolder / ouvrir la DB plugin.",
      });
    },

    async materialize(input): Promise<FactoryMaterializeResult> {
      const product = store.getProduct(input.productId);
      if (!product) {
        return { ok: false, error: "Produit plugin introuvable" };
      }

      // Tolérance : approuver implicitement si encore en awaiting
      if (product.lifecycle_state === "awaiting_prd_approval") {
        factory.approvePrd({
          productId: input.productId,
          userId: input.actor.userId || "factory",
        });
      }
      advanceTo(store, input.productId, ["planning", "ready_for_execution"]);

      const current = store.getProduct(input.productId)!;
      const pluginId = String(
        input.pluginId ||
          current.plugin_id ||
          derivePluginIdentity(current.description || current.name)
            .suggestedPluginId,
      ).trim();

      const prd = store.listPrdRevisions(input.productId)[0] || null;
      const files = buildPluginScaffoldFiles({
        pluginId,
        name: current.name,
        description: current.description,
        prd,
      });

      advanceTo(store, input.productId, ["executing"]);

      const scaffolded = await adapters.scaffoldPlugin({
        id: pluginId,
        name: current.name,
        description: current.description,
      });
      if (!scaffolded.ok) {
        return {
          ok: false,
          error: scaffolded.error,
          session: snapshotFor(store, store.getProduct(input.productId)!, {
            phase: "failed",
            message: scaffolded.error,
          }),
        };
      }

      const written = await adapters.writePluginFiles(pluginId, files);
      if (!written.ok) {
        return {
          ok: false,
          error: written.error,
          session: snapshotFor(store, store.getProduct(input.productId)!, {
            phase: "failed",
            message: written.error,
          }),
        };
      }

      store.linkRuntime(input.productId, pluginId);
      const runtime = await adapters.installRuntime(pluginId, input.actor);

      advanceTo(store, input.productId, [
        "automated_testing",
        "awaiting_human_qa",
        "released",
      ]);

      const session = snapshotFor(store, store.getProduct(input.productId)!, {
        phase: "materialized",
        message: `Plugin « ${pluginId} » matérialisé (DB ${
          runtime.dbOpened ? "ouverte" : "non ouverte"
        }).`,
        suggestedPluginId: pluginId,
      });

      return {
        ok: true,
        pluginId,
        dir: scaffolded.plugin.dir,
        dbOpened: runtime.dbOpened,
        filesWritten: written.written,
        session,
      };
    },

    async iterate(input) {
      const text = String(input.text || "").trim();
      if (!text) throw new Error("intention_vide");
      const pluginId = String(input.pluginId || "").trim();
      const evidence: PluginImpactEvidence[] = [
        ...(adapters.collectEvidence?.() || []),
        {
          type: "plugin_manifest",
          name: pluginId,
          description: `plugin existant ${pluginId}`,
          pluginId,
        },
      ];
      const impact = buildPluginImpactReport({
        name: pluginId,
        description: text,
        evidence,
        evolveThreshold: 0.05,
      });
      // Force evolve si on itère explicitement sur un id
      const forced = {
        ...impact,
        recommendation: "evolve" as const,
        candidatePluginId: pluginId,
        summary: `Itération sur « ${pluginId} » — ${impact.summary}`,
      };
      const { product } = store.createRequest({
        name: `${pluginId} (itération)`,
        description: text,
        conversationId: input.conversationId,
        impact: forced,
      });
      intentionByProduct.set(product.id, text);
      const draft = await resolveDraft(adapters, {
        name: pluginId,
        intention: text,
      });
      store.savePrd({
        productId: product.id,
        problem: draft.problem,
        users: draft.users,
        scope: draft.scope,
        outOfScope: draft.outOfScope,
        acceptanceCriteria: draft.acceptanceCriteria,
        sections: draft.sections,
      });
      store.linkRuntime(product.id, pluginId);
      return snapshotFor(store, store.getProduct(product.id)!, {
        phase: "awaiting_approval",
        message: `Itération prête pour « ${pluginId} » — approuver puis re-matérialiser les fichiers.`,
        suggestedPluginId: pluginId,
      });
    },

    getSession(productId) {
      const product = store.getProduct(productId);
      if (!product) return undefined;
      return snapshotFor(store, product);
    },

    listSessions() {
      return store.listProducts().map((p) => snapshotFor(store, p));
    },
  };

  return factory;
}
