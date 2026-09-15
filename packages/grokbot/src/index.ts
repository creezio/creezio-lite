/**
 * @creezio/grokbot — module natif de pilotage d'agents cloud (API Cursor v1).
 *
 * Le kit fournit le moteur générique : client REST complet de l'API
 * Cursor Cloud Agents (agents, runs, usage, artefacts, modèles, repos),
 * mount `/api/v1/modules/grokbot/*` avec miroir local des agents en
 * brand.db et token stocké côté serveur (jamais renvoyé en clair). La
 * marque compose `grokbotMigrations()` dans ses migrations brand et
 * enregistre `createGrokbotMount({ defaults })` sous l'id `grokbot`.
 */

export {
  GROKBOT_CONFIG_KEYS,
  GROKBOT_DEFAULT_API_BASE_URL,
  GROKBOT_SCHEMA_SQL,
  grokbotMigrations,
  maskToken,
  mergeGrokbotConfig,
  type GrokbotModuleConfig,
} from "./config.js";

export {
  createCursorAgentsClient,
  type CursorAgentsClient,
  type CursorApiResult,
  type CursorClientOptions,
  type CursorCreateAgentBody,
  type CursorCreateRunBody,
  type CursorFetch,
  type CursorPromptInput,
  type CursorQuery,
} from "./client.js";

export { createGrokbotMount, type GrokbotMountOptions } from "./mount.js";
