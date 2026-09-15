/**
 * Sources assistant déclarées par un `BrandModuleDef` (F3.4 / T5).
 *
 * Descripteurs **typés uniquement** — pas de handler, pas de code libre.
 * Collectés par `createBrandModuleRegistry` (`@creezio/app-runtime`) et
 * consommés ici : contexte prompt, toolDefinitions, projections entitySources.
 */

import {
  createEntitySourcesFromRules,
  type EntitySourceKindRule,
} from "./entity-projections.js";
import type { AssistantSource } from "./sources-shim.js";
import type { AssistantToolDefinition } from "./types.js";

/** Kind get_entity / SQL — même contrat que `EntitySourceKindRule`. */
export type BrandModuleAssistantEntitySource = {
  kind: "entity";
  /** Kind get_entity (articles, clients, …). */
  entityKind: string;
  titleFields: readonly string[];
  titleMode?: "first" | "join";
  titleFallbackFields?: readonly string[];
  type: string;
  urlWhenId: string;
  urlWhenSearch: string;
  idField?: string;
};

/** Bloc de contexte injecté dans le prompt système (texte seul). */
export type BrandModuleAssistantContextSource = {
  kind: "context";
  /** Identifiant stable du bloc (dédup registre). */
  id: string;
  title: string;
  body: string;
};

/**
 * Descripteur d'outil exposé au LLM — **pas** de handler.
 * L'exécution reste MCP (`operations[]`) ou un adapter kit.
 */
export type BrandModuleAssistantToolSource = {
  kind: "tool";
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
};

export type BrandModuleAssistantSource =
  | BrandModuleAssistantEntitySource
  | BrandModuleAssistantContextSource
  | BrandModuleAssistantToolSource;

export function isEntityAssistantSource(
  src: BrandModuleAssistantSource,
): src is BrandModuleAssistantEntitySource {
  return src.kind === "entity";
}

export function isContextAssistantSource(
  src: BrandModuleAssistantSource,
): src is BrandModuleAssistantContextSource {
  return src.kind === "context";
}

export function isToolAssistantSource(
  src: BrandModuleAssistantSource,
): src is BrandModuleAssistantToolSource {
  return src.kind === "tool";
}

export function entityRuleFromModuleSource(
  src: BrandModuleAssistantEntitySource,
): EntitySourceKindRule {
  return {
    kind: src.entityKind,
    titleFields: src.titleFields,
    ...(src.titleMode ? { titleMode: src.titleMode } : {}),
    ...(src.titleFallbackFields
      ? { titleFallbackFields: src.titleFallbackFields }
      : {}),
    type: src.type,
    urlWhenId: src.urlWhenId,
    urlWhenSearch: src.urlWhenSearch,
    ...(src.idField ? { idField: src.idField } : {}),
  };
}

export function toolDefinitionFromModuleSource(
  src: BrandModuleAssistantToolSource,
): AssistantToolDefinition {
  return {
    type: "function",
    function: {
      name: src.name,
      description: src.description,
      parameters: src.parameters ?? { type: "object", properties: {} },
    },
  };
}

/**
 * Applique les descripteurs collectés : règles entity, defs d'outils,
 * section de contexte prompt. Dédup : entityKind / tool name / context id
 * (premier gagne).
 */
export function applyModuleAssistantSources(
  sources: readonly BrandModuleAssistantSource[],
): {
  entityRules: EntitySourceKindRule[];
  toolDefinitions: AssistantToolDefinition[];
  contextSection: string;
} {
  const entityRules: EntitySourceKindRule[] = [];
  const seenEntity = new Set<string>();
  const toolDefinitions: AssistantToolDefinition[] = [];
  const seenTool = new Set<string>();
  const contextParts: string[] = [];
  const seenContext = new Set<string>();

  for (const src of sources) {
    if (isEntityAssistantSource(src)) {
      if (seenEntity.has(src.entityKind)) continue;
      seenEntity.add(src.entityKind);
      entityRules.push(entityRuleFromModuleSource(src));
      continue;
    }
    if (isToolAssistantSource(src)) {
      if (seenTool.has(src.name)) continue;
      seenTool.add(src.name);
      toolDefinitions.push(toolDefinitionFromModuleSource(src));
      continue;
    }
    if (isContextAssistantSource(src)) {
      if (seenContext.has(src.id)) continue;
      seenContext.add(src.id);
      const title = src.title.trim();
      const body = src.body.trim();
      if (!title && !body) continue;
      contextParts.push(title ? `### ${title}\n${body}` : body);
    }
  }

  return {
    entityRules,
    toolDefinitions,
    contextSection: contextParts.length
      ? `## Contexte modules\n${contextParts.join("\n\n")}`
      : "",
  };
}

/** `entitySources(kind, id, ent)` composé depuis les descripteurs `kind:"entity"`. */
export function createEntitySourcesFromModuleSources(
  sources: readonly BrandModuleAssistantSource[],
): (
  kind: string,
  id: string,
  ent: Record<string, unknown> | null,
) => AssistantSource[] {
  const { entityRules } = applyModuleAssistantSources(sources);
  return createEntitySourcesFromRules(entityRules);
}

/** Fusionne deux `entitySources` (marque puis modules — concat, pas d'écrasement). */
export function composeEntitySources(
  brandFn:
    | ((
        kind: string,
        id: string,
        ent: Record<string, unknown> | null,
      ) => AssistantSource[])
    | undefined,
  moduleFn:
    | ((
        kind: string,
        id: string,
        ent: Record<string, unknown> | null,
      ) => AssistantSource[])
    | undefined,
): (
  kind: string,
  id: string,
  ent: Record<string, unknown> | null,
) => AssistantSource[] {
  return (kind, id, ent) => {
    const a = brandFn?.(kind, id, ent) ?? [];
    const b = moduleFn?.(kind, id, ent) ?? [];
    if (!a.length) return b;
    if (!b.length) return a;
    const seen = new Set(a.map((s) => `${s.url}|${s.title}`));
    const extra = b.filter((s) => !seen.has(`${s.url}|${s.title}`));
    return extra.length ? [...a, ...extra] : a;
  };
}
