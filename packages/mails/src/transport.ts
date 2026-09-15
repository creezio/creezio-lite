/**
 * Contrat unique `MailTransport` (v2) — remplace `MailProvider` v1.
 * Transports fournis par le kit : `smtp` (nodemailer dynamique, préréglage
 * Cloudflare Email Service), `resend` (fetch natif), `file-sink` (dev/CI).
 */

/** "Nom <a@b.c>" accepté. */
export type MailAddress = string;

export type OutgoingMailAttachment = {
  filename: string;
  contentType: string;
  /** Servi depuis creezio_platform_mail_attachments (BLOB). */
  content: Buffer;
};

export type OutgoingMail = {
  /** uuid kit = Idempotency-Key Resend. */
  id: string;
  /** Défaut : identité résolue par la config transport. */
  from?: MailAddress;
  to: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  replyTo?: MailAddress;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  /** Message-ID cité (threads). */
  inReplyTo?: string;
  references?: string[];
  attachments?: OutgoingMailAttachment[];
};

export type MailSendResult =
  | { ok: true; providerMessageId?: string }
  | { ok: false; error: string; retryable: boolean };

export type MailTransportId = "smtp" | "resend" | "file-sink";

export type MailTransport = {
  id: MailTransportId;
  capabilities: {
    attachments: boolean;
    /** resend : oui (Idempotency-Key). */
    idempotency: boolean;
    /** resend : oui (delivered/bounced via webhooks). */
    statusWebhooks: boolean;
  };
  send(mail: OutgoingMail): Promise<MailSendResult>;
  /** Test de connexion pour l'UI admin (SMTP verify / Resend GET domains). */
  verify?(): Promise<{ ok: boolean; error?: string }>;
};

/** Limite kit PJ sortantes par mail (25 Mo, configurable via mail_settings). */
export const MAIL_MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;
