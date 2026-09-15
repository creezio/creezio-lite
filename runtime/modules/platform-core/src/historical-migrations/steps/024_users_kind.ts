import type { Migration } from "../types.js";
import { addColumnIfMissing, tableExists } from "../types.js";

const migration: Migration = {
  version: 24,
  name: "users-kind",
  up(db) {
    if (!tableExists(db, "users")) return;
    addColumnIfMissing(db, "users", "kind", "TEXT NOT NULL DEFAULT 'human'");
    db.exec("CREATE INDEX IF NOT EXISTS idx_users_kind ON users(kind)");
  },
};
export default migration;
