/**
 * Table core des intégrations tierces (ADR-integrations-store).
 * Migration kit `app_runtime_005_integrations` (create-brand-kernel).
 */
export const INTEGRATIONS_CORE_SQL = `
CREATE TABLE IF NOT EXISTS creezio_integrations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  secret_enc TEXT NOT NULL,
  secret_hint TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  n8n_credential_id TEXT,
  n8n_synced_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creezio_integrations_provider
  ON creezio_integrations(provider);
`;
