/**
 * Vérification des livraisons webhook Granola — spécification
 * Standard Webhooks (https://www.standardwebhooks.com/).
 *
 * Granola signe chaque livraison : HMAC-SHA256 de
 * `{webhook-id}.{webhook-timestamp}.{body}` avec le secret `whsec_…`
 * (base64-décodé après le préfixe), transmis en `webhook-signature`
 * sous la forme `v1,<base64>` (plusieurs signatures séparées par espace).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type GranolaWebhookHeaders = Record<
  string,
  string | string[] | undefined
>;

/** Tolérance de rejeu par défaut (secondes) sur `webhook-timestamp`. */
export const GRANOLA_WEBHOOK_TOLERANCE_S = 300;

function headerValue(
  headers: GranolaWebhookHeaders,
  name: string,
): string {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(direct)) return direct[0] ?? "";
  if (typeof direct === "string") return direct;
  // En-têtes potentiellement non normalisés par l'adaptateur HTTP.
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name.toLowerCase()) {
      if (Array.isArray(v)) return v[0] ?? "";
      if (typeof v === "string") return v;
    }
  }
  return "";
}

export type GranolaSignatureCheck = {
  valid: boolean;
  reason?: "missing_headers" | "timestamp_out_of_tolerance" | "bad_signature";
};

/**
 * Vérifie une livraison webhook Granola (pur, jamais de throw).
 *
 * @param headers   En-têtes de la requête (`webhook-id`, `webhook-timestamp`,
 *                  `webhook-signature`).
 * @param rawBody   Corps brut UTF-8 tel que reçu sur le fil (`req.rawBody`).
 * @param signingSecret Secret `whsec_…` retourné à la création de l'endpoint.
 * @param opts.toleranceS  Tolérance de rejeu en secondes (défaut 300, 0 = off).
 * @param opts.nowMs       Horloge injectable (tests).
 */
export function verifyGranolaSignature(
  headers: GranolaWebhookHeaders,
  rawBody: string,
  signingSecret: string,
  opts?: { toleranceS?: number; nowMs?: number },
): GranolaSignatureCheck {
  const id = headerValue(headers, "webhook-id");
  const timestamp = headerValue(headers, "webhook-timestamp");
  const signature = headerValue(headers, "webhook-signature");
  if (!id || !timestamp || !signature) {
    return { valid: false, reason: "missing_headers" };
  }

  const toleranceS = opts?.toleranceS ?? GRANOLA_WEBHOOK_TOLERANCE_S;
  if (toleranceS > 0) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) {
      return { valid: false, reason: "timestamp_out_of_tolerance" };
    }
    const nowS = (opts?.nowMs ?? Date.now()) / 1000;
    if (Math.abs(nowS - ts) > toleranceS) {
      return { valid: false, reason: "timestamp_out_of_tolerance" };
    }
  }

  let key: Buffer;
  try {
    const b64 = signingSecret.startsWith("whsec_")
      ? signingSecret.slice("whsec_".length)
      : signingSecret;
    key = Buffer.from(b64, "base64");
  } catch {
    return { valid: false, reason: "bad_signature" };
  }
  if (key.length === 0) return { valid: false, reason: "bad_signature" };

  const expected = Buffer.from(
    createHmac("sha256", key)
      .update(`${id}.${timestamp}.${rawBody}`, "utf8")
      .digest("base64"),
  );

  const ok = signature.split(" ").some((versioned) => {
    const comma = versioned.indexOf(",");
    if (comma <= 0) return false;
    const version = versioned.slice(0, comma);
    const provided = Buffer.from(versioned.slice(comma + 1));
    return (
      version === "v1" &&
      provided.length === expected.length &&
      timingSafeEqual(provided, expected)
    );
  });

  return ok ? { valid: true } : { valid: false, reason: "bad_signature" };
}

/**
 * Signe un corps comme le ferait Granola (tests / simulateur).
 * Retourne la valeur à poser en `webhook-signature`.
 */
export function signGranolaPayload(
  id: string,
  timestampS: number,
  rawBody: string,
  signingSecret: string,
): string {
  const b64 = signingSecret.startsWith("whsec_")
    ? signingSecret.slice("whsec_".length)
    : signingSecret;
  const key = Buffer.from(b64, "base64");
  const sig = createHmac("sha256", key)
    .update(`${id}.${timestampS}.${rawBody}`, "utf8")
    .digest("base64");
  return `v1,${sig}`;
}
