/**
 * Résolution dynamique des permissions :
 *   défauts déclaratifs du rôle (configureAccessControl) + overrides DB de
 *   rôle + overrides DB par COMPTE (access_user_overrides — deny > allow >
 *   rôle : c'est l'attribution de permissions de modules à un compte précis).
 *
 * Cache mémoire court (30 s) — invalidé à chaque écriture (matrice / rôle).
 * Le rôle d'un compte vient du SoT métier (getUserRole marque) ou de la table
 * interne access_user_roles, sinon brandRole (auth) / defaultRole.
 */
import { getAccessControlConfig } from "./config.js";
import {
  getAccessControlStore,
  type AccessControlStore,
} from "./store.js";

const CACHE_TTL_MS = 30_000;

const permissionsCache = new Map<
  string,
  { at: number; brandRole: string | null; permissions: string[] }
>();

/** Invalide le cache (un compte, ou tout si omis) — appelé aux écritures. */
export function invalidateAccessControlCaches(userId?: string): void {
  if (userId) permissionsCache.delete(userId);
  else permissionsCache.clear();
}

/** Rôle effectif d'un compte (SoT métier > table interne > brandRole > défaut). */
export async function resolveUserRole(
  userId: string,
  brandRole?: string | null,
  storeOverride?: AccessControlStore,
): Promise<string | null> {
  const config = getAccessControlConfig();
  if (!config) return brandRole ?? null;
  if (config.getUserRole) {
    const role = await config.getUserRole(userId);
    if (role) return role;
  } else {
    const store = storeOverride ?? getAccessControlStore();
    const role = store?.getUserRole(userId);
    if (role) return role;
  }
  return brandRole ?? config.defaultRole ?? null;
}

/**
 * Permissions effectives d'un compte : défauts du rôle + overrides DB de
 * rôle + overrides DB du compte (deny > allow > rôle).
 * Le owner kit ne passe PAS par ici (court-circuit ownerPermissions côté
 * appelant — auth /me, garde API).
 */
export async function resolvePermissions(
  userId: string,
  brandRole?: string | null,
  storeOverride?: AccessControlStore,
): Promise<string[]> {
  const config = getAccessControlConfig();
  if (!config) return [];
  const key = brandRole ?? null;
  const hit = permissionsCache.get(userId);
  if (hit && hit.brandRole === key && Date.now() - hit.at < CACHE_TTL_MS) {
    return [...hit.permissions];
  }
  const role = await resolveUserRole(userId, brandRole, storeOverride);
  const effective = new Set<string>(
    role ? resolveRoleEffectivePermissions(role, storeOverride) : [],
  );
  const store = storeOverride ?? getAccessControlStore();
  if (store) {
    for (const override of store.listUserOverrides(userId)) {
      if (override.effect === "allow") effective.add(override.permission);
      else effective.delete(override.permission);
    }
  }
  const permissions = [...effective];
  permissionsCache.set(userId, { at: Date.now(), brandRole: key, permissions });
  return [...permissions];
}

/** Permissions effectives d'un RÔLE (défauts + overrides) — sans cache. */
export function resolveRoleEffectivePermissions(
  role: string,
  storeOverride?: AccessControlStore,
): string[] {
  const config = getAccessControlConfig();
  if (!config) return [];
  const def = config.roles.find((r) => r.id === role);
  const effective = new Set<string>(def ? [...def.defaultPermissions] : []);
  const store = storeOverride ?? getAccessControlStore();
  if (store) {
    for (const override of store.listOverridesByRole(role)) {
      if (override.effect === "allow") effective.add(override.permission);
      else effective.delete(override.permission);
    }
  }
  return [...effective];
}