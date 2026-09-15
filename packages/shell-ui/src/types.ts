export type CoreNavItem = {
  id: string;
  label: string;
  href: string;
  /** Groupe UI optionnel. */
  group?: "core" | "brand" | "plugin";
  icon?: string;
  /**
   * Permission requise pour voir l'entrée (ex. "nav.crm") — filtrée par la
   * sidebar kit sur me.permissions (même logique que les entrées admin).
   * Absente = visible par tous.
   */
  permission?: string;
};

/** Alias historique factory demobrand. */
export type NavItem = CoreNavItem;

export type NavSlotId = "brand-primary" | "brand-secondary" | "plugins";

export type NavSlot = {
  id: NavSlotId;
  items: CoreNavItem[];
};
