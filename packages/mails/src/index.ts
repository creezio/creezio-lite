/**
 * @creezio/mails — mails plateforme v2 (SoT inbox + outbox durable +
 * transports multi-provider + IMAP + webhooks + UI).
 * Pas de templates marques.
 */

export type {
  DraftMailInput,
  EnqueueMailInput,
  InboxEmailAttachmentMeta,
  InboxEmailDetail,
  InboxEmailListItem,
  InboundAttachmentInput,
  InboundEmailInput,
  MailAccount,
  MailEvent,
  MailEventType,
  MailFolder,
  MailStatus,
  PlatformMail,
  PlatformMailAttachmentMeta,
  PlatformMailsStore,
} from "./types.js";
export {
  PLATFORM_MAILS_CORE_SQL,
  ensureMailsFolderMigrationSql,
  ensureMailsInboundColumnsSql,
} from "./types.js";

export type {
  MailAddress,
  MailSendResult,
  MailTransport,
  MailTransportId,
  OutgoingMail,
  OutgoingMailAttachment,
} from "./transport.js";
export { MAIL_MAX_ATTACHMENT_TOTAL_BYTES } from "./transport.js";

export type { MailsConfig } from "./config.js";
export {
  configureMails,
  getMailsConfig,
  resetMailsConfigForTests,
  resolveEmailDomain,
  resolveEmptyStateNoDomainHint,
  resolveInboundSecret,
  resolvePageSubtitle,
} from "./config.js";

export type {
  CreateSqliteMailsStoreOptions,
  MailAccountInput,
  MailAccountPatch,
  MailAccountSyncPatch,
  SqliteMailsStore,
} from "./sqlite-store.js";
export { createSqliteMailsStore, splitAddrs } from "./sqlite-store.js";
export type { OpenSqliteDatabase, SqliteDatabase } from "./sqlite-driver.js";
export { openNodeSqliteDatabase } from "./sqlite-driver.js";

export {
  FILE_SINK_TRANSPORT_ID,
  createFileSinkMailTransport,
} from "./providers/file-sink.js";
export type { CreateFileSinkMailTransportOptions } from "./providers/file-sink.js";
export {
  CLOUDFLARE_SMTP_PRESET,
  createSmtpMailTransport,
} from "./providers/smtp.js";
export type { SmtpMailTransportConfig } from "./providers/smtp.js";
export {
  RESEND_API_BASE_URL,
  createResendMailTransport,
} from "./providers/resend.js";
export type { ResendMailTransportConfig } from "./providers/resend.js";

export type {
  MailSecretBridge,
  MailTransportKind,
  ResolvedMailTransport,
} from "./transport-resolve.js";
export {
  MAIL_SETTINGS_KEYS,
  configureMailSecretBridge,
  describeMailTransportError,
  getMailSecretBridge,
  isMailTransportConfigured,
  resolveMailSecret,
  resolveMailTransport,
} from "./transport-resolve.js";
export type { MailSendState, MailSendStatus } from "./send-status.js";
export {
  MAIL_SEND_STATUS_SETTING_KEYS,
  classifyMailSendError,
  describeMailSendStatus,
  hasMailCredentials,
  isHardTransportError,
  isSendUnavailableError,
  persistMailSendStatus,
  probeMailSend,
  publicMailSettings,
  resolveMailSendStatus,
  summarizeMailSendError,
} from "./send-status.js";

export type {
  MailOutboxWorker,
  StartMailOutboxWorkerOptions,
} from "./outbox.js";
export {
  MAIL_OUTBOX_BACKOFF_BASE_MS,
  MAIL_OUTBOX_BACKOFF_MAX_MS,
  MAIL_OUTBOX_DEFAULT_INTERVAL_MS,
  MAIL_OUTBOX_MAX_ATTEMPTS,
  computeOutboxBackoffMs,
  startMailOutboxWorker,
} from "./outbox.js";

export type {
  ResendWebhookEvent,
  ResendWebhookOutcome,
  SvixHeaders,
} from "./webhooks/resend.js";
export {
  SVIX_TIMESTAMP_TOLERANCE_S,
  applyResendWebhookEvent,
  resolveResendWebhookSecret,
  verifySvixSignature,
} from "./webhooks/resend.js";
export {
  ingestResendInboundEmail,
  resendInboundEnabled,
} from "./inbound-resend.js";

export type { MailAccountPublic } from "./imap/accounts.js";
export {
  parseAccountCreateInput,
  parseAccountPatchInput,
  toPublicAccount,
} from "./imap/accounts.js";
export type {
  ImapSyncScheduler,
  SyncImapAccountResult,
} from "./imap/sync.js";
export {
  MAIL_IMAP_DEFAULT_POLL_MS,
  loadImapModules,
  resolveImapPollMs,
  startImapSyncScheduler,
  syncImapAccount,
  verifyImapAccount,
} from "./imap/sync.js";

export { createMailsApiMount } from "./api-mount.js";
export { indexKitInboundMail } from "./env-bridge.js";
export { getKitMailsStore, resetKitMailsStoreForTests } from "./env-store.js";

export {
  computeThreadId,
  ensureMailsInboxSchema,
  emailsReady,
  listInboxEmails,
  getInboxEmail,
  getInboxAttachment,
  markInboxEmailRead,
  moveInboxEmail,
  deleteInboxEmail,
  insertInboundEmail,
} from "./inbox-queries.js";

export type { EmailInboxRouteDeps, MailRouteActor } from "./email-routes.js";
export { createEmailInboxRoutes } from "./email-routes.js";

export type { MigrateBrandEmailsResult } from "./migrate-brand-emails.js";
export { migrateBrandEmailsToKit } from "./migrate-brand-emails.js";
