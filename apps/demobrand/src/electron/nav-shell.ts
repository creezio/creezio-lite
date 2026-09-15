/**
 * Adapter shell-ui demobrand (I7) — marque = registerBrandNav only.
 */
import { createNavShellAdapter, type NavShellAdapter } from "@creezio/shell-ui";

export const demobrandNavShell: NavShellAdapter = createNavShellAdapter();

// Slot métier sandbox (notes) — id brand.*
demobrandNavShell.registerBrandNav([
  { id: "brand.notes", label: "Notes", href: "/notes", group: "brand" },
]);
