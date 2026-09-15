/**
 * Store mails plateforme — sqlite **core** (v2 : outbox durable + threads +
 * comptes IMAP + réglages transport). Toute émission passe par `enqueue()`
 * (jamais bloquant) ; le worker outbox (app-runtime) draine la file.
 */

import crypto from "node:crypto";
import {
  PLATFORM_MAILS_CORE_SQL,
  ensureMailsFolderMigrationSql,
  ensureMailsInboundColumnsSql,
  type DraftMailInput,
  type EnqueueMailInput,
  type InboundAttachmentInput,
  type MailAccount,
  type MailEvent,
  type MailEventType,
  type PlatformMail,
  type PlatformMailsStore,
} from "./types.js";
import type { OutgoingMail } from "./transport.js";
import { MAIL_MAX_ATTACHMENT_TOTAL_BYTES } from "./transport.js";
import {
  openNodeSqliteDatabase,
  type OpenSqliteDatabase,
  type SqliteDatabase,
} from "./sqlite-driver.js";
import {
  computeThreadId,
  deleteInboxEmail,
  emailsReady,
  getInboxAttachment,
  getInboxEmail,
  insertInboundEmail,
  listInboxEmails,
  markInboxEmailRead,
  moveInboxEmail,
  ensureMailsInboxSchema,
} from "./inbox-queries.js";
import type {
  InboxEmailDetail,
  InboxEmailListItem,
  InboundEmailInput,
} from "./types.js";

function now(): string {
  return new Date().toISOString();
}

function joinAddrs(v: string[] | string | undefined | null): string {
  if (!v) return "";
  if (Array.isArray(v)) {
    return v.map((s) => String(s || "").trim()).filter(Boolean).join(", ");
  }
  return String(v).trim();
}

