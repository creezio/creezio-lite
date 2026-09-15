/**
 * Générateur nav métier (shell-ui registerBrandNav).
 * Consommateur du registre modules — les entrées viennent de
 * \`modules/<id>.ts\` via \`collectNavItems\`.
 */
import type { ProductModel } from "../product-model.js";

export function renderVerticalSlotFromModel(model: ProductModel): string {
  return `/**
 * Slot métier vertical — ${model.brandName} (généré --from-prd).
 * Consommateur du registre de modules : chaque module déclare ses entrées
 * (\`navItems\` avec \`order\`) dans \`modules/<id>.ts\`.
 */
import {
  createNavRegistry,
  type CoreNavItem,
  type NavRegistry,
} from "@creezio/shell-ui";
import { collectNavItems } from "./modules/index.js";

export type VerticalSlot = {
  brandId: string;
  items: CoreNavItem[];
  nav: NavRegistry;
};

const BRAND_NAV: CoreNavItem[] = collectNavItems().map(
  ({ order: _order, ...item }) => item,
);

const nav = createNavRegistry();
nav.registerBrandNav(BRAND_NAV);

export const verticalSlot: VerticalSlot = {
  brandId: ${JSON.stringify(model.brandId)},
  items: nav.getBrandNav(),
  nav,
};
`;
}
