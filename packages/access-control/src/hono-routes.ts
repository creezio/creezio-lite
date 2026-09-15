/**
 * API Hono access-control — préfixe /api/v1/access (montée par app-runtime).
 *
 * Garde : owner (non impersonné) OU collaborateur porteur de la permission
 * `platform.access.manage` (résolution dynamique — jamais le claim JWT figé).
 */
import { Hono, type Context } from "hono";
import {
  sessionIsImpersonating,
  type SessionPayload,
} from "@creezio/auth";
import {
  getAccessControlConfig,
  type AccessControlConfig,
} from "./config.js";
import {
  getAccessControlStore,
  type AccessControlStore,
} from "./store.js";
import {
  invalidateAccessControlCaches,
  resolvePermissions,
  resolveRoleEffectivePermissions,
  resolveUserRole,
} from "./resolve.js";
import type {
  AccessPermissionDef,
  AccessRouteUser,
} from "./types.js";

/** Permission de gestion du module (owner l'a par défaut). */
export const ACCESS_MANAGE_PERMISSION = "platform.access.manage";

export type AccessControlRouteDeps = {
  getSession: (c: Context) => Promise<SessionPayload | null>;
  listUsers: () => AccessRouteUser[];
  getUserById: (id: string) => AccessRouteUser | null;
  /** Permissions owner (configureAuth.ownerPermissions) — lecture paresseuse. */
  ownerPermissions: () => readonly string[];
  /** configureAuth.userAdminPermission — ajoutée au groupe Plateforme. */
  userAdminPermission?: () => string;
};

type MatrixChange = {
  role?: unknown;
  permission?: unknown;
  effect?: unknown;
};

const MAX_MATRIX_CHANGES = 500;

function normalizePermission(
  raw: string | AccessPermissionDef,
): { id: string; label: string } {
  if (typeof raw === "string") return { id: raw, label: raw };
  return { id: raw.id, label: raw.label || raw.id };
}

/** Groupe natif « Plateforme » — toujours administrable (garde du module). */
function nativePlatformGroup(deps: AccessControlRouteDeps): {
  id: string;
  label: string;
  permissions: Array<{ id: string; label: string }>;
} {
  const permissions = [
    { id: ACCESS_MANAGE_PERMISSION, label: "Gérer les rôles & accès" },
  ];
  const userAdmin = deps.userAdminPermission?.().trim();
  if (userAdmin) {
    permissions.push({ id: userAdmin, label: "Gérer les comptes utilisateurs" });
  }
  return { id: "platform", label: "Plateforme", permissions };
}

function catalogPermissionIds(
  config: AccessControlConfig,
  deps: AccessControlRouteDeps,
): Set<string> {
  const ids = new Set<string>();
  for (const group of [
    nativePlatformGroup(deps),
    ...(config.permissionGroups ?? []),
  ]) {
    for (const p of group.permissions) ids.add(normalizePermission(p).id);
  }
  return ids;
}

