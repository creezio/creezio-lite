/**
 * Schéma plateforme mails v2 (core.db) + contrats store.
 * v2 : outbox durable (statuts étendus, retries, journal), threads,
 * comptes IMAP, réglages transport — voir docs/plans/PLAN-MAILS-NATIF.md.
 */

export type MailStatus =
  | "draft"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "bounced"
  | "failed"
  | "failed_permanent"
  | "inbound";

export type MailFolder =
  | "inbox"
  | "sent"
  | "drafts"
  | "outbox"
  | "archive"
  | "trash";

export type PlatformMailAttachmentMeta = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type PlatformMail = {
  id: string;
  userId: string;
  /** Destinataires principaux (chaîne "a@b.c, d@e.f"). */
  to: string;
  subject: string;
  body: string;
  status: MailStatus;
  providerId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Inbound / inbox */
  from?: string;
  messageId?: string | null;
  folder?: string;
  readAt?: string | null;
  /** @deprecated secondary brand id — cutover kit SoT ; garder pour migration */
  brandEmailId?: string | null;
  textBody?: string | null;
  htmlBody?: string | null;
  receivedAt?: string | null;
  rawHeaders?: string | null;
  /** v2 — envoi riche */
  cc?: string | null;
  bcc?: string | null;
  replyTo?: string | null;
  inReplyTo?: string | null;
  /** Message-IDs cités, séparés par des espaces (convention header References). */
  references?: string | null;
  threadId?: string | null;
  /** Compte IMAP source (inbound) — null = worker CF / Resend. */
  accountId?: string | null;
  providerMessageId?: string | null;
  /** v2 — outbox durable */
  retryCount?: number;
  nextAttemptAt?: string | null;
  lastError?: string | null;
  sentAt?: string | null;
  deliveredAt?: string | null;
};

export type MailEventType =
  | "queued"
  | "attempt"
  | "sent"
  | "delivered"
  | "bounced"
  | "complained"
  | "failed";

export type MailEvent = {
  id: string;
  mail_id: string;
  type: MailEventType;
  detail: string | null;
  provider: string | null;
  created_at: string;
};

export type MailAccount = {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  /** Référence secret (`integration://…`) — jamais la valeur en clair. */
  secretRef: string;
  /** Mapping IMAP→kit (JSON) — v1 : `{ "INBOX": "inbox" }`. */
  foldersJson: string | null;
  lastUidvalidity: string | null;
  lastUid: number;
  syncState: string;
  lastSyncAt: string | null;
  lastError: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InboundAttachmentInput = {
  filename?: string;
  content_type?: string;
  content_base64: string;
};

export type InboundEmailInput = {
  message_id?: string | null;
  from: string;
  to: string;
  subject?: string;
  text?: string | null;
  html?: string | null;
  received_at?: string | null;
  headers?: Record<string, string> | null;
  attachments?: InboundAttachmentInput[];
  userId?: string;
  /** Compte IMAP source (sync). */
  account_id?: string | null;
};

export type EnqueueMailInput = {
  userId?: string;
  from?: string;
  to: string[] | string;
  cc?: string[] | string;
  bcc?: string[] | string;
  replyTo?: string;
  subject: string;
  text?: string | null;
  html?: string | null;
  headers?: Record<string, string>;
  inReplyTo?: string | null;
  references?: string[] | null;
  accountId?: string | null;
  attachments?: InboundAttachmentInput[];
};

export type DraftMailInput = {
  userId: string;
  to?: string[] | string;
  cc?: string[] | string;
  bcc?: string[] | string;
  replyTo?: string;
  subject?: string;
  /** Compat v1 : body = texte. */
  body?: string;
  text?: string | null;
  html?: string | null;
  inReplyTo?: string | null;
  references?: string[] | null;
};

/** Shape API inbox (snake_case, compatible UI gold TF). */
export type InboxEmailListItem = {
  id: string;
  message_id: string | null;
  from_addr: string;
  to_addr: string;
  subject: string;
  received_at: string;
  read_at: string | null;
  folder: string;
  has_attachments: number;
  preview: string | null;
  /** v2 */
  status: string;
  thread_id: string | null;
  /** Présent surtout en outbox (échecs d'envoi). */
  last_error: string | null;
};

export type InboxEmailAttachmentMeta = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
};

export type InboxEmailDetail = InboxEmailListItem & {
  text_body: string | null;
  html_body: string | null;
  raw_headers: string | null;
  attachments: InboxEmailAttachmentMeta[];
  /** v2 */
  cc: string | null;
  bcc: string | null;
  reply_to: string | null;
  in_reply_to: string | null;
  references: string | null;
  provider_message_id: string | null;
  retry_count: number;
  next_attempt_at: string | null;
  last_error: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  account_id: string | null;
};

