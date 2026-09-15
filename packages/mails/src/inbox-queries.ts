/**
 * Requêtes boîte mail plateforme (SoT kit — core.db).
 * v2 : dossiers étendus (inbox/sent/drafts/outbox/archive/trash), threads
 * (`thread_id` calculé à l'insertion via In-Reply-To/References), move.
 */

import crypto from "node:crypto";
import type { SqliteDatabase } from "./sqlite-driver.js";
import type {
  InboxEmailAttachmentMeta,
  InboxEmailDetail,
  InboxEmailListItem,
  InboundEmailInput,
} from "./types.js";
import { PLATFORM_MAILS_CORE_SQL, ensureMailsInboundColumnsSql } from "./types.js";

const KIT_FOLDERS = new Set([
  "inbox",
  "sent",
  "drafts",
  "outbox",
  "archive",
  "trash",
]);

function execEachStatement(db: SqliteDatabase, sql: string): void {
  for (const raw of sql.split(/;\s*\n/)) {
    const stmt = raw.trim();
    if (!stmt) continue;
    try {
      db.exec(stmt);
    } catch {
      /* index v2 sur colonne pas encore migrée — seconde passe après ALTERs */
    }
  }
}

export function ensureMailsInboxSchema(db: SqliteDatabase): void {
  // 1re passe : tables (les index v2 peuvent échouer sur un schéma v1).
  execEachStatement(db, PLATFORM_MAILS_CORE_SQL);
  // ALTERs idempotents (migration colonnes v1 → v2).
  for (const sql of ensureMailsInboundColumnsSql()) {
    try {
      db.exec(sql);
    } catch {
      /* already exists */
    }
  }
  // 2de passe : index v2 maintenant que les colonnes existent.
  execEachStatement(db, PLATFORM_MAILS_CORE_SQL);
}

export function emailsReady(db: SqliteDatabase): boolean {
  try {
    const row = db
      .prepare(
        `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='creezio_platform_mails'`,
      )
      .get() as { ok?: number } | undefined;
    const att = db
      .prepare(
        `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='creezio_platform_mail_attachments'`,
      )
      .get() as { ok?: number } | undefined;
    return Boolean(row?.ok) && Boolean(att?.ok);
  } catch {
    return false;
  }
}

