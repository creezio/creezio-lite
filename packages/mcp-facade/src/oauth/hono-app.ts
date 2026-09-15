/**
 * Factory Hono `/mcp` + OAuth — SoT kit (équivalent fonctionnel server/mcp/app.ts).
 * Transport Streamable HTTP et buildMcpServer restent injectés par la marque.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { clientCanAuthenticate } from "../admin/mcp-admin.js";
import {
  getClient,
  isMcpPublicUrlRequiredError,
  mcpBaseUrl,
  verifyAccessToken,
} from "./store.js";
import { checkMcpRateLimit, rateLimitHeaders } from "./rate-limit.js";
import { resolveMcpCorsOrigin } from "./cors-policy.js";
import type { CreateMcpHonoAppOptions } from "./types.js";

type McpAppEnv = {
  Variables: {
    mcpAuth: {
      authType: "api_key" | "oauth";
      clientId: string;
      userId: string | null;
    };
  };
};

export function createMcpHonoApp(options: CreateMcpHonoAppOptions): Hono<McpAppEnv> {
  const mcpApp = new Hono<McpAppEnv>();
  const rateLimit = options.mcpRateLimit?.limit ?? 120;
  const rateWindow = options.mcpRateLimit?.windowMs ?? 60_000;
  const resolveCors = options.resolveCorsOrigin ?? resolveMcpCorsOrigin;

  if (options.ensureSchema) {
    mcpApp.use("*", async (_c, next) => {
      options.ensureSchema?.();
      await next();
    });
  }

  mcpApp.use(
    "*",
    cors({
      origin: resolveCors,
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "Mcp-Session-Id",
        "MCP-Protocol-Version",
      ],
      exposeHeaders: ["Mcp-Session-Id", "WWW-Authenticate"],
      maxAge: 86400,
    }),
  );

  mcpApp.route("/", options.oauthRoutes as Hono);

  if (options.mcpMiddleware) {
    mcpApp.use("/mcp", options.mcpMiddleware);
  }

  function tunnelRequired(): Response {
    return new Response(
      JSON.stringify({
        error: "temporarily_unavailable",
        error_description:
          "tunnel requis — configurez l'accès mobile (APP_PUBLIC_URL / MCP_PUBLIC_URL)",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  function unauthorized(
    description: string,
    opts?: { publicMeta?: boolean },
  ): Response {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (opts?.publicMeta !== false) {
      try {
        const meta = `${mcpBaseUrl()}/.well-known/oauth-protected-resource/mcp`;
        headers["WWW-Authenticate"] =
          `Bearer resource_metadata="${meta}", ` +
          `error="invalid_token", error_description="${description}"`;
      } catch (e) {
        if (!isMcpPublicUrlRequiredError(e)) throw e;
      }
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message: `Unauthorized: ${description}` },
        id: null,
      }),
      { status: 401, headers },
    );
  }

  mcpApp.all("/mcp", async (c) => {
    const auth = c.req.header("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token || token === auth) {
      return unauthorized("Bearer token manquant");
    }

    const apiKeyAuth = options.apiKeyAuth;
    if (apiKeyAuth && token.startsWith(apiKeyAuth.prefix)) {
      const key = apiKeyAuth.verify(token);
      if (!key) {
        return unauthorized("clé API invalide ou révoquée", {
          publicMeta: false,
        });
      }
      const rate = checkMcpRateLimit(
        `mcp:api-key:${key.id}`,
        rateLimit,
        rateWindow,
      );
      for (const [name, value] of Object.entries(rateLimitHeaders(rate))) {
        c.header(name, value);
      }
      if (!rate.ok) {
        return c.json(
          {
            error: "rate_limit_exceeded",
            error_description: "Limite MCP atteinte",
          },
          429,
        );
      }
      const userId =
        apiKeyAuth.resolveUserId?.(key) ?? key.user_id ?? null;
      c.set("mcpAuth", {
        authType: "api_key",
        clientId: `api-key:${key.id}`,
        userId,
      });
      const server = await options.buildMcpServer({
        userId,
        clientId: `api-key:${key.id}`,
        scopes: key.scopes,
      });
      const transport = options.createTransport();
      await server.connect(transport);
      try {
        return await transport.handleRequest(c);
      } finally {
        queueMicrotask(() => {
          transport.close().catch(() => {});
          server.close().catch(() => {});
        });
      }
    }

    try {
      mcpBaseUrl();
    } catch (e) {
      if (isMcpPublicUrlRequiredError(e)) return tunnelRequired();
      throw e;
    }
    const payload = await verifyAccessToken(token);
    if (!payload) {
      return unauthorized("token invalide ou expiré");
    }
    let clientOk = false;
    try {
      clientOk = clientCanAuthenticate(payload.client_id);
    } catch {
      // Admin adapters absents : fallback store (filtre enabled/revoked).
      clientOk = Boolean(getClient(payload.client_id));
    }
    if (!clientOk) {
      return unauthorized("client OAuth désactivé ou révoqué");
    }
    const rate = checkMcpRateLimit(
      `mcp:oauth:${payload.client_id}`,
      rateLimit,
      rateWindow,
    );
    for (const [name, value] of Object.entries(rateLimitHeaders(rate))) {
      c.header(name, value);
    }
    if (!rate.ok) {
      return c.json(
        {
          error: "rate_limit_exceeded",
          error_description: "Limite MCP atteinte",
        },
        429,
      );
    }
    c.set("mcpAuth", {
      authType: "oauth",
      clientId: payload.client_id,
      userId: payload.user_id,
    });

    const server = await options.buildMcpServer({
      userId: payload.user_id,
      clientId: payload.client_id,
      scopes: payload.scope,
    });
    const transport = options.createTransport();
    await server.connect(transport);
    try {
      return await transport.handleRequest(c);
    } finally {
      queueMicrotask(() => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
    }
  });

  mcpApp.notFound((c) => c.json({ error: "Route inconnue" }, 404));
  mcpApp.onError((err, c) => {
    console.error("[mcp]", err);
    return c.json(
      { error: err instanceof Error ? err.message : "Erreur serveur" },
      500,
    );
  });

  return mcpApp;
}
