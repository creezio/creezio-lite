/**
 * Type de page CRM — standard unique.
 * - section : listes (toolbar recherche + titre + actions sous les onglets)
 * - entity  : fiches détail (fil d'Ariane sticky ; titre via EntityHeader)
 */
export type PageKind = "section" | "entity";

/** Fil d'Ariane publié vers le chrome sticky (sous les onglets). */
export type TrailCrumb = {
  label: string;
  href?: string;
};

export type TabMeta = {
  title: string;
  subtitle?: string;
  kind?: PageKind;
  /** Chemin de navigation sticky — obligatoire pour kind=entity. */
  trail?: TrailCrumb[];
  /** Masque le bandeau H1/trail — canvas plein écran sous les onglets. */
  fullscreen?: boolean;
};

/** Métadonnées d'un onglet site externe (WebContentsView Electron). */
export type ExternalSiteTabMeta = {
  siteId: number;
  /** URL (rechargée au remount ; cookies partition conservés). */
  url: string;
  electronTabId?: string;
};

export type WorkspaceTab = {
  id: string;
  href: string;
  title: string;
  /** Verrouillage choisi par l'utilisateur (le Dashboard reste protégé séparément). */
  locked?: boolean;
  subtitle?: string;
  kind?: PageKind;
  trail?: TrailCrumb[];
  fullscreen?: boolean;
  /** Présent si l'onglet héberge un site externe Chromium. */
  externalSite?: ExternalSiteTabMeta;

  /** Historique back/forward propre à cet onglet. */
  history: string[];
  historyIndex: number;
};

export type WorkspacePersistedState = {
  tabs: WorkspaceTab[];
  activeTabId: string;
};

/** v3 : Dashboard unique épinglé + état des onglets persisté en session.
 * Override marque via `configureWorkspaceStorageKey` (ex. `<brand>-workspace-tabs-v3`).
 */
export let WORKSPACE_STORAGE_KEY = "creezio-workspace-tabs-v3";
export const MAX_TABS = 12;
export const MAX_KEEPALIVE = 12;

export function configureWorkspaceStorageKey(key: string): void {
  if (key.trim()) WORKSPACE_STORAGE_KEY = key.trim();
}

/** Chemin de l'onglet épinglé (toujours premier, non fermable). */
export const DASHBOARD_PATH = "/dashboard";

/**
 * Canvas plein écran conditionnel : un pathname rendu sans bandeau H1/trail,
 * activé seulement quand `requiredQuery` (si posé) est présent dans l'URL
 * (ex. atelier ouvert sur un objet précis).
 */
export type WorkspaceCanvasSpec = {
  /** Pathname exact du canvas (ex. un atelier métier). */
  path: string;
  /** Query param requis pour basculer plein écran (absent = toujours). */
  requiredQuery?: string;
};

/**
 * Chemins workspace **injectés par la marque** (kit = plateforme only,
 * défauts vides — aucun domaine métier ici) via `configureWorkspacePaths`.
 */
let FULLSCREEN_PATH_PREFIXES: readonly string[] = [];
let CANVAS_SPECS: readonly WorkspaceCanvasSpec[] = [];

export function configureWorkspacePaths(opts: {
  /**
   * Préfixes de pathnames rendus plein écran sous les onglets
   * (ex. une page de sélection métier).
   */
  fullscreenPaths?: string[];
  /** Canvas plein écran conditionnels (path + query requis). */
  canvases?: WorkspaceCanvasSpec[];
}): void {
  if (opts.fullscreenPaths) FULLSCREEN_PATH_PREFIXES = [...opts.fullscreenPaths];
  if (opts.canvases) CANVAS_SPECS = [...opts.canvases];
}


/** Le href pointe-t-il vers le dashboard (query ignorée) ? */
export function isDashboardHref(href: string): boolean {
  const path = normalizeHref(href).split("?")[0] || "/";
  return path === DASHBOARD_PATH || path === "/";
}

