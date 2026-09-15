/**
 * Types session JWT génériques (indépendants du métier users marque).
 */

export type AuthSessionUser = {
  id: string;
  username: string;
  role: string;
  permissions: readonly string[];
};

export type SessionRole = "owner" | "collaborator";

export type SessionPayload = {
  sub: string;
  email: string;
  role: SessionRole;
  permissions: string[];
  /** Présent uniquement en impersonation = id du owner acteur. */
  actorSub?: string;
  actorRole?: "owner";
};

export type SessionCookieSecureOpts = {
  /**
   * Forcer Secure selon la requête (tunnel https vs Electron http://127.0.0.1).
   * Si omis : production → true.
   */
  secure?: boolean;
};

export type SessionCookieOptions = {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

export type NavAccessAdapters = {
  hasPermission: (
    permissions: readonly string[],
    required: string | null | undefined,
  ) => boolean;
  permissionForPath: (pathname: string) => string | null | undefined;
};

export type SessionUserLookup = {
  ensureOwnerSynced: () => AuthSessionUser | null;
  getUserByUsername: (
    username: string,
  ) => { id: string; active: number } | null | undefined;
  getUserById: (id: string) => AuthSessionUser | null | undefined;
};
