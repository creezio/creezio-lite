/**
 * Monte OAuth MCP + admin MCP sur le runtime marque (SQLite core + store OS).
 * Sans credentials externes : issuer = baseUrl harness/loopback.
 */
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { ListedModuleOperation, MountedApiInfo } from "@creezio/api-kernel";
import {
  collectKernelOperationRoutes,
  collectListedOperationRoutes,
} from "@creezio/api-kernel";
import type { AppManifest } from "@creezio/brand-config";
import type { SqliteRuntime } from "@creezio/platform-core";
import {
  authenticateViaKit,
  createSessionToken,
  getAuthConfig,
  sessionCookieOptions,
  toHonoCookie,
  validateEnvCredentials,
  verifySessionToken,
  type SessionPayload,
} from "@creezio/auth";
import { getTasksBrandConfig } from "@creezio/tasks";
import {
  configureMcpOAuth,
  configureMcpAdmin,
  createMcpOAuthRoutes,
  createMcpAdminRoutes,
  ensureMcpAdminSchema,
  mcpOauthReady,
  resolveMcpPublicUrl,
  mcpAdminStatus,
  seedMcpToolPolicies,
  type McpFacade,
} from "@creezio/mcp-facade";
import {
  buildApiEndpointsRegistry,
  buildOpenApiDocumentFromRegistry,
  collectHonoRoutes,
  configureUsageAnalytics,
  createApiEndpointsRoutes,
  createRequestLogsRoutes,
  createUsageAnalyticsAdminRoutes,
  createUsageAnalyticsIngestRoutes,
  ensureUsageAnalyticsSchema,
} from "@creezio/observability";
import type { BrandOsComposition } from "./compose-brand-os.js";
import {
  adminDatabaseHandlesPath,
  createBrandAdminDatabaseRoutes,
} from "./mount-brand-admin-database.js";

export type BrandMcpSurface = {
  app: Hono;
  /** true si tables OAuth présentes */
  oauthReady: () => boolean;
  publicUrl: () => string | null;
};

function tableExists(db: {
  prepare: (sql: string) => { get: (...a: unknown[]) => unknown };
}, name: string): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`,
      )
      .get(name),
  );
}

/** DDL OAuth MCP sur core.db (parité step historique 022 — sans schema_version brand). */
const MCP_OAUTH_CORE_DDL = `
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id                  TEXT PRIMARY KEY,
  client_secret_hash         TEXT,
  client_name                TEXT,
  redirect_uris              TEXT NOT NULL,
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'client_secret_post',
  grant_types                TEXT NOT NULL DEFAULT 'authorization_code,refresh_token',
  scope                      TEXT,
  created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  enabled                   INTEGER NOT NULL DEFAULT 1,
  revoked_at                TEXT,
  last_used_at              TEXT
);
CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code_hash             TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL,
  redirect_uri          TEXT NOT NULL,
  scope                 TEXT NOT NULL,
  resource              TEXT,
  code_challenge        TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  expires_at            INTEGER NOT NULL,
  used_at               INTEGER,
  user_id               TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL,
  scope      TEXT NOT NULL,
  resource   TEXT,
  expires_at INTEGER NOT NULL,
  rotated_at INTEGER,
  revoked_at INTEGER,
  user_id    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_codes_expires
  ON mcp_oauth_codes (expires_at);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_rt_client
  ON mcp_oauth_refresh_tokens (client_id);
