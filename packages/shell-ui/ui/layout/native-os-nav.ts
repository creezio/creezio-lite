"use client";

/**
 * Nav OS native Creezio — adaptateur sidebar du catalogue unique.
 *
 * SoT = `registerOsNavEntry` / `defaultOsCatalogEntries()`
 * (`@creezio/shell-ui`, `src/nav-catalog.ts`). Cette fonction ne fait
 * que projeter le registre vers `SidebarNavItem[]` (icônes résolues).
 *
 * La marque DOIT monter `<NavCatalogLoader />` (Phase C) — **interdit**
 * de recopier un `OS_NAV` inline. Fallback hors mount :
 * `defaultOsPrimaryNavItems()`. Cible : `docs/plans/PLAN-NAV-CATALOG.md`.
 * Hermes / n8n restent injectés par la sidebar kit (Admin → Outils).
 *
 * Feature-off plugins : passer `{ includePlugins: false }` à
 * `defaultOsAdminNavItems` — ne pas lister `/admin/plugins`.
 */
import {
  Activity,
  Braces,
  Cable,
  Database,
  KeyRound,
  List,
  Package,
  ScrollText,
  Settings,
  ShieldCheck,
} from "lucide-react";
import {
  defaultOsCatalogEntries,
  type NavCatalogEntry,
} from "../../dist/nav-catalog.js";
import { resolveNavIcon } from "./nav-icons";
import type { SidebarAdminItem, SidebarNavItem } from "./sidebar-host";

function toSidebarNavItem(entry: NavCatalogEntry): SidebarNavItem {
  return {
    href: entry.href,
    label: entry.label,
    icon: resolveNavIcon(entry.icon),
    fromShell: true,
    permission: entry.permission,
  };
}

/** Pages OS utilisateur (hors métier marque) — dérivé du registre. */
export function defaultOsPrimaryNavItems(): SidebarNavItem[] {
  return defaultOsCatalogEntries()
    .filter(
      (e) =>
        e.available &&
        e.defaultVisible &&
        e.group !== "admin" &&
        e.group !== "plugin",
    )
    .map(toSidebarNavItem);
}

export type OsAdminNavOptions = {
  /**
   * Inclure `/admin/plugins`. Défaut `true`.
   * Mettre `false` si `manifest.features.plugins === false`.
   */
  includePlugins?: boolean;
};

/** Liens Admin OS (Hermes/n8n ajoutés à part par la sidebar kit). */
export function defaultOsAdminNavItems(
  opts?: OsAdminNavOptions,
): SidebarAdminItem[] {
  const includePlugins = opts?.includePlugins !== false;
  const items: SidebarAdminItem[] = [
    { href: "/configuration", label: "Configuration", icon: Settings },
    { href: "/admin/analytics", label: "Analytics", icon: Activity },
  ];
  if (includePlugins) {
    items.push({ href: "/admin/plugins", label: "Plugins", icon: Package });
  }
  items.push(
    {
      href: "/admin/access",
      label: "Rôles & accès",
      icon: ShieldCheck,
      permission: "platform.access.manage",
    },
    {
      href: "/admin/nav",
      label: "Navigation",
      icon: List,
      permission: "platform.access.manage",
    },
    { href: "/admin/database", label: "Database", icon: Database },
    { href: "/admin/integrations", label: "Intégrations", icon: KeyRound },
    { href: "/admin/api", label: "API", icon: Braces },
    { href: "/admin/mcp", label: "MCP", icon: Cable },
    {
      href: "/admin/request-logs",
      label: "Logs API / MCP",
      icon: ScrollText,
    },
  );
  return items;
}
