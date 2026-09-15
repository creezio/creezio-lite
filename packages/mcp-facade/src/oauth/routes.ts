/**
 * Endpoints OAuth 2.1 du serveur MCP — SoT kit (port kit gold).
 * Branding / session / cookie injectables via McpOAuthRoutesConfig.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import {
  ACCESS_TOKEN_TTL_S,
  MCP_SCOPE,
  MCP_SCOPES,
  consumeAuthCode,
  createAuthCode,
  createRefreshToken,
  getClient,
  isMcpPublicUrlRequiredError,
  mcpBaseUrl,
  mcpOauthReady,
  mcpResourceUrl,
  normalizeMcpScopes,
  peekAuthCode,
  pruneExpiredCodes,
  registerClient,
  resourceAcceptable,
  rotateRefreshToken,
  signAccessToken,
  touchOAuthClientLastUsed,
  verifyClientSecret,
  verifyPkceS256,
} from "./store.js";
import { checkMcpRateLimit, rateLimitHeaders } from "./rate-limit.js";
import type { McpOAuthRoutesConfig } from "./types.js";

const DEFAULT_CONSENT_SCOPES = `
        <li>consulter et modifier les données métier exposées via MCP</li>
        <li>appeler les tools autorisés pour votre compte</li>
        <li>agir au nom de la session authentifiée</li>`;

export function createMcpOAuthRoutes(config: McpOAuthRoutesConfig): Hono {
  const oauthRoutes = new Hono();
  const productName = config.productName;
  const resourceName = config.resourceName || `${productName} MCP`;
  const consentScopesHtml =
    config.consentScopesHtml?.trim() || DEFAULT_CONSENT_SCOPES;
  const documentationPath = config.documentationPath || "/developers";
  const dcrLimit = config.dcrRateLimit?.limit ?? 20;
  const dcrWindow = config.dcrRateLimit?.windowMs ?? 60 * 60_000;

  function tunnelRequiredJson(c: Context) {
    return c.json(
      {
        error: "temporarily_unavailable",
        error_description:
          "tunnel requis — configurez l'accès mobile (APP_PUBLIC_URL / MCP_PUBLIC_URL)",
      },
      503,
    );
  }

  function authorizationServerMetadata() {
    const base = mcpBaseUrl();
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      scopes_supported: [MCP_SCOPE],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: [
        "client_secret_post",
        "client_secret_basic",
        "none",
      ],
      code_challenge_methods_supported: ["S256"],
      service_documentation: `${base}${documentationPath}`,
    };
  }

  function protectedResourceMetadata() {
    const base = mcpBaseUrl();
    return {
      resource: mcpResourceUrl(),
      authorization_servers: [base],
      scopes_supported: [MCP_SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: resourceName,
      resource_documentation: `${base}${documentationPath}`,
    };
  }

  for (const p of [
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-authorization-server/mcp",
    "/oauth/well-known/authorization-server",
  ]) {
    oauthRoutes.get(p, (c) => {
      try {
        return c.json(authorizationServerMetadata());
      } catch (e) {
        if (isMcpPublicUrlRequiredError(e)) return tunnelRequiredJson(c);
        throw e;
      }
    });
  }
  for (const p of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
    "/oauth/well-known/protected-resource",
  ]) {
    oauthRoutes.get(p, (c) => {
      try {
        return c.json(protectedResourceMetadata());
      } catch (e) {
        if (isMcpPublicUrlRequiredError(e)) return tunnelRequiredJson(c);
        throw e;
      }
    });
  }

  function isValidRedirectUri(uri: unknown): uri is string {
    if (typeof uri !== "string") return false;
    try {
      const u = new URL(uri);
      return (
        u.protocol === "https:" ||
        (u.protocol === "http:" &&
          (u.hostname === "localhost" || u.hostname === "127.0.0.1"))
      );
    } catch {
      return false;
    }
  }

  oauthRoutes.post("/oauth/register", async (c) => {
    const clientIp =
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const rate = checkMcpRateLimit(`mcp:dcr:${clientIp}`, dcrLimit, dcrWindow);
    for (const [name, value] of Object.entries(rateLimitHeaders(rate))) {
      c.header(name, value);
    }
    if (!rate.ok) {
      return c.json(
        {
          error: "rate_limit_exceeded",
          error_description: "Trop d'enregistrements clients",
        },
        429,
      );
    }
    if (!mcpOauthReady()) {
      return c.json({ error: "temporarily_unavailable" }, 503);
    }
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "invalid_client_metadata", error_description: "JSON attendu" },
        400,
      );
    }
    const redirectUris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris
      : [];
    if (!redirectUris.length || !redirectUris.every(isValidRedirectUri)) {
      return c.json(
        {
          error: "invalid_redirect_uri",
          error_description: "redirect_uris requis (https, ou http://localhost)",
        },
        400,
      );
    }
    const requestedScope =
      typeof body.scope === "string"
        ? normalizeMcpScopes(body.scope)
        : MCP_SCOPE;
    if (!requestedScope) {
      return c.json(
        {
          error: "invalid_client_metadata",
          error_description: `Scopes permis : ${MCP_SCOPES.join(", ")}`,
        },
        400,
      );
    }
    const { client, client_secret } = registerClient({
      client_name:
        typeof body.client_name === "string" ? body.client_name : undefined,
      redirect_uris: redirectUris as string[],
      token_endpoint_auth_method:
        typeof body.token_endpoint_auth_method === "string"
          ? body.token_endpoint_auth_method
          : undefined,
      scope: requestedScope,
    });
    pruneExpiredCodes();
    return c.json(
      {
        client_id: client.client_id,
        ...(client_secret ? { client_secret } : {}),
        client_id_issued_at: Math.floor(Date.now() / 1000),
        ...(client_secret ? { client_secret_expires_at: 0 } : {}),
        client_name: client.client_name ?? undefined,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: client.scope ?? MCP_SCOPE,
      },
      201,
    );
  });

  type AuthorizeParams = {
    client_id: string;
    redirect_uri: string;
    response_type: string;
    state: string;
    scope: string;
    code_challenge: string;
    code_challenge_method: string;
    resource: string;
  };

  function readAuthorizeParams(
    src: Record<string, string | undefined>,
  ): AuthorizeParams {
    return {
      client_id: src.client_id || "",
      redirect_uri: src.redirect_uri || "",
      response_type: src.response_type || "",
      state: src.state || "",
      scope: src.scope || MCP_SCOPE,
      code_challenge: src.code_challenge || "",
      code_challenge_method: src.code_challenge_method || "",
      resource: src.resource || "",
    };
  }

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function redirectWithError(
    redirectUri: string,
    state: string,
    error: string,
    description?: string,
  ): Response {
    const u = new URL(redirectUri);
    u.searchParams.set("error", error);
    if (description) u.searchParams.set("error_description", description);
    if (state) u.searchParams.set("state", state);
    return new Response(null, {
      status: 302,
      headers: { Location: u.toString() },
    });
  }

  function oauthLog(
    event: string,
    fields: Record<string, string | number | boolean | null | undefined>,
  ) {
    const safe: Record<string, string | number | boolean | null> = { event };
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      safe[k] = v;
    }
    console.info("[mcp-oauth]", JSON.stringify(safe));
  }

  function redirectHost(redirectUri: string): string {
    try {
      return new URL(redirectUri).host;
    } catch {
      return "invalid";
    }
  }

  type ConsentOpts = {
    clientName: string;
    sessionEmail?: string | null;
    error?: string;
  };

  function consentPage(p: AuthorizeParams, opts: ConsentOpts): string {
    const { clientName, sessionEmail, error } = opts;
    const signedIn = Boolean(sessionEmail);
    const hidden = (
      [
        "client_id",
        "redirect_uri",
        "response_type",
        "state",
        "scope",
        "code_challenge",
        "code_challenge_method",
        "resource",
      ] as const
    )
      .map(
        (k) =>
          `<input type="hidden" name="${k}" value="${escapeHtml(p[k])}">`,
      )
      .join("\n        ");
    let formAction = "/oauth/authorize";
    try {
      formAction = `${mcpBaseUrl()}/oauth/authorize`;
    } catch {
      /* fallback relatif */
    }
    const credentialsBlock = signedIn
      ? `<div class="session" data-auth="session">
      Connecté en tant que <strong>${escapeHtml(sessionEmail || "")}</strong>
    </div>`
      : `<label for="username">Identifiant CRM</label>
        <input id="username" name="email" type="text" autocomplete="username" required>
        <label for="password">Mot de passe</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>`;
    return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Autoriser ${escapeHtml(clientName)} — ${escapeHtml(productName)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
           font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
           background: #f1f5f9; color: #0f172a; }
    .card { width: 100%; max-width: 420px; background: #fff; border: 1px solid #e2e8f0;
            border-radius: 16px; padding: 32px; margin: 16px; box-shadow: 0 10px 30px rgba(15,23,42,.06); }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .sub { color: #64748b; font-size: 14px; margin: 0 0 20px; }
    .client { display: inline-block; background: #e0f2fe; color: #0369a1; border-radius: 8px;
              padding: 2px 8px; font-weight: 600; }
    label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 4px; }
    input[type=text], input[type=password] { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1;
           border-radius: 10px; font-size: 15px; }
    .session { margin: 14px 0 0; padding: 12px 14px; background: #ecfdf5; border: 1px solid #a7f3d0;
               border-radius: 10px; font-size: 14px; color: #065f46; }
    .scopes { margin: 18px 0; padding: 12px 14px; background: #f8fafc; border: 1px solid #e2e8f0;
              border-radius: 10px; font-size: 13px; color: #334155; }
    .scopes li { margin: 2px 0; }
    .error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 10px;
             padding: 10px 12px; font-size: 13px; margin-bottom: 8px; }
    .actions { display: flex; gap: 10px; margin-top: 20px; }
    button { flex: 1; padding: 11px 0; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; }
    .approve { background: #0284c7; color: #fff; border: none; }
    .deny { background: #fff; color: #475569; border: 1px solid #cbd5e1; }
  </style>
</head>
<body>
  <main class="card">
    <h1>${escapeHtml(productName)}</h1>
    <p class="sub"><span class="client">${escapeHtml(clientName)}</span> demande l'accès à votre CRM via MCP.</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    <div class="scopes">
      Cet accès permettra à l'application de :
      <ul>
        ${consentScopesHtml}
      </ul>
    </div>
    <form method="post" action="${escapeHtml(formAction)}">
        ${hidden}
        ${credentialsBlock}
        <div class="actions">
          <button class="deny" type="submit" name="decision" value="deny" formnovalidate>Refuser</button>
          <button class="approve" type="submit" name="decision" value="approve">Autoriser</button>
        </div>
    </form>
  </main>
</body>
</html>`;
  }

  function validateAuthorizeBase(
    p: AuthorizeParams,
  ):
    | { kind: "bad_client"; message: string }
    | { kind: "redirect_error"; error: string; description: string }
    | { kind: "ok"; clientName: string } {
    const client = getClient(p.client_id);
    if (!client) return { kind: "bad_client", message: "client_id inconnu" };
    if (!client.redirect_uris.includes(p.redirect_uri)) {
      return {
        kind: "bad_client",
        message: "redirect_uri non enregistrée pour ce client",
      };
    }
    const requestedScope = normalizeMcpScopes(p.scope);
    const clientScopes = new Set(
      String(client.scope || MCP_SCOPE).split(/\s+/),
    );
    if (
      !requestedScope ||
      !requestedScope
        .split(/\s+/)
        .every((scope) => clientScopes.has(scope) || clientScopes.has("crm"))
    ) {
      return {
        kind: "redirect_error",
        error: "invalid_scope",
        description: `Scopes permis : ${client.scope || MCP_SCOPE}`,
      };
    }
    if (p.response_type !== "code") {
      return {
        kind: "redirect_error",
        error: "unsupported_response_type",
        description: "response_type=code requis",
      };
    }
    if (!p.code_challenge || p.code_challenge_method !== "S256") {
      return {
        kind: "redirect_error",
        error: "invalid_request",
        description:
          "PKCE S256 obligatoire (code_challenge + code_challenge_method=S256)",
      };
    }
    if (!resourceAcceptable(p.resource)) {
      return {
        kind: "redirect_error",
        error: "invalid_target",
        description: `resource doit être ${mcpResourceUrl()}`,
      };
    }
    return { kind: "ok", clientName: client.client_name || p.client_id };
  }

  oauthRoutes.get("/oauth/authorize", async (c) => {
    if (!mcpOauthReady()) return c.text("Migration v22 non appliquée", 503);
    try {
      mcpBaseUrl();
    } catch (e) {
      if (isMcpPublicUrlRequiredError(e)) {
        return c.text(
          "Tunnel requis — configurez l'accès mobile avant de connecter un client MCP.",
          503,
        );
      }
      throw e;
    }
    const p = readAuthorizeParams({
      client_id: c.req.query("client_id"),
      redirect_uri: c.req.query("redirect_uri"),
      response_type: c.req.query("response_type"),
      state: c.req.query("state"),
      scope: c.req.query("scope"),
      code_challenge: c.req.query("code_challenge"),
      code_challenge_method: c.req.query("code_challenge_method"),
      resource: c.req.query("resource"),
    });
    const v = validateAuthorizeBase(p);
    if (v.kind === "bad_client") {
      oauthLog("authorize_get_reject", {
        reason: "bad_client",
        message: v.message,
        client_id_prefix: p.client_id.slice(0, 12),
        redirect_host: redirectHost(p.redirect_uri),
      });
      return c.text(`Requête invalide : ${v.message}`, 400);
    }
    if (v.kind === "redirect_error") {
      oauthLog("authorize_get_reject", {
        reason: v.error,
        description: v.description,
        client_id_prefix: p.client_id.slice(0, 12),
        redirect_host: redirectHost(p.redirect_uri),
      });
      return redirectWithError(p.redirect_uri, p.state, v.error, v.description);
    }
    const session = await config.session.getSessionFromContext(c);
    const sessionEmail = session?.email ? String(session.email) : null;
    oauthLog("authorize_get", {
      client_id_prefix: p.client_id.slice(0, 12),
      redirect_host: redirectHost(p.redirect_uri),
      has_session: Boolean(sessionEmail),
      has_resource: Boolean(p.resource),
      pkce: p.code_challenge_method === "S256",
    });
    c.header("Referrer-Policy", "same-origin");
    c.header("Cache-Control", "no-store");
    return c.html(consentPage(p, { clientName: v.clientName, sessionEmail }));
  });

  oauthRoutes.post("/oauth/authorize", async (c) => {
    if (!mcpOauthReady()) return c.text("Migration v22 non appliquée", 503);
    try {
      mcpBaseUrl();
    } catch (e) {
      if (isMcpPublicUrlRequiredError(e)) {
        return c.text(
          "Tunnel requis — configurez l'accès mobile avant de connecter un client MCP.",
          503,
        );
      }
      throw e;
    }
    const form = await c.req.parseBody();
    const asStr = (v: unknown) => (typeof v === "string" ? v : "");
    const p = readAuthorizeParams({
      client_id: asStr(form.client_id),
      redirect_uri: asStr(form.redirect_uri),
      response_type: asStr(form.response_type),
      state: asStr(form.state),
      scope: asStr(form.scope),
      code_challenge: asStr(form.code_challenge),
      code_challenge_method: asStr(form.code_challenge_method),
      resource: asStr(form.resource),
    });
    const v = validateAuthorizeBase(p);
    if (v.kind === "bad_client") {
      return c.text(`Requête invalide : ${v.message}`, 400);
    }
    if (v.kind === "redirect_error") {
      return redirectWithError(p.redirect_uri, p.state, v.error, v.description);
    }

    if (asStr(form.decision) === "deny") {
      oauthLog("authorize_deny", {
        client_id_prefix: p.client_id.slice(0, 12),
        redirect_host: redirectHost(p.redirect_uri),
      });
      return redirectWithError(
        p.redirect_uri,
        p.state,
        "access_denied",
        "Accès refusé",
      );
    }

    const session = await config.session.getSessionFromContext(c);
    const sessionEmail = session?.email ? String(session.email) : null;
    let authVia: "session" | "credentials" | null = null;
    let userEmail: string | null = null;
    let userId: string | null = session?.sub ? String(session.sub) : null;

    if (sessionEmail) {
      authVia = "session";
      userEmail = sessionEmail;
    } else {
      const email = asStr(form.email).trim();
      const password = asStr(form.password);
      const user = await config.session.authenticateUser(email, password);
      const okLegacy =
        !user && Boolean(config.session.validateCredentials?.(email, password));
      if (!user && !okLegacy) {
        oauthLog("authorize_approve_fail", {
          reason: "invalid_credentials",
          client_id_prefix: p.client_id.slice(0, 12),
          redirect_host: redirectHost(p.redirect_uri),
        });
        c.header("Referrer-Policy", "same-origin");
        c.header("Cache-Control", "no-store");
        return c.html(
          consentPage(p, {
            clientName: v.clientName,
            sessionEmail: null,
            error: "Identifiants invalides — réessayez.",
          }),
          200,
        );
      }
      authVia = "credentials";
      userEmail = user?.username || email;
      userId = user?.id || config.session.getOwnerId() || null;
      if (config.session.createSessionCookie) {
        try {
          await config.session.createSessionCookie(c, {
            id: user?.id || userId,
            username: userEmail,
          });
        } catch (e) {
          console.warn(
            "[mcp-oauth] pose cookie session après login consent échouée",
            e,
          );
        }
      }
    }

    if (!userId) userId = config.session.getOwnerId() || null;
    const code = createAuthCode({
      client_id: p.client_id,
      redirect_uri: p.redirect_uri,
      scope: p.scope || MCP_SCOPE,
      resource: p.resource || null,
      code_challenge: p.code_challenge,
      user_id: userId,
    });

    oauthLog("authorize_approve", {
      client_id_prefix: p.client_id.slice(0, 12),
      redirect_host: redirectHost(p.redirect_uri),
      auth_via: authVia,
      has_resource: Boolean(p.resource),
      user_prefix: userEmail ? userEmail.slice(0, 3) : null,
      has_user_id: Boolean(userId),
    });

    const u = new URL(p.redirect_uri);
    u.searchParams.set("code", code);
    if (p.state) u.searchParams.set("state", p.state);
    return c.redirect(u.toString(), 302);
  });

  function tokenError(
    c: Context,
    error: string,
    description: string,
    status: 400 | 401 = 400,
  ) {
    return c.json({ error, error_description: description }, status, {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    });
  }

  function authenticateClient(
    clientId: string,
    clientSecretPost: string,
    basicHeader: string | undefined,
  ):
    | { ok: true; client_id: string }
    | { ok: false; description: string } {
    let id = clientId;
    let secret: string | null = clientSecretPost || null;
    if (basicHeader?.toLowerCase().startsWith("basic ")) {
      try {
        const decoded = Buffer.from(basicHeader.slice(6), "base64").toString(
          "utf8",
        );
        const sep = decoded.indexOf(":");
        if (sep > 0) {
          id = decodeURIComponent(decoded.slice(0, sep));
          secret = decodeURIComponent(decoded.slice(sep + 1));
        }
      } catch {
        return { ok: false, description: "En-tête Basic invalide" };
      }
    }
    const client = getClient(id);
    if (!client) return { ok: false, description: "client inconnu" };
    if (!verifyClientSecret(client, secret)) {
      return { ok: false, description: "client_secret invalide" };
    }
    return { ok: true, client_id: client.client_id };
  }

  oauthRoutes.post("/oauth/token", async (c) => {
    if (!mcpOauthReady()) {
      return tokenError(
        c,
        "temporarily_unavailable",
        "Migration v22 non appliquée",
      );
    }
    try {
      mcpBaseUrl();
    } catch (e) {
      if (isMcpPublicUrlRequiredError(e)) {
        return tokenError(
          c,
          "temporarily_unavailable",
          "tunnel requis — configurez l'accès mobile (APP_PUBLIC_URL / MCP_PUBLIC_URL)",
        );
      }
      throw e;
    }
    let body: Record<string, unknown> = {};
    const ct = c.req.header("content-type") || "";
    try {
      if (ct.includes("application/json")) {
        body = await c.req.json();
      } else {
        body = (await c.req.parseBody()) as Record<string, unknown>;
      }
    } catch {
      return tokenError(
        c,
        "invalid_request",
        "Corps form-urlencoded ou JSON attendu",
      );
    }
    const asStr = (v: unknown) => (typeof v === "string" ? v : "");
    const grantType = asStr(body.grant_type);

    const auth = authenticateClient(
      asStr(body.client_id),
      asStr(body.client_secret),
      c.req.header("authorization"),
    );
    if (!auth.ok) return tokenError(c, "invalid_client", auth.description, 401);

    if (grantType === "authorization_code") {
      const code = asStr(body.code);
      const verifier = asStr(body.code_verifier);
      const redirectUri = asStr(body.redirect_uri);
      if (!code) return tokenError(c, "invalid_request", "code requis");
      if (!verifier) {
        return tokenError(
          c,
          "invalid_request",
          "code_verifier requis (PKCE)",
        );
      }

      const pending = peekAuthCode(code);
      if (!pending) {
        oauthLog("token_reject", {
          grant: "authorization_code",
          reason: "code_unknown_or_used",
          client_id_prefix: auth.client_id.slice(0, 12),
        });
        return tokenError(
          c,
          "invalid_grant",
          "code inconnu, expiré ou déjà utilisé",
        );
      }
      if (pending.client_id !== auth.client_id) {
        oauthLog("token_reject", {
          grant: "authorization_code",
          reason: "client_mismatch",
          client_id_prefix: auth.client_id.slice(0, 12),
        });
        return tokenError(
          c,
          "invalid_grant",
          "code émis pour un autre client",
        );
      }
      if (redirectUri && redirectUri !== pending.redirect_uri) {
        oauthLog("token_reject", {
          grant: "authorization_code",
          reason: "redirect_uri_mismatch",
          client_id_prefix: auth.client_id.slice(0, 12),
          redirect_host: redirectHost(redirectUri),
          expected_host: redirectHost(pending.redirect_uri),
        });
        return tokenError(
          c,
          "invalid_grant",
          "redirect_uri différente de l'autorisation",
        );
      }
      if (!verifyPkceS256(verifier, pending.code_challenge)) {
        oauthLog("token_reject", {
          grant: "authorization_code",
          reason: "pkce_invalid",
          client_id_prefix: auth.client_id.slice(0, 12),
        });
        return tokenError(c, "invalid_grant", "code_verifier PKCE invalide");
      }
      const resource = asStr(body.resource);
      if (!resourceAcceptable(resource)) {
        oauthLog("token_reject", {
          grant: "authorization_code",
          reason: "resource_invalid",
          client_id_prefix: auth.client_id.slice(0, 12),
        });
        return tokenError(
          c,
          "invalid_target",
          `resource doit être ${mcpResourceUrl()}`,
        );
      }

      const consumed = consumeAuthCode(code);
      if (!consumed) {
        oauthLog("token_reject", {
          grant: "authorization_code",
          reason: "code_race_consumed",
          client_id_prefix: auth.client_id.slice(0, 12),
        });
        return tokenError(
          c,
          "invalid_grant",
          "code inconnu, expiré ou déjà utilisé",
        );
      }

      const accessToken = await signAccessToken(
        auth.client_id,
        consumed.scope,
        consumed.user_id,
      );
      touchOAuthClientLastUsed(auth.client_id);
      const refreshToken = createRefreshToken(
        auth.client_id,
        consumed.scope,
        consumed.resource,
        consumed.user_id,
      );
      oauthLog("token_ok", {
        grant: "authorization_code",
        client_id_prefix: auth.client_id.slice(0, 12),
        has_resource: Boolean(resource || consumed.resource),
      });
      return c.json(
        {
          access_token: accessToken,
          token_type: "bearer",
          expires_in: ACCESS_TOKEN_TTL_S,
          refresh_token: refreshToken,
          scope: consumed.scope,
        },
        200,
        { "Cache-Control": "no-store", Pragma: "no-cache" },
      );
    }

    if (grantType === "refresh_token") {
      const rt = asStr(body.refresh_token);
      if (!rt) {
        return tokenError(c, "invalid_request", "refresh_token requis");
      }
      const rotated = rotateRefreshToken(rt);
      if (!rotated) {
        return tokenError(
          c,
          "invalid_grant",
          "refresh_token invalide, expiré ou révoqué",
        );
      }
      if (rotated.client_id !== auth.client_id) {
        return tokenError(
          c,
          "invalid_grant",
          "refresh_token émis pour un autre client",
        );
      }
      const accessToken = await signAccessToken(
        auth.client_id,
        rotated.scope,
        rotated.user_id,
      );
      touchOAuthClientLastUsed(auth.client_id);
      return c.json(
        {
          access_token: accessToken,
          token_type: "bearer",
          expires_in: ACCESS_TOKEN_TTL_S,
          refresh_token: rotated.refresh_token,
          scope: rotated.scope,
        },
        200,
        { "Cache-Control": "no-store", Pragma: "no-cache" },
      );
    }

    return tokenError(
      c,
      "unsupported_grant_type",
      "authorization_code ou refresh_token",
    );
  });

  return oauthRoutes;
}
