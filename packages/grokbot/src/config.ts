/**
 * Config + schéma du module natif GrokBot (pilotage d'agents cloud via
 * l'API Cursor v1 — https://api.cursor.com).
 *
 * La marque déclare ses défauts via `createGrokbotMount({ defaults })` ;
 * le token utilisateur (clé API Cursor) posé à chaud (PUT config) vit en
 * `brand.db` (table `grokbot_settings`) et le runtime sert toujours
 * `merge(défauts, override DB)`.
 *
 * Imports type-only pour ne pas créer de cycle runtime.
 */

import type { SqliteMigration } from "@creezio/platform-core";

/** Base URL officielle de l'API Cursor (Cloud Agents v1). */
export const GROKBOT_DEFAULT_API_BASE_URL = "https://api.cursor.com";

/** Config effective du module (défauts marque + override DB). */
export type GrokbotModuleConfig = {
  /** Clé API Cursor (Dashboard → API Keys, ou clé service account). */
  apiKey?: string;
  /** Override base URL API (tests / proxy). Défaut : api.cursor.com. */
  apiBaseUrl?: string;
  /** Dépôt GitHub proposé par défaut à la création d'un agent. */
  defaultRepoUrl?: string;
  /** Modèle proposé par défaut (id retourné par GET /v1/models). */
  defaultModelId?: string;
};

/** Champs texte autorisés dans l'override DB (PUT config). */
export const GROKBOT_CONFIG_KEYS = [
  "apiKey",
  "apiBaseUrl",
  "defaultRepoUrl",
  "defaultModelId",
] as const;

export const GROKBOT_SCHEMA_SQL = `-- Module natif GrokBot (@creezio/grokbot)

CREATE TABLE IF NOT EXISTS grokbot_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grokbot_agents (
  id TEXT PRIMARY KEY,
  name TEXT,
  status TEXT,
  prompt TEXT,
  repo_url TEXT,
  branch TEXT,
  pr_url TEXT,
  model TEXT,
  url TEXT,
  latest_run_id TEXT,
  created_at TEXT,
  updated_at TEXT,
  synced_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_grokbot_agents_created
  ON grokbot_agents (created_at DESC);
`;

/** Migrations brand.db du module (à composer dans `brand-migrations.ts`). */
export function grokbotMigrations(): SqliteMigration[] {
  return [{ id: "grokbot_001_core", sql: GROKBOT_SCHEMA_SQL }];
}

/** Merge pur défauts marque + override DB (les champs override priment). */
export function mergeGrokbotConfig(
  defaults: GrokbotModuleConfig | undefined,
  override: Partial<GrokbotModuleConfig> | null | undefined,
): GrokbotModuleConfig {
  const out: GrokbotModuleConfig = { ...defaults };
  if (override && typeof override === "object") {
    for (const key of GROKBOT_CONFIG_KEYS) {
      const v = (override as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim()) out[key] = v.trim();
    }
  }
  return out;
}

/** Masque le token pour l'affichage (jamais renvoyé en clair). */
export function maskToken(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return "…".repeat(4);
  return `${value.slice(0, 7)}…${value.slice(-4)}`;
}
