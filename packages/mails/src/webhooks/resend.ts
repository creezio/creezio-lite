/**
 * Webhooks Resend — vérification de signature Svix implémentée en
 * HMAC-SHA256 natif (zéro dépendance) + mapping des événements statut
 * (`email.sent|delivered|bounced|complained`) vers l'outbox par
 * `provider_message_id`.
 *
 * Signature Svix : secret `whsec_<base64>` ; contenu signé
 * `${svix-id}.${svix-timestamp}.${body}` ; header `svix-signature` =
 * liste d'entrées `v1,<base64>` séparées par des espaces ; tolérance
 * timestamp ±5 min.
 */

import crypto from "node:crypto";
import type { SqliteMailsStore } from "../sqlite-store.js";

export const SVIX_TIMESTAMP_TOLERANCE_S = 5 * 60;

export type SvixHeaders = {
  id: string;
  timestamp: string;
  signature: string;
};

export function verifySvixSignature(opts: {
  secret: string;
  headers: SvixHeaders;
  payload: string;
  nowMs?: number;
}): { ok: boolean; error?: string } {
  const secret = (opts.secret || "").trim();
  if (!secret) return { ok: false, error: "webhook_secret_unconfigured" };
  const { id, timestamp, signature } = opts.headers;
  if (!id || !timestamp || !signature) {
    return { ok: false, error: "svix_headers_missing" };
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, error: "svix_timestamp_invalid" };
  const nowS = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowS - ts) > SVIX_TIMESTAMP_TOLERANCE_S) {
    return { ok: false, error: "svix_timestamp_expired" };
  }
  const secretB64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(secretB64, "base64");
  } catch {
    return { ok: false, error: "webhook_secret_invalid" };
  }
  if (!key.length) return { ok: false, error: "webhook_secret_invalid" };
  const signedContent = `${id}.${timestamp}.${opts.payload}`;
  const expected = crypto
    .createHmac("sha256", key)
    .update(signedContent)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);
  for (const entry of signature.split(/\s+/)) {
    const [version, sig] = entry.split(",", 2);
    if (version !== "v1" || !sig) continue;
    const sigBuf = Buffer.from(sig);
    if (
      sigBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
      return { ok: true };
    }
  }
  return { ok: false, error: "svix_signature_mismatch" };
}

export function resolveResendWebhookSecret(): string {
  return (process.env.RESEND_WEBHOOK_SECRET || "").trim();
}

export type ResendWebhookEvent = {
  type: string;
  data?: {
    email_id?: string;
    to?: string[];
    subject?: string;
    bounce?: { message?: string; type?: string; subType?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ResendWebhookOutcome =
  | { ok: true; handled: boolean; mailId?: string; kind: string }
  | { ok: false; error: string };

/**
 * Applique un événement webhook Resend (payload déjà vérifié) sur le store.
 * `email.received` est traité par l'appelant (inbound opt-in).
 */
export function applyResendWebhookEvent(
  store: SqliteMailsStore,
  event: ResendWebhookEvent,
): ResendWebhookOutcome {
  const type = String(event.type || "");
  const emailId = String(event.data?.email_id || "").trim();
  const mapping: Record<
    string,
    "sent" | "delivered" | "bounced" | "complained"
  > = {
    "email.sent": "sent",
    "email.delivered": "delivered",
    "email.bounced": "bounced",
    "email.complained": "complained",
  };
  const status = mapping[type];
  if (!status) {
    return { ok: true, handled: false, kind: type };
  }
  if (!emailId) return { ok: false, error: "email_id_missing" };
  let detail: string | null = null;
  if (status === "bounced" && event.data?.bounce) {
    const b = event.data.bounce;
    detail = [b.type, b.subType, b.message].filter(Boolean).join(" / ") || null;
  }
  const updated = store.applyProviderStatus(emailId, status, detail);
  return {
    ok: true,
    handled: Boolean(updated),
    mailId: updated?.id,
    kind: type,
  };
}
