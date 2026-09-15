/**
 * Store OAuth 2.1 MCP (PKCE S256, DCR, refresh rotation) — SoT kit.
 * port kit gold ; DB / JWT secret / URL publique injectables.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { McpOAuthAdapters } from "./types.js";

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** `crm` reste accepté pour les clients déjà connectés (accès complet). */
export const MCP_SCOPE_LEGACY = "crm";
export const MCP_SCOPE_READ = "crm:read";
export const MCP_SCOPE_WRITE = "crm:write";
export const MCP_SCOPES = [MCP_SCOPE_READ, MCP_SCOPE_WRITE] as const;
export const MCP_SCOPE = MCP_SCOPES.join(" ");
export const ACCESS_TOKEN_TTL_S = 60 * 60 * 24; // 24 h
export const REFRESH_TOKEN_TTL_S = 60 * 60 * 24 * 30; // 30 jours
const AUTH_CODE_TTL_S = 60 * 10; // 10 min
/** Fenêtre de grâce après rotation : le client peut rejouer l'échange (retry réseau). */
const REFRESH_ROTATION_GRACE_S = 120;

let adapters: McpOAuthAdapters | null = null;

export function configureMcpOAuth(next: McpOAuthAdapters): void {
  adapters = next;
}

export function getMcpOAuthAdapters(): McpOAuthAdapters {
  if (!adapters) {
    throw new Error(
      "@creezio/mcp-facade: configureMcpOAuth({ getWriteDb, tableExists }) requis",
    );
  }
  return adapters;
}

export function resetMcpOAuthAdaptersForTests(): void {
  adapters = null;
}

function queryOne<T>(sql: string, params: unknown[] = []): T | null {
  const row = getMcpOAuthAdapters()
    .getWriteDb()
    .prepare(sql)
    .get(...params);
  return (row as T) ?? null;
}

/** Desktop sans URL publique (tunnel non configuré). */
export class McpPublicUrlRequiredError extends Error {
  readonly code = "mcp_public_url_required" as const;
  constructor(
    message = "tunnel requis — configurez l'accès mobile (APP_PUBLIC_URL / MCP_PUBLIC_URL)",
  ) {
    super(message);
    this.name = "McpPublicUrlRequiredError";
  }
}

export function isMcpPublicUrlRequiredError(
  err: unknown,
): err is McpPublicUrlRequiredError {
  return (
    err instanceof McpPublicUrlRequiredError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "mcp_public_url_required")
  );
}

/**
 * Origine publique MCP (issuer) sans lever d'erreur.
 * Priorité : adapter → MCP_PUBLIC_URL → APP_PUBLIC_URL → (hors desktop) APP_BASE_URL.
 * Jamais de fallback domaine marque hardcodé.
 */
export function resolveMcpPublicUrl(): string | null {
  const custom = adapters?.resolvePublicUrl?.();
  if (custom != null) {
    const trimmed = custom.trim();
    return trimmed ? trimmed.replace(/\/+$/, "") : null;
  }
  const explicit = (
    process.env.MCP_PUBLIC_URL ||
    process.env.APP_PUBLIC_URL ||
    ""
  ).trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  if ((process.env.DESKTOP_LOCAL || "").trim() === "1") return null;
  const base = (process.env.APP_BASE_URL || "").trim();
  return base ? base.replace(/\/+$/, "") : null;
}

/** URL publique de base (issuer OAuth + préfixe resource). */
export function mcpBaseUrl(): string {
  const url = resolveMcpPublicUrl();
  if (url) return url;
  throw new McpPublicUrlRequiredError();
}

/** Identifiant canonique de la ressource MCP (RFC 8707). */
export function mcpResourceUrl(): string {
  return `${mcpBaseUrl()}/mcp`;
}

/**
 * Normalise loopback (127.0.0.1 / ::1 → localhost) pour comparer resource.
 */
export function canonicalizeMcpUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  try {
    const u = new URL(trimmed);
    if (
      u.hostname === "127.0.0.1" ||
      u.hostname === "[::1]" ||
      u.hostname === "::1"
    ) {
      u.hostname = "localhost";
    }
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return trimmed;
  }
}

