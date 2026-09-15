import type { Migration } from "../types.js";

const migration: Migration = {
  version: 23,
  name: "users",
  up(db) {
    db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'collaborator')),
  active INTEGER NOT NULL DEFAULT 1,
  permissions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);`);
  },
};
export default migration;
