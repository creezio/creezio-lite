import type { Migration } from "../types.js";

/**
 * ACL d'affichage des plugins par collaborateur (décision Q7 multi-profils) :
 * liste d'user_id autorisés PAR plugin. Fail-closed : aucun enregistrement
 * pour un plugin = visible par l'owner uniquement (opt-in explicite par
 * collaborateur, géré depuis le cockpit).
 */
const migration: Migration = {
  version: 32,
  name: "plugin-acl",
  up(db) {
    db.exec(`
CREATE TABLE IF NOT EXISTS plugin_acl (
  plugin_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (plugin_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_plugin_acl_user ON plugin_acl(user_id);
`);
  },
};

export default migration;
