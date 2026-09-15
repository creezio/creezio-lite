/**
 * DDL assistant — tables dans sqlite **core** (Phase I2 + C1 rich fields).
 *
 * Décision figée : persistance cible = `resolveCoreDbPath` / SqliteRuntime core.
 * `resolveAssistantDbPath` (`assistant_chats.db`) reste un chemin **historique**
 * pour marques non migrées ; ne pas l’utiliser pour les nouveaux stores kit.
 *
 * C1 : colonnes `model` / `mode` / `user_id` / `sources_json` pour cutover
 * kit sans perte (voir ensureAssistantRichColumns).
 */
export const ASSISTANT_CORE_SQL = `
CREATE TABLE IF NOT EXISTS creezio_assistant_conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'chat',
  user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creezio_assistant_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL
    REFERENCES creezio_assistant_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  sources_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_creezio_assistant_messages_conv
  ON creezio_assistant_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_creezio_assistant_conversations_user
  ON creezio_assistant_conversations(user_id, updated_at);
`;

/** ALTER best-effort pour bases I2 déjà créées sans colonnes C1. */
export function ensureAssistantRichColumnsSql(): string[] {
  return [
    `ALTER TABLE creezio_assistant_conversations ADD COLUMN model TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE creezio_assistant_conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'chat'`,
    `ALTER TABLE creezio_assistant_conversations ADD COLUMN user_id TEXT`,
    `ALTER TABLE creezio_assistant_messages ADD COLUMN sources_json TEXT`,
  ];
}
