/** Schéma SQLite core — observabilité V2. */

export const OBSERVABILITY_CORE_SQL = `
CREATE TABLE IF NOT EXISTS creezio_obs_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  action TEXT NOT NULL,
  org_id TEXT,
  user_id TEXT,
  brand_id TEXT,
  plugin_id TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creezio_obs_kind_created
  ON creezio_obs_events(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_creezio_obs_org_created
  ON creezio_obs_events(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_creezio_obs_plugin_created
  ON creezio_obs_events(plugin_id, created_at);
`;
