/**
 * Types OAuth MCP + transport Hono — adapters injectés (zéro hardcode marque).
 */

import type { Context, MiddlewareHandler } from "hono";
import type { McpAdminSqliteDatabase } from "../admin/types.js";

export type McpOAuthSqliteDatabase = McpAdminSqliteDatabase;

/** Injection host pour le store OAuth (tables v22/v25/v27). */
export type McpOAuthAdapters = {
  getWriteDb: () => McpOAuthSqliteDatabase;
  tableExists: (name: string) => boolean;
  /** Secret JWT (défaut : process.env.MCP_JWT_SECRET). */
  getJwtSecret?: () => string;
  /** Resolver URL publique (défaut : MCP_PUBLIC_URL → APP_PUBLIC_URL → APP_BASE_URL). */
  resolvePublicUrl?: () => string | null;
};

export type McpOAuthSessionUser = {
  id: string;
  username: string;
};

export type McpOAuthSession = {
  email?: string | null;
  sub?: string | null;
};

/**
 * Pont session/credentials marque — ne pas hardcoder le cookie CRM.
 */
export type McpOAuthSessionBridge = {
  getSessionFromContext: (
    c: Context,
  ) => Promise<McpOAuthSession | null | undefined>;
  authenticateUser: (
    username: string,
    password: string,
  ) => McpOAuthSessionUser | null | Promise<McpOAuthSessionUser | null>;
  /** Credentials legacy (setup desktop) — optionnel. */
  validateCredentials?: (username: string, password: string) => boolean;
  getOwnerId: () => string | null;
  /** Pose cookie session après login consent (optionnel). */
  createSessionCookie?: (
    c: Context,
    user: { id?: string | null; username: string },
  ) => Promise<void>;
};

export type McpOAuthRoutesConfig = {
  /** Titre produit pages consent (ex. « CRM »). */
  productName: string;
  /** resource_name metadata (défaut : `${productName} MCP`). */
  resourceName?: string;
  /** HTML `<li>…</li>` pour la liste de scopes consent. */
  consentScopesHtml?: string;
  session: McpOAuthSessionBridge;
  /** Cookie Secure derrière tunnel (injectable ; défaut heuristique env). */
  resolveCookieSecure?: (c: Context) => boolean;
  /** Documentation URL path (défaut `/developers`). */
  documentationPath?: string;
  dcrRateLimit?: { limit: number; windowMs: number };
};

export type McpServerAuthContext = {
  userId: string | null;
  clientId?: string;
  scopes?: string;
};

export type McpStreamableTransport = {
  handleRequest: (c: Context) => Promise<Response> | Response;
  close: () => Promise<void>;
};

export type McpConnectedServer = {
  connect: (transport: McpStreamableTransport) => Promise<void>;
  close: () => Promise<void>;
};

export type McpApiKeyRecord = {
  id: string;
  user_id?: string | null;
  scopes?: string;
};

export type CreateMcpHonoAppOptions = {
  /** Routes OAuth (createMcpOAuthRoutes). */
  oauthRoutes: { fetch: unknown } | import("hono").Hono;
  buildMcpServer: (
    ctx: McpServerAuthContext,
  ) => Promise<McpConnectedServer>;
  /** Factory transport Streamable HTTP (ex. `() => new StreamableHTTPTransport(...)`). */
  createTransport: () => McpStreamableTransport;
  /** Auth clé API locale (Hermes) — optionnel. */
  apiKeyAuth?: {
    prefix: string;
    verify: (token: string) => McpApiKeyRecord | null;
    resolveUserId?: (key: McpApiKeyRecord) => string | null;
  };
  ensureSchema?: () => void;
  /** Middleware /mcp (ex. requestLogMcpMiddleware). */
  mcpMiddleware?: MiddlewareHandler;
  resolveCorsOrigin?: (origin: string) => string;
  mcpRateLimit?: { limit: number; windowMs: number };
};
