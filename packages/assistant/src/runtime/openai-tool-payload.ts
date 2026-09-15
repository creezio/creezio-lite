/**
 * Payload tools Chat Completions OpenAI — plafond 128 + dédup nom safe.
 * OpenAI refuse `tools` plus long que 128 (`Invalid 'tools': array too long`).
 */
import type { AssistantToolDefinition } from "../brand/types.js";

/**
 * OpenAI Chat Completions n'accepte que `^[a-zA-Z0-9_-]+$` pour
 * `tools[].function.name`. Les tools MCP canoniques utilisent des points.
 */
export function openaiSafeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Plafond Chat Completions / Anthropic tool list (OpenAI hard cap). */
export const OPENAI_CHAT_MAX_TOOLS = 128;

export type SelectOpenAiToolDefinitionsOptions = {
  /** Défaut `OPENAI_CHAT_MAX_TOOLS`. */
  max?: number;
};

/**
 * Fusionne des listes d'outils, déduplique par nom OpenAI-safe
 * (`^[a-zA-Z0-9_-]+$`), premier gagnant, puis tronque au plafond.
 *
 * Ordre d'appel recommandé : platform → tasks → addendum marque → MCP
 * (les tools OS restent, le métier MCP est rogné en dernier).
 */
export function selectOpenAiToolDefinitions(
  lists: AssistantToolDefinition[][],
  options: SelectOpenAiToolDefinitionsOptions = {},
): AssistantToolDefinition[] {
  const max = Number.isFinite(options.max)
    ? Math.max(1, Math.floor(options.max as number))
    : OPENAI_CHAT_MAX_TOOLS;
  const bySafe = new Map<string, AssistantToolDefinition>();
  for (const list of lists) {
    for (const t of list) {
      const raw = t.function?.name;
      if (!raw) continue;
      const safe = openaiSafeToolName(raw);
      if (bySafe.has(safe)) continue;
      bySafe.set(safe, {
        ...t,
        function: {
          ...t.function,
          name: safe,
        },
      });
    }
  }
  const all = [...bySafe.values()];
  if (all.length <= max) return all;
  if (typeof console !== "undefined" && console.warn) {
    console.warn(
      `[assistant] tools payload tronqué ${all.length} → ${max} (plafond OpenAI)`,
    );
  }
  return all.slice(0, max);
}
