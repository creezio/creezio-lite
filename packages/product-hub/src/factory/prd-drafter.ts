/**
 * PrdDrafter pluggable (C3) — déterministe par défaut, LLM optionnel.
 *
 * Sans clé / sans complete injecté → `draftPrdFromIntention` (zéro réseau).
 * Avec `CREEZIO_PRD_LLM_API_KEY` + URL (ou `complete` de test) → tente LLM,
 * fallback déterministe si échec / JSON invalide.
 */

import type { PluginPrdRevisionInput, PluginPrdSections } from "../prd.js";
import {
  draftPrdFromIntention,
  type DraftPrdFromIntentionInput,
} from "./draft-prd.js";

export type PrdDrafter = (
  input: DraftPrdFromIntentionInput,
) => PluginPrdRevisionInput | Promise<PluginPrdRevisionInput>;

export type LlmPrdDrafterOptions = {
  /** Injecteur tests / marques — retourne texte brut ou objet PRD partiel. */
  complete?: (
    prompt: string,
    input: DraftPrdFromIntentionInput,
  ) =>
    | string
    | Partial<PluginPrdRevisionInput>
    | null
    | Promise<string | Partial<PluginPrdRevisionInput> | null>;
  /** URL chat-completions compatible OpenAI (optionnel). */
  apiUrl?: string;
  /** Défaut : process.env.CREEZIO_PRD_LLM_API_KEY */
  apiKey?: string | null;
  model?: string;
};

function mergeWithDeterministic(
  input: DraftPrdFromIntentionInput,
  partial: Partial<PluginPrdRevisionInput> | null | undefined,
): PluginPrdRevisionInput {
  const base = draftPrdFromIntention(input);
  if (!partial || typeof partial !== "object") return base;
  const sections: Partial<PluginPrdSections> = {
    ...(base.sections || {}),
    ...((partial.sections as Partial<PluginPrdSections>) || {}),
  };
  return {
    problem: String(partial.problem || base.problem),
    users: String(partial.users || base.users),
    scope: String(partial.scope || base.scope),
    outOfScope:
      partial.outOfScope != null ? String(partial.outOfScope) : base.outOfScope,
    acceptanceCriteria: String(
      partial.acceptanceCriteria || base.acceptanceCriteria,
    ),
    sections,
  };
}

function parseLlmPayload(
  raw: string | Partial<PluginPrdRevisionInput> | null,
): Partial<PluginPrdRevisionInput> | null {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  const text = String(raw).trim();
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fence ? fence[1]!.trim() : text;
  try {
    const parsed = JSON.parse(jsonText) as Partial<PluginPrdRevisionInput>;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return {
      problem: text.slice(0, 2000),
      scope: text.slice(0, 2000),
    };
  }
}

async function defaultHttpComplete(
  prompt: string,
  opts: { apiUrl: string; apiKey: string; model: string },
): Promise<string | null> {
  const res = await fetch(opts.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Tu rédiges un PRD plugin Creezio. Réponds UNIQUEMENT en JSON " +
            "avec keys: problem, users, scope, outOfScope, acceptanceCriteria, sections.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content || null;
}

/**
 * Drafter déterministe (alias explicite pour injection adapters).
 */
export const deterministicPrdDrafter: PrdDrafter = (input) =>
  draftPrdFromIntention(input);

/**
 * Drafter LLM optionnel — fallback déterministe si pas de clé / échec réseau.
 */
export function createOptionalLlmPrdDrafter(
  opts: LlmPrdDrafterOptions = {},
): PrdDrafter {
  return async (input) => {
    const apiKey =
      opts.apiKey !== undefined
        ? opts.apiKey
        : process.env.CREEZIO_PRD_LLM_API_KEY || null;
    const apiUrl =
      opts.apiUrl ||
      process.env.CREEZIO_PRD_LLM_API_URL ||
      "https://api.openai.com/v1/chat/completions";
    const model =
      opts.model || process.env.CREEZIO_PRD_LLM_MODEL || "gpt-4o-mini";

    const prompt = [
      `Nom: ${input.name}`,
      `Intention: ${input.intention}`,
      input.clarificationAnswers
        ? `Clarifications: ${JSON.stringify(input.clarificationAnswers)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      let raw: string | Partial<PluginPrdRevisionInput> | null = null;
      if (opts.complete) {
        raw = await opts.complete(prompt, input);
      } else if (apiKey) {
        raw = await defaultHttpComplete(prompt, {
          apiUrl,
          apiKey,
          model,
        });
      } else {
        return draftPrdFromIntention(input);
      }
      return mergeWithDeterministic(input, parseLlmPayload(raw));
    } catch {
      return draftPrdFromIntention(input);
    }
  };
}
