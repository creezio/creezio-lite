/**
 * Step 022 — OAuth 2.1 pour le serveur MCP (ChatGPT connectors).
 * Porté depuis scripts/migrate_v22_mcp_oauth.py.
 */

import type { Migration } from "../types.js";

const DDL = `
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id                  TEXT PRIMARY KEY,
  client_secret_hash         TEXT,
  client_name                TEXT,
  redirect_uris              TEXT NOT NULL,
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'client_secret_post',
  grant_types                TEXT NOT NULL DEFAULT 'authorization_code,refresh_token',
  scope                      TEXT,
  created_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code_hash             TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL,
  redirect_uri          TEXT NOT NULL,
  scope                 TEXT NOT NULL,
  resource              TEXT,
  code_challenge        TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  expires_at            INTEGER NOT NULL,
  used_at               INTEGER,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL,
  scope      TEXT NOT NULL,
  resource   TEXT,
  expires_at INTEGER NOT NULL,
  rotated_at INTEGER,
  revoked_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_codes_expires
  ON mcp_oauth_codes (expires_at);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_rt_client
  ON mcp_oauth_refresh_tokens (client_id);
`;

const migration: Migration = {
  version: 22,
  name: "mcp-oauth",
  up(db) {
    db.exec(DDL);
  },
};

export default migration;
