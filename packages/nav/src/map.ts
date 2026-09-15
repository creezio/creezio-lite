/**
 * Adaptateurs catalogue — CoreNavItem / BrandNavItem → NavCatalogEntry.
 * Ne duplique pas les types NAV-1 (`@creezio/shell-ui`).
 */

import type { NavCatalogEntry, NavCatalogGroup } from "@creezio/shell-ui";

export type BrandNavLike = {
  id: string;
  href: string;
  label: string;
  icon?: string;
  group?: string;
  permission?: string;
  order?: number;
};

function asGroup(raw: string | undefined): NavCatalogGroup {
  if (raw === "plugin" || raw === "admin" || raw === "core") return raw;
  return "brand";
}

/** Projette les items métier (`collectNavItems` / `navItems`) en entrées catalogue. */
export function brandNavItemsToCatalog(
  items: readonly BrandNavLike[] | undefined,
): NavCatalogEntry[] {
  if (!items?.length) return [];
  return items.map((item, i) => {
    const entry: NavCatalogEntry = {
      id: item.id,
      href: item.href,
      label: item.label,
      icon: item.icon && item.icon.length > 0 ? item.icon : "Circle",
      group: asGroup(item.group),
      order: typeof item.order === "number" ? item.order : 100 + i,
      defaultVisible: true,
      source: "module",
      available: true,
    };
    if (item.permission) entry.permission = item.permission;
    return entry;
  });
}
