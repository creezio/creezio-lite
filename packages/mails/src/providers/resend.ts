/**
 * Transport Resend — `fetch` natif, zéro dépendance.
 * POST https://api.resend.com/emails + `Idempotency-Key: <mail.id>` ;
 * erreurs 429/5xx/réseau → retryable.
 */
import type {
  MailSendResult,
  MailTransport,
  OutgoingMail,
} from "../transport.js";

export const RESEND_API_BASE_URL = "https://api.resend.com";

export type ResendMailTransportConfig = {
  apiKey: string;
  /** Expéditeur par défaut si `mail.from` absent. */
  from?: string;
  /** Base URL surchargée pour les tests (mock HTTP local). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export function createResendMailTransport(
  cfg: ResendMailTransportConfig,
): MailTransport {
  const baseUrl = (cfg.baseUrl || RESEND_API_BASE_URL).replace(/\/$/, "");
  const doFetch = cfg.fetchImpl || fetch;

  return {
    id: "resend",
    capabilities: {
      attachments: true,
      idempotency: true,
      statusWebhooks: true,
    },
    async send(mail: OutgoingMail): Promise<MailSendResult> {
      if (!cfg.apiKey) {
        return {
          ok: false,
          error: "resend_unconfigured (RESEND_API_KEY requis)",
          retryable: false,
        };
      }
      const from = mail.from || cfg.from;
      if (!from) {
        return {
          ok: false,
          error: "from_required (identité expéditeur non configurée)",
          retryable: false,
        };
      }
      const payload: Record<string, unknown> = {
        from,
        to: mail.to,
        subject: mail.subject,
      };
      if (mail.cc?.length) payload.cc = mail.cc;
      if (mail.bcc?.length) payload.bcc = mail.bcc;
      if (mail.replyTo) payload.reply_to = mail.replyTo;
      if (mail.html) payload.html = mail.html;
      if (mail.text) payload.text = mail.text;
      const headers: Record<string, string> = { ...(mail.headers || {}) };
      if (mail.inReplyTo) headers["In-Reply-To"] = mail.inReplyTo;
      if (mail.references?.length) {
        headers["References"] = mail.references.join(" ");
      }
      if (Object.keys(headers).length) payload.headers = headers;
      if (mail.attachments?.length) {
        payload.attachments = mail.attachments.map((a) => ({
          filename: a.filename,
          content_type: a.contentType,
          content: a.content.toString("base64"),
        }));
      }

      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/emails`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            "Content-Type": "application/json",
            // Idempotency-Key Resend (24 h, ≤256 car.) = uuid kit.
            "Idempotency-Key": mail.id.slice(0, 256),
          },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          retryable: true,
        };
      }
      if (res.ok) {
        let providerMessageId: string | undefined;
        try {
          const json = (await res.json()) as { id?: string };
          providerMessageId = json?.id || undefined;
        } catch {
          providerMessageId = undefined;
        }
        return { ok: true, providerMessageId };
      }
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 500);
      } catch {
        detail = "";
      }
      return {
        ok: false,
        error: `resend_http_${res.status}${detail ? `: ${detail}` : ""}`,
        retryable: res.status === 429 || res.status >= 500,
      };
    },
    async verify() {
      if (!cfg.apiKey) {
        return { ok: false, error: "resend_unconfigured" };
      }
      try {
        const res = await doFetch(`${baseUrl}/domains`, {
          headers: { Authorization: `Bearer ${cfg.apiKey}` },
        });
        if (res.ok) return { ok: true };
        return { ok: false, error: `resend_http_${res.status}` };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
}
