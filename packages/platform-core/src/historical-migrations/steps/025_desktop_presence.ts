import type { Migration } from "../types.js";
import { addColumnIfMissing, tableExists } from "../types.js";

const migration: Migration = {
  version: 25,
  name: "desktop-presence",
  up(db) {
    if (tableExists(db, "api_keys")) addColumnIfMissing(db, "api_keys", "user_id", "TEXT");
    if (tableExists(db, "mcp_oauth_codes")) addColumnIfMissing(db, "mcp_oauth_codes", "user_id", "TEXT");
    if (tableExists(db, "mcp_oauth_refresh_tokens")) addColumnIfMissing(db, "mcp_oauth_refresh_tokens", "user_id", "TEXT");
    db.exec(`
CREATE TABLE IF NOT EXISTS desktop_presence (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT NOT NULL,
  device_label TEXT, bridge_connected INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_desktop_presence_user ON desktop_presence(user_id);
CREATE INDEX IF NOT EXISTS idx_desktop_presence_seen ON desktop_presence(last_seen_at);`);
  },
};
export default migration;
