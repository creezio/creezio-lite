/**
 * Middlewares session Hono génériques.
 * Les clés API publiques / scopes sont injectés par la marque.
 */

import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { getAuthConfig, getAuthCookieName } from "./config.js";
import {
  isAuthDisabled,
  sessionActorIsOwner,
  sessionIsImpersonating,
  verifySessionToken,
  type SessionPayload,
} from "./session.js";

export type PublicApiKeyRecord = {
  id: string | number;
  scopes: string;
  user_id?: string | null;
};

export type HonoAuthAdapters = {
  /** Préfixe clé live (tf2_live_ / certivan_live_ / fidu_live_). */
  apiKeyPrefix: string;
  verifyApiKey: (raw: string) => PublicApiKeyRecord | null | undefined;
  checkRateLimit: (
    keyId: string | number,
  ) => { ok: boolean; remaining: number };
  rateLimitPerMinute: number;
  /** Si omis : toute méthode acceptée. */
  apiKeyAllowsMethod?: (scopes: string, method: string) => boolean;
  /** Si omis : requireSessionOrTasksApiKey non fourni (feature-off). */
  apiKeyAllowsTasks?: (scopes: string) => boolean;
};

export type HonoAuthMiddleware = {
  getSessionFromContext: (c: Context) => Promise<SessionPayload | null>;
  requireSession: (c: Context, next: Next) => Promise<Response | void>;
  requireNavPermission: (
    permission: string,
  ) => (c: Context, next: Next) => Promise<Response | void>;
  requireOwnerNotImpersonating: (
    c: Context,
    next: Next,
  ) => Promise<Response | void>;
  isValidAgentKey: (c: Context) => boolean;
  requireAgentKey: (c: Context, next: Next) => Promise<Response | void>;
  requireSessionOrAgentKey: (
    c: Context,
    next: Next,
  ) => Promise<Response | void>;
  requireSessionOrApiKey: (
    c: Context,
    next: Next,
  ) => Promise<Response | void>;
  requireSessionOrTasksApiKey?: (
    c: Context,
    next: Next,
  ) => Promise<Response | void>;
};

