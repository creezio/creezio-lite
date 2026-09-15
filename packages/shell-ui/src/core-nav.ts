import type { CoreNavItem } from "./types.js";

/**
 * Entrées nav natives Creezio — aucune entrée métier marque
 * (panier, dispatch, GED, RTI…).
 *
 * Liste historique (home / assistant / setup / login / about…) consommée
 * par `createNavShellAdapter` — **pas** la sidebar CRM. La sidebar OS
 * primaire (taches, mails, granola, grokbot…) vit dans le catalogue
 * `defaultOsCatalogEntries()` / `registerOsNavEntry`
 * (`nav-catalog.ts`, plan `docs/plans/PLAN-NAV-CATALOG.md`). Ne pas
 * recopier granola/grokbot ici pour « aligner » : Phase D dérivera
 * `CORE_NAV_ITEMS` du catalogue, ou documentera l'écart à vie.
 */
export const CORE_NAV_ITEMS: readonly CoreNavItem[] = [
  { id: "core.home", label: "Accueil", href: "/", group: "core" },
  { id: "core.settings", label: "Réglages", href: "/settings", group: "core" },
  {
    id: "core.assistant",
    label: "Assistant",
    href: "/assistant",
    group: "core",
  },
  { id: "core.tasks", label: "Tâches", href: "/taches", group: "core" },
  { id: "core.mails", label: "Mails", href: "/mails", group: "core" },
  { id: "core.granola", label: "Granola", href: "/granola", group: "core" },
  { id: "core.grokbot", label: "GrokBot", href: "/grokbot", group: "core" },
  { id: "core.setup", label: "Setup", href: "/setup", group: "core" },
  { id: "core.login", label: "Login", href: "/login", group: "core" },
  {
    id: "core.developers",
    label: "Developers",
    href: "/developers",
    group: "core",
  },
  { id: "core.about", label: "À propos", href: "/about", group: "core" },
] as const;

/** Alias factory / demobrand. */
export const coreNavItems: CoreNavItem[] = CORE_NAV_ITEMS.map((i) => ({
  ...i,
}));
