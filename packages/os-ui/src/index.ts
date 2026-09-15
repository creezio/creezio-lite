export { CreezioUiBoot, type CreezioUiBootProps } from "./boot-types.js";

/** Dossiers OS interdits dans ui/app/ versionné d'une marque. */
export const OS_UI_ROUTE_SEGMENTS = [
  "admin",
  "cockpit",
  "collaborateurs",
  "configuration",
  "developers",
  "granola",
  "grokbot",
  "login",
  "mails",
  "mcp",
  "onboarding",
  "parametres",
  "server-cockpit",
  "settings",
  "setup",
  "support",
  "taches",
] as const;

/**
 * Segments primaires sidebar — DOIVENT avoir une entrée
 * `defaultOsCatalogEntries()` (gate `test-phase-os-nav-catalog`).
 */
export const OS_PRIMARY_NAV_SEGMENTS = [
  "taches",
  "mails",
  "granola",
  "grokbot",
  "parametres",
  "collaborateurs",
] as const;

/**
 * Segments `OS_UI_ROUTE_SEGMENTS` hors sidebar primaire.
 * Une page OS sans entrée catalogue doit figurer ici (fail-closed).
 */
export const OS_UI_HORS_NAV_JUSTIFICATIONS: Record<string, string> = {
  admin:
    "sous-arbre admin — sidebar getAdminItems / catalogue group admin (/admin/nav)",
  cockpit: "cockpit serveur — hors sidebar utilisateur",
  configuration: "entrée admin (/configuration), pas primaire",
  developers: "page développeurs — hors sidebar utilisateur",
  login: "auth — hors chrome session",
  mcp: "admin MCP — hors primaire",
  onboarding: "wizard first-run — hors sidebar persistante",
  "server-cockpit": "cockpit serveur — hors sidebar utilisateur",
  settings: "alias historique de /parametres — hors primaire",
  setup: "first-run setup — hors chrome session",
  support: "tickets support serveur — hors primaire",
};

/** Groupe App Router Next (hors URL) où l’OS est matérialisé localement. */
export const OS_UI_ROUTE_GROUP = "(creezio-os)";
