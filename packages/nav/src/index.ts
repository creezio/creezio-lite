/**
 * @creezio/nav — module natif hybride (catalogue sidebar + overrides admin).
 *
 * UI React : `@creezio/nav/ui`. Types catalogue : `@creezio/shell-ui`
 * (NAV-1 — ne pas dupliquer).
 */

export const NAV_PACKAGE = "@creezio/nav" as const;

export { NAV_SCHEMA_SQL, navMigrations } from "./migrations.js";

export type {
  NavDb,
  NavOverridePatch,
  NavStoredOverride,
} from "./store.js";
export {
  deleteNavOverride,
  getNavOverride,
  listNavOverrides,
  mergeNavOverridePatch,
  reorderNavOverrides,
  toNavCatalogOverrides,
  upsertNavOverride,
} from "./store.js";

export type { BrandNavLike } from "./map.js";
export { brandNavItemsToCatalog } from "./map.js";

export { OS_ADMIN_NAV_ENTRY, registerOsNavAdminEntry } from "./admin-entry.js";

export type { NavActor, NavMountOptions, NavPersistence } from "./mount.js";
export { NAV_MANAGE_PERMISSION, createNavMount } from "./mount.js";
