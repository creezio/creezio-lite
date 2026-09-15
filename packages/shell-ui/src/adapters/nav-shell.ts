/**
 * Adapter nav shell (Phase I7) — contrat de rendu UI-agnostique.
 *
 * Marque = `registerBrandNav` uniquement ; pas de hardcode panier/dispatch
 * dans le kit. React/Next consomme `getRenderModel()` / `subscribe`.
 */

import { CORE_NAV_ITEMS } from "../core-nav.js";
import { createNavRegistry, mergeNav, type NavRegistry } from "../registry.js";
import type { CoreNavItem, NavSlotId } from "../types.js";

export type NavRenderItem = CoreNavItem & {
  source: "core" | "brand" | "plugin";
  active?: boolean;
};

export type NavRenderGroup = {
  id: "core" | "brand" | "plugin";
  label: string;
  items: NavRenderItem[];
};

export type NavRenderModel = {
  items: NavRenderItem[];
  groups: NavRenderGroup[];
  activeHref: string | null;
  generatedAt: string;
};

export type NavShellAdapter = {
  /** Registre sous-jacent (tests / advanced). */
  readonly registry: NavRegistry;
  /** Seule API marque recommandée. */
  registerBrandNav(items: CoreNavItem[], slot?: NavSlotId): void;
  clearBrandNav(slot?: NavSlotId): void;
  setActiveHref(href: string | null): void;
  getMergedNav(): CoreNavItem[];
  getRenderModel(): NavRenderModel;
  subscribe(listener: () => void): () => void;
  /** HTML minimal (preuve demobrand / SSR sans React). */
  renderNavHtml(opts?: { className?: string }): string;
};

const GROUP_LABELS: Record<NavRenderGroup["id"], string> = {
  core: "Creezio",
  brand: "Métier",
  plugin: "Plugins",
};

function sourceOf(item: CoreNavItem): NavRenderItem["source"] {
  if (item.group === "plugin") return "plugin";
  if (item.group === "brand" || item.id.startsWith("brand.")) return "brand";
  return "core";
}

export type CreateNavShellAdapterOptions = {
  coreItems?: readonly CoreNavItem[];
  registry?: NavRegistry;
  activeHref?: string | null;
};

/**
 * Crée l'adapter shell. Usage marque :
 *
 * ```ts
 * const shell = createNavShellAdapter();
 * shell.registerBrandNav([{ id: "brand.home", label: "Métier", href: "/brand" }]);
 * const model = shell.getRenderModel(); // → UI React / HTML
 * ```
 */
export function createNavShellAdapter(
  opts?: CreateNavShellAdapterOptions,
): NavShellAdapter {
  const core = opts?.coreItems || CORE_NAV_ITEMS;
  const registry = opts?.registry || createNavRegistry();
  let activeHref = opts?.activeHref ?? null;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const l of listeners) l();
  }

  const adapter: NavShellAdapter = {
    registry,

    registerBrandNav(items, slot) {
      registry.registerBrandNav(items, slot);
      notify();
    },

    clearBrandNav(slot) {
      registry.clearBrandNav(slot);
      notify();
    },

    setActiveHref(href) {
      activeHref = href;
      notify();
    },

    getMergedNav() {
      const brand = [
        ...registry.getBrandNav("brand-primary"),
        ...registry.getBrandNav("brand-secondary"),
        ...registry.getBrandNav("plugins"),
      ];
      return mergeNav(core, brand);
    },

    getRenderModel() {
      const items: NavRenderItem[] = adapter.getMergedNav().map((i) => ({
        ...i,
        source: sourceOf(i),
        active: Boolean(activeHref && i.href === activeHref),
      }));
      const groups: NavRenderGroup[] = (
        ["core", "brand", "plugin"] as const
      ).map((id) => ({
        id,
        label: GROUP_LABELS[id],
        items: items.filter((i) => i.source === id),
      }));
      return {
        items,
        groups,
        activeHref,
        generatedAt: new Date().toISOString(),
      };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    renderNavHtml(htmlOpts) {
      const model = adapter.getRenderModel();
      const cls = htmlOpts?.className || "creezio-nav";
      const parts: string[] = [`<nav class="${cls}" data-creezio-shell-ui="i7">`];
      for (const g of model.groups) {
        if (!g.items.length) continue;
        parts.push(`<div class="${cls}__group" data-group="${g.id}">`);
        parts.push(
          `<div class="${cls}__group-label">${escapeHtml(g.label)}</div>`,
        );
        parts.push(`<ul>`);
        for (const item of g.items) {
          const active = item.active ? ' aria-current="page"' : "";
          parts.push(
            `<li data-source="${item.source}"><a href="${escapeHtml(item.href)}"${active}>${escapeHtml(item.label)}</a></li>`,
          );
        }
        parts.push(`</ul></div>`);
      }
      parts.push(`</nav>`);
      return parts.join("");
    },
  };

  return adapter;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
