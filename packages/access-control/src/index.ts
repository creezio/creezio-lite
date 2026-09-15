/** Surface publique @creezio/access-control. */
export {
  configureAccessControl,
  getAccessControlConfig,
  isAccessControlConfigured,
  resetAccessControlForTests,
  type AccessControlConfig,
} from "./config.js";
export {
  ACCESS_CONTROL_CORE_SQL,
  createSqliteAccessStore,
  getAccessControlStore,
  registerAccessControlStore,
  resetAccessControlStoreForTests,
  type AccessControlStore,
  type AccessDbHandle,
} from "./store.js";
export {
  invalidateAccessControlCaches,
  resolvePermissions,
  resolveRoleEffectivePermissions,
  resolveUserRole,
} from "./resolve.js";
export {
  ACCESS_MANAGE_PERMISSION,
  createAccessControlRoutes,
  type AccessControlRouteDeps,
} from "./hono-routes.js";
export type {
  AccessAuditEntry,
  AccessEffect,
  AccessOverride,
  AccessPermissionDef,
  AccessPermissionGroup,
  AccessRoleDef,
  AccessRouteUser,
  AccessUserOverride,
  AccessUserRole,
} from "./types.js";