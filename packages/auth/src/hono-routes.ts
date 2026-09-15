/**
 * Factory routes auth Hono (login / logout / me / impersonation / AI workspace).
 * Lookup users + ACL injectés — le kit ne connaît pas le métier marque.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { setCookie } from "hono/cookie";
import type { Context } from "hono";
import {
  authenticateViaKit,
  migrateBrandCredentialsToKit,
} from "./env-store.js";
import {
  clearSessionCookieOptions,
  createSessionToken,
  isAuthDisabled,
  sessionActorIsOwner,
  sessionCookieOptions,
  sessionIsImpersonating,
  toHonoCookie,
  validateEnvCredentials,
  type AuthSessionUser,
  type SessionPayload,
} from "./session.js";

export type AuthRouteUser = AuthSessionUser & {
  active?: boolean | number;
  kind?: "human" | "ai" | string;
};

export type AuthRouteAdapters = {
  authenticateUser: (
    email: string,
    password: string,
  ) => AuthRouteUser | null | undefined;
  ensureOwnerSynced: () => AuthRouteUser | null | undefined;
  getUserById: (id: string) => AuthRouteUser | null | undefined;
  getUserByUsername: (
    username: string,
  ) => { id: string; active: number } | null | undefined;
  listUsers: () => AuthRouteUser[];
  /** Permissions owner pour /me quand AUTH_DISABLED. */
  ownerPermissions: readonly string[];
  /**
   * Secure cookie depuis la requête.
   * Typiquement : resolveCookieSecure de @creezio/shell-ui.
   */
  resolveCookieSecure: (c: Context) => boolean;
  /**
   * Validation credentials marque (env + SQLite).
   * Défaut : validateEnvCredentials kit.
   */
  validateCredentials?: (email: string, password: string) => boolean;
  /**
   * Session depuis contexte Hono (souvent createHonoAuth().getSessionFromContext).
   */
  getSessionFromContext: (c: Context) => Promise<SessionPayload | null>;
  /**
   * Kit-first login (TF/CV). Défaut true.
   * feature-off peut forcer true après cutover.
   */
  kitFirst?: boolean;
  /**
   * Rôle métier marque de la session (champ brand_role de /me) — construit
   * par app-runtime depuis configureAuth.resolveBrandRole + la db brand de
   * la surface. sub = la CIBLE en impersonation : le rôle suivi est celui
   * du compte vu. Adapter absent = brand_role null (rétrocompatible).
   */
  resolveBrandRole?: (
    userId: string,
  ) => string | null | Promise<string | null>;
  /**
   * Résolution DYNAMIQUE des permissions effectives (module natif
   * @creezio/access-control) — injectée par app-runtime quand la marque
   * configure access-control. /me sert alors la valeur résolue (défauts de
   * rôle + overrides DB, cache court) au lieu du claim JWT, et les tokens
   * mintés (login / impersonate) embarquent la valeur fraîche — un toggle
   * admin est effectif à la prochaine requête / reconnexion, sans toucher
   * au référentiel (creezio_platform_users.permissions devient donnée
   * historique inerte pour ces marques). Absent = comportement historique
   * (permissions figées), octet pour octet.
   */
  resolveEffectivePermissions?: (
    userId: string,
    kitRole: "owner" | "collaborator",
  ) => readonly string[] | Promise<readonly string[]>;
};

/** Permissions résolues dynamiquement si l'adaptateur est présent. */
async function effectivePermissions(
  adapters: AuthRouteAdapters,
  user: { id: string; role: string },
  fallback: readonly string[],
): Promise<string[]> {
  if (!adapters.resolveEffectivePermissions) return [...fallback];
  try {
    return [
      ...(await adapters.resolveEffectivePermissions(
        user.id,
        user.role === "owner" ? "owner" : "collaborator",
      )),
    ];
  } catch {
    return [...fallback]; // fail-open : jamais de 500 sur /me ou login
  }
};

const ErrorSchema = z.object({ error: z.string() }).openapi("AuthError");
const OkSchema = z.object({ ok: z.literal(true) }).openapi("AuthOk");
const LoginSchema = z
  .object({
    email: z.string(),
    password: z.string(),
  })
  .openapi("AuthLogin");

