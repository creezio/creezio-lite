/** DDL auth — tables dans sqlite **core** (pas brand). */
export const AUTH_CORE_SQL = `
CREATE TABLE IF NOT EXISTS creezio_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  stay_logged_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creezio_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES creezio_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_creezio_sessions_user
  ON creezio_sessions(user_id);
`;
