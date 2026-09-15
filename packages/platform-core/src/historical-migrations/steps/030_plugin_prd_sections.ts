import { addColumnIfMissing, type Migration } from "../types.js";

/**
 * Product Hub v2 — PRD étendu (sections structurées) + interview itérative.
 *
 * `sections_json` porte les sections obligatoires du PRD (data_inputs,
 * data_outputs, db_schema, user_stories, screens, wireframes) ;
 * `plugin_clarifications` porte les rounds de questions structurées posées
 * par l'agent et les réponses saisies par l'utilisateur dans le chat.
 */
const migration: Migration = {
  version: 30,
  name: "plugin-prd-sections",
  up(db) {
    addColumnIfMissing(
      db,
      "plugin_prd_revisions",
      "sections_json",
      "TEXT NOT NULL DEFAULT '{}'",
    );
    db.exec(`
CREATE TABLE IF NOT EXISTS plugin_clarifications (
  id TEXT PRIMARY KEY,
  plugin_product_id TEXT NOT NULL REFERENCES plugin_products(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  questions_json TEXT NOT NULL DEFAULT '[]',
  answers_json TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_plugin_clarifications_product
  ON plugin_clarifications(plugin_product_id, status, round);
`);
  },
};

export default migration;