/** Protection effective : Dashboard système ou verrouillage utilisateur. */
export function isWorkspaceTabLocked(
  tab: Pick<WorkspaceTab, "id" | "locked">,
  pinnedTabId?: string | null,
): boolean {
  return tab.id === pinnedTabId || tab.locked === true;
}

export function normalizeHref(href: string): string {
  try {
    const url = new URL(href, "http://local.invalid");
    // "/" est une pure page de redirection vers /dashboard : la canoniser ici
    // pour qu'aucun onglet, historique ou pane keep-alive ne référence "/".
    // Une pane gelée sur "/" rejouerait le redirect à chaque rendu →
    // router.replace('/dashboard') en boucle infinie → React #310 au premier
    // changement de route (app desktop qui charge la racine).
    const path = url.pathname === "/" ? DASHBOARD_PATH : url.pathname || "/";
    const search = url.search || "";
    return `${path}${search}`;
  } catch {
    return href.split("#")[0] || "/";
  }
}

/** Roots entity — **injectés par la marque** (kit = plateforme only). */
let ENTITY_ROUTE_ROOTS = new Set<string>();

export function configureEntityRouteRoots(roots: string[]): void {
  ENTITY_ROUTE_ROOTS = new Set(roots);
}


/**
 * Infère kind avant publication AppShell (évite le flash H1
 * « Catalogue · 123 » sur les fiches détail au premier paint).
 */
export function pageKindFromHref(href: string): PageKind {
  const path = normalizeHref(href).split("?")[0] || "/";
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "admin" && parts[1] === "agregateurs" && parts.length >= 3) {
    return "entity";
  }
  if (parts.length >= 2 && ENTITY_ROUTE_ROOTS.has(parts[0]!)) {
    return "entity";
  }
  return "section";
}

/** Libellé liste (section) vs fiche (entity) — évite « Catalogue · 123 » au clic. */
const SECTION_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  admin: "Admin",
  parametres: "Préférences",
  configuration: "Configuration",
  setup: "Premier lancement",
  site: "Site externe",
  navigateur: "Navigateur",
  taches: "Tâches",
  mails: "Mails",
  abonnement: "Abonnement",
  collaborateurs: "Collaborateurs",
  cockpit: "Cockpit",
};

/** Enrichit les libellés de section (marque = métier). */
export function configureSectionLabels(labels: Record<string, string>): void {
  Object.assign(SECTION_LABELS, labels);
}


const ENTITY_LABELS: Record<string, string> = {};

export function configureEntityLabels(labels: Record<string, string>): void {
  Object.assign(ENTITY_LABELS, labels);
}


export function titleFromHref(href: string): string {
  const path = normalizeHref(href).split("?")[0] || "/";
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return "Dashboard";
  if (parts[0] === "admin") {
    if (parts[1] === "data-mapping") return "Data Mapping";
    if (parts[1] === "agregateurs") {
      return parts.length >= 3 ? "Agrégateur" : "Agrégateurs";
    }
    return "Admin";
  }
  const head = parts[0]!;
  if (parts.length === 1) return SECTION_LABELS[head] || head;
  // Fiche entité : titre générique court (le vrai nom arrive via AppShell).
  if (ENTITY_ROUTE_ROOTS.has(head)) {
    return ENTITY_LABELS[head] || SECTION_LABELS[head] || head;
  }
  const label = SECTION_LABELS[head] || head;
  return `${label} · ${decodeURIComponent(parts[1] || "")}`;
}

/** Canvas plein écran actif (spec marque : path + query requis). */
export function isCanvasHref(href: string): boolean {
  if (!CANVAS_SPECS.length) return false;
  const normalized = normalizeHref(href);
  try {
    const url = new URL(normalized, "http://local.invalid");
    return CANVAS_SPECS.some(
      (spec) =>
        url.pathname === spec.path &&
        (!spec.requiredQuery || url.searchParams.has(spec.requiredQuery)),
    );
  } catch {
    return false;
  }
}

