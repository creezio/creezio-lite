"use client";

/**
 * Loader unique du catalogue sidebar — fetch `GET /api/v1/modules/nav`,
 * bump `configureSidebar`, alimente `getNavItems`.
 *
 * Vit dans `@creezio/shell-ui/ui` pour que le chrome factory n'importe
 * pas `@creezio/nav` au runtime UI. La factory **installe** quand même
 * `@creezio/nav` (même vague publish) pour `/admin/nav` et le mount
 * auto-register. `@creezio/nav/ui` re-exporte le même composant.
 *
 * Contrat items : `{ id, href, label, order, group?, permission?, icon }`.
 */
import { useEffect } from "react";
import { subscribeDataChanged } from "@creezio/shell-ui";
import {
  parseNavCatalogSessionItems,
  type NavCatalogSessionItem,
} from "../../dist/nav-catalog.js";
import { defaultOsAdminNavItems } from "./native-os-nav";
import { resolveNavIcon } from "./nav-icons";
import {
  configureSidebar,
  getSidebarHostOptional,
  type SidebarHost,
  type SidebarNavItem,
} from "./sidebar-host";

export const NAV_CATALOG_ENDPOINT = "/api/v1/modules/nav";

export function mapNavCatalogSessionToSidebar(
  items: readonly NavCatalogSessionItem[],
): SidebarNavItem[] {
  return items
    .filter((item) => item.group !== "admin" && item.group !== "plugin")
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((item) => ({
      href: item.href,
      label: item.label,
      icon: resolveNavIcon(item.icon),
      fromShell: item.group === "core" || item.group === undefined,
      permission: item.permission,
    }));
}

export function applyNavCatalogItemsToSidebar(
  items: readonly NavCatalogSessionItem[],
  opts?: { includePlugins?: boolean; adminFromCatalog?: boolean },
): void {
  const prev = getSidebarHostOptional();
  const next: SidebarHost = {
    ...(prev ?? { getNavItems: () => [] }),
    getNavItems: () => mapNavCatalogSessionToSidebar(items),
    getAdminItems:
      (opts?.adminFromCatalog ? (() => items.filter(i=>i.group === "admin").map(i=>({href:i.href,label:i.label,icon:resolveNavIcon(i.icon),permission:i.permission}))) : prev?.getAdminItems) ??
      (() => defaultOsAdminNavItems({ includePlugins: opts?.includePlugins })),
  };
  configureSidebar(next);
}

export type NavCatalogLoaderProps = {
  endpoint?: string;
  includePlugins?: boolean;
  adminFromCatalog?: boolean;
};

/**
 * Monte dans le chrome (sous `RequireSession`). Premier paint = fallback
 * `defaultOsPrimaryNavItems()` déjà posé par `configureSidebar` ; après
 * GET / le host est remplacé et la sidebar se re-rend (version bump).
 */
export function NavCatalogLoader(props: NavCatalogLoaderProps = {}): null {
  const endpoint = props.endpoint ?? NAV_CATALOG_ENDPOINT;
  const includePlugins = props.includePlugins;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(endpoint, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok || cancelled) return;
        const body: unknown = await res.json();
        const items = parseNavCatalogSessionItems(body);
        if (cancelled) return;
        applyNavCatalogItemsToSidebar(items, { includePlugins, adminFromCatalog: props.adminFromCatalog });
      } catch {
        /* fallback : configureSidebar initial (catalogue OS local) */
      }
    };
    void load();
    const unsubscribe = subscribeDataChanged(() => { void load(); }, {resource:"nav"});
    return () => {
      unsubscribe();
      cancelled = true;
    };
  }, [endpoint, includePlugins, props.adminFromCatalog]);

  return null;
}
