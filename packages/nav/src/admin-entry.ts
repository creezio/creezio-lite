/**
 * Entrée admin « Navigation » — registre OS (NAV-1), pas un 3ᵉ ADMIN_NAV.
 */

import { registerOsNavEntry, type NavCatalogEntry } from "@creezio/shell-ui";

export const OS_ADMIN_NAV_ENTRY: NavCatalogEntry = {
  id: "os.admin.nav",
  href: "/admin/nav",
  label: "Navigation",
  icon: "List",
  group: "admin",
  order: 72,
  permission: "platform.access.manage",
  defaultVisible: true,
  source: "os",
  available: true,
};

/** Enregistre `os.admin.nav`. Idempotent (même href + label). */
export function registerOsNavAdminEntry(): () => void {
  return registerOsNavEntry(OS_ADMIN_NAV_ENTRY);
}
