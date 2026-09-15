/**
 * Slot métier vertical — DemoBrand.
 * I7 : nav via `demobrandNavShell` (registerBrandNav only).
 */
import type { CoreNavItem, NavRegistry, NavShellAdapter } from "@creezio/shell-ui";
import {
  createDemoPluginRequest,
  demobrandProductHubTokens,
  getDemobrandProductHubStore,
} from "./product-hub-stub.js";
import { demobrandNavShell } from "./nav-shell.js";

export type VerticalSlot = {
  /** Identifiant marque. */
  brandId: string;
  /** Entrées de nav métier. */
  items: CoreNavItem[];
  /** Registre slots shell-ui. */
  nav: NavRegistry;
  /** Adapter rendu I7. */
  shell: NavShellAdapter;
  /** Accès Product Hub sandbox. */
  productHub: {
    tokens: typeof demobrandProductHubTokens;
    getStore: typeof getDemobrandProductHubStore;
    createRequest: typeof createDemoPluginRequest;
  };
};

export const verticalSlot: VerticalSlot = {
  brandId: "demobrand",
  items: demobrandNavShell.registry.getBrandNav(),
  nav: demobrandNavShell.registry,
  shell: demobrandNavShell,
  productHub: {
    tokens: demobrandProductHubTokens,
    getStore: getDemobrandProductHubStore,
    createRequest: createDemoPluginRequest,
  },
};
