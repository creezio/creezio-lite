/**
 * Types partagés UI webmail — miroir des réponses `/api/v1/email/*`.
 */

export type MailListRow = {
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
  status: string;
  thread_id: string | null;
  last_error?: string | null;
};

export type MailAttachmentMeta = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
};

export type MailDetail = MailListRow & {
  text_body: string | null;
  html_body: string | null;
  raw_headers: string | null;
  attachments: MailAttachmentMeta[];
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

export type MailEventRow = {
  id: string;
  mail_id: string;
  type: string;
  detail: string | null;
  provider: string | null;
  created_at: string;
};

export type MailMeta = {
  ready: boolean;
  domain: string | null;
  inboundConfigured: boolean;
  uiEnabled: boolean;
  pageSubtitle?: string;
  emptyStateNoDomainHint?: string;
  transport: {
    kind: string | null;
    source: string;
    preset: string | null;
    configured: boolean;
    error?: string | null;
    errorCode?: string | null;
    send?: MailSendStatus;
  };
};

export type MailSendState =
  | "unconfigured"
  | "unavailable"
  | "ok"
  | "unknown";

export type MailSendStatus = {
  state: MailSendState;
  credentialsPresent: boolean;
  configured: boolean;
  sendOk: boolean | null;
  code: string | null;
  error: string | null;
  message: string;
};

/** Libellé FR pour les codes d'erreur transport / outbox. */
export function describeMailError(code: string | null | undefined): string {
  const c = (code || "").trim();
  if (!c) return "";
  if (c === "transport_unconfigured") {
    return "Aucun transport d'envoi configuré (Paramètres → Email).";
  }
  if (c === "resend_secret_unresolved") {
    return "Clé Resend manquante ou illisible.";
  }
  if (c.startsWith("file_sink_dir_required")) {
    return "Répertoire file-sink manquant.";
  }
  if (c.startsWith("smtp_unconfigured")) {
    return "SMTP incomplet.";
  }
  if (c.includes("nodemailer_absent")) {
    return "nodemailer_absent — installez nodemailer ou utilisez file-sink.";
  }
  if (c === "send_unavailable") {
    return "Token présent, envoi réel indisponible (domaine non onboardé / 550).";
  }
  return c;
}

export type MailFolderId =
  | "inbox"
  | "sent"
  | "drafts"
  | "outbox"
  | "archive"
  | "trash";

export const MAIL_FOLDERS: Array<{ id: MailFolderId; label: string }> = [
  { id: "inbox", label: "Boîte de réception" },
  { id: "sent", label: "Envoyés" },
  { id: "drafts", label: "Brouillons" },
  { id: "outbox", label: "File d'attente" },
  { id: "archive", label: "Archives" },
  { id: "trash", label: "Corbeille" },
];

export const MAIL_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  queued: "En attente d'envoi",
  sending: "Envoi en cours",
  sent: "Envoyé",
  delivered: "Délivré",
  bounced: "Rejeté (bounce)",
  failed: "Échec (nouvel essai prévu)",
  failed_permanent: "Échec définitif",
  inbound: "Reçu",
};

export function formatMailDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function mailFromLabel(from: string): string {
  const m = from.match(/^"?([^"<]+)"?\s*<|^([^<@]+)/);
  const name = (m?.[1] || m?.[2] || from).trim();
  return name || from;
}

export function stripHtmlPreview(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
