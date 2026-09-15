-- Cache des synthèses IA (DB plugin — convention kit data/plugin.sqlite).
CREATE TABLE IF NOT EXISTS syntheses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  model TEXT,
  modules TEXT NOT NULL DEFAULT '[]',
  sample_rows INTEGER NOT NULL DEFAULT 0,
  prompt TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  dry INTEGER NOT NULL DEFAULT 0
);