export function createHonoAuth(
  adapters: HonoAuthAdapters,
): HonoAuthMiddleware {
  async function getSessionFromContext(
    c: Context,
  ): Promise<SessionPayload | null> {
    if (isAuthDisabled()) {
      return {
        sub: "auth-disabled",
        email: "auth-disabled",
        role: "owner",
        permissions: [...getAuthConfig().ownerPermissions],
      };
    }
    const token = getCookie(c, getAuthCookieName());
    if (!token) return null;
    return verifySessionToken(token);
  }

  async function requireSession(c: Context, next: Next) {
    const session = await getSessionFromContext(c);
    if (!session) {
      return c.json({ error: "Non authentifié" }, 401);
    }
    c.set("session", session);
    await next();
  }

  function requireNavPermission(permission: string) {
    return async (c: Context, next: Next) => {
      const session = await getSessionFromContext(c);
      if (!session) return c.json({ error: "Non authentifié" }, 401);
      if (
        (session.role === "owner" && !sessionIsImpersonating(session)) ||
        session.permissions.includes(permission)
      ) {
        return next();
      }
      return c.json({ error: "Accès refusé", code: "forbidden_nav" }, 403);
    };
  }

  async function requireOwnerNotImpersonating(c: Context, next: Next) {
    const session = await getSessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    if (sessionIsImpersonating(session) || !sessionActorIsOwner(session)) {
      return c.json(
        { error: "Revenez à votre compte pour cette action" },
        403,
      );
    }
    await next();
  }

  function isValidAgentKey(c: Context): boolean {
    const expected = process.env.AGENT_API_KEY || "";
    if (!expected) return false;
    const got =
      c.req.header("x-agent-key") ||
      (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
    return got === expected;
  }

  async function requireAgentKey(c: Context, next: Next) {
    if (!process.env.AGENT_API_KEY) {
      return c.json(
        { error: "AGENT_API_KEY non configurée côté serveur" },
        503,
      );
    }
    if (!isValidAgentKey(c)) {
      return c.json({ error: "clé agent invalide" }, 401);
    }
    await next();
  }

  async function requireSessionOrAgentKey(c: Context, next: Next) {
    if (isValidAgentKey(c)) {
      await next();
      return;
    }
    const session = await getSessionFromContext(c);
    if (!session) {
      return c.json({ error: "Non authentifié" }, 401);
    }
    await next();
  }

  function extractPublicApiKey(c: Context): string | null {
    const prefix = adapters.apiKeyPrefix;
    const xApiKey = c.req.header("x-api-key");
    if (xApiKey?.startsWith(prefix)) return xApiKey;
    const auth = c.req.header("authorization") || "";
    const bearer = auth.replace(/^Bearer\s+/i, "");
    if (bearer.startsWith(prefix)) return bearer;
    return null;
  }

  async function requireSessionOrApiKey(c: Context, next: Next) {
    const raw = extractPublicApiKey(c);
    if (raw) {
      const key = adapters.verifyApiKey(raw);
      if (!key) {
        return c.json(
          {
            error: {
              code: "invalid_api_key",
              message: "Clé API invalide ou révoquée",
            },
          },
          401,
        );
      }
      if (
        adapters.apiKeyAllowsMethod &&
        !adapters.apiKeyAllowsMethod(key.scopes, c.req.method)
      ) {
        return c.json(
          {
            error: {
              code: "insufficient_scope",
              message: `Scope « ${key.scopes} » insuffisant pour ${c.req.method}`,
            },
          },
          403,
        );
      }
      const rate = adapters.checkRateLimit(key.id);
      c.header("X-RateLimit-Limit", String(adapters.rateLimitPerMinute));
      c.header("X-RateLimit-Remaining", String(rate.remaining));
      if (!rate.ok) {
        return c.json(
          {
            error: {
              code: "rate_limit_exceeded",
              message: `Limite de ${adapters.rateLimitPerMinute} requêtes/minute atteinte`,
            },
          },
          429,
        );
      }
      c.set("apiKey", key);
      await next();
      return;
    }
    const session = await getSessionFromContext(c);
    if (!session) {
      return c.json(
        {
          error: "Non authentifié",
          code: "unauthorized",
          hint: `Fournir Authorization: Bearer ${adapters.apiKeyPrefix}... (ou X-API-Key), ou un cookie de session`,
        },
        401,
      );
    }
    await next();
  }

  const out: HonoAuthMiddleware = {
    getSessionFromContext,
    requireSession,
    requireNavPermission,
    requireOwnerNotImpersonating,
    isValidAgentKey,
    requireAgentKey,
    requireSessionOrAgentKey,
    requireSessionOrApiKey,
  };

  if (adapters.apiKeyAllowsTasks) {
    const allowsTasks = adapters.apiKeyAllowsTasks;
    out.requireSessionOrTasksApiKey = async (c: Context, next: Next) => {
      const raw = extractPublicApiKey(c);
      if (raw) {
        const key = adapters.verifyApiKey(raw);
        if (!key) {
          return c.json(
            {
              error: {
                code: "invalid_api_key",
                message: "Clé API invalide ou révoquée",
              },
            },
            401,
          );
        }
        if (!key.user_id) {
          return c.json(
            {
              error: {
                code: "api_key_without_user",
                message:
                  "Cette clé API n'est liée à aucun utilisateur — recréez-la avec un utilisateur",
              },
            },
            401,
          );
        }
        if (!allowsTasks(key.scopes)) {
          return c.json(
            {
              error: {
                code: "insufficient_scope",
                message: `Scope « ${key.scopes} » insuffisant — scope « tasks:run » requis`,
              },
            },
            403,
          );
        }
        const rate = adapters.checkRateLimit(key.id);
        c.header("X-RateLimit-Limit", String(adapters.rateLimitPerMinute));
        c.header("X-RateLimit-Remaining", String(rate.remaining));
        if (!rate.ok) {
          return c.json(
            {
              error: {
                code: "rate_limit_exceeded",
                message: `Limite de ${adapters.rateLimitPerMinute} requêtes/minute atteinte`,
              },
            },
            429,
          );
        }
        c.set("apiKey", key);
        await next();
        return;
      }
      const session = await getSessionFromContext(c);
      if (!session) {
        return c.json(
          {
            error: "Non authentifié",
            code: "unauthorized",
            hint: `Fournir une clé API tasks:run (Bearer ${adapters.apiKeyPrefix}...) ou un cookie de session`,
          },
          401,
        );
      }
      await next();
    };
  }

  return out;
}
