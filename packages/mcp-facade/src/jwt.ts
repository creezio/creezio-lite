/**
 * Vérification JWT HS256 minimale (sans dépendance jsonwebtoken).
 * Alignée sur le secret local-config `mcpJwtSecret` / MCP_JWT_SECRET.
 */

import crypto from "node:crypto";
import type { McpAuthResult } from "./types.js";

function b64urlToBuf(s: string): Buffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Accepte :
 * - bearer === secret (token opaque sandbox) ;
 * - JWT HS256 signé avec le secret (payload.sub optionnel).
 */
export function verifyMcpBearer(
  bearerToken: string | null | undefined,
  secret: string | null | undefined,
  opts?: { allowUnauthenticated?: boolean },
): McpAuthResult {
  if (!secret) {
    if (opts?.allowUnauthenticated) return { ok: true, subject: "anonymous" };
    return { ok: false, error: "mcp_jwt_secret_missing", status: 503 };
  }
  if (!bearerToken) {
    if (opts?.allowUnauthenticated) return { ok: true, subject: "anonymous" };
    return { ok: false, error: "unauthorized", status: 401 };
  }
  const token = bearerToken.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { ok: false, error: "unauthorized", status: 401 };
  }
  if (timingSafeEqualStr(token, secret)) {
    return { ok: true, subject: "opaque-token" };
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, error: "invalid_token", status: 401 };
  }
  const [h, p, s] = parts as [string, string, string];
  const data = `${h}.${p}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64url");
  if (!timingSafeEqualStr(s, expected)) {
    return { ok: false, error: "invalid_signature", status: 401 };
  }
  try {
    const payload = JSON.parse(b64urlToBuf(p).toString("utf8")) as {
      sub?: string;
      exp?: number;
      orgId?: string;
      org_id?: string;
      isOwner?: boolean;
      [k: string]: unknown;
    };
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
      return { ok: false, error: "token_expired", status: 401 };
    }
    const orgId =
      typeof payload.orgId === "string"
        ? payload.orgId
        : typeof payload.org_id === "string"
          ? payload.org_id
          : undefined;
    return {
      ok: true,
      subject: payload.sub || "jwt",
      ...(orgId ? { orgId } : {}),
      claims: payload as Record<string, unknown>,
    };
  } catch {
    return { ok: false, error: "invalid_payload", status: 401 };
  }
}

/** Émet un JWT HS256 court (tests / sandbox). */
export function signMcpJwt(
  secret: string,
  payload: { sub?: string; exp?: number; [k: string]: unknown },
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${sig}`;
}
