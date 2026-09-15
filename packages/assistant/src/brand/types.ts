/**
 * Points d’extension marque pour `@creezio/assistant` (Phase N3 / O4r).
 *
 * Marques = AppMap + Prompts addendum + projections (entitySources / Meili) +
 * façade MCP (tools métier découverts) + adapter tasks.
 * Kit = runtime + PLATFORM tools + handlers tasks/MCP.
 * `BrandTools.executeTool` = legacy mort (O4r) — ne plus brancher de métier.
 */

import type { BrandModuleAssistantSource } from "./module-sources.js";

export type AssistantAppPage = {
  route: string;
  titre: string;
  role: string;
  actions: string[];
  synonymes: string[];
};

export type AssistantToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type HermesWorkUser = {
  id: string;
  name: string;
  role: string;
};

/** Carte app injectée par la marque (pages métier). */
export type AssistantAppMapConfig = {
  pages: AssistantAppPage[];
};

/** Prompts / briefs métier. */
export type AssistantPromptsConfig = {
  /** Prompt système Chat (hors carte app / addendum mode). */
  baseSystemPrompt?: string;
  /** Addendum mode Chat (sinon défaut kit générique). */
  chatModeAddendum?: string;
  /**
   * Addendum defs LLM marque uniquement (ex. get_entity kinds).
   * O4r : ne plus y mettre la liste plateforme (SoT kit) ni le métier MCP.
   */
  toolDefinitions?: AssistantToolDefinition[];
  /** Brief Hermes Work entreprise. */
  buildHermesWorkSystemBrief?: (
    nowIso: string,
    user?: HermesWorkUser | null,
  ) => string;
  /** Brief agent personnel. */
  buildPersonalAgentWorkBrief?: (
    nowIso: string,
    user?: HermesWorkUser | null,
  ) => string;
};

/** Tool MCP exposé au LLM (module.* / plugin.*). */
export type AssistantMcpToolDef = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
};

/** Résultat callTool MCP (aligné `@creezio/mcp-facade`). */
export type AssistantMcpCallResult = {
  ok: boolean;
  content?: unknown;
  error?: string;
  /** Enrichissements assistant optionnels. */
  sources?: Array<{ title: string; url: string; type?: string }>;
  uiSummary?: string;
};

/**
 * Façade MCP injectée par la marque (même registry que Electron / Hono).
 * SoT métier assistant = discovery + callTool — pas BrandTools.executeTool.
 */
export type AssistantMcpConfig = {
  listTools: (opts?: {
    bearerToken?: string | null;
  }) => Promise<AssistantMcpToolDef[]> | AssistantMcpToolDef[];
  callTool: (
    name: string,
    args: Record<string, unknown>,
    opts?: {
      bearerToken?: string | null;
      headers?: Record<string, string>;
      ctx?: Record<string, unknown>;
    },
  ) => Promise<AssistantMcpCallResult>;
  /** Bearer optionnel (ACL plugin). */
  bearerToken?: () => string | null | Promise<string | null>;
  /** TTL cache listTools (ms, défaut 30s). */
  listCacheTtlMs?: number;
};

/**
 * Adapter tâches kanban marque — handlers kit `create_task` / `list_tasks`
 * (aliases feature-off `create_todo` / `list_todos`).
 * Les marques branchent leur store (`@/lib/tasks` ou todos) ; le kit expose
 * les defs + dispatch. Ne pas recopier dans brand-chat-tools.
 */
