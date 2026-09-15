/**
 * Config + schéma du module natif Granola (ADR-module-natif-hybride).
 *
 * La marque déclare ses défauts (clé API, secret de signature, base URL
 * publique) via `createGranolaMount({ defaults })` ; les overrides posés à
 * chaud (PUT config) vivent en `brand.db` (table `granola_settings`) et le
 * runtime sert toujours `merge(défauts, override DB)`.
 *
 * Imports type-only pour ne pas créer de cycle runtime.
 */

import type { SqliteMigration } from "@creezio/platform-core";

/** Base URL officielle de l'API publique Granola. */
export const GRANOLA_DEFAULT_API_BASE_URL = "https://public-api.granola.ai";

/** Config effective du module (défauts marque + override DB). */
export type GranolaModuleConfig = {
  /** Clé API Granola (`grn_…`) — Settings → Connectors → API keys. */
  apiKey?: string;
  /**
   * Secret de signature webhook (`whsec_…`) — retourné UNE SEULE FOIS à la
   * création de l'endpoint (UI Granola ou `POST register-webhook`).
   */
  signingSecret?: string;
  /**
   * Origine publique HTTPS du serveur marque (ex. `https://crm.exemple.fr`).
   * Sert à composer l'URL webhook à coller dans Granola. À défaut, l'URL
   * est dérivée des en-têtes de la requête (`x-forwarded-*` / `host`).
   */
  publicBaseUrl?: string;
  /** Override base URL API (tests / proxy). Défaut : API publique Granola. */
  apiBaseUrl?: string;
  /** Id `whe_…` de l'endpoint enregistré via `POST register-webhook`. */
  webhookEndpointId?: string;
};

/** Champs texte autorisés dans l'override DB (PUT config). */
export const GRANOLA_CONFIG_KEYS = [
  "apiKey",
  "signingSecret",
  "publicBaseUrl",
  "apiBaseUrl",
  "webhookEndpointId",
] as const;

export const GRANOLA_SCHEMA_SQL = `-- Module natif Granola (@creezio/granola)

CREATE TABLE IF NOT EXISTS granola_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS granola_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  note_id TEXT,
  occurred_at TEXT,
  received_at TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  deliveries INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_granola_events_received
  ON granola_events (received_at DESC);

CREATE TABLE IF NOT EXISTS granola_notes (
  id TEXT PRIMARY KEY,
  title TEXT,
  summary TEXT,
  owner_json TEXT,
  note_created_at TEXT,
  note_updated_at TEXT,
  synced_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_granola_notes_synced
  ON granola_notes (synced_at DESC);
`;

/** Colonnes dossier + transcript local (jamais renuméroter granola_001). */
export const GRANOLA_NOTES_TRANSCRIPT_SQL = `
ALTER TABLE granola_notes ADD COLUMN folder_id TEXT;
ALTER TABLE granola_notes ADD COLUMN transcript_json TEXT;
CREATE INDEX IF NOT EXISTS idx_granola_notes_folder
  ON granola_notes (folder_id);
`;

/** Migrations brand.db du module (à composer dans `brand-migrations.ts`). */
export function granolaMigrations(): SqliteMigration[] {
  return [
    { id: "granola_001_core", sql: GRANOLA_SCHEMA_SQL },
    { id: "granola_002_note_transcript_folder", sql: GRANOLA_NOTES_TRANSCRIPT_SQL },
  ];
}

/** Merge pur défauts marque + override DB (les champs override priment). */
export function mergeGranolaConfig(
  defaults: GranolaModuleConfig | undefined,
  override: Partial<GranolaModuleConfig> | null | undefined,
): GranolaModuleConfig {
  const out: GranolaModuleConfig = { ...defaults };
  if (override && typeof override === "object") {
    for (const key of GRANOLA_CONFIG_KEYS) {
      const v = (override as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim()) out[key] = v.trim();
    }
  }
  return out;
}

/** Masque un secret pour l'affichage (`grn_ab…` + longueur). */
export function maskSecret(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return "…".repeat(4);
  return `${value.slice(0, 7)}…${value.slice(-4)}`;
}