export function createAccessControlRoutes(
  deps: AccessControlRouteDeps,
): Hono {
  const app = new Hono();

  function configured():
    | { config: AccessControlConfig; store: AccessControlStore }
    | { error: string; status: 404 | 503 } {
    const config = getAccessControlConfig();
    if (!config) {
      return { error: "access-control non configuré pour cette marque", status: 404 };
    }
    const store = getAccessControlStore();
    if (!store) {
      return { error: "store access-control indisponible", status: 503 };
    }
    return { config, store };
  }

  async function managerSession(
    c: Context,
  ): Promise<{ session: SessionPayload } | Response> {
    const session = await deps.getSession(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    if (session.role === "owner" && !sessionIsImpersonating(session)) {
      return { session };
    }
    if (sessionIsImpersonating(session)) {
      return c.json(
        { error: "Gestion des accès interdite en impersonation" },
        403,
      );
    }
    const permissions = await resolvePermissions(session.sub, null);
    if (!permissions.includes(ACCESS_MANAGE_PERMISSION)) {
      return c.json(
        { error: `Permission ${ACCESS_MANAGE_PERMISSION} requise` },
        403,
      );
    }
    return { session };
  }

  /** Matrice rôles × permissions (défauts brand + overrides DB). */
  app.get("/matrix", async (c) => {
    const guard = await managerSession(c);
    if (guard instanceof Response) return guard;
    const ctx = configured();
    if ("error" in ctx) return c.json({ error: ctx.error }, ctx.status);
    const { config, store } = ctx;
    const overrides = store.listOverrides();
    const ownerPermissions = [...deps.ownerPermissions()];
    const roles = [
      {
        id: "owner",
        label: "Propriétaire",
        locked: true,
        defaults: ownerPermissions,
        effective: ownerPermissions,
      },
      ...config.roles.map((role) => ({
        id: role.id,
        label: role.label,
        locked: false,
        defaults: [...role.defaultPermissions],
        effective: resolveRoleEffectivePermissions(role.id, store),
      })),
    ];
    const groups = [
      nativePlatformGroup(deps),
      ...(config.permissionGroups ?? []).map((g) => ({
        id: g.id,
        label: g.label,
        permissions: g.permissions.map(normalizePermission),
      })),
    ];
    return c.json({
      ok: true,
      managePermission: ACCESS_MANAGE_PERMISSION,
      roles,
      groups,
      overrides,
    });
  });

  /** Sauvegarde des toggles (effect: allow | deny | inherit). */
  app.put("/matrix", async (c) => {
    const guard = await managerSession(c);
    if (guard instanceof Response) return guard;
    const ctx = configured();
    if ("error" in ctx) return c.json({ error: ctx.error }, ctx.status);
    const { config, store } = ctx;
    const actor = String(guard.session.email || guard.session.sub);
    const body = (await c.req.json().catch(() => ({}))) as {
      changes?: MatrixChange[];
    };
    if (!Array.isArray(body.changes)) {
      return c.json({ error: "changes[] requis" }, 400);
    }
    if (body.changes.length > MAX_MATRIX_CHANGES) {
      return c.json({ error: "trop de changements" }, 400);
    }
    const roleIds = new Set(config.roles.map((r) => r.id));
    const catalog = catalogPermissionIds(config, deps);
    const current = new Map(
      store.listOverrides().map((o) => [`${o.role}${o.permission}`, o.effect]),
    );
    const changes: Array<{
      role: string;
      permission: string;
      effect: "allow" | "deny" | "inherit";
    }> = [];
    for (const raw of body.changes) {
      const role = String(raw.role || "");
      const permission = String(raw.permission || "");
      const effect = String(raw.effect || "");
      if (role === "owner") {
        return c.json({ error: "Le rôle propriétaire est figé" }, 400);
      }
      if (!roleIds.has(role)) {
        return c.json({ error: `rôle inconnu: ${role}` }, 400);
      }
      if (!catalog.has(permission)) {
        return c.json({ error: `permission inconnue: ${permission}` }, 400);
      }
      if (effect !== "allow" && effect !== "deny" && effect !== "inherit") {
        return c.json({ error: `effect invalide: ${effect}` }, 400);
      }
      changes.push({ role, permission, effect });
    }
    for (const change of changes) {
      const key = `${change.role}${change.permission}`;
      const before = current.get(key) ?? null;
      if (change.effect === "inherit") {
        if (before !== null) {
          store.clearOverride(change.role, change.permission);
          store.logAudit({
            actor,
            action: "override.clear",
            role: change.role,
            permission: change.permission,
            detail: { from: before },
          });
        }
        continue;
      }
      if (before !== change.effect) {
        store.setOverride(change.role, change.permission, change.effect, actor);
        store.logAudit({
          actor,
          action: "override.set",
          role: change.role,
          permission: change.permission,
          effect: change.effect,
          detail: { from: before, to: change.effect },
        });
      }
    }
    invalidateAccessControlCaches();
    return c.json({ ok: true, overrides: store.listOverrides() });
  });

  /**
   * Comptes + rôle effectif + permissions résolues. Pour chaque compte non
   * owner : `roleBaseline` (permissions du rôle SEUL) + `overrides` (les
   * ajustements par compte) — l'UI en déduit l'écart compte ↔ rôle.
   */
  app.get("/users", async (c) => {
    const guard = await managerSession(c);
    if (guard instanceof Response) return guard;
    const ctx = configured();
    if ("error" in ctx) return c.json({ error: ctx.error }, ctx.status);
    const { config, store } = ctx;
    const users = [];
    for (const user of deps.listUsers()) {
      const isOwner = user.role === "owner";
      const role = isOwner ? "owner" : await resolveUserRole(user.id, null);
      users.push({
        id: user.id,
        username: user.username,
        kind: user.kind ?? "human",
        active: user.active !== false,
        kitRole: user.role,
        role,
        permissions: isOwner
          ? [...deps.ownerPermissions()]
          : await resolvePermissions(user.id, null),
        roleBaseline: isOwner
          ? [...deps.ownerPermissions()]
          : role
            ? resolveRoleEffectivePermissions(role, store)
            : [],
        overrides: isOwner
          ? []
          : store
              .listUserOverrides(user.id)
              .map((o) => ({ permission: o.permission, effect: o.effect })),
      });
    }
    return c.json({
      ok: true,
      users,
      roles: config.roles.map((r) => ({ id: r.id, label: r.label })),
      defaultRole: config.defaultRole ?? null,
    });
  });

  /**
   * Attribution de permissions PAR COMPTE (overrides utilisateur) —
   * `{ changes: [{ permission, effect: allow|deny|inherit }] }`.
   * `inherit` = retour au rôle. Owner figé (a déjà tout).
   */
  app.put("/users/:id/permissions", async (c) => {
    const guard = await managerSession(c);
    if (guard instanceof Response) return guard;
    const ctx = configured();
    if ("error" in ctx) return c.json({ error: ctx.error }, ctx.status);
    const { config, store } = ctx;
    const actor = String(guard.session.email || guard.session.sub);
    const target = deps.getUserById(c.req.param("id"));
    if (!target) return c.json({ error: "Compte introuvable" }, 404);
    if (target.role === "owner") {
      return c.json(
        { error: "Le propriétaire a toutes les permissions (figé)" },
        400,
      );
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      changes?: Array<{ permission?: unknown; effect?: unknown }>;
    };
    if (!Array.isArray(body.changes)) {
      return c.json({ error: "changes[] requis" }, 400);
    }
    if (body.changes.length > MAX_MATRIX_CHANGES) {
      return c.json({ error: "trop de changements" }, 400);
    }
    const catalog = catalogPermissionIds(config, deps);
    const changes: Array<{
      permission: string;
      effect: "allow" | "deny" | "inherit";
    }> = [];
    for (const raw of body.changes) {
      const permission = String(raw.permission || "");
      const effect = String(raw.effect || "");
      if (!catalog.has(permission)) {
        return c.json({ error: `permission inconnue: ${permission}` }, 400);
      }
      if (effect !== "allow" && effect !== "deny" && effect !== "inherit") {
        return c.json({ error: `effect invalide: ${effect}` }, 400);
      }
      changes.push({ permission, effect });
    }
    const current = new Map(
      store
        .listUserOverrides(target.id)
        .map((o) => [o.permission, o.effect] as const),
    );
    for (const change of changes) {
      const before = current.get(change.permission) ?? null;
      if (change.effect === "inherit") {
        if (before !== null) {
          store.clearUserOverride(target.id, change.permission);
          store.logAudit({
            actor,
            action: "user.override.clear",
            permission: change.permission,
            targetUserId: target.id,
            detail: { username: target.username, from: before },
          });
        }
        continue;
      }
      if (before !== change.effect) {
        store.setUserOverride(
          target.id,
          change.permission,
          change.effect,
          actor,
        );
        store.logAudit({
          actor,
          action: "user.override.set",
          permission: change.permission,
          effect: change.effect,
          targetUserId: target.id,
          detail: { username: target.username, from: before, to: change.effect },
        });
      }
    }
    invalidateAccessControlCaches(target.id);
    return c.json({
      ok: true,
      user: {
        id: target.id,
        username: target.username,
        permissions: await resolvePermissions(target.id, null),
        overrides: store
          .listUserOverrides(target.id)
          .map((o) => ({ permission: o.permission, effect: o.effect })),
      },
    });
  });

  /** Change le rôle d'un compte (SoT métier ou table interne). */
  app.put("/users/:id/role", async (c) => {
    const guard = await managerSession(c);
    if (guard instanceof Response) return guard;
    const ctx = configured();
    if ("error" in ctx) return c.json({ error: ctx.error }, ctx.status);
    const { config, store } = ctx;
    const actor = String(guard.session.email || guard.session.sub);
    const target = deps.getUserById(c.req.param("id"));
    if (!target) return c.json({ error: "Compte introuvable" }, 404);
    if (target.role === "owner") {
      return c.json({ error: "Le rôle du propriétaire est figé" }, 400);
    }
    const body = (await c.req.json().catch(() => ({}))) as { role?: unknown };
    const role =
      body.role === null || body.role === undefined || body.role === ""
        ? null
        : String(body.role);
    if (role !== null && !config.roles.some((r) => r.id === role)) {
      return c.json({ error: `rôle inconnu: ${role}` }, 400);
    }
    const previous = await resolveUserRole(target.id, null);
    if (config.setUserRole) {
      await config.setUserRole({ userId: target.id, role, actor });
    } else {
      store.setUserRole(target.id, role, actor);
    }
    store.logAudit({
      actor,
      action: "user.role",
      role,
      targetUserId: target.id,
      detail: { username: target.username, from: previous, to: role },
    });
    invalidateAccessControlCaches(target.id);
    return c.json({
      ok: true,
      user: {
        id: target.id,
        username: target.username,
        role,
        permissions: await resolvePermissions(target.id, null),
      },
    });
  });

  /** Journal d'audit (desc, limit ≤ 500). */
  app.get("/audit", async (c) => {
    const guard = await managerSession(c);
    if (guard instanceof Response) return guard;
    const ctx = configured();
    if ("error" in ctx) return c.json({ error: ctx.error }, ctx.status);
    const { store } = ctx;
    const raw = Number(c.req.query("limit") || "100");
    const limit =
      Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 500) : 100;
    return c.json({ ok: true, entries: store.listAudit(limit) });
  });

  return app;
}