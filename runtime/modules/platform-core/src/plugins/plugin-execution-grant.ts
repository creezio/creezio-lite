/**
 * Grants d'exécution plugins (product-hub) — port brand-agnostic kit.
 * Préfixe token paramétrable (défaut `exec_` ; kit utilisait `tf2_exec_`).
 */

import crypto from "node:crypto";

export type PluginGrantAction = "create" | "write";

export type PluginExecutionGrantPayload = {
  v: 1;
  grantId: string;
  productId: string;
  prdRevisionId: string;
  pluginId: string;
  actions: PluginGrantAction[];
  iat: number;
  exp: number;
};

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function signature(payloadPart: string, secret: string): string {
  return encode(
    crypto.createHmac("sha256", secret).update(payloadPart).digest(),
  );
}

export function issuePluginExecutionGrant(opts: {
  secret: string;
  grantId?: string;
  productId: string;
  prdRevisionId: string;
  pluginId: string;
  actions?: PluginGrantAction[];
  ttlSeconds?: number;
  /** Prefixe token (ex. `tf2_exec_` pour compat TF2). */
  tokenPrefix?: string;
}): { token: string; payload: PluginExecutionGrantPayload } {
  if (!opts.secret || opts.secret.length < 16) {
    throw new Error("secret execution_grant invalide");
  }
  const prefix = opts.tokenPrefix ?? "exec_";
  const now = Math.floor(Date.now() / 1000);
  const payload: PluginExecutionGrantPayload = {
    v: 1,
    grantId: opts.grantId || crypto.randomUUID(),
    productId: opts.productId,
    prdRevisionId: opts.prdRevisionId,
    pluginId: opts.pluginId,
    actions: opts.actions?.length ? opts.actions : ["create", "write"],
    iat: now,
    exp: now + Math.min(1800, Math.max(30, opts.ttlSeconds ?? 600)),
  };
  const body = encode(JSON.stringify(payload));
  return { token: `${prefix}${body}.${signature(body, opts.secret)}`, payload };
}

export function verifyPluginExecutionGrant(opts: {
  token: string | undefined;
  secret: string;
  pluginId: string;
  action: PluginGrantAction;
  nowSeconds?: number;
  tokenPrefix?: string;
}):
  | { ok: true; payload: PluginExecutionGrantPayload }
  | { ok: false; error: string } {
  const prefix = opts.tokenPrefix ?? "exec_";
  const token = String(opts.token || "");
  if (!token.startsWith(prefix)) {
    return { ok: false, error: "execution_grant requis" };
  }
  const [body, supplied] = token.slice(prefix.length).split(".");
  if (!body || !supplied) return { ok: false, error: "execution_grant malformé" };
  const expected = signature(body, opts.secret);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: "execution_grant signature invalide" };
  }
  let payload: PluginExecutionGrantPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "execution_grant payload invalide" };
  }
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (payload.v !== 1 || payload.exp <= now || payload.iat > now + 30) {
    return { ok: false, error: "execution_grant expiré ou invalide" };
  }
  if (payload.pluginId !== opts.pluginId) {
    return { ok: false, error: "execution_grant lié à un autre plugin" };
  }
  if (!payload.actions.includes(opts.action)) {
    return {
      ok: false,
      error: `execution_grant non autorisé pour ${opts.action}`,
    };
  }
  if (!payload.productId || !payload.prdRevisionId || !payload.grantId) {
    return { ok: false, error: "execution_grant incomplet" };
  }
  return { ok: true, payload };
}