/** Validation resource (RFC 8707) — accepte absent, ou l'URL canonique /mcp. */
export function resourceAcceptable(resource: string): boolean {
  if (!resource) return true;
  let canonical: string;
  let base: string;
  try {
    canonical = canonicalizeMcpUrl(mcpResourceUrl());
    base = canonicalizeMcpUrl(mcpBaseUrl());
  } catch {
    return false;
  }
  return resource
    .split(",")
    .map((r) => canonicalizeMcpUrl(r))
    .every((r) => !r || r === canonical || r === base);
}

function getMcpSecret() {
  const fromAdapter = adapters?.getJwtSecret?.();
  const secret = (fromAdapter || process.env.MCP_JWT_SECRET || "").trim();
  if (!secret) throw new Error("MCP_JWT_SECRET non configuré");
  return new TextEncoder().encode(secret);
}

export function mcpOauthReady(): boolean {
  try {
    const a = getMcpOAuthAdapters();
    return (
      a.tableExists("mcp_oauth_clients") &&
      a.tableExists("mcp_oauth_codes") &&
      a.tableExists("mcp_oauth_refresh_tokens")
    );
  } catch {
    return false;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

const nowS = () => Math.floor(Date.now() / 1000);

export function normalizeMcpScopes(
  scope: string | null | undefined,
): string | null {
  const requested = new Set(
    String(scope || MCP_SCOPE)
      .split(/\s+/)
      .filter(Boolean),
  );
  if (requested.has(MCP_SCOPE_LEGACY)) return MCP_SCOPE_LEGACY;
  if (
    Array.from(requested).some(
      (item) => !(MCP_SCOPES as readonly string[]).includes(item),
    )
  ) {
    return null;
  }
  if (requested.has(MCP_SCOPE_WRITE)) requested.add(MCP_SCOPE_READ);
  return (
    Array.from(MCP_SCOPES)
      .filter((item) => requested.has(item))
      .join(" ") || MCP_SCOPE_READ
  );
}

/* ------------------------------------------------------------------ */
/* Clients (Dynamic Client Registration — RFC 7591)                    */
/* ------------------------------------------------------------------ */

export type McpOAuthClient = {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string | null;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  scope: string | null;
  enabled?: number;
  revoked_at?: string | null;
};

export type RegisterClientInput = {
  client_name?: string;
  redirect_uris: string[];
  token_endpoint_auth_method?: string;
  scope?: string;
};

const ALLOWED_AUTH_METHODS = new Set([
  "none",
  "client_secret_post",
  "client_secret_basic",
]);

/** Enregistre un client — retourne le secret en clair (une seule fois) si confidentiel. */
export function registerClient(input: RegisterClientInput): {
  client: McpOAuthClient;
  client_secret: string | null;
} {
  const method = ALLOWED_AUTH_METHODS.has(input.token_endpoint_auth_method || "")
    ? (input.token_endpoint_auth_method as string)
    : "client_secret_post";
  const clientId = `mcp_${randomBytes(16).toString("base64url")}`;
  const clientSecret =
    method === "none" ? null : randomBytes(32).toString("base64url");
  const client: McpOAuthClient = {
    client_id: clientId,
    client_secret_hash: clientSecret ? sha256(clientSecret) : null,
    client_name: input.client_name?.slice(0, 200) || null,
    redirect_uris: input.redirect_uris,
    token_endpoint_auth_method: method,
    scope: normalizeMcpScopes(input.scope) || MCP_SCOPE,
  };
  getMcpOAuthAdapters()
    .getWriteDb()
    .prepare(
      `INSERT INTO mcp_oauth_clients
        (client_id, client_secret_hash, client_name, redirect_uris,
         token_endpoint_auth_method, grant_types, scope)
       VALUES (?, ?, ?, ?, ?, 'authorization_code,refresh_token', ?)`,
    )
    .run(
      client.client_id,
      client.client_secret_hash,
      client.client_name,
      JSON.stringify(client.redirect_uris),
      client.token_endpoint_auth_method,
      client.scope,
    );
  return { client, client_secret: clientSecret };
}

export function getClient(clientId: string): McpOAuthClient | null {
  if (!clientId || !mcpOauthReady()) return null;
  const row = queryOne<{
    client_id: string;
    client_secret_hash: string | null;
    client_name: string | null;
    redirect_uris: string;
    token_endpoint_auth_method: string;
    scope: string | null;
    enabled?: number;
    revoked_at?: string | null;
  }>(`SELECT * FROM mcp_oauth_clients WHERE client_id = ?`, [clientId]);
  if (!row) return null;
  if (row.enabled === 0 || row.revoked_at) return null;
  let uris: string[] = [];
  try {
    uris = JSON.parse(row.redirect_uris);
  } catch {
    uris = [];
  }
  return { ...row, redirect_uris: uris };
}

/** Vérifie le secret client (client_secret_post / client_secret_basic). */
export function verifyClientSecret(
  client: McpOAuthClient,
  secret: string | null,
): boolean {
  if (client.token_endpoint_auth_method === "none") return true;
  if (!client.client_secret_hash || !secret) return false;
  return safeEqualHex(sha256(secret), client.client_secret_hash);
}

/* ------------------------------------------------------------------ */
/* Authorization codes + PKCE S256                                     */
/* ------------------------------------------------------------------ */

export type CreateCodeInput = {
  client_id: string;
  redirect_uri: string;
  scope: string;
  resource: string | null;
  code_challenge: string;
  /** Utilisateur CRM ayant donné son consentement. */
  user_id?: string | null;
};

/** Crée un authorization code (usage unique, TTL 10 min) — retourné en clair. */
export function createAuthCode(input: CreateCodeInput): string {
  const code = randomBytes(32).toString("base64url");
  getMcpOAuthAdapters()
    .getWriteDb()
    .prepare(
      `INSERT INTO mcp_oauth_codes
        (code_hash, client_id, redirect_uri, scope, resource,
         code_challenge, code_challenge_method, expires_at, user_id)
       VALUES (?, ?, ?, ?, ?, ?, 'S256', ?, ?)`,
    )
    .run(
      sha256(code),
      input.client_id,
      input.redirect_uri,
      input.scope,
      input.resource,
      input.code_challenge,
      nowS() + AUTH_CODE_TTL_S,
      input.user_id || null,
    );
  return code;
}

export type ConsumedCode = {
  client_id: string;
  redirect_uri: string;
  scope: string;
  resource: string | null;
  code_challenge: string;
  user_id: string | null;
};

/**
 * Lecture d'un code encore valide (sans le consommer) — pour valider PKCE /
 * redirect_uri / client avant usage unique.
 */
export function peekAuthCode(code: string): ConsumedCode | null {
  if (!code || !mcpOauthReady()) return null;
  const hash = sha256(code);
  const row = queryOne<ConsumedCode & { used_at: number | null; expires_at: number }>(
    `SELECT client_id, redirect_uri, scope, resource, code_challenge, user_id, used_at, expires_at
     FROM mcp_oauth_codes WHERE code_hash = ?`,
    [hash],
  );
  if (!row || row.used_at != null || row.expires_at <= nowS()) return null;
  return {
    client_id: row.client_id,
    redirect_uri: row.redirect_uri,
    scope: row.scope,
    resource: row.resource,
    code_challenge: row.code_challenge,
    user_id: row.user_id ?? null,
  };
}

/** Consomme un code (usage unique, atomique) — null si inconnu/expiré/déjà utilisé. */
export function consumeAuthCode(code: string): ConsumedCode | null {
  if (!code || !mcpOauthReady()) return null;
  const hash = sha256(code);
  const db = getMcpOAuthAdapters().getWriteDb();
  const claim = db
    .prepare(
      `UPDATE mcp_oauth_codes SET used_at = ?
       WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`,
    )
    .run(nowS(), hash, nowS());
  if (claim.changes !== 1) return null;
  const row = queryOne<ConsumedCode>(
    `SELECT client_id, redirect_uri, scope, resource, code_challenge, user_id
     FROM mcp_oauth_codes WHERE code_hash = ?`,
    [hash],
  );
  return row ?? null;
}

/** Vérifie PKCE S256 : BASE64URL(SHA256(verifier)) === challenge. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false;
  const computed = createHash("sha256")
    .update(verifier, "utf8")
    .digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* Refresh tokens (rotation + grâce)                                   */
/* ------------------------------------------------------------------ */

export function createRefreshToken(
  clientId: string,
  scope: string,
  resource: string | null,
  userId?: string | null,
): string {
  const token = `mcp_rt_${randomBytes(32).toString("base64url")}`;
  getMcpOAuthAdapters()
    .getWriteDb()
    .prepare(
      `INSERT INTO mcp_oauth_refresh_tokens (token_hash, client_id, scope, resource, expires_at, user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sha256(token),
      clientId,
      scope,
      resource,
      nowS() + REFRESH_TOKEN_TTL_S,
      userId || null,
    );
  return token;
}

export type RotatedRefresh = {
  client_id: string;
  scope: string;
  resource: string | null;
  user_id: string | null;
  refresh_token: string;
};

/**
 * Échange un refresh token : rotation atomique.
 */
export function rotateRefreshToken(token: string): RotatedRefresh | null {
  if (!token || !mcpOauthReady()) return null;
  const hash = sha256(token);
  const row = queryOne<{
    client_id: string;
    scope: string;
    resource: string | null;
    user_id: string | null;
    expires_at: number;
    rotated_at: number | null;
    revoked_at: number | null;
  }>(
    `SELECT client_id, scope, resource, user_id, expires_at, rotated_at, revoked_at
      FROM mcp_oauth_refresh_tokens WHERE token_hash = ?`,
    [hash],
  );
  if (!row || row.revoked_at) return null;
  if (row.expires_at <= nowS()) return null;
  if (row.rotated_at && nowS() - row.rotated_at > REFRESH_ROTATION_GRACE_S) {
    return null;
  }

  const db = getMcpOAuthAdapters().getWriteDb();
  const issue = () => {
    if (!row.rotated_at) {
      db.prepare(
        `UPDATE mcp_oauth_refresh_tokens SET rotated_at = ? WHERE token_hash = ?`,
      ).run(nowS(), hash);
    }
    return createRefreshToken(
      row.client_id,
      row.scope,
      row.resource,
      row.user_id,
    );
  };
  const run =
    typeof db.transaction === "function"
      ? db.transaction(issue)
      : issue;
  return {
    client_id: row.client_id,
    scope: row.scope,
    resource: row.resource,
    user_id: row.user_id ?? null,
    refresh_token: run(),
  };
}

/* ------------------------------------------------------------------ */
/* Access tokens (JWT HS256 — MCP_JWT_SECRET)                          */
/* ------------------------------------------------------------------ */

export async function signAccessToken(
  clientId: string,
  scope: string,
  userId?: string | null,
): Promise<string> {
  const uid = userId?.trim() || null;
  const claims: Record<string, string> = { scope, client_id: clientId };
  if (uid) claims.uid = uid;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
    .setIssuer(mcpBaseUrl())
    .setAudience(mcpResourceUrl())
    .setSubject(uid || clientId)
    .setIssuedAt()
    .setJti(randomBytes(12).toString("base64url"))
    .setExpirationTime(`${ACCESS_TOKEN_TTL_S}s`)
    .sign(getMcpSecret());
}

export type McpAccessToken = {
  client_id: string;
  scope: string;
  user_id: string | null;
};

/** Vérifie signature + issuer + audience — null si invalide/expiré. */
export async function verifyAccessToken(
  token: string,
): Promise<McpAccessToken | null> {
  try {
    const { payload } = await jwtVerify(token, getMcpSecret(), {
      issuer: mcpBaseUrl(),
      audience: mcpResourceUrl(),
    });
    const clientId = String(payload.client_id || "");
    const uidClaim =
      typeof payload.uid === "string" && payload.uid ? payload.uid : null;
    const userId =
      uidClaim ||
      (payload.sub && String(payload.sub) !== clientId
        ? String(payload.sub)
        : null);
    return {
      client_id: clientId || String(payload.sub || ""),
      scope: String(payload.scope || ""),
      user_id: userId,
    };
  } catch {
    return null;
  }
}

/** Purge opportuniste des codes expirés (appelée au fil de l'eau). */
export function pruneExpiredCodes(): void {
  try {
    getMcpOAuthAdapters()
      .getWriteDb()
      .prepare(`DELETE FROM mcp_oauth_codes WHERE expires_at < ?`)
      .run(nowS() - 3600);
  } catch {
    /* non bloquant */
  }
}

/** Touch last_used_at client (migration admin optionnelle). */
export function touchOAuthClientLastUsed(clientId: string): void {
  try {
    getMcpOAuthAdapters()
      .getWriteDb()
      .prepare(
        `UPDATE mcp_oauth_clients SET last_used_at = datetime('now') WHERE client_id = ?`,
      )
      .run(clientId);
  } catch {
    /* migration admin absente : ne jamais casser OAuth */
  }
}
