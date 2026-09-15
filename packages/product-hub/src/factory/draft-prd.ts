/**
 * Brouillon PRD déterministe depuis une intention (+ réponses clarifications).
 * Pas d'appel LLM — preuve kit / sandbox ; les marques peuvent remplacer.
 */

import type { PluginPrdRevisionInput, PluginPrdSections } from "../prd.js";

export type DraftPrdFromIntentionInput = {
  name: string;
  intention: string;
  clarificationAnswers?: Record<string, string | string[]>;
};

function fmtAnswer(v: string | string[] | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? v.join(", ") : String(v);
}

/**
 * Produit un PRD complet (sections obligatoires remplies) pour valider le cycle.
 */
export function draftPrdFromIntention(
  input: DraftPrdFromIntentionInput,
): PluginPrdRevisionInput {
  const intention = String(input.intention || "").trim();
  const answers = input.clarificationAnswers || {};
  const dataSource =
    fmtAnswer(answers.data_source) || "apis et tables natives de l'organisation";
  const users =
    fmtAnswer(answers.users) || "utilisateurs de l'organisation autorisés (ACL L3)";
  const uiKind = fmtAnswer(answers.ui_kind) || "single";

  const sections: PluginPrdSections = {
    data_inputs: [
      {
        data: "contexte organisation + intention utilisateur",
        sourceEndpoint: "core.assistant / product-hub",
      },
      {
        data: dataSource,
        sourceEndpoint: "brand|plugin APIs découvertes",
      },
    ],
    data_outputs: [
      {
        data: `état et données du plugin ${input.name}`,
        destination: `sqlite plugin/<id>`,
      },
      {
        data: "outils MCP space plugin",
        destination: "mcp-facade discoverToolsBySpace",
      },
    ],
    db_schema: [
      {
        table: "plugin_kv",
        columns: [
          { name: "key", type: "TEXT", description: "clé" },
          { name: "value", type: "TEXT", description: "valeur" },
          { name: "updated_at", type: "TEXT", description: "ISO-8601" },
        ],
      },
    ],
    user_stories: [
      `En tant qu'utilisateur org, je peux utiliser « ${input.name} » pour : ${intention}`,
      "En tant qu'admin org, je contrôle see/install/execute via Product Hub ACL L3",
      "En tant qu'utilisateur, je peux itérer via le chat sans casser le cœur",
    ],
    screens: [
      {
        name: "Vue principale",
        kind: uiKind === "tab" ? "tab" : "single",
        description: `Écran principal du plugin ${input.name}`,
      },
    ],
    wireframes: [
      {
        screen: "Vue principale",
        ascii: [
          `+---------------------------+`,
          `| ${input.name.padEnd(25).slice(0, 25)} |`,
          `+---------------------------+`,
          `| [données]  [actions]     |`,
          `|                           |`,
          `|  (isolé — plugin DB)      |`,
          `+---------------------------+`,
        ].join("\n"),
      },
    ],
  };

  return {
    problem: intention || `Besoin métier : ${input.name}`,
    users,
    scope: `Plugin isolé « ${input.name} » — DB plugin/<id>, API montée, tools MCP space plugin, ACL L3.`,
    outOfScope:
      "Pas de promotion auto plugin→module marque ; pas d'univers perso hors org ; pas de registry cloud.",
    acceptanceCriteria: [
      "Scaffold plugin créé sous plugins/<id>",
      "SqliteRuntime.openPlugin ouvre plugin/<id>.db",
      "Tools MCP plugin.<id>.* visibles pour org autorisée uniquement",
      "Itération possible via nouvelle intention (evolve)",
    ].join("\n"),
    sections,
  };
}

/**
 * Questions de clarification si l'intention est trop vague.
 */
export function defaultClarificationQuestions(): Array<{
  id: string;
  label: string;
  type: "choice" | "multi" | "text";
  options?: string[];
  allowOther?: boolean;
}> {
  return [
    {
      id: "users",
      label: "Qui utilisera ce plugin ?",
      type: "text",
    },
    {
      id: "data_source",
      label: "Quelles données / API doit-il consommer ?",
      type: "text",
    },
    {
      id: "ui_kind",
      label: "Interface souhaitée ?",
      type: "choice",
      options: ["single", "tab"],
    },
  ];
}

/** Heuristique : intention trop courte ⇒ clarification. */
export function needsClarification(intention: string): boolean {
  const words = String(intention || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.length < 6;
}
