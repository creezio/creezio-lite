import type {
  AssistantAppMapConfig,
  AssistantAppPage,
  AssistantBrandConfig,
  AssistantBrandIdentity,
  AssistantBrandTools,
  AssistantDbAccess,
  AssistantHermesConfig,
  AssistantMeiliConfig,
  AssistantMcpConfig,
  AssistantPromptsConfig,
  AssistantTasksConfig,
  AssistantToolDefinition,
  HermesWorkUser,
} from "./types.js";
import type { BrandModuleAssistantSource } from "./module-sources.js";
import {
  applyModuleAssistantSources,
  composeEntitySources,
  createEntitySourcesFromModuleSources,
} from "./module-sources.js";

let config: AssistantBrandConfig | null = null;

const DEFAULT_IDENTITY: AssistantBrandIdentity = {
  productName: "Creezio",
  uiStorageKey: "creezio-assistant-ui",
  modeStorageKey: "creezio-assistant-preferred-mode",
  desktopApiGlobal: "creezioDesktop",
  globalStorePrefix: "__creezio",
};

/**
 * Configure l’assistant marque (AppMap, Prompts, MCP, tasks, DB, Meili…).
 * À appeler au boot serveur / layout client avant usage runtime.
 *
 * Remplace la config entière. Pour enrichir sans écraser (ex. MCP posé
 * après beforeBoot), utiliser `mergeAssistantBrandConfig`.
 */
export function configureAssistantBrand(next: AssistantBrandConfig): void {
  config = next;
}

/**
 * Fusion shallow des blocs top-level (identity / prompts / tools / …).
 * Les champs absents du partial conservent la valeur déjà configurée.
 * Sert au kit (db/presence/tasks/mcp) après un `configureAssistantBrand`
 * marque au beforeBoot.
 */
export function mergeAssistantBrandConfig(
  partial: Partial<AssistantBrandConfig>,
): void {
  if (!config) {
    config = partial as AssistantBrandConfig;
    return;
  }
  config = {
    ...config,
    ...partial,
    identity: partial.identity
      ? { ...config.identity, ...partial.identity }
      : config.identity,
    appMap: partial.appMap
      ? { ...config.appMap, ...partial.appMap }
      : config.appMap,
    prompts: partial.prompts
      ? { ...config.prompts, ...partial.prompts }
      : config.prompts,
    tools: partial.tools
      ? { ...config.tools, ...partial.tools }
      : config.tools,
    meili: partial.meili
      ? { ...config.meili, ...partial.meili }
      : config.meili,
    hermes: partial.hermes
      ? { ...config.hermes, ...partial.hermes }
      : config.hermes,
    auth: partial.auth
      ? { ...config.auth, ...partial.auth }
      : config.auth,
    desktopPresence: partial.desktopPresence
      ? { ...config.desktopPresence, ...partial.desktopPresence }
      : config.desktopPresence,
    moduleSources: partial.moduleSources
      ? [...(config.moduleSources ?? []), ...partial.moduleSources]
      : config.moduleSources,
  };
}

export function getAssistantBrandConfig(): AssistantBrandConfig | null {
  return config;
}

export function requireAssistantBrand(): AssistantBrandConfig {
  if (!config) {
    throw new Error(
      "@creezio/assistant: configureAssistantBrand() requis avant usage runtime",
    );
  }
  return config;
}

export function assistantIdentity(): AssistantBrandIdentity {
  return config?.identity ?? DEFAULT_IDENTITY;
}

export function assistantAppMapPages(): AssistantAppPage[] {
  return config?.appMap?.pages ?? [];
}

export function assistantPrompts(): AssistantPromptsConfig {
  return config?.prompts ?? {};
}

export function assistantBrandTools(): AssistantBrandTools {
  const tools = config?.tools ?? {};
  const moduleSources = assistantModuleSources();
  if (!moduleSources.some((s) => s.kind === "entity")) return tools;
  return {
    ...tools,
    entitySources: composeEntitySources(
      tools.entitySources,
      createEntitySourcesFromModuleSources(moduleSources),
    ),
  };
}

export function assistantMcp(): AssistantMcpConfig | null {
  return config?.mcp ?? null;
}

export function assistantTasks(): AssistantTasksConfig | null {
  return config?.tasks ?? null;
}

export function assistantDb(): AssistantDbAccess | null {
  return config?.db ?? null;
}

export function requireAssistantDb(): AssistantDbAccess {
  const db = assistantDb();
  if (!db) {
    throw new Error(
      "@creezio/assistant: configureAssistantBrand({ db }) requis pour SQL tools",
    );
  }
  return db;
}

export function assistantMeili(): AssistantMeiliConfig | null {
  return config?.meili ?? null;
}

export function assistantHermes(): AssistantHermesConfig {
  return config?.hermes ?? {};
}

/** Addendum marque uniquement — merge complet via getToolDefinitions(). */
export function assistantToolDefinitions(): AssistantToolDefinition[] {
  const brand = config?.prompts?.toolDefinitions ?? [];
  const fromModules = applyModuleAssistantSources(
    assistantModuleSources(),
  ).toolDefinitions;
  if (!fromModules.length) return brand;
  const seen = new Set(brand.map((t) => t.function.name));
  return [
    ...brand,
    ...fromModules.filter((t) => !seen.has(t.function.name)),
  ];
}

/** Sources collectées depuis `BrandModuleDef.assistantSources`. */
export function assistantModuleSources(): BrandModuleAssistantSource[] {
  return config?.moduleSources ?? [];
}

export function buildBrandHermesWorkBrief(
  nowIso: string,
  user?: HermesWorkUser | null,
): string {
  const fn = config?.prompts?.buildHermesWorkSystemBrief;
  if (fn) return fn(nowIso, user);
  const who = user ? `${user.name} (rôle ${user.role})` : "l'utilisateur";
  return `Tu es l'agent Work ${assistantIdentity().productName}, exécuté via Hermes embarqué pour ${who}. Date : ${nowIso}.`;
}

export function buildBrandPersonalAgentBrief(
  nowIso: string,
  user?: HermesWorkUser | null,
): string {
  const fn = config?.prompts?.buildPersonalAgentWorkBrief;
  if (fn) return fn(nowIso, user);
  const who = user ? `${user.name} (rôle ${user.role})` : "l'utilisateur";
  return `Tu es l'agent personnel de ${who}, sollicité depuis ${assistantIdentity().productName} Desktop (mode Work). Date : ${nowIso}.`;
}

export type { AssistantAppMapConfig };
