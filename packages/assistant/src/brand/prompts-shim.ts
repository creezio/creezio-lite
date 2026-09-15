/**
 * Prompts génériques + injection marque (AssistantPrompts).
 * TOOL_DEFINITIONS plateforme = SoT kit (platform-tool-definitions).
 * Métier = discovery MCP ; pas de liste panier/tasks dupliquée en marque.
 */
import { appMapPromptSection } from "./app-map-shim.js";
import {
  assistantModuleSources,
  assistantPrompts,
  assistantToolDefinitions,
} from "./registry.js";
import { applyModuleAssistantSources } from "./module-sources.js";
import { CHAT_MODE_ADDENDUM } from "../runtime/modes.js";
import {
  looksLikeUiCommand,
  shouldForceRunSql,
  shouldPreferSearchKnowledge,
} from "../runtime/routing.js";
import { loadSchemaCatalog } from "../runtime/schema-catalog.js";
import { PLATFORM_TOOL_DEFINITIONS } from "../runtime/platform-tool-definitions.js";
import { cachedMcpToolDefinitions } from "../runtime/mcp-tools.js";
import { selectOpenAiToolDefinitions } from "../runtime/openai-tool-payload.js";
import { taskToolDefinitions } from "../runtime/tasks-tools.js";
import type { AssistantToolDefinition } from "./types.js";

export {
  OPENAI_CHAT_MAX_TOOLS,
  selectOpenAiToolDefinitions,
} from "../runtime/openai-tool-payload.js";

export {
  looksLikeUiCommand,
  shouldForceRunSql,
  shouldPreferSearchKnowledge,
};

export const DEFAULT_MAX_TOOL_ROUNDS = 24;

export function maxToolRounds(): number {
  const n = Number(process.env.ASSISTANT_MAX_TOOL_ROUNDS || "");
  if (Number.isFinite(n) && n >= 4 && n <= 40) return Math.floor(n);
  return DEFAULT_MAX_TOOL_ROUNDS;
}

export function formatNowParis(d = new Date()): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      dateStyle: "full",
      timeStyle: "short",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

const GENERIC_BASE = `Tu es l'assistant ops du CRM (lecture seule).
Tu aides l'utilisateur sur les données et l'interface de l'application.

Règles strictes :
- Tu DOIS appeler au moins un outil avant toute réponse factuelle. Ne jamais répondre de mémoire.
- Ne jamais inventer de faits, montants, IDs ou statuts.
- Si l'information manque après outils, dis-le clairement.
- Réponds en français, concis et opérationnel.
- Tu n'as aucun droit d'écriture SQL.

## Pilotage de l'interface
Quand l'utilisateur demande une ACTION sur ce qu'il voit, utilise les outils surface_* :
1. surface_list_targets D'ABORD
2. surface_click / surface_type / surface_scroll / surface_read ensuite.
`;

export type BuildSystemPromptOptions = {
  schemaCatalog?: string;
  extra?: string;
  auditDistribution?: boolean;
  mode?: "chat" | "work";
  /** Bloc runtime activeSurface (injecté par assistant-chat). */
  activeSurfaceBlock?: string;
};

/**
 * Prompt système Chat.
 * Compatible TF : `buildSystemPrompt(new Date(), { mode, activeSurfaceBlock, … })`
 * et forme courte : `buildSystemPrompt({ schemaCatalog, extra })`.
 */
export function buildSystemPrompt(
  nowOrOpts: Date | BuildSystemPromptOptions = new Date(),
  options: BuildSystemPromptOptions = {},
): string {
  const opts: BuildSystemPromptOptions =
    nowOrOpts instanceof Date ? options : { ...nowOrOpts, ...options };
  const brand = assistantPrompts();
  const base = brand.baseSystemPrompt?.trim() || GENERIC_BASE;
  const addendum =
    opts.mode === "work"
      ? ""
      : brand.chatModeAddendum?.trim() || CHAT_MODE_ADDENDUM;
  const catalog =
    opts.schemaCatalog?.trim() ||
    (() => {
      try {
        return loadSchemaCatalog();
      } catch {
        return "";
      }
    })();
  const map = appMapPromptSection();
  const moduleContext =
    applyModuleAssistantSources(assistantModuleSources()).contextSection;
  const distributionGuard = opts.auditDistribution
    ? `
## Contrôle obligatoire pour la demande de répartition en cours
Avant toute réponse finale, effectue les requêtes SQL nécessaires pour établir :
1. le COUNT total des lignes source ;
2. le COUNT des lignes où la dimension demandée est renseignée et celui où elle est vide / NULL ;
3. le GROUP BY normalisé de la dimension, ordonné par COUNT(*) DESC.
Pour une dimension texte, normalise-la par \`LOWER(TRIM(colonne))\`. N'annonce pas un total sans ces mesures.`
    : "";
  const surfaceBlock = opts.activeSurfaceBlock?.trim()
    ? opts.activeSurfaceBlock.trim()
    : "";
  const parts = [
    base,
    addendum,
    surfaceBlock,
    distributionGuard,
    `## Carte de l'application\n${map}`,
    moduleContext,
    catalog ? `## Catalogue schéma\n${catalog}` : "",
    opts.extra?.trim() || "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

export const ASSISTANT_SYSTEM_PROMPT = GENERIC_BASE;

/**
 * Outils LLM = platform kit ∪ tasks ∪ addendum marque ∪ MCP découverts.
 * Dédup nom OpenAI-safe + plafond 128. Cache MCP via ensureMcpToolCache().
 */
export function getToolDefinitions(): AssistantToolDefinition[] {
  return selectOpenAiToolDefinitions([
    PLATFORM_TOOL_DEFINITIONS,
    taskToolDefinitions(),
    assistantToolDefinitions(),
    cachedMcpToolDefinitions(),
  ]);
}

/** @deprecated préférer getToolDefinitions() — tableau live via getter. */
export function TOOL_DEFINITIONS() {
  return getToolDefinitions();
}

/** Heuristique générique (répartition / classement) — pas de métier marque. */
export function shouldAuditDistribution(userMessage: string): boolean {
  const text = userMessage.toLowerCase();
  return (
    /\b(r[ée]partition|distribution|classement|top\s*\d*)\b/.test(text) ||
    /\bqui\b.{0,80}\b(le\s+plus|la\s+plus|majorit[ée]|moins)\b/.test(text) ||
    /\b(qui|quel(?:le)?)\b.{0,80}\b(a\s+le\s+plus|fournit|propose)\b/.test(text)
  );
}
