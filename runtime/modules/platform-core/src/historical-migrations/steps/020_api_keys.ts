/**
 * Step 020 — clés API publiques (Zapier / Make / n8n).
 * Porté depuis scripts/migrate_v20_api_keys.py.
 */

import type { Migration } from "../types.js";

const DDL = `
CREATE TABLE IF NOT EXISTS api_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL,
  scopes       TEXT NOT NULL DEFAULT 'full',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_active
  ON api_keys (key_hash)
  WHERE revoked_at IS NULL;
`;

const migration: Migration = {
  version: 20,
  name: "api-keys",
  up(db) {
    db.exec(DDL);
  },
};

export default migration;
