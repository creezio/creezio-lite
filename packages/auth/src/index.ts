/**
 * @creezio/auth — session native Creezio (store + JWT + Hono + UI).
 * UI React : `@creezio/auth/ui`.
 * Recovery crypto : `@creezio/platform-core` (réexporté ci-dessous).
 */

export { AUTH_CORE_SQL } from "./schema.js";
export type {
  AuthAccountPublic,
  AuthLoginInput,
  AuthRegisterInput,
  AuthSession,
  AuthStore,
  AuthUser,
} from "./types.js";
export { createMemoryAuthStore } from "./memory-store.js";
export type {
  CreateSqliteAuthStoreOptions,
  SqliteAuthStore,
} from "./sqlite-store.js";
export { createSqliteAuthStore } from "./sqlite-store.js";
export type { OpenSqliteDatabase, SqliteDatabase } from "./sqlite-driver.js";
export { openNodeSqliteDatabase } from "./sqlite-driver.js";
export {
  hashPassword,
  hashToken,
  newToken,
  verifyPassword,
} from "./password.js";
export type { AuthIpcBindings, IpcHandleFn } from "./ipc.js";
export { authLoginWithStore, bindAuthIpcHandlers } from "./ipc.js";
export type { KitAuthResult } from "./env-store.js";
export {
  authenticateViaKit,
  countKitAuthUsers,
  getKitAuthStore,
  migrateBrandCredentialsToKit,
} from "./env-store.js";

/* ── Config marque ── */
export type { AuthConfig, BrandRoleDbLike } from "./config.js";
export {
  configureAuth,
  getAuthConfig,
  getAuthCookieName,
  resetAuthConfigForTests,
} from "./config.js";

/* ── Session JWT / cookies ── */
export type {
  AuthSessionUser,
  NavAccessAdapters,
  SessionCookieOptions,
  SessionCookieSecureOpts,
  SessionPayload,
  SessionRole,
  SessionUserLookup,
} from "./session.js";
export {
  DEV_AUTH_SECRET_FALLBACK,
  clearSessionCookieOptions,
  createSessionToken,
  createSessionTokenForUsername,
  getAuthCredentials,
  getSession,
  isAuthDisabled,
  sessionActorIsOwner,
  sessionCanAccessPath,
  sessionCookieOptions,
  sessionIsImpersonating,
  toHonoCookie,
  validateEnvCredentials,
  verifySessionToken,
} from "./session.js";

/* ── Hono middlewares ── */
export type {
  HonoAuthAdapters,
  HonoAuthMiddleware,
  PublicApiKeyRecord,
} from "./hono-middleware.js";
export { createHonoAuth } from "./hono-middleware.js";

/* ── Hono routes ── */
export type {
  AuthRouteAdapters,
  AuthRouteUser,
} from "./hono-routes.js";
export { createAuthRoutes } from "./hono-routes.js";

/* ── Recovery (SoT platform-core) ── */
export type {
  RecoveryEnvelope,
  RecoveryVerifier,
  RecoveryWrappedSecrets,
} from "@creezio/platform-core";
export {
  createRecoveryVerifier,
  generateRecoveryKey,
  normalizeRecoveryKey,
  unwrapSecretsWithRecoveryKey,
  verifyRecoveryKey,
  wrapSecretsWithRecoveryKey,
} from "@creezio/platform-core";
