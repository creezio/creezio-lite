import { createHmac } from "node:crypto";
import { getDatabaseWebhookBrand } from "./adapters.js";

export type WebhookDeliveryResult = {
  ok: boolean;
  status?: number;
  error?: string;
  bodyPreview?: string;
};

const DEFAULT_TIMEOUT_MS = 8000;

function envFlag(...names: string[]): boolean {
  return names.some((n) => process.env[n] === "1");
}

/** Domaines bloqués (SSRF basique). */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::1"
  ) {
    return true;
  }
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (host === "metadata.google.internal") return true;
  return false;
}

export function assertWebhookUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("URL webhook invalide");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Protocole webhook non supporté");
  }
  const allowPrivate = envFlag(
    "CREEZIO_WEBHOOK_ALLOW_PRIVATE",
    "TF2_WEBHOOK_ALLOW_PRIVATE",
  );
  const allowLoopback = envFlag(
    "CREEZIO_WEBHOOK_ALLOW_LOOPBACK",
    "TF2_WEBHOOK_ALLOW_LOOPBACK",
  );
  if (isBlockedHost(parsed.hostname) && !allowPrivate) {
    if (!(allowLoopback && parsed.hostname === "127.0.0.1")) {
      throw new Error(`Hôte webhook bloqué (SSRF) : ${parsed.hostname}`);
    }
  }
  return parsed;
}

export function signWebhookBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export async function deliverWebhook(input: {
  url: string;
  method?: "POST" | "PUT";
  headers?: Record<string, string>;
  body: Record<string, unknown>;
  secret?: string;
  timeoutMs?: number;
}): Promise<WebhookDeliveryResult> {
  try {
    assertWebhookUrl(input.url);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "URL invalide" };
  }

  const brand = getDatabaseWebhookBrand();
  const body = JSON.stringify(input.body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": brand.userAgent,
    ...(input.headers || {}),
  };
  if (input.secret) {
    headers[brand.signatureHeader] = signWebhookBody(body, input.secret);
  }

  try {
    const response = await fetch(input.url, {
      method: input.method || "POST",
      headers,
      body,
      signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const text = await response.text().catch(() => "");
    return {
      ok: response.ok,
      status: response.status,
      bodyPreview: text.slice(0, 500),
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Échec livraison webhook",
    };
  }
}

export function retryDelaySeconds(attempt: number): number {
  const table = [30, 120, 600, 1800];
  return table[Math.min(attempt, table.length - 1)]!;
}

export const MAX_WEBHOOK_ATTEMPTS = 5;