`;

function ensureMcpOauthCoreSchema(db: { exec: (sql: string) => void }): void {
  db.exec(MCP_OAUTH_CORE_DDL);
}

export function mountBrandMcpSurface(opts: {
  manifest: AppManifest;
  runtime: SqliteRuntime;
  os: BrandOsComposition;
  mcp: McpFacade;
  /** Base URL publique (loopback OK pour preuves locales). */
  publicBaseUrl: () => string;
  /** Mounts api-kernel (ops → catalogue `/admin/api`, pas seulement Hono admin). */
  listKernelMounts?: () => MountedApiInfo[];
  /** Ops aplaties (`api.listOperations()`) — préféré pour le catalogue métier. */
  listKernelOperations?: () => ListedModuleOperation[];
}): BrandMcpSurface {
  const getDb = () => opts.runtime.getCore();

  // JWT + tables OAuth avant configure — oauthReady / admin status prouvables.
  const jwtSecret = opts.os.store.ensureMcpJwtSecret();
  if (jwtSecret) process.env.MCP_JWT_SECRET = jwtSecret;
  ensureMcpOauthCoreSchema(getDb());

  configureMcpOAuth({
    getWriteDb: () => getDb() as never,
    tableExists: (n) => tableExists(getDb(), n),
    getJwtSecret: () => opts.os.store.ensureMcpJwtSecret(),
    resolvePublicUrl: () => opts.publicBaseUrl(),
  });

  const toolDefs: Array<{
    name: string;
    category: string;
    access: "read" | "write";
    requiredScope: string;
    description?: string;
    defaultRoles?: string[];
    mcpPublishDefault?: boolean;
  }> = [];
  void opts.mcp.listTools().then((listed) => {
    toolDefs.length = 0;
    for (const t of listed.tools || []) {
      toolDefs.push({
        name: String(t.name),
        category: t.space === "plugin" ? "plugin" : "module",
        access: "read",
        requiredScope: t.requiredScope || "crm:read",
        description: t.description ? String(t.description) : undefined,
        defaultRoles: t.defaultRoles,
        mcpPublishDefault: t.mcpPublishDefault,
      });
    }
    try {
      seedMcpToolPolicies(toolDefs);
    } catch {
      /* DB admin pas prête */
    }
  });

  configureMcpAdmin({
    getDb: () => getDb() as never,
    getWriteDb: () => getDb() as never,
    tableExists: (n) => tableExists(getDb(), n),
    listTools: () => toolDefs,
    mcpOauthReady,
    resolveMcpPublicUrl,
  });

  try {
    ensureMcpAdminSchema();
  } catch {
    /* schema peut déjà exister via migrations platform */
  }

  const productName = opts.manifest.client.productName;

  // Session CRM (cookie marque ou Bearer JWT) — même SoT que /api/v1/auth.
  const sessionFromContext = async (c: {
    req: { header: (n: string) => string | undefined };
  }): Promise<SessionPayload | null> => {
    let token = "";
    try {
      const cookieName = getAuthConfig().cookieName;
      token = getCookie(c as never, cookieName) || "";
    } catch {
      token = "";
    }
    if (!token) {
      const authz = c.req.header("authorization") || "";
      if (authz.toLowerCase().startsWith("bearer ")) {
        token = authz.slice(7).trim();
      }
    }
    if (!token) return null;
    return verifySessionToken(token);
  };

  const resolveCrmUser = (username: string) => {
    const lc = username.trim().toLowerCase();
    if (!lc) return null;
    try {
      const found = getTasksBrandConfig()
        ?.users.list()
        .find((u) => u.username.toLowerCase() === lc && u.active);
      if (!found) return null;
      return {
        id: found.id,
        username: found.username,
        role: found.role === "owner" ? ("owner" as const) : ("collaborator" as const),
        permissions: [...(found.permissions || [])],
      };
    } catch {
      return null;
    }
  };

  const matchLocalAuth = (username: string, password: string) => {
    const auth = opts.os.store.getLocalAuth();
    if (!auth) return null;
    if (
      auth.authUser.toLowerCase() === username.trim().toLowerCase() &&
      auth.authPassword === password
    ) {
      return auth;
    }
    return null;
  };

  const oauthRoutes = createMcpOAuthRoutes({
    productName,
    session: {
      getSessionFromContext: async (c) => {
        const session = await sessionFromContext(c);
        if (!session) return null;
        return {
          email: session.email || null,
          sub: session.sub || null,
        };
      },
      authenticateUser: async (username, password) => {
        const raw = username.trim();
        if (!raw || !password) return null;

        const kitAuth = await authenticateViaKit({ username: raw, password });
        if (kitAuth.ok) {
          const crm = resolveCrmUser(kitAuth.email) || resolveCrmUser(raw);
          return {
            id: crm?.id || kitAuth.email,
            username: crm?.username || kitAuth.email,
          };
        }

        const local = matchLocalAuth(raw, password);
        if (local) {
          const crm = resolveCrmUser(local.authUser);
          return { id: crm?.id || "owner", username: local.authUser };
        }

        if (validateEnvCredentials(raw, password)) {
          const crm = resolveCrmUser(raw);
          return { id: crm?.id || "owner", username: raw };
        }
        return null;
      },
      validateCredentials: (username, password) => {
        if (matchLocalAuth(username, password)) return true;
        return validateEnvCredentials(username, password);
      },
      getOwnerId: () => {
        try {
          return getTasksBrandConfig()?.users.getOwner()?.id ?? "owner";
        } catch {
          return "owner";
        }
      },
      createSessionCookie: async (c, user) => {
        const crm = resolveCrmUser(user.username);
        const token = await createSessionToken({
          user: {
            id: user.id || crm?.id || "owner",
            username: user.username,
            role: crm?.role || "owner",
            permissions: crm?.permissions || getAuthConfig().ownerPermissions,
          },
        });
        const proto = (c.req.header("x-forwarded-proto") || "").toLowerCase();
        let secure = proto === "https";
        if (!secure) {
          try {
            secure = new URL(c.req.url).protocol === "https:";
          } catch {
            /* loopback http */
          }
        }
        const cookie = sessionCookieOptions(token, { secure });
        setCookie(c, cookie.name, cookie.value, toHonoCookie(cookie));
      },
    },
  });

  const adminRoutes = createMcpAdminRoutes({
    diagnosticFilenamePrefix: opts.manifest.brandId,
  });
  const requestLogsRoutes = createRequestLogsRoutes();
  const databaseRoutes = createBrandAdminDatabaseRoutes({
    runtime: opts.runtime,
    brandId: opts.manifest.brandId,
  });

  // Usage analytics (Admin → Analytics) : store brand.db + schema lazy.
  configureUsageAnalytics({
    getWriteDb: () => opts.runtime.getBrand() as never,
    getDb: () => opts.runtime.getBrand() as never,
    tableExists: (n) => tableExists(opts.runtime.getBrand(), n),
  });
  try {
    ensureUsageAnalyticsSchema();
  } catch {
    /* brand.db peut être en lecture seule pendant un smoke court */
  }

  const adminSurface = new Hono();
  adminSurface.route("/", adminRoutes);
  adminSurface.route("/", requestLogsRoutes);
  adminSurface.route("/", databaseRoutes);
  adminSurface.route("/", createUsageAnalyticsAdminRoutes());

  const kernelOpRoutes = () => {
    const listed = opts.listKernelOperations?.();
    if (listed) return collectListedOperationRoutes(listed);
    return collectKernelOperationRoutes(opts.listKernelMounts?.() ?? []);
  };

  const buildAdminRegistry = () =>
    buildApiEndpointsRegistry({
      routes: [
        ...collectHonoRoutes(adminSurface, "/api/v1/admin"),
        ...kernelOpRoutes(),
      ],
      source:
        "kernel operations (modules + platform) + brand admin surface (MCP + database + analytics + request-logs)",
      openapiUrl: "/api/v1/openapi.json",
    });

  adminSurface.route(
    "/",
    createApiEndpointsRoutes({
      getRegistry: buildAdminRegistry,
    }),
  );

  const app = new Hono();
  app.route("/", oauthRoutes);
  app.route("/api/v1/admin", adminSurface);

  // Ingest tracker UI (POST /api/v1/analytics/events) — même session cookie/Bearer.
  app.route(
    "/api/v1/analytics",
    createUsageAnalyticsIngestRoutes({
      getSession: async (c) => {
        const session = await sessionFromContext(c);
        if (!session) return null;
        return {
          sub: session.sub,
          email: session.email,
          role: session.role,
        };
      },
      getUserKind: () => "human",
    }),
  );

  // Stub OpenAPI utile (lien Admin API) — dérivé du registre endpoints montés.
  app.get("/api/v1/openapi.json", (c) =>
    c.json(
      buildOpenApiDocumentFromRegistry(buildAdminRegistry(), {
        title: `${productName} Admin API`,
        version: "0.1.0",
      }),
    ),
  );

  // Sonde légère hors Hono OAuth (preuves)
  app.get("/api/v1/os/mcp-oauth/status", (c) =>
    c.json({
      ok: true,
      oauthReady: mcpOauthReady(),
      publicUrl: resolveMcpPublicUrl(),
      admin: (() => {
        try {
          return mcpAdminStatus();
        } catch (e) {
          return {
            error: e instanceof Error ? e.message : String(e),
          };
        }
      })(),
    }),
  );

  return {
    app,
    oauthReady: () => mcpOauthReady(),
    publicUrl: () => resolveMcpPublicUrl(),
  };
}

/** Proxy Node http → Hono pour chemins OAuth/admin (+ registre endpoints O5). */
export function mcpSurfaceHandlesPath(pathname: string): boolean {
  return (
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/oauth/") ||
    pathname.startsWith("/api/v1/admin/mcp") ||
    adminDatabaseHandlesPath(pathname) ||
    pathname.startsWith("/api/v1/admin/analytics") ||
    pathname === "/api/v1/admin/endpoints" ||
    pathname === "/api/v1/admin/request-logs" ||
    pathname.startsWith("/api/v1/admin/request-logs/") ||
    pathname === "/api/v1/openapi.json" ||
    pathname === "/api/v1/analytics" ||
    pathname.startsWith("/api/v1/analytics/") ||
    pathname === "/api/v1/os/mcp-oauth/status"
  );
}