export function isFullscreenHref(href: string): boolean {
  if (isCanvasHref(href) || isExternalSiteHref(href)) return true;
  if (FULLSCREEN_PATH_PREFIXES.length) {
    const path = normalizeHref(href).split("?")[0] || "/";
    return FULLSCREEN_PATH_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(prefix + "/"),
    );
  }
  return false;
}

/** Onglet workspace hébergeant un site externe (`/site/<id>`). */
export function isExternalSiteHref(href: string): boolean {
  const path = normalizeHref(href).split("?")[0] || "/";
  return path === "/site" || path.startsWith("/site/");
}

export function siteIdFromHref(href: string): number | null {
  const path = normalizeHref(href).split("?")[0] || "/";
  const m = path.match(/^\/site\/(\d+)$/);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) ? id : null;
}

export function externalSiteHref(siteId: number): string {
  return `/site/${Math.floor(siteId)}`;
}

export function createExternalSiteTab(opts: {
  siteId: number;
  url: string;
  title?: string;
  electronTabId?: string;
  id?: string;
}): WorkspaceTab {
  const href = externalSiteHref(opts.siteId);
  let title = (opts.title || "").trim();
  if (!title) {
    try {
      title = new URL(opts.url).hostname.replace(/^www\./, "");
    } catch {
      title = `Site ${opts.siteId}`;
    }
  }
  return {
    ...createTab(href, {
      id: opts.id,
      title,
      kind: "section",
      fullscreen: true,
    }),
    externalSite: {
      siteId: opts.siteId,
      url: opts.url,
      electronTabId: opts.electronTabId,
    },
  };
}

export function isWorkspacePath(pathname: string): boolean {
  if (!pathname) return false;
  if (pathname === "/login" || pathname.startsWith("/login/")) return false;
  // Wizard first-run : plein écran dédié, sans sidebar / onglets / assistant.
  if (pathname === "/setup" || pathname.startsWith("/setup/")) return false;
  if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) return false;
  if (pathname === "/health" || pathname.startsWith("/health/")) return false;
  if (pathname.startsWith("/api/")) return false;
  // Module scan : plein écran mobile hors shell (pas de keep-alive caméra).
  if (pathname === "/scan" || pathname.startsWith("/scan/")) return false;
  // Planche d'étiquettes QR : rendu print autonome, hors chrome workspace.
  if (pathname === "/stack/qr-print") return false;
  // Cockpit app Serveur : console ops autonome, sans sidebar CRM.
  if (
    pathname === "/server-cockpit" ||
    pathname.startsWith("/server-cockpit/")
  ) {
    return false;
  }
  return true;
}

export function newTabId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function trailsEqual(a?: TrailCrumb[], b?: TrailCrumb[]): boolean {
  if (a === b) return true;
  if (!a?.length && !b?.length) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every(
    (c, i) => c.label === b[i]!.label && (c.href || "") === (b[i]!.href || ""),
  );
}

/** Crée un onglet avec une pile d'historique initiale. */
export function createTab(
  href: string,
  overrides?: Partial<
    Pick<
      WorkspaceTab,
      "id" | "title" | "locked" | "subtitle" | "kind" | "trail" | "fullscreen"
    >
  >,
): WorkspaceTab {
  const h = normalizeHref(href);
  return {
    id: overrides?.id || newTabId(),
    href: h,
    title: overrides?.title || titleFromHref(h),
    locked: overrides?.locked === true,
    subtitle: overrides?.subtitle,
    kind: overrides?.kind,
    trail: overrides?.trail,
    fullscreen: overrides?.fullscreen ?? isFullscreenHref(h),
    history: [h],
    historyIndex: 0,
  };
}

/** Kind chrome effectif (meta publiée, sinon inféré depuis l'URL). */
export function resolvePageKind(tab: Pick<WorkspaceTab, "href" | "kind">): PageKind {
  return tab.kind ?? pageKindFromHref(tab.href);
}