function previewFrom(
  text: string | null | undefined,
  html: string | null | undefined,
): string {
  const raw =
    (text || "").trim() ||
    (html || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return raw.slice(0, 180);
}

function decodeBase64(b64: string): Buffer | null {
  const clean = String(b64 || "").replace(/\s/g, "");
  if (!clean) return null;
  try {
    const data = Buffer.from(clean, "base64");
    return data.length ? data : null;
  } catch {
    return null;
  }
}

/**
 * Threading : hériter du `thread_id` d'un mail connu cité par
 * `In-Reply-To` / `References` ; sinon null (l'appelant prend l'id du mail).
 */
export function computeThreadId(
  db: SqliteDatabase,
  input: {
    inReplyTo?: string | null;
    references?: string | null;
  },
): string | null {
  const candidates: string[] = [];
  if (input.inReplyTo?.trim()) candidates.push(input.inReplyTo.trim());
  if (input.references) {
    for (const ref of input.references.split(/\s+/)) {
      const clean = ref.trim();
      if (clean) candidates.push(clean);
    }
  }
  for (const messageId of candidates) {
    try {
      const row = db
        .prepare(
          `SELECT id, thread_id FROM creezio_platform_mails
           WHERE message_id = ? LIMIT 1`,
        )
        .get(messageId) as { id: string; thread_id: string | null } | undefined;
      if (row) return row.thread_id || row.id;
    } catch {
      /* colonne absente = pas de threads */
    }
  }
  return null;
}

const LIST_SELECT = `
SELECT e.id, e.message_id, e.from_addr, e.to_addr, e.subject,
  COALESCE(e.received_at, e.sent_at, e.created_at) AS received_at,
  e.read_at, e.folder, e.status, e.thread_id, e.last_error,
  (SELECT COUNT(*) FROM creezio_platform_mail_attachments a WHERE a.mail_id = e.id) AS has_attachments,
  CASE
    WHEN e.text_body IS NOT NULL AND trim(e.text_body) != '' THEN substr(e.text_body, 1, 180)
    WHEN e.html_body IS NOT NULL THEN substr(e.html_body, 1, 180)
    WHEN e.body IS NOT NULL AND trim(e.body) != '' THEN substr(e.body, 1, 180)
    ELSE NULL
  END AS preview
FROM creezio_platform_mails e
`;

export function listInboxEmails(
  db: SqliteDatabase,
  opts: {
    folder?: string;
    q?: string;
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {},
): { rows: InboxEmailListItem[]; total: number; unread: number } {
  if (!emailsReady(db)) return { rows: [], total: 0, unread: 0 };
  const folder = KIT_FOLDERS.has(opts.folder || "")
    ? (opts.folder as string)
    : "inbox";
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const params: unknown[] = [folder];
  let where = `e.folder = ?`;
  if (opts.unreadOnly) {
    where += ` AND e.read_at IS NULL`;
  }
  if (opts.q?.trim()) {
    where += ` AND (e.subject LIKE ? OR e.from_addr LIKE ? OR e.to_addr LIKE ? OR IFNULL(e.text_body,'') LIKE ? OR IFNULL(e.body,'') LIKE ?)`;
    const like = `%${opts.q.trim()}%`;
    params.push(like, like, like, like, like);
  }
  const total =
    (
      db
        .prepare(`SELECT COUNT(*) AS c FROM creezio_platform_mails e WHERE ${where}`)
        .get(...params) as { c: number } | undefined
    )?.c ?? 0;
  const unread =
    (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM creezio_platform_mails
           WHERE folder = ? AND status = 'inbound' AND read_at IS NULL`,
        )
        .get(folder) as { c: number } | undefined
    )?.c ?? 0;
  const rows = db
    .prepare(
      `${LIST_SELECT}
WHERE ${where}
ORDER BY COALESCE(e.received_at, e.sent_at, e.created_at) DESC, e.id DESC
LIMIT ? OFFSET ?
`,
    )
    .all(...params, limit, offset) as InboxEmailListItem[];
  return { rows, total, unread };
}

export function getInboxEmail(
  db: SqliteDatabase,
  id: string,
): InboxEmailDetail | null {
  if (!emailsReady(db) || !id) return null;
  const row = db
    .prepare(
      `
SELECT id, message_id, from_addr, to_addr, subject, text_body, html_body, body,
  COALESCE(received_at, sent_at, created_at) AS received_at, read_at, folder,
  raw_headers, status, thread_id, cc, bcc, reply_to, in_reply_to,
  references_list, provider_message_id, retry_count, next_attempt_at,
  last_error, sent_at, delivered_at, account_id
FROM creezio_platform_mails WHERE id = ?
`,
    )
    .get(id) as
    | {
        id: string;
        message_id: string | null;
        from_addr: string;
        to_addr: string;
        subject: string;
        text_body: string | null;
        html_body: string | null;
        body: string;
        received_at: string;
        read_at: string | null;
        folder: string;
        raw_headers: string | null;
        status: string;
        thread_id: string | null;
        cc: string | null;
        bcc: string | null;
        reply_to: string | null;
        in_reply_to: string | null;
        references_list: string | null;
        provider_message_id: string | null;
        retry_count: number;
        next_attempt_at: string | null;
        last_error: string | null;
        sent_at: string | null;
        delivered_at: string | null;
        account_id: string | null;
      }
    | undefined;
  if (!row) return null;
  const attachments = db
    .prepare(
      `
SELECT id, filename, content_type, size_bytes
FROM creezio_platform_mail_attachments WHERE mail_id = ? ORDER BY filename, id
`,
    )
    .all(id) as InboxEmailAttachmentMeta[];
  const textBody = row.text_body ?? (row.html_body ? null : row.body || null);
  return {
    id: row.id,
    message_id: row.message_id,
    from_addr: row.from_addr,
    to_addr: row.to_addr,
    subject: row.subject,
    received_at: row.received_at,
    read_at: row.read_at,
    folder: row.folder,
    status: row.status,
    thread_id: row.thread_id,
    has_attachments: attachments.length,
    preview: previewFrom(textBody, row.html_body),
    text_body: textBody,
    html_body: row.html_body,
    raw_headers: row.raw_headers,
    attachments,
    cc: row.cc,
    bcc: row.bcc,
    reply_to: row.reply_to,
    in_reply_to: row.in_reply_to,
    references: row.references_list,
    provider_message_id: row.provider_message_id,
    retry_count: row.retry_count ?? 0,
    next_attempt_at: row.next_attempt_at,
    last_error: row.last_error,
    sent_at: row.sent_at,
    delivered_at: row.delivered_at,
    account_id: row.account_id,
  };
}

export function getInboxAttachment(
  db: SqliteDatabase,
  emailId: string,
  attachmentId: string,
): { filename: string; content_type: string; data: Buffer } | null {
  if (!emailsReady(db) || !emailId || !attachmentId) return null;
  const row = db
    .prepare(
      `
SELECT filename, content_type, data
FROM creezio_platform_mail_attachments WHERE id = ? AND mail_id = ?
`,
    )
    .get(attachmentId, emailId) as
    | { filename: string; content_type: string; data: Buffer | Uint8Array }
    | undefined;
  if (!row) return null;
  const data = Buffer.isBuffer(row.data)
    ? row.data
    : Buffer.from(row.data as Uint8Array);
  return {
    filename: row.filename,
    content_type: row.content_type,
    data,
  };
}

export function markInboxEmailRead(
  db: SqliteDatabase,
  id: string,
  read: boolean,
): boolean {
  if (!emailsReady(db) || !id) return false;
  const r = db
    .prepare(
      read
        ? `UPDATE creezio_platform_mails SET read_at = ?, updated_at = ? WHERE id = ?`
        : `UPDATE creezio_platform_mails SET read_at = NULL, updated_at = ? WHERE id = ?`,
    )
    .run(
      ...(read
        ? [new Date().toISOString(), new Date().toISOString(), id]
        : [new Date().toISOString(), id]),
    );
  return (r.changes ?? 0) > 0;
}

/** Déplace un mail vers un dossier kit (archive/trash/inbox…). */
export function moveInboxEmail(
  db: SqliteDatabase,
  id: string,
  folder: string,
): boolean {
  if (!emailsReady(db) || !id) return false;
  if (!KIT_FOLDERS.has(folder)) return false;
  const r = db
    .prepare(
      `UPDATE creezio_platform_mails SET folder = ?, updated_at = ? WHERE id = ?`,
    )
    .run(folder, new Date().toISOString(), id);
  return (r.changes ?? 0) > 0;
}

export function deleteInboxEmail(db: SqliteDatabase, id: string): boolean {
  if (!emailsReady(db) || !id) return false;
  const run = () => {
    db.prepare(`DELETE FROM creezio_platform_mail_attachments WHERE mail_id = ?`).run(
      id,
    );
    try {
      db.prepare(`DELETE FROM creezio_platform_mail_events WHERE mail_id = ?`).run(
        id,
      );
    } catch {
      /* table absente sur très vieux schémas */
    }
    return (
      (db.prepare(`DELETE FROM creezio_platform_mails WHERE id = ?`).run(id).changes ??
        0) > 0
    );
  };
  if (db.transaction) return db.transaction(run);
  return run();
}

export function insertInboundEmail(
  db: SqliteDatabase,
  input: InboundEmailInput,
): { ok: true; id: string; duplicate?: boolean } | { ok: false; error: string } {
  ensureMailsInboxSchema(db);
  if (!emailsReady(db)) {
    return { ok: false, error: "Schema creezio_platform_mails absent" };
  }

  const messageId = (input.message_id || "").trim() || null;
  if (messageId) {
    const existing = db
      .prepare(
        `SELECT id FROM creezio_platform_mails WHERE message_id = ? LIMIT 1`,
      )
      .get(messageId) as { id: string } | undefined;
    if (existing) return { ok: true, id: existing.id, duplicate: true };
  }

  const from = String(input.from || "").trim();
  const to = String(input.to || "").trim();
  if (!from || !to) return { ok: false, error: "from et to requis" };

  const subject = String(input.subject || "").trim() || "(sans objet)";
  const text = input.text ?? null;
  const html = input.html ?? null;
  const receivedAt = (input.received_at || "").trim() || new Date().toISOString();
  const headersJson = input.headers ? JSON.stringify(input.headers) : null;
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  const userId = (input.userId || "system").trim() || "system";
  const body = (text || html || "").toString();
  const id = cryptoRandomId();
  const ts = new Date().toISOString();

  // Threading : In-Reply-To / References depuis les headers inbound.
  const headerLookup = (name: string): string | null => {
    if (!input.headers) return null;
    for (const [k, v] of Object.entries(input.headers)) {
      if (k.toLowerCase() === name) return String(v || "").trim() || null;
    }
    return null;
  };
  const inReplyTo = headerLookup("in-reply-to");
  const referencesRaw = headerLookup("references");
  const threadId =
    computeThreadId(db, { inReplyTo, references: referencesRaw }) ?? id;

  const run = () => {
    db.prepare(
      `
INSERT INTO creezio_platform_mails
  (id, user_id, to_addr, subject, body, status, provider_id,
   from_addr, message_id, folder, read_at, brand_email_id,
   text_body, html_body, received_at, raw_headers,
   in_reply_to, references_list, thread_id, account_id,
   created_at, updated_at)
VALUES (?, ?, ?, ?, ?, 'inbound', NULL, ?, ?, 'inbox', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
    ).run(
      id,
      userId,
      to,
      subject,
      body,
      from,
      messageId,
      text,
      html,
      receivedAt,
      headersJson,
      inReplyTo,
      referencesRaw,
      threadId,
      input.account_id ?? null,
      ts,
      ts,
    );

    const insAtt = db.prepare(
      `
INSERT INTO creezio_platform_mail_attachments
  (id, mail_id, filename, content_type, size_bytes, data)
VALUES (?, ?, ?, ?, ?, ?)
`,
    );
    for (const att of attachments) {
      const data = decodeBase64(att.content_base64);
      if (!data) continue;
      const filename = (att.filename || "piece-jointe").slice(0, 255);
      const contentType = (att.content_type || "application/octet-stream").slice(
        0,
        127,
      );
      insAtt.run(
        cryptoRandomId(),
        id,
        filename,
        contentType,
        data.length,
        data,
      );
    }
    return id;
  };

  try {
    const mailId = db.transaction ? db.transaction(run) : run();
    return { ok: true, id: mailId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function cryptoRandomId(): string {
  return crypto.randomUUID();
}