export type PlatformMailsStore = {
  createDraft(input: DraftMailInput): PlatformMail;
  /** Enqueue sortant — jamais bloquant (écriture SQLite locale). */
  enqueue(input: EnqueueMailInput): PlatformMail;
  /** Index / insert inbound (PJ inclus dans le kit SoT). */
  insertInbound?(input: {
    id?: string;
    userId: string;
    from: string;
    to: string;
    subject: string;
    body?: string;
    messageId?: string | null;
    brandEmailId?: string | null;
    textBody?: string | null;
    htmlBody?: string | null;
    receivedAt?: string | null;
    rawHeaders?: string | null;
    attachments?: InboundAttachmentInput[];
  }): PlatformMail;
  list(userId: string): PlatformMail[];
  get(id: string): PlatformMail | undefined;
};

export const PLATFORM_MAILS_CORE_SQL = `
CREATE TABLE IF NOT EXISTS creezio_platform_mails (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  provider_id TEXT,
  from_addr TEXT NOT NULL DEFAULT '',
  message_id TEXT,
  folder TEXT NOT NULL DEFAULT 'outbox',
  read_at TEXT,
  brand_email_id TEXT,
  text_body TEXT,
  html_body TEXT,
  received_at TEXT,
  raw_headers TEXT,
  cc TEXT,
  bcc TEXT,
  reply_to TEXT,
  in_reply_to TEXT,
  references_list TEXT,
  thread_id TEXT,
  account_id TEXT,
  provider_message_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creezio_platform_mails_user
  ON creezio_platform_mails(user_id, status);
CREATE INDEX IF NOT EXISTS idx_creezio_platform_mails_message
  ON creezio_platform_mails(message_id);
CREATE INDEX IF NOT EXISTS idx_creezio_platform_mails_folder_received
  ON creezio_platform_mails(folder, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_creezio_platform_mails_read_at
  ON creezio_platform_mails(read_at);
CREATE INDEX IF NOT EXISTS idx_creezio_platform_mails_outbox
  ON creezio_platform_mails(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_creezio_platform_mails_thread
  ON creezio_platform_mails(thread_id);
CREATE INDEX IF NOT EXISTS idx_creezio_platform_mails_provider_msg
  ON creezio_platform_mails(provider_message_id);

CREATE TABLE IF NOT EXISTS creezio_platform_mail_attachments (
  id TEXT PRIMARY KEY,
  mail_id TEXT NOT NULL REFERENCES creezio_platform_mails(id) ON DELETE CASCADE,
  filename TEXT NOT NULL DEFAULT 'piece-jointe',
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  data BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creezio_platform_mail_attachments_mail
  ON creezio_platform_mail_attachments(mail_id);

CREATE TABLE IF NOT EXISTS creezio_platform_mail_events (
  id TEXT PRIMARY KEY,
  mail_id TEXT NOT NULL REFERENCES creezio_platform_mails(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  detail TEXT,
  provider TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creezio_platform_mail_events_mail
  ON creezio_platform_mail_events(mail_id, created_at);

CREATE TABLE IF NOT EXISTS creezio_platform_mail_accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 993,
  secure INTEGER NOT NULL DEFAULT 1,
  username TEXT NOT NULL,
  secret_ref TEXT NOT NULL,
  folders_json TEXT,
  last_uidvalidity TEXT,
  last_uid INTEGER NOT NULL DEFAULT 0,
  sync_state TEXT NOT NULL DEFAULT 'idle',
  last_sync_at TEXT,
  last_error TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creezio_platform_mail_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);
`;

export function ensureMailsInboundColumnsSql(): string[] {
  return [
    `ALTER TABLE creezio_platform_mails ADD COLUMN from_addr TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN message_id TEXT`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN folder TEXT NOT NULL DEFAULT 'outbox'`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN read_at TEXT`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN brand_email_id TEXT`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN text_body TEXT`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN html_body TEXT`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN received_at TEXT`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN raw_headers TEXT`,
    // v2 — outbox durable + threads + comptes
    `ALTER TABLE creezio_platform_mails ADD COLUMN cc TEXT`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN bcc TEXT`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN reply_to TEXT`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN in_reply_to TEXT`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN references_list TEXT`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN thread_id TEXT`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN account_id TEXT`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN provider_message_id TEXT`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN next_attempt_at TEXT`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN last_error TEXT`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN sent_at TEXT`,
    `ALTER TABLE creezio_platform_mails ADD COLUMN delivered_at TEXT`,
  ];
}

/**
 * Réalignement idempotent des dossiers legacy v1 (draft/sent rangés en
 * `outbox`) sur la sémantique v2 (`drafts` / `sent`).
 */
export function ensureMailsFolderMigrationSql(): string[] {
  return [
    `UPDATE creezio_platform_mails SET folder = 'drafts'
       WHERE status = 'draft' AND folder = 'outbox'`,
    `UPDATE creezio_platform_mails SET folder = 'sent'
       WHERE status = 'sent' AND folder = 'outbox'`,
  ];
}