function projectUserFromKitLogin(
  email: string,
  adapters: AuthRouteAdapters,
): AuthRouteUser | null {
  // Kit OK mais hash brand stale → projection ACL par username
  const synced = adapters.ensureOwnerSynced();
  const emailLc = email.trim().toLowerCase();
  if (synced && synced.username.toLowerCase() === emailLc) {
    return synced;
  }
  const pub = adapters.listUsers().find((u) => {
    const active = u.active === undefined ? true : Boolean(u.active);
    return u.username.toLowerCase() === emailLc && active;
  });
  if (pub) return pub;
  // row existe mais inactive / AI — refusé
  if (adapters.getUserByUsername(email)) return null;
  return null;
}

async function resolveLoginUser(
  email: string,
  password: string,
  adapters: AuthRouteAdapters,
): Promise<AuthRouteUser | null> {
  const validate =
    adapters.validateCredentials ?? validateEnvCredentials;
  const kitFirst = adapters.kitFirst !== false;

  if (kitFirst) {
    const kitAuth = await authenticateViaKit({ username: email, password });
    let user: AuthRouteUser | null | undefined = null;
    if (kitAuth.ok) {
      user = adapters.authenticateUser(email, password);
      if (!user) {
        user = projectUserFromKitLogin(email, adapters);
      }
    } else {
      user = adapters.authenticateUser(email, password);
      if (!user && validate(email, password)) {
        user = adapters.ensureOwnerSynced();
      }
      if (user) {
        await migrateBrandCredentialsToKit({
          username: email,
          password,
          displayName: user.username,
        }).catch(() => undefined);
      }
    }
    return user ?? null;
  }

  // Brand-only (legacy) — migrate one-shot si succès
  let user = adapters.authenticateUser(email, password);
  if (!user && validate(email, password)) {
    user = adapters.ensureOwnerSynced();
  }
  if (user) {
    await migrateBrandCredentialsToKit({
      username: email,
      password,
      displayName: user.username,
    }).catch(() => undefined);
  }
  return user ?? null;
}