export type AssistantTasksConfig = {
  create: (
    args: Record<string, unknown>,
    ctx: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  list: (
    args: Record<string, unknown>,
    ctx: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  /**
   * Noms LLM additionnels mappés vers create/list
   * (défaut kit : create_todo→create, list_todos→list).
   */
  aliases?: Partial<{ create: string[]; list: string[] }>;
};

/** Session utilisateur pour handleAssistantChat (O4). */
export type AssistantAuthSession = {
  sub: string;
  email: string;
  role: string;
};

/**
 * Projections / entités marque — PAS d’exécuteur métier.
 * Métier = `AssistantMcpConfig` ; tasks = `AssistantTasksConfig`.
 */
export type AssistantBrandTools = {
  /** get_entity marque (produit/dossier/…). */
  getEntity?: (
    kind: string,
    id: string,
  ) => { kind: string; entity: unknown; related?: Record<string, unknown> };
  /**
   * @deprecated O4r — legacy mort. Utiliser `configureAssistantBrand({ mcp })`.
   * Si encore présent, ignoré par le runtime (sauf tests de migration).
   */
  executeTool?: (
    name: string,
    args: Record<string, unknown>,
    ctx: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;
  /** Sources CRM pour get_entity (kinds marque). */
  entitySources?: (
    kind: string,
    id: string,
    entity: Record<string, unknown> | null,
  ) => Array<{ title: string; url: string; type?: string }>;
  /** Projection hits Meili pour tool_result (champs métier optionnels). */
  formatSearchHit?: (hit: AssistantRagHit) => Record<string, unknown>;
  /** Preview args outil (sinon JSON générique). */
  argsPreview?: (
    name: string,
    args: Record<string, unknown>,
  ) => string | null | undefined;
  /** Enrichissement sources SQL → liens CRM. */
  collectSourcesFromSqlRows?: (
    rows: Record<string, unknown>[],
  ) => Array<{ title: string; url: string; type?: string }>;
  /** Matchers de liens dans le markdown assistant (UI). */
  sourceLinkMatchers?: (
    sources: Array<{ title: string; url: string; type?: string }> | undefined,
  ) => Array<{ text: string; url: string; type?: string }>;
};

/** Accès DB marque (remplace `@/lib/db`). */
export type AssistantDbAccess = {
  queryAll: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => T[];
  queryOne: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => T | undefined;
  getDbPath: () => string;
  tableExists?: (name: string) => boolean;
  /** better-sqlite3 Database (run_sql / explore). */
  getDb?: () => {
    prepare: (sql: string) => {
      all: (...params: unknown[]) => unknown[];
      get: (...params: unknown[]) => unknown;
      run: (...params: unknown[]) => unknown;
    };
    pragma?: (s: string) => unknown;
  };
};

/** Hit Meili générique (champs métier optionnels via index signature). */
export type AssistantRagHit = {
  index: string;
  id: string;
  type: string;
  title: string;
  body: string;
  url: string;
  status?: string;
  score?: number;
  ville?: string;
  pays?: string;
  [k: string]: unknown;
};

/** Meilisearch marque (indexes + mapping hits). */
export type AssistantMeiliConfig = {
  /** Tous les indexes keyword. */
  indexes: readonly string[];
  /** Indexes interrogés en premier (défaut = indexes). */
  primaryIndexes?: readonly string[];
  /** Index de secours si 0 hit (optionnel). */
  fallbackIndex?: string;
  mapHit: (index: string, doc: Record<string, unknown>) => AssistantRagHit;
  /** Enrichissement post-Meili (ex. geo SQL marque). */
  enrichHits?: (hits: AssistantRagHit[]) => void;
  host?: string;
  apiKey?: string;
};

/** Hermes / kanban marque. */
export type AssistantHermesConfig = {
  defaultSkills?: string[];
  /** Skills mode Work (≠ defaultSkills n8n/plugins) — O4. */
  workSkills?: string[];
  /** Préfixe session Hermes Work (`${prefix}-${conversationId}`). */
  sessionIdPrefix?: string;
  kanbanTenant?: string;
  kanbanTaskSkills?: string[];
  kanbanCronSkills?: string[];
  kanbanCreatedBy?: string;
};

/** Identité produit pour UI / messages d’erreur. */
export type AssistantBrandIdentity = {
  productName: string;
  /** localStorage key UI (provider). */
  uiStorageKey: string;
  /** Pref key mode Chat/Work. */
  modeStorageKey: string;
  /** window.*Desktop API name (ex. creezioDesktop / marqueDesktop). */
  desktopApiGlobal: string;
  /** Prefixe globalThis pour registres ui-actions. */
  globalStorePrefix: string;
};

export type AssistantBrandConfig = {
  identity: AssistantBrandIdentity;
  appMap?: AssistantAppMapConfig;
  prompts?: AssistantPromptsConfig;
  /**
   * Sources collectées depuis `BrandModuleDef.assistantSources`
   * (`collectAssistantSources`). Consommées par le runtime (contexte
   * prompt, toolDefinitions, entitySources) — pas de code libre.
   */
  moduleSources?: BrandModuleAssistantSource[];
  tools?: AssistantBrandTools;
  /** O4r — discovery + exécution tools métier (module.* / plugin.*). */
  mcp?: AssistantMcpConfig;
  /** O4r — create_task / list_tasks (kanban marque). */
  tasks?: AssistantTasksConfig;
  db?: AssistantDbAccess;
  meili?: AssistantMeiliConfig;
  hermes?: AssistantHermesConfig;
  /**
   * Auth pour handleAssistantChat (O4).
   * Remplace l’import marque `@/lib/auth`.
   */
  auth?: {
    getSession: () => Promise<AssistantAuthSession | null>;
  };
  /** Presence desktop (isDesktopOnline / offline error). */
  desktopPresence?: {
    isDesktopOnline: (userId: string) => boolean;
    desktopOfflineError: (userId: string) => Record<string, unknown>;
  };
  /** Ops track (optionnel). */
  trackServerDebounced?: (
    evt: {
      level: string;
      kind: string;
      outcome?: string;
      reason?: string;
      ctx?: Record<string, unknown>;
    },
    intervalMs?: number,
  ) => void;
};
