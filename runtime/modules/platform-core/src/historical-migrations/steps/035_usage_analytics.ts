import type { Migration } from "../types.js";

/**
 * Step 035 — analytics d'usage (pages, clics, temps passé, acteurs humain/IA).
 * Table événementielle pour le module Admin → Analytics.
 * (034 = emails ; renuméroté à l'intégration sur main.)
 */
const migration: Migration = {
  version: 35,
  name: "usage-analytics",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        event_type TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'ui',
        label TEXT,
        path TEXT,
        referrer_path TEXT,
        user_id TEXT,
        username TEXT,
        user_kind TEXT NOT NULL DEFAULT 'human',
        user_role TEXT,
        session_id TEXT,
        duration_ms INTEGER,
        meta_json TEXT,
        user_agent TEXT,
        surface TEXT NOT NULL DEFAULT 'crm'
      );
      CREATE INDEX IF NOT EXISTS idx_usage_events_created
        ON usage_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_events_user_created
        ON usage_events(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_events_type_created
        ON usage_events(event_type, created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_events_path_created
        ON usage_events(path, created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_events_kind_created
        ON usage_events(user_kind, created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_events_session
        ON usage_events(session_id, created_at);
    `);
  },
};

export default migration;
