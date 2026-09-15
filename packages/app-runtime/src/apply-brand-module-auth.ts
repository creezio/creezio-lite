/**
 * Câble les collecteurs nav du registre modules dans configureAuth /
 * configureAccessControl — SoT unique pour les sessions owner et la
 * matrice `/admin/access` (D8).
 *
 * Appelé par `applyBrandPlatformBindings` (factory) au beforeBoot, et par
 * `mountBrandPlatformSurface` si la marque n'a pas encore configuré auth.
 */
import { configureAuth, getAuthConfig } from "@creezio/auth";
import {
  configureAccessControl,
  getAccessControlConfig,
  isAccessControlConfigured,
  type AccessControlConfig,
} from "@creezio/access-control";
import type { BrandPermissionGroup } from "./module-contract.js";

/** Cookie session aligné `mountBrandPlatformSurface` (`${brandId}_session`). */
export function sessionCookieNameForBrand(brandId: string): string {
  return `${brandId.replace(/[^a-z0-9_]/gi, "_")}_session`;
}

function mergePermissionGroups(
  existing: AccessControlConfig["permissionGroups"],
  extra: readonly BrandPermissionGroup[],
): BrandPermissionGroup[] {
  const out: BrandPermissionGroup[] = [];
  const byId = new Map<string, BrandPermissionGroup>();
  const push = (g: BrandPermissionGroup) => {
    const copy: BrandPermissionGroup = {
      id: g.id,
      label: g.label,
      permissions: g.permissions.map((p) => ({ id: p.id, label: p.label })),
    };
    out.push(copy);
    byId.set(copy.id, copy);
  };
  for (const g of existing ?? []) {
    push({
      id: g.id,
      label: g.label,
      permissions: g.permissions.map((p) =>
        typeof p === "string"
          ? { id: p, label: p }
          : { id: p.id, label: p.label ?? p.id },
      ),
    });
  }
  for (const g of extra) {
    const dest = byId.get(g.id);
    if (!dest) {
      push({
        id: g.id,
        label: g.label,
        permissions: g.permissions.map((p) => ({ id: p.id, label: p.label })),
      });
      continue;
    }
    const seen = new Set(dest.permissions.map((p) => p.id));
    for (const p of g.permissions) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        dest.permissions.push({ id: p.id, label: p.label });
      }
    }
  }
  return out;
}

export type ApplyBrandModuleAuthOptions = {
  cookieName: string;
  /** Absent = conserver `getAuthConfig().ownerPermissions`. */
  ownerPermissions?: readonly string[];
  /**
   * Fusionné dans `configureAccessControl` **seulement** si access-control
   * est déjà configuré (rôles déjà déclarés). N'active pas le module.
   */
  permissionGroups?: readonly BrandPermissionGroup[];
};

/**
 * Pose `ownerPermissions` sur `configureAuth` et, si access-control est
 * déjà configuré, fusionne les groupes nav dans le catalogue admin.
 */
export function applyBrandModuleAuth(opts: ApplyBrandModuleAuthOptions): void {
  const existing = getAuthConfig();
  configureAuth({
    cookieName: existing.cookieName || opts.cookieName,
    ...(opts.ownerPermissions
      ? { ownerPermissions: [...opts.ownerPermissions] }
      : {}),
  });
  if (
    isAccessControlConfigured() &&
    opts.permissionGroups &&
    opts.permissionGroups.length > 0
  ) {
    const current = getAccessControlConfig();
    if (!current) return;
    configureAccessControl({
      roles: current.roles,
      ...(current.defaultRole ? { defaultRole: current.defaultRole } : {}),
      permissionGroups: mergePermissionGroups(
        current.permissionGroups,
        opts.permissionGroups,
      ),
      ...(current.getUserRole ? { getUserRole: current.getUserRole } : {}),
      ...(current.setUserRole ? { setUserRole: current.setUserRole } : {}),
    });
  }
}