export function splitAddrs(v: string | null | undefined): string[] {
  if (!v) return [];
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type Row = {
  id: string;
  user_id: string;
  to_addr: string;
  subject: string;
  body: string;
  status: string;
  provider_id: string | null;
  from_addr?: string;
  message_id?: string | null;
  folder?: string;
  read_at?: string | null;
  brand_email_id?: string | null;
  text_body?: string | null;
  html_body?: string | null;
  received_at?: string | null;
  raw_headers?: string | null;
  cc?: string | null;
  bcc?: string | null;
  reply_to?: string | null;
  in_reply_to?: string | null;
  references_list?: string | null;
  thread_id?: string | null;
  account_id?: string | null;
  provider_message_id?: string | null;
  retry_count?: number;
  next_attempt_at?: string | null;
  last_error?: string | null;
  sent_at?: string | null;
  delivered_at?: string | null;
  created_at: string;
  updated_at: string;
};

function fromRow(r: Row): PlatformMail {
  return {
    id: r.id,
    userId: r.user_id,
    to: r.to_addr,
    subject: r.subject,
    body: r.body,
    status: r.status as PlatformMail["status"],
    providerId: r.provider_id,
    from: r.from_addr || "",
    messageId: r.message_id ?? null,
    folder: r.folder || "outbox",
    readAt: r.read_at ?? null,
    brandEmailId: r.brand_email_id ?? null,
    textBody: r.text_body ?? null,
    htmlBody: r.html_body ?? null,
    receivedAt: r.received_at ?? null,
    rawHeaders: r.raw_headers ?? null,
    cc: r.cc ?? null,
    bcc: r.bcc ?? null,
    replyTo: r.reply_to ?? null,
    inReplyTo: r.in_reply_to ?? null,
    references: r.references_list ?? null,
    threadId: r.thread_id ?? null,
    accountId: r.account_id ?? null,
    providerMessageId: r.provider_message_id ?? null,
    retryCount: r.retry_count ?? 0,
    nextAttemptAt: r.next_attempt_at ?? null,
    lastError: r.last_error ?? null,
    sentAt: r.sent_at ?? null,
    deliveredAt: r.delivered_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

type AccountRow = {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: number;
  username: string;
  secret_ref: string;
  folders_json: string | null;
  last_uidvalidity: string | null;
  last_uid: number;
  sync_state: string;
  last_sync_at: string | null;
  last_error: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
};

function accountFromRow(r: AccountRow): MailAccount {
  return {
    id: r.id,
    label: r.label,
    host: r.host,
    port: r.port,
    secure: Boolean(r.secure),
    username: r.username,
    secretRef: r.secret_ref,
    foldersJson: r.folders_json,
    lastUidvalidity: r.last_uidvalidity,
    lastUid: r.last_uid,
    syncState: r.sync_state,
    lastSyncAt: r.last_sync_at,
    lastError: r.last_error,
    enabled: Boolean(r.enabled),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export type MailAccountInput = {
  label: string;
  host: string;
  port?: number;
  secure?: boolean;
  username: string;
  secretRef: string;
  foldersJson?: string | null;
  enabled?: boolean;
};

export type MailAccountPatch = Partial<MailAccountInput>;

export type MailAccountSyncPatch = {
  lastUidvalidity?: string | null;
  lastUid?: number;
  syncState?: string;
  lastSyncAt?: string | null;
  lastError?: string | null;
};

export type SqliteMailsStore = PlatformMailsStore & {
  close(): void;
  readonly dbPath: string;
  /** Accès DB pour routes / tests. */
  readonly db: SqliteDatabase;
  emailsReady(): boolean;
  listInbox(opts?: {
    folder?: string;
    q?: string;
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
  }): { rows: InboxEmailListItem[]; total: number; unread: number };
  getInbox(id: string): InboxEmailDetail | null;
  getAttachment(
    emailId: string,
    attachmentId: string,
  ): { filename: string; content_type: string; data: Buffer } | null;
  markRead(id: string, read: boolean): boolean;
  moveMail(id: string, folder: string): boolean;
  deleteMail(id: string): boolean;
  insertInboundFull(
    input: InboundEmailInput,
  ): { ok: true; id: string; duplicate?: boolean } | { ok: false; error: string };

  /** ── Drafts / envoi ─────────────────────────────────────────────── */
  updateDraft(
    id: string,
    patch: Omit<DraftMailInput, "userId">,
  ): PlatformMail | null;
  /** Draft → queued (folder outbox) + événement `queued`. */
  sendDraft(id: string, actorUserId?: string): PlatformMail;
  /** Ajoute une PJ sortante (BLOB) à un mail existant (draft/queued). */
  addAttachment(
    mailId: string,
    att: { filename?: string; contentType?: string; data: Buffer },
  ):
    | { ok: true; id: string; sizeBytes: number }
    | { ok: false; error: string };
  /** Total octets PJ d'un mail (limite 25 Mo). */
  attachmentsTotalBytes(mailId: string): number;

  /** ── Outbox durable (worker) ────────────────────────────────────── */
  /** Claim atomique du prochain mail dû (`queued` && next_attempt_at <= now). */
  claimNextOutbox(nowIso?: string): PlatformMail | null;
  countDueOutbox(nowIso?: string): number;
  markSent(id: string, providerMessageId?: string | null): void;
  scheduleRetry(id: string, error: string, nextAttemptAtIso: string): void;
  markFailedPermanent(id: string, error: string): void;
  recordEvent(
    mailId: string,
    type: MailEventType,
    opts?: { detail?: string | null; provider?: string | null },
  ): void;
  listEvents(mailId: string): MailEvent[];
  /** Webhook statuts (Resend) — update par provider_message_id. */
  applyProviderStatus(
    providerMessageId: string,
    status: "sent" | "delivered" | "bounced" | "complained",
    detail?: string | null,
  ): { id: string } | null;
  /** OutgoingMail complet (PJ Buffer incluses) pour un transport. */
  getOutgoing(id: string): OutgoingMail | null;

  /** ── Threads ────────────────────────────────────────────────────── */
  listThread(threadId: string): InboxEmailListItem[];

  /** ── Réglages transport (mail_settings) ─────────────────────────── */
  getSetting(key: string): string | null;
  setSetting(key: string, value: string | null): void;
  getAllSettings(): Record<string, string>;

  /** ── Comptes IMAP ───────────────────────────────────────────────── */
  listAccounts(): MailAccount[];
  getAccount(id: string): MailAccount | null;
  createAccount(input: MailAccountInput): MailAccount;
  updateAccount(id: string, patch: MailAccountPatch): MailAccount | null;
  deleteAccount(id: string): boolean;
  updateAccountSync(id: string, patch: MailAccountSyncPatch): void;
};

export type CreateSqliteMailsStoreOptions = {
  coreDbPath: string;
  openDatabase?: OpenSqliteDatabase;
  /** Limite PJ par mail en octets (défaut 25 Mo). */
  maxAttachmentTotalBytes?: number;
};

export function createSqliteMailsStore(
  opts: CreateSqliteMailsStoreOptions,
): SqliteMailsStore {
  const open = opts.openDatabase || openNodeSqliteDatabase;
  const db: SqliteDatabase = open(opts.coreDbPath);
  ensureMailsInboxSchema(db);
  for (const sql of ensureMailsFolderMigrationSql()) {
    try {
      db.exec(sql);
    } catch {
      /* best effort */
    }
  }

  const maxAttachmentBytes =
    opts.maxAttachmentTotalBytes ?? MAIL_MAX_ATTACHMENT_TOTAL_BYTES;

  function persist(mail: PlatformMail): void {
    db.prepare(
      `INSERT INTO creezio_platform_mails
      (id, user_id, to_addr, subject, body, status, provider_id,
       from_addr, message_id, folder, read_at, brand_email_id,
       text_body, html_body, received_at, raw_headers,
       cc, bcc, reply_to, in_reply_to, references_list, thread_id,
       account_id, provider_message_id, retry_count, next_attempt_at,
       last_error, sent_at, delivered_at,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        to_addr = excluded.to_addr,
        subject = excluded.subject,
        body = excluded.body,
        status = excluded.status,
        provider_id = excluded.provider_id,
        from_addr = excluded.from_addr,
        message_id = excluded.message_id,
        folder = excluded.folder,
        read_at = excluded.read_at,
        brand_email_id = excluded.brand_email_id,
        text_body = excluded.text_body,
        html_body = excluded.html_body,
        received_at = excluded.received_at,
        raw_headers = excluded.raw_headers,
        cc = excluded.cc,
        bcc = excluded.bcc,
        reply_to = excluded.reply_to,
        in_reply_to = excluded.in_reply_to,
        references_list = excluded.references_list,
        thread_id = excluded.thread_id,
        account_id = excluded.account_id,
        provider_message_id = excluded.provider_message_id,
        retry_count = excluded.retry_count,
        next_attempt_at = excluded.next_attempt_at,
        last_error = excluded.last_error,
        sent_at = excluded.sent_at,
        delivered_at = excluded.delivered_at,
        updated_at = excluded.updated_at`,
    ).run(
      mail.id,
      mail.userId,
      mail.to,
      mail.subject,
      mail.body,
      mail.status,
      mail.providerId,
      mail.from || "",
      mail.messageId ?? null,
      mail.folder || "outbox",
      mail.readAt ?? null,
      mail.brandEmailId ?? null,
      mail.textBody ?? null,
      mail.htmlBody ?? null,
      mail.receivedAt ?? null,
      mail.rawHeaders ?? null,
      mail.cc ?? null,
      mail.bcc ?? null,
      mail.replyTo ?? null,
      mail.inReplyTo ?? null,
      mail.references ?? null,
      mail.threadId ?? null,
      mail.accountId ?? null,
      mail.providerMessageId ?? null,
      mail.retryCount ?? 0,
      mail.nextAttemptAt ?? null,
      mail.lastError ?? null,
      mail.sentAt ?? null,
      mail.deliveredAt ?? null,
      mail.createdAt,
      mail.updatedAt,
    );
  }

  function getRow(id: string): Row | undefined {
    return db
      .prepare(`SELECT * FROM creezio_platform_mails WHERE id = ?`)
      .get(id) as Row | undefined;
  }

  function recordEventInternal(
    mailId: string,
    type: MailEventType,
    detail?: string | null,
    provider?: string | null,
  ): void {
    db.prepare(
      `INSERT INTO creezio_platform_mail_events
       (id, mail_id, type, detail, provider, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      mailId,
      type,
      detail ?? null,
      provider ?? null,
      now(),
    );
  }

  function buildOutgoingBase(input: EnqueueMailInput | DraftMailInput): {
    to: string;
    cc: string | null;
    bcc: string | null;
    replyTo: string | null;
    subject: string;
    text: string | null;
    html: string | null;
    inReplyTo: string | null;
    references: string | null;
  } {
    const text =
      ("text" in input ? input.text : null) ??
      ("body" in input ? (input as DraftMailInput).body : null) ??
      null;
    return {
      to: joinAddrs(input.to),
      cc: joinAddrs(input.cc) || null,
      bcc: joinAddrs(input.bcc) || null,
      replyTo: (input.replyTo || "").trim() || null,
      subject: String(input.subject || "").trim(),
      text,
      html: input.html ?? null,
      inReplyTo: (input.inReplyTo || "").trim() || null,
      references:
        input.references && input.references.length
          ? input.references.join(" ")
          : null,
    };
  }

  const store: SqliteMailsStore = {
    db,
    dbPath: opts.coreDbPath,
    close() {
      db.close?.();
    },
    emailsReady() {
      return emailsReady(db);
    },
    listInbox(listOpts) {
      return listInboxEmails(db, listOpts);
    },
    getInbox(id) {
      return getInboxEmail(db, id);
    },
    getAttachment(emailId, attachmentId) {
      return getInboxAttachment(db, emailId, attachmentId);
    },
    markRead(id, read) {
      return markInboxEmailRead(db, id, read);
    },
    moveMail(id, folder) {
      return moveInboxEmail(db, id, folder);
    },
    deleteMail(id) {
      return deleteInboxEmail(db, id);
    },
    insertInboundFull(input) {
      return insertInboundEmail(db, input);
    },

    createDraft(input) {
      const ts = now();
      const base = buildOutgoingBase(input);
      const mail: PlatformMail = {
        id: crypto.randomUUID(),
        userId: input.userId,
        to: base.to,
        subject: base.subject,
        body: base.text || "",
        status: "draft",
        providerId: null,
        folder: "drafts",
        cc: base.cc,
        bcc: base.bcc,
        replyTo: base.replyTo,
        textBody: base.text,
        htmlBody: base.html,
        inReplyTo: base.inReplyTo,
        references: base.references,
        threadId: base.inReplyTo
          ? computeThreadId(db, {
              inReplyTo: base.inReplyTo,
              references: base.references,
            })
          : null,
        createdAt: ts,
        updatedAt: ts,
      };
      persist(mail);
      return mail;
    },

    updateDraft(id, patch) {
      const row = getRow(id);
      if (!row || row.status !== "draft") return null;
      const cur = fromRow(row);
      const base = buildOutgoingBase({ userId: cur.userId, ...patch });
      const next: PlatformMail = {
        ...cur,
        to: patch.to !== undefined ? base.to : cur.to,
        cc: patch.cc !== undefined ? base.cc : cur.cc,
        bcc: patch.bcc !== undefined ? base.bcc : cur.bcc,
        replyTo: patch.replyTo !== undefined ? base.replyTo : cur.replyTo,
        subject: patch.subject !== undefined ? base.subject : cur.subject,
        textBody:
          patch.text !== undefined || patch.body !== undefined
            ? base.text
            : cur.textBody,
        htmlBody: patch.html !== undefined ? base.html : cur.htmlBody,
        inReplyTo:
          patch.inReplyTo !== undefined ? base.inReplyTo : cur.inReplyTo,
        references:
          patch.references !== undefined ? base.references : cur.references,
        updatedAt: now(),
      };
      next.body = next.textBody || "";
      persist(next);
      return next;
    },

    enqueue(input) {
      const ts = now();
      const base = buildOutgoingBase(input);
      if (!base.to) throw new Error("to_required");
      if (!base.subject) throw new Error("subject_required");
      const id = crypto.randomUUID();
      const mail: PlatformMail = {
        id,
        userId: (input.userId || "system").trim() || "system",
        to: base.to,
        subject: base.subject,
        body: base.text || "",
        status: "queued",
        providerId: null,
        from: (input.from || "").trim(),
        folder: "outbox",
        cc: base.cc,
        bcc: base.bcc,
        replyTo: base.replyTo,
        textBody: base.text,
        htmlBody: base.html,
        rawHeaders: input.headers ? JSON.stringify(input.headers) : null,
        inReplyTo: base.inReplyTo,
        references: base.references,
        accountId: input.accountId ?? null,
        threadId:
          computeThreadId(db, {
            inReplyTo: base.inReplyTo,
            references: base.references,
          }) ?? id,
        retryCount: 0,
        nextAttemptAt: ts,
        createdAt: ts,
        updatedAt: ts,
      };
      const run = () => {
        persist(mail);
        for (const att of input.attachments || []) {
          const data = decodeAttachment(att);
          if (!data) continue;
          insertAttachmentRow(db, mail.id, att.filename, att.content_type, data);
        }
        recordEventInternal(mail.id, "queued");
        return mail;
      };
      const total = (input.attachments || []).reduce(
        (sum, a) => sum + Math.ceil((a.content_base64 || "").length * 0.75),
        0,
      );
      if (total > maxAttachmentBytes) {
        throw new Error("attachments_too_large");
      }
      if (db.transaction) return db.transaction(run);
      return run();
    },

    sendDraft(id, actorUserId) {
      const row = getRow(id);
      if (!row) throw new Error("not_found");
      if (actorUserId && row.user_id !== actorUserId) {
        throw new Error("forbidden");
      }
      if (row.status !== "draft") throw new Error("not_a_draft");
      const cur = fromRow(row);
      if (!cur.to.trim()) throw new Error("to_required");
      if (!cur.subject.trim()) throw new Error("subject_required");
      const ts = now();
      const next: PlatformMail = {
        ...cur,
        status: "queued",
        folder: "outbox",
        threadId:
          cur.threadId ??
          computeThreadId(db, {
            inReplyTo: cur.inReplyTo,
            references: cur.references,
          }) ??
          cur.id,
        retryCount: 0,
        nextAttemptAt: ts,
        updatedAt: ts,
      };
      persist(next);
      recordEventInternal(id, "queued");
      return next;
    },

    addAttachment(mailId, att) {
      const row = getRow(mailId);
      if (!row) return { ok: false, error: "not_found" };
      if (row.status !== "draft" && row.status !== "queued") {
        return { ok: false, error: "mail_not_editable" };
      }
      const total = store.attachmentsTotalBytes(mailId) + att.data.length;
      if (total > maxAttachmentBytes) {
        return { ok: false, error: "attachments_too_large" };
      }
      const id = insertAttachmentRow(
        db,
        mailId,
        att.filename,
        att.contentType,
        att.data,
      );
      return { ok: true, id, sizeBytes: att.data.length };
    },

    attachmentsTotalBytes(mailId) {
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(size_bytes), 0) AS total
           FROM creezio_platform_mail_attachments WHERE mail_id = ?`,
        )
        .get(mailId) as { total: number } | undefined;
      return row?.total ?? 0;
    },

    claimNextOutbox(nowIso) {
      const ts = nowIso || now();
      for (let i = 0; i < 5; i += 1) {
        const cand = db
          .prepare(
            `SELECT id FROM creezio_platform_mails
             WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
             ORDER BY next_attempt_at ASC, created_at ASC LIMIT 1`,
          )
          .get(ts) as { id: string } | undefined;
        if (!cand) return null;
        const res = db
          .prepare(
            `UPDATE creezio_platform_mails
             SET status = 'sending', updated_at = ?
             WHERE id = ? AND status = 'queued'`,
          )
          .run(now(), cand.id);
        if ((res.changes ?? 0) > 0) {
          const row = getRow(cand.id);
          return row ? fromRow(row) : null;
        }
      }
      return null;
    },

    countDueOutbox(nowIso) {
      const ts = nowIso || now();
      const row = db
        .prepare(
          `SELECT COUNT(*) AS c FROM creezio_platform_mails
           WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)`,
        )
        .get(ts) as { c: number } | undefined;
      return row?.c ?? 0;
    },

    markSent(id, providerMessageId) {
      db.prepare(
        `UPDATE creezio_platform_mails
         SET status = 'sent', folder = 'sent', provider_message_id = ?,
             sent_at = ?, last_error = NULL, next_attempt_at = NULL,
             updated_at = ?
         WHERE id = ?`,
      ).run(providerMessageId ?? null, now(), now(), id);
    },

    scheduleRetry(id, error, nextAttemptAtIso) {
      db.prepare(
        `UPDATE creezio_platform_mails
         SET status = 'queued', retry_count = retry_count + 1,
             last_error = ?, next_attempt_at = ?, updated_at = ?
         WHERE id = ?`,
      ).run(error, nextAttemptAtIso, now(), id);
    },

    markFailedPermanent(id, error) {
      db.prepare(
        `UPDATE creezio_platform_mails
         SET status = 'failed_permanent', last_error = ?,
             next_attempt_at = NULL, updated_at = ?
         WHERE id = ?`,
      ).run(error, now(), id);
    },

    recordEvent(mailId, type, eventOpts) {
      recordEventInternal(
        mailId,
        type,
        eventOpts?.detail ?? null,
        eventOpts?.provider ?? null,
      );
    },

    listEvents(mailId) {
      return db
        .prepare(
          `SELECT id, mail_id, type, detail, provider, created_at
           FROM creezio_platform_mail_events
           WHERE mail_id = ? ORDER BY created_at ASC, rowid ASC`,
        )
        .all(mailId) as MailEvent[];
    },

    applyProviderStatus(providerMessageId, status, detail) {
      const row = db
        .prepare(
          `SELECT id, status FROM creezio_platform_mails
           WHERE provider_message_id = ? LIMIT 1`,
        )
        .get(providerMessageId) as { id: string; status: string } | undefined;
      if (!row) return null;
      if (status === "delivered") {
        db.prepare(
          `UPDATE creezio_platform_mails
           SET status = 'delivered', delivered_at = ?, updated_at = ?
           WHERE id = ?`,
        ).run(now(), now(), row.id);
        recordEventInternal(row.id, "delivered", detail ?? null, "resend");
      } else if (status === "bounced") {
        db.prepare(
          `UPDATE creezio_platform_mails
           SET status = 'bounced', updated_at = ? WHERE id = ?`,
        ).run(now(), row.id);
        recordEventInternal(row.id, "bounced", detail ?? null, "resend");
      } else if (status === "complained") {
        recordEventInternal(row.id, "complained", detail ?? null, "resend");
      } else {
        recordEventInternal(row.id, "sent", detail ?? null, "resend");
      }
      return { id: row.id };
    },

    getOutgoing(id) {
      const row = getRow(id);
      if (!row) return null;
      const mail = fromRow(row);
      const atts = db
        .prepare(
          `SELECT id, filename, content_type, data
           FROM creezio_platform_mail_attachments WHERE mail_id = ?
           ORDER BY filename, id`,
        )
        .all(id) as Array<{
        id: string;
        filename: string;
        content_type: string;
        data: Buffer | Uint8Array;
      }>;
      let headers: Record<string, string> | undefined;
      if (mail.rawHeaders && mail.status !== "inbound") {
        try {
          headers = JSON.parse(mail.rawHeaders) as Record<string, string>;
        } catch {
          headers = undefined;
        }
      }
      return {
        id: mail.id,
        from: mail.from || undefined,
        to: splitAddrs(mail.to),
        cc: splitAddrs(mail.cc),
        bcc: splitAddrs(mail.bcc),
        replyTo: mail.replyTo || undefined,
        subject: mail.subject,
        text: mail.textBody || undefined,
        html: mail.htmlBody || undefined,
        headers,
        inReplyTo: mail.inReplyTo || undefined,
        references: mail.references
          ? mail.references.split(/\s+/).filter(Boolean)
          : undefined,
        attachments: atts.map((a) => ({
          filename: a.filename,
          contentType: a.content_type,
          content: Buffer.isBuffer(a.data)
            ? a.data
            : Buffer.from(a.data as Uint8Array),
        })),
      };
    },

    listThread(threadId) {
      return db
        .prepare(
          `
SELECT e.id, e.message_id, e.from_addr, e.to_addr, e.subject,
  COALESCE(e.received_at, e.sent_at, e.created_at) AS received_at,
  e.read_at, e.folder, e.status, e.thread_id,
  (SELECT COUNT(*) FROM creezio_platform_mail_attachments a WHERE a.mail_id = e.id) AS has_attachments,
  CASE
    WHEN e.text_body IS NOT NULL AND trim(e.text_body) != '' THEN substr(e.text_body, 1, 180)
    WHEN e.html_body IS NOT NULL THEN substr(e.html_body, 1, 180)
    WHEN e.body IS NOT NULL AND trim(e.body) != '' THEN substr(e.body, 1, 180)
    ELSE NULL
  END AS preview
FROM creezio_platform_mails e
WHERE e.thread_id = ?
ORDER BY COALESCE(e.received_at, e.sent_at, e.created_at) ASC, e.id ASC
`,
        )
        .all(threadId) as InboxEmailListItem[];
    },

    getSetting(key) {
      const row = db
        .prepare(
          `SELECT value FROM creezio_platform_mail_settings WHERE key = ?`,
        )
        .get(key) as { value: string | null } | undefined;
      return row?.value ?? null;
    },

    setSetting(key, value) {
      if (value === null) {
        db.prepare(
          `DELETE FROM creezio_platform_mail_settings WHERE key = ?`,
        ).run(key);
        return;
      }
      db.prepare(
        `INSERT INTO creezio_platform_mail_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
           updated_at = excluded.updated_at`,
      ).run(key, value, now());
    },

    getAllSettings() {
      const rows = db
        .prepare(`SELECT key, value FROM creezio_platform_mail_settings`)
        .all() as Array<{ key: string; value: string | null }>;
      const out: Record<string, string> = {};
      for (const r of rows) {
        if (r.value != null) out[r.key] = r.value;
      }
      return out;
    },

    listAccounts() {
      const rows = db
        .prepare(
          `SELECT * FROM creezio_platform_mail_accounts ORDER BY created_at ASC`,
        )
        .all() as AccountRow[];
      return rows.map(accountFromRow);
    },

    getAccount(id) {
      const row = db
        .prepare(`SELECT * FROM creezio_platform_mail_accounts WHERE id = ?`)
        .get(id) as AccountRow | undefined;
      return row ? accountFromRow(row) : null;
    },

    createAccount(input) {
      const ts = now();
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO creezio_platform_mail_accounts
         (id, label, host, port, secure, username, secret_ref, folders_json,
          last_uidvalidity, last_uid, sync_state, last_sync_at, last_error,
          enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 'idle', NULL, NULL, ?, ?, ?)`,
      ).run(
        id,
        input.label.trim(),
        input.host.trim(),
        input.port ?? 993,
        input.secure === false ? 0 : 1,
        input.username.trim(),
        input.secretRef.trim(),
        input.foldersJson ?? null,
        input.enabled === false ? 0 : 1,
        ts,
        ts,
      );
      return store.getAccount(id)!;
    },

    updateAccount(id, patch) {
      const cur = store.getAccount(id);
      if (!cur) return null;
      db.prepare(
        `UPDATE creezio_platform_mail_accounts
         SET label = ?, host = ?, port = ?, secure = ?, username = ?,
             secret_ref = ?, folders_json = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        (patch.label ?? cur.label).trim(),
        (patch.host ?? cur.host).trim(),
        patch.port ?? cur.port,
        (patch.secure ?? cur.secure) ? 1 : 0,
        (patch.username ?? cur.username).trim(),
        (patch.secretRef ?? cur.secretRef).trim(),
        patch.foldersJson !== undefined ? patch.foldersJson : cur.foldersJson,
        (patch.enabled ?? cur.enabled) ? 1 : 0,
        now(),
        id,
      );
      return store.getAccount(id);
    },

    deleteAccount(id) {
      const res = db
        .prepare(`DELETE FROM creezio_platform_mail_accounts WHERE id = ?`)
        .run(id);
      return (res.changes ?? 0) > 0;
    },

    updateAccountSync(id, patch) {
      const cur = store.getAccount(id);
      if (!cur) return;
      db.prepare(
        `UPDATE creezio_platform_mail_accounts
         SET last_uidvalidity = ?, last_uid = ?, sync_state = ?,
             last_sync_at = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        patch.lastUidvalidity !== undefined
          ? patch.lastUidvalidity
          : cur.lastUidvalidity,
        patch.lastUid !== undefined ? patch.lastUid : cur.lastUid,
        patch.syncState !== undefined ? patch.syncState : cur.syncState,
        patch.lastSyncAt !== undefined ? patch.lastSyncAt : cur.lastSyncAt,
        patch.lastError !== undefined ? patch.lastError : cur.lastError,
        now(),
        id,
      );
    },

    insertInbound(input) {
      const attachments = (input.attachments || []) as InboundAttachmentInput[];
      let headers: Record<string, string> | null = null;
      if (input.rawHeaders) {
        try {
          headers = JSON.parse(input.rawHeaders) as Record<string, string>;
        } catch {
          headers = null;
        }
      }
      const result = insertInboundEmail(db, {
        message_id: input.messageId,
        from: input.from,
        to: input.to,
        subject: input.subject,
        text: input.textBody ?? input.body ?? null,
        html: input.htmlBody ?? null,
        received_at: input.receivedAt,
        headers,
        attachments,
        userId: input.userId,
      });
      if (!result.ok) {
        throw new Error(result.error);
      }
      if (input.brandEmailId) {
        db.prepare(
          `UPDATE creezio_platform_mails SET brand_email_id = ?, updated_at = ? WHERE id = ?`,
        ).run(input.brandEmailId, now(), result.id);
      }
      return fromRow(getRow(result.id)!);
    },

    list(userId) {
      const rows = db
        .prepare(
          `SELECT * FROM creezio_platform_mails WHERE user_id = ?
           ORDER BY updated_at DESC`,
        )
        .all(userId) as Row[];
      return rows.map(fromRow);
    },

    get(id) {
      const row = getRow(id);
      return row ? fromRow(row) : undefined;
    },
  };

  return store;
}

function decodeAttachment(att: InboundAttachmentInput): Buffer | null {
  const clean = String(att.content_base64 || "").replace(/\s/g, "");
  if (!clean) return null;
  try {
    const data = Buffer.from(clean, "base64");
    return data.length ? data : null;
  } catch {
    return null;
  }
}

function insertAttachmentRow(
  db: SqliteDatabase,
  mailId: string,
  filename: string | undefined,
  contentType: string | undefined,
  data: Buffer,
): string {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO creezio_platform_mail_attachments
     (id, mail_id, filename, content_type, size_bytes, data)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    mailId,
    (filename || "piece-jointe").slice(0, 255),
    (contentType || "application/octet-stream").slice(0, 127),
    data.length,
    data,
  );
  return id;
}
