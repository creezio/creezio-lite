/**
 * Inbound Resend (opt-in `MAIL_INBOUND_RESEND=1`) — 3ᵉ source de réception.
 * Le webhook `email.received` ne porte que les métadonnées : le corps et
 * les PJ sont récupérés via l'API Receiving
 * (`GET /emails/receiving/{email_id}` + `/attachments`, download_url 1 h),
 * puis insérés via `insertInboundFull` (dédup `message_id`).
 */

import type { SqliteMailsStore } from "./sqlite-store.js";
import type { InboundAttachmentInput } from "./types.js";
import { RESEND_API_BASE_URL } from "./providers/resend.js";

export function resendInboundEnabled(): boolean {
  return (process.env.MAIL_INBOUND_RESEND || "").trim() === "1";
}

export type IngestResendInboundOptions = {
  store: SqliteMailsStore;
  apiKey: string;
  emailId: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export async function ingestResendInboundEmail(
  opts: IngestResendInboundOptions,
): Promise<
  | { ok: true; id: string; duplicate?: boolean }
  | { ok: false; error: string }
> {
  const baseUrl = (opts.baseUrl || RESEND_API_BASE_URL).replace(/\/$/, "");
  const doFetch = opts.fetchImpl || fetch;
  const auth = { Authorization: `Bearer ${opts.apiKey}` };

  let detail: {
    message_id?: string;
    from?: string;
    to?: string[] | string;
    subject?: string;
    text?: string;
    html?: string;
    created_at?: string;
    headers?: Record<string, string> | Array<{ name: string; value: string }>;
    attachments?: Array<{ id?: string; filename?: string; content_type?: string }>;
  };
  try {
    const res = await doFetch(`${baseUrl}/emails/receiving/${opts.emailId}`, {
      headers: auth,
    });
    if (!res.ok) {
      return { ok: false, error: `resend_receiving_http_${res.status}` };
    }
    detail = (await res.json()) as typeof detail;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // Headers : Resend peut renvoyer un objet ou une liste {name,value}.
  let headers: Record<string, string> | null = null;
  if (Array.isArray(detail.headers)) {
    headers = {};
    for (const h of detail.headers) {
      if (h?.name) headers[h.name] = String(h.value ?? "");
    }
  } else if (detail.headers && typeof detail.headers === "object") {
    headers = {};
    for (const [k, v] of Object.entries(detail.headers)) {
      headers[k] = String(v ?? "");
    }
  }

  // PJ : liste + download_url (valable 1 h) par pièce.
  const attachments: InboundAttachmentInput[] = [];
  try {
    const res = await doFetch(
      `${baseUrl}/emails/receiving/${opts.emailId}/attachments`,
      { headers: auth },
    );
    if (res.ok) {
      const json = (await res.json()) as {
        data?: Array<{
          filename?: string;
          content_type?: string;
          download_url?: string;
        }>;
      };
      for (const att of json.data || []) {
        if (!att.download_url) continue;
        try {
          const dl = await doFetch(att.download_url);
          if (!dl.ok) continue;
          const buf = Buffer.from(await dl.arrayBuffer());
          attachments.push({
            filename: att.filename,
            content_type: att.content_type,
            content_base64: buf.toString("base64"),
          });
        } catch {
          /* PJ manquée = mail quand même ingéré */
        }
      }
    }
  } catch {
    /* best effort */
  }

  const to = Array.isArray(detail.to)
    ? detail.to.join(", ")
    : String(detail.to || "");
  return opts.store.insertInboundFull({
    message_id: detail.message_id || `<resend-${opts.emailId}>`,
    from: String(detail.from || ""),
    to,
    subject: detail.subject,
    text: detail.text ?? null,
    html: detail.html ?? null,
    received_at: detail.created_at ?? null,
    headers,
    attachments,
  });
}
