import type { Migration } from "../types.js";

/**
 * Boîte mail locale — mails reçus via Cloudflare Email Routing → Worker →
 * POST /api/v1/email/inbound (stockage SQLite chez le client).
 */
const migration: Migration = {
  // 34 (et non 32 comme sur la branche d'origine) : 32 = plugin_acl,
  // 33 = database_automations étaient déjà sur main. Jamais appliquée en 32
  // sur aucun poste (branche jamais mergée) — renumérotation sûre.
  version: 34,
  name: "emails",
  up(db) {
    db.exec(`
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  from_addr TEXT NOT NULL DEFAULT '',
  to_addr TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  text_body TEXT,
  html_body TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT,
  folder TEXT NOT NULL DEFAULT 'inbox',
  raw_headers TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_message_id
  ON emails(message_id) WHERE message_id IS NOT NULL AND message_id != '';

CREATE INDEX IF NOT EXISTS idx_emails_folder_received
  ON emails(folder, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_emails_read_at
  ON emails(read_at);

CREATE TABLE IF NOT EXISTS email_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  filename TEXT NOT NULL DEFAULT 'piece-jointe',
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  data BLOB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_attachments_email
  ON email_attachments(email_id);
`);
  },
};

export default migration;
