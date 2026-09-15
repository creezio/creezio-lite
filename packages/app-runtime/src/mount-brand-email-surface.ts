/**
 * Surface Hono `/api/v1/email/*` — inbound Worker CF + inbox/outbox kit.
 * Montée par listenBrandOsHttp (desktop + harness).
 *
 * Auth : session cookie/Bearer requise pour l'inbox (lecture/écriture).
 * `/inbound` reste protégé par secret partagé (Worker Cloudflare) ;
 * `/webhooks/*` par signature (Svix Resend). Les routes owner-only
 * (`/settings*`, `/accounts*`) exigent une session owner.
 */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  getAuthConfig,
  isAuthDisabled,
  verifySessionToken,
} from "@creezio/auth";
import {
  createEmailInboxRoutes,
  type MailRouteActor,
  type SqliteMailsStore,
} from "@creezio/mails";

export type BrandEmailSurface = {
  app: Hono;
};

type HeaderContext = {
  req: {
    header: (name: string) => string | undefined;
  };
};

async function sessionFromEmailContext(
  c: HeaderContext,
): Promise<{ sub: string; role: string } | null> {
  if (isAuthDisabled()) {
    return { sub: "auth-disabled", role: "owner" };
  }
  let token = "";
  try {
    const cookieName = getAuthConfig().cookieName;
    if (cookieName) token = getCookie(c as never, cookieName) || "";
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
  const session = await verifySessionToken(token);
  if (!session?.sub) return null;
  return { sub: session.sub, role: session.role || "collaborator" };
}

function isPublicEmailPath(path: string): boolean {
  return (
    path === "/inbound" ||
    path.endsWith("/inbound") ||
    path.includes("/webhooks/")
  );
}

export function mountBrandEmailSurface(opts?: {
  /** Store kernel (sinon getKitMailsStore via CREEZIO_CORE_DB_PATH). */
  getStore?: () => SqliteMailsStore | null;
}): BrandEmailSurface {
  const app = new Hono();
  const inbox = new Hono();

  // Middleware AVANT les routes (Hono n'enveloppe pas les routes déjà posées).
  inbox.use("*", async (c, next) => {
    const path = c.req.path || "";
    if (isPublicEmailPath(path)) {
      return next();
    }
    if (!(await sessionFromEmailContext(c))) {
      return c.json({ error: "Non authentifié" }, 401);
    }
    return next();
  });

  const resolveActor = async (c: HeaderContext): Promise<MailRouteActor> => {
    const session = await sessionFromEmailContext(c);
    return {
      userId: session?.sub ?? null,
      owner: session?.role === "owner",
    };
  };

  inbox.route(
    "/",
    createEmailInboxRoutes({
      ...(opts?.getStore ? { getStore: opts.getStore } : {}),
      resolveActor,
    }),
  );

  app.route("/api/v1/email", inbox);
  return { app };
}

/** Chemins proxifiés Node http → Hono inbox. */
export function emailSurfaceHandlesPath(pathname: string): boolean {
  return (
    pathname === "/api/v1/email" || pathname.startsWith("/api/v1/email/")
  );
}