/** Applique les métadonnées d'onglet sans toucher à l'historique. */
export function applyTabMeta(tab: WorkspaceTab, meta: TabMeta): WorkspaceTab {
  const kind = meta.kind ?? pageKindFromHref(tab.href);
  const trail = meta.trail;
  const fullscreen = meta.fullscreen ?? isFullscreenHref(tab.href);
  if (
    tab.title === meta.title &&
    tab.subtitle === meta.subtitle &&
    (tab.kind ?? pageKindFromHref(tab.href)) === kind &&
    trailsEqual(tab.trail, trail) &&
    tab.fullscreen === fullscreen
  ) {
    return tab;
  }
  return {
    ...tab,
    title: meta.title || tab.title,
    subtitle: meta.subtitle,
    kind,
    trail,
    fullscreen,
  };
}

/** Normalise un onglet persisté (migration v1 → v2 + pageHeader → kind). */
export function ensureTabHistory(
  tab:
    | WorkspaceTab
    | (Omit<WorkspaceTab, "history" | "historyIndex"> &
        Partial<Pick<WorkspaceTab, "history" | "historyIndex">> & {
          pageHeader?: string;
        }),
): WorkspaceTab {
  const href = normalizeHref(tab.href);
  const history = (tab.history?.length ? tab.history : [href]).map(normalizeHref);
  let historyIndex =
    typeof tab.historyIndex === "number" ? tab.historyIndex : history.length - 1;
  historyIndex = Math.min(Math.max(0, historyIndex), history.length - 1);

  // Migration sessionStorage : ancien pageHeader → kind
  const legacy = tab as WorkspaceTab & { pageHeader?: string };
  let kind = tab.kind;
  if (!kind && legacy.pageHeader) {
    kind = legacy.pageHeader === "section" ? "section" : "entity";
  }

  let externalSite: ExternalSiteTabMeta | undefined;
  if (tab.externalSite && typeof tab.externalSite.siteId === "number") {
    externalSite = {
      siteId: tab.externalSite.siteId,
      url: String(tab.externalSite.url || ""),
      electronTabId: tab.externalSite.electronTabId,
    };
  } else if (isExternalSiteHref(href)) {
    externalSite = {
      siteId: siteIdFromHref(href) || 0,
      url: "",
    };
  }

  return {
    id: tab.id || newTabId(),
    href: history[historyIndex] || href,
    title: tab.title || titleFromHref(href),
    locked: tab.locked === true,
    subtitle: tab.subtitle,
    kind,
    trail: tab.trail,
    fullscreen: tab.fullscreen ?? isFullscreenHref(href),
    externalSite,
    history,
    historyIndex,
  };
}

/** Même pathname (seuls les query params changent). */
export function samePathname(a: string, b: string): boolean {
  const pa = normalizeHref(a).split("?")[0] || "/";
  const pb = normalizeHref(b).split("?")[0] || "/";
  return pa === pb;
}

/** Une navigation de page doit-elle préserver l'onglet actif protégé ? */
export function shouldOpenLockedNavigationInNewTab(
  activeTab: Pick<WorkspaceTab, "id" | "href" | "locked">,
  targetHref: string,
  pinnedTabId?: string | null,
): boolean {
  return (
    isWorkspaceTabLocked(activeTab, pinnedTabId) &&
    !samePathname(activeTab.href, targetHref)
  );
}

export function replaceTabHistory(tab: WorkspaceTab, href: string): WorkspaceTab {
  const h = normalizeHref(href);
  const history = tab.history.length ? [...tab.history] : [h];
  const idx = Math.min(Math.max(0, tab.historyIndex), history.length - 1);
  history[idx] = h;
  return { ...tab, href: h, history, historyIndex: idx };
}

export function pushTabHistory(tab: WorkspaceTab, href: string): WorkspaceTab {
  const h = normalizeHref(href);
  const trimmed = tab.history.slice(0, Math.max(0, tab.historyIndex) + 1);
  if (trimmed[trimmed.length - 1] === h) {
    return {
      ...tab,
      href: h,
      history: trimmed,
      historyIndex: trimmed.length - 1,
    };
  }
  const history = [...trimmed, h].slice(-80);
  return {
    ...tab,
    href: h,
    history,
    historyIndex: history.length - 1,
  };
}
