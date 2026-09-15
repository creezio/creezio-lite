import type { CoreNavItem, NavSlot, NavSlotId } from "./types.js";

const FORBIDDEN_BRAND_IDS = new Set([
  "panier",
  "cart",
  "dispatch",
  "optimiser",
  "catalog",
  "catalogue",
]);

function assertBrandItem(item: CoreNavItem): void {
  const id = item.id.toLowerCase();
  const href = item.href.toLowerCase();
  // H3 : les slots marque peuvent pointer vers les vraies routes produit
  // (`/panier`, `/optimiser`…) si l'id est préfixé `brand.*`.
  // Interdit : id métier nu (ex. `panier`) = confusion avec nav native.
  for (const bad of FORBIDDEN_BRAND_IDS) {
    if (id === bad) {
      throw new Error(
        `Nav brand refusée: id réservé métier (${bad}). Utiliser brand.${bad}.`,
      );
    }
  }
  if (!id.startsWith("brand.") && FORBIDDEN_BRAND_IDS.has(href.replace(/^\//, ""))) {
    throw new Error(
      `Nav brand refusée: href métier (${href}) sans id brand.*.`,
    );
  }
}

export type NavRegistry = {
  registerBrandNav(items: CoreNavItem[], slot?: NavSlotId): void;
  getBrandNav(slot?: NavSlotId): CoreNavItem[];
  getSlots(): NavSlot[];
  clearBrandNav(slot?: NavSlotId): void;
};

export function createNavRegistry(): NavRegistry {
  const slots = new Map<NavSlotId, CoreNavItem[]>([
    ["brand-primary", []],
    ["brand-secondary", []],
    ["plugins", []],
  ]);

  return {
    registerBrandNav(items, slot = "brand-primary") {
      for (const item of items) assertBrandItem(item);
      const tagged = items.map((i) => ({
        ...i,
        group: i.group || ("brand" as const),
      }));
      slots.set(slot, tagged);
    },
    getBrandNav(slot = "brand-primary") {
      return [...(slots.get(slot) || [])];
    },
    getSlots() {
      return [...slots.entries()].map(([id, items]) => ({ id, items: [...items] }));
    },
    clearBrandNav(slot) {
      if (slot) {
        slots.set(slot, []);
        return;
      }
      for (const id of slots.keys()) slots.set(id, []);
    },
  };
}

/** Fusion nav cœur + items brand (slot primary par défaut). */
export function mergeNav(
  core: readonly CoreNavItem[],
  brand: readonly CoreNavItem[],
): CoreNavItem[] {
  return [...core.map((i) => ({ ...i })), ...brand.map((i) => ({ ...i }))];
}
