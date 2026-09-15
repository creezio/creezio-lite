/**
 * Configuration auth marque — cookie / permissions owner.
 * Aucun nom de cookie ni bridge hardcodé dans le kit.
 */

/**
 * Accès db minimal (structurel) passé au resolver de rôle marque : la
 * couche brand du kernel (brand.db) quand la surface la fournit, sinon
 * null. Type structurel local, zéro dépendance runtime.
 */
export type BrandRoleDbLike = {
  prepare: (sql: string) => { get: (...params: unknown[]) => unknown };
};

export type AuthConfig = {
  /**
   * Nom du cookie de session JWT (ex. brand_session / brand_session).
   * Obligatoire avant getSession / cookies / middlewares.
   */
  cookieName: string;
  /** Durée cookie en secondes. Défaut 7 jours. */
  cookieMaxAge?: number;
  /**
   * Permissions nav accordées au rôle owner / session AUTH_DISABLED.
   * Injectées par la marque (ALL_NAV_PERMISSIONS).
   */
  ownerPermissions?: readonly string[];
  /**
   * ACL collaborateurs déclarées par la marque — consommées par l'API
   * plateforme users (référentiel unique kit) : permissions par défaut à la
   * création, permissions assignables (checkboxes UI), permissions réservées
   * au owner. Le kit n'embarque aucune liste métier.
   */
  collaboratorDefaultPermissions?: readonly string[];
  collaboratorAssignablePermissions?: readonly string[];
  ownerOnlyPermissions?: readonly string[];
  /**
   * E1 — gestion des collaborateurs gardée par permission : si déclarée, les
   * écritures de l'API plateforme users (POST/PATCH /api/v1/platform/users)
   * acceptent le owner OU une session collaborateur portant cette permission.
   * Option absente (défaut) = garde owner-only historique, octet pour octet.
   */
  userAdminPermission?: string;
  /**
   * Rôle métier marque exposé en session (ex. backoffice, pos) : résolu à
   * la volée par la marque depuis SA db métier, jamais stocké dans le JWT.
   * Servi par GET /api/v1/auth/me (champ brand_role, sub = cible en
   * impersonation) puis exposé côté UI via useSession().me.brandRole (démo
   * interactive par rôle, lanceurs conditionnels…). Option absente
   * (défaut) = brand_role null, aucun filtrage métier côté kit.
   */
  resolveBrandRole?: (
    userId: string,
    db: BrandRoleDbLike | null,
  ) => string | null | Promise<string | null>;
};

const DEFAULT_MAX_AGE = 60 * 60 * 24 * 7;

type ResolvedAuthConfig = {
  cookieName: string;
  cookieMaxAge: number;
  ownerPermissions: readonly string[];
  collaboratorDefaultPermissions: readonly string[];
  collaboratorAssignablePermissions: readonly string[];
  ownerOnlyPermissions: readonly string[];
  /** E1 — vide = non déclarée (garde users owner-only inchangée). */
  userAdminPermission: string;
  /** undefined = non déclaré : /me renvoie brand_role null. */
  resolveBrandRole: AuthConfig["resolveBrandRole"];
};

const DEFAULT: ResolvedAuthConfig = {
  cookieName: "",
  cookieMaxAge: DEFAULT_MAX_AGE,
  ownerPermissions: [],
  collaboratorDefaultPermissions: [],
  collaboratorAssignablePermissions: [],
  ownerOnlyPermissions: [],
  userAdminPermission: "",
  resolveBrandRole: undefined,
};

let config: ResolvedAuthConfig = { ...DEFAULT };

/** Configure une fois au boot marque (avant routes / pages / middleware). */
export function configureAuth(next: AuthConfig): void {
  if (!next.cookieName || !String(next.cookieName).trim()) {
    throw new Error("@creezio/auth: configureAuth({ cookieName }) requis");
  }
  config = {
    cookieName: String(next.cookieName).trim(),
    cookieMaxAge:
      typeof next.cookieMaxAge === "number" && next.cookieMaxAge > 0
        ? next.cookieMaxAge
        : DEFAULT_MAX_AGE,
    ownerPermissions: next.ownerPermissions
      ? [...next.ownerPermissions]
      : config.ownerPermissions,
    collaboratorDefaultPermissions: next.collaboratorDefaultPermissions
      ? [...next.collaboratorDefaultPermissions]
      : config.collaboratorDefaultPermissions,
    collaboratorAssignablePermissions: next.collaboratorAssignablePermissions
      ? [...next.collaboratorAssignablePermissions]
      : config.collaboratorAssignablePermissions,
    ownerOnlyPermissions: next.ownerOnlyPermissions
      ? [...next.ownerOnlyPermissions]
      : config.ownerOnlyPermissions,
    userAdminPermission:
      typeof next.userAdminPermission === "string"
        ? next.userAdminPermission.trim()
        : config.userAdminPermission,
    resolveBrandRole: next.resolveBrandRole ?? config.resolveBrandRole,
  };
}

export function getAuthConfig(): ResolvedAuthConfig {
  return {
    ...config,
    ownerPermissions: [...config.ownerPermissions],
    collaboratorDefaultPermissions: [...config.collaboratorDefaultPermissions],
    collaboratorAssignablePermissions: [
      ...config.collaboratorAssignablePermissions,
    ],
    ownerOnlyPermissions: [...config.ownerOnlyPermissions],
  };
}

export function getAuthCookieName(): string {
  const name = config.cookieName;
  if (!name) {
    throw new Error(
      "@creezio/auth: cookieName non configuré — appeler configureAuth({ cookieName }) au boot",
    );
  }
  return name;
}

export function resetAuthConfigForTests(): void {
  config = { ...DEFAULT, ownerPermissions: [] };
}
