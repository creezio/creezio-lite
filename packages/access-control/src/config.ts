/**
 * Configuration access-control marque — rôles déclaratifs + catalogue de
 * permissions groupées par module. Tout le reste (overrides, assignations,
 * audit) vit en DB (core.db) via le store enregistré par app-runtime.
 */
import type { AccessPermissionGroup, AccessRoleDef } from "./types.js";

export type AccessControlConfig = {
  /** Rôles métier de la marque (défauts déclaratifs). */
  roles: readonly AccessRoleDef[];
  /**
   * Rôle d'un collaborateur sans assignation explicite (ex. "staff" pour une
   * marque mono-rôle). Absent = pas de rôle par défaut (aucune permission).
   */
  defaultRole?: string;
  /** Catalogue des permissions administrables, groupées par module. */
  permissionGroups?: readonly AccessPermissionGroup[];
  /**
   * SoT métier du rôle d'un compte (ex. brand.db user_roles).
   * Absent = table interne `access_user_roles` (core.db).
   */
  getUserRole?: (userId: string) => string | null | Promise<string | null>;
  /** Écriture du rôle côté métier (miroir de getUserRole). */
  setUserRole?: (input: {
    userId: string;
    role: string | null;
    actor: string;
  }) => void | Promise<void>;
};

let config: AccessControlConfig | null = null;

/**
 * Configure une fois au boot marque (beforeBoot, à côté de configureAuth).
 * Sans appel, le module reste inerte : app-runtime ne rebranche ni /me ni la
 * garde API (comportement historique des marques sans rôles).
 */
export function configureAccessControl(next: AccessControlConfig): void {
  if (!Array.isArray(next.roles)) {
    throw new Error("@creezio/access-control: configureAccessControl({ roles }) requis");
  }
  const ids = new Set<string>();
  for (const role of next.roles) {
    if (!role.id || ids.has(role.id)) {
      throw new Error(`@creezio/access-control: rôle invalide ou dupliqué (${role.id})`);
    }
    ids.add(role.id);
  }
  if (next.defaultRole && !ids.has(next.defaultRole)) {
    throw new Error(
      `@creezio/access-control: defaultRole inconnu (${next.defaultRole})`,
    );
  }
  if (next.getUserRole && !next.setUserRole) {
    throw new Error(
      "@creezio/access-control: setUserRole requis quand getUserRole est déclaré",
    );
  }
  config = {
    roles: next.roles.map((r) => ({
      id: r.id,
      label: r.label || r.id,
      defaultPermissions: [...r.defaultPermissions],
    })),
    ...(next.defaultRole ? { defaultRole: next.defaultRole } : {}),
    ...(next.permissionGroups
      ? { permissionGroups: next.permissionGroups.map((g) => ({ ...g })) }
      : {}),
    ...(next.getUserRole ? { getUserRole: next.getUserRole } : {}),
    ...(next.setUserRole ? { setUserRole: next.setUserRole } : {}),
  };
}

export function getAccessControlConfig(): AccessControlConfig | null {
  return config;
}

export function isAccessControlConfigured(): boolean {
  return config !== null;
}

export function resetAccessControlForTests(): void {
  config = null;
}