export function createAuthRoutes(
  adapters: AuthRouteAdapters,
): OpenAPIHono {
  const app = new OpenAPIHono();

  app.openapi(
    createRoute({
      method: "post",
      path: "/login",
      tags: ["auth"],
      summary: "Connexion (pose le cookie de session)",
      request: {
        body: { content: { "application/json": { schema: LoginSchema } } },
      },
      responses: {
        200: {
          description: "Session créée",
          content: {
            "application/json": {
              schema: OkSchema.extend({
                auth_disabled: z.boolean().optional(),
              }),
            },
          },
        },
        401: {
          description: "Identifiants invalides",
          content: { "application/json": { schema: ErrorSchema } },
        },
      },
    }),
    async (c) => {
      if (isAuthDisabled()) {
        return c.json({ ok: true as const, auth_disabled: true }, 200);
      }
      const { email, password } = c.req.valid("json");
      const user = await resolveLoginUser(email, password, adapters);
      if (!user) {
        return c.json({ error: "Identifiants invalides" }, 401);
      }
      const permissions = await effectivePermissions(
        adapters,
        user,
        user.permissions,
      );
      const token = await createSessionToken({
        user: { ...user, permissions },
      });
      const opts = sessionCookieOptions(token, {
        secure: adapters.resolveCookieSecure(c),
      });
      setCookie(c, opts.name, opts.value, toHonoCookie(opts));
      return c.json({ ok: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/logout",
      tags: ["auth"],
      summary: "Déconnexion",
      responses: {
        200: {
          description: "Session supprimée",
          content: { "application/json": { schema: OkSchema } },
        },
      },
    }),
    async (c) => {
      const opts = clearSessionCookieOptions({
        secure: adapters.resolveCookieSecure(c),
      });
      setCookie(c, opts.name, opts.value, toHonoCookie(opts));
      return c.json({ ok: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/me",
      tags: ["auth"],
      summary: "Compte de la session courante",
      responses: {
        200: {
          description: "Utilisateur connecté",
          content: {
            "application/json": {
              schema: OkSchema.extend({
                user: z.string(),
                user_id: z.string().optional(),
                role: z.string().optional(),
                permissions: z.array(z.string()).optional(),
                impersonating: z.boolean().optional(),
                auth_disabled: z.boolean().optional(),
                brand_role: z.string().nullable().optional(),
              }),
            },
          },
        },
        401: {
          description: "Non authentifié",
          content: { "application/json": { schema: ErrorSchema } },
        },
      },
    }),
    async (c) => {
      if (isAuthDisabled()) {
        return c.json(
          {
            ok: true as const,
            user: "auth-disabled",
            auth_disabled: true,
            role: "owner",
            permissions: [...adapters.ownerPermissions],
            impersonating: false,
            brand_role: null,
          },
          200,
        );
      }
      const session = await adapters.getSessionFromContext(c);
      if (!session?.email && !session?.sub) {
        return c.json({ error: "Non authentifié" }, 401);
      }
      const me = adapters.getUserById(session.sub);
      const actor = session.actorSub
        ? adapters.getUserById(session.actorSub)
        : null;
      const permissions = await effectivePermissions(
        adapters,
        { id: session.sub, role: session.role },
        session.permissions,
      );
      /* Rôle métier marque (configureAuth.resolveBrandRole) — best effort :
       * un resolver en échec ne doit JAMAIS faire échouer /me. */
      let brandRole: string | null = null;
      try {
        brandRole = (await adapters.resolveBrandRole?.(session.sub)) ?? null;
      } catch {
        brandRole = null;
      }
      return c.json(
        {
          ok: true as const,
          user: String(session.email),
          user_id: session.sub,
          role: session.role,
          kind: me?.kind || "human",
          permissions,
          impersonating: sessionIsImpersonating(session),
          brand_role: brandRole,
          actor: actor
            ? { id: actor.id, username: actor.username, role: actor.role }
            : null,
        },
        200,
      );
    },
  );

  app.post("/impersonate", async (c) => {
    const session = await adapters.getSessionFromContext(c);
    if (
      !session ||
      !sessionActorIsOwner(session) ||
      sessionIsImpersonating(session)
    ) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    const userId = String(
      ((await c.req.json().catch(() => ({}))) as { userId?: string }).userId ||
        "",
    );
    const target = adapters.getUserById(userId);
    const actor =
      adapters.getUserById(session.sub) || adapters.ensureOwnerSynced();
    const targetActive =
      target &&
      (target.active === undefined ||
        target.active === true ||
        target.active === 1);
    if (!targetActive || target?.role === "owner" || !actor) {
      return c.json({ error: "Collaborateur introuvable" }, 404);
    }
    const targetPermissions = await effectivePermissions(
      adapters,
      target!,
      target!.permissions,
    );
    const opts = sessionCookieOptions(
      await createSessionToken({
        user: { ...target!, permissions: targetPermissions },
        actor,
      }),
      { secure: adapters.resolveCookieSecure(c) },
    );
    setCookie(c, opts.name, opts.value, toHonoCookie(opts));
    return c.json({
      ok: true,
      user: target!.username,
      user_id: target!.id,
      role: target!.role,
      permissions: target!.permissions,
      impersonating: true,
    });
  });

  app.post("/stop-impersonate", async (c) => {
    const session = await adapters.getSessionFromContext(c);
    if (!session?.actorSub || !sessionIsImpersonating(session)) {
      return c.json({ error: "Aucune impersonation active" }, 400);
    }
    const actor =
      adapters.getUserById(session.actorSub) || adapters.ensureOwnerSynced();
    if (!actor) {
      return c.json({ error: "Compte principal introuvable" }, 403);
    }
    const opts = sessionCookieOptions(
      await createSessionToken({ user: actor }),
      { secure: adapters.resolveCookieSecure(c) },
    );
    setCookie(c, opts.name, opts.value, toHonoCookie(opts));
    return c.json({ ok: true });
  });

  app.post("/ai-workspace-session", async (c) => {
    const session = await adapters.getSessionFromContext(c);
    if (
      !session ||
      !sessionActorIsOwner(session) ||
      sessionIsImpersonating(session)
    ) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    const userId = String(
      ((await c.req.json().catch(() => ({}))) as { userId?: string }).userId ||
        "",
    );
    const target = adapters.getUserById(userId);
    const actor =
      adapters.getUserById(session.sub) || adapters.ensureOwnerSynced();
    const targetActive =
      target &&
      (target.active === undefined ||
        target.active === true ||
        target.active === 1);
    if (!targetActive || target?.kind !== "ai" || !actor) {
      return c.json({ error: "Collaborateur IA introuvable" }, 404);
    }
    return c.json({
      ok: true,
      token: await createSessionToken({ user: target!, actor }),
      user_id: target!.id,
      user: target!.username,
      kind: target!.kind,
      permissions: target!.permissions,
    });
  });

  return app;
}
