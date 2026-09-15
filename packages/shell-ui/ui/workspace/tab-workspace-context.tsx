"use client";
import { getShellDesktopApi } from "@creezio/shell-ui";
import { configureTabWorkspaceHost } from "./tab-workspace-host";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  configureAssistantTabWorkspace,
  resolveActiveSurface,
  type ActiveSurface,
} from "@creezio/assistant/ui";
import { reduceExternalSiteSurfaceCommand } from "../desktop/external-site-surface";
import { invalidateKeepAlive } from "./keep-alive";
import {
  DASHBOARD_PATH,
  MAX_TABS,
  WORKSPACE_STORAGE_KEY,
  applyTabMeta,
  createExternalSiteTab,
  createTab,
  ensureTabHistory,
  isDashboardHref,
  isExternalSiteHref,
  isFullscreenHref,
  isWorkspaceTabLocked,
  isWorkspacePath,
  normalizeHref,
  pushTabHistory,
  replaceTabHistory,
  samePathname,
  shouldOpenLockedNavigationInNewTab,
  externalSiteHref,
  titleFromHref,
  type TabMeta,
  type WorkspacePersistedState,
  type WorkspaceTab,
} from "./types";
import { useLocationSearch } from "./use-location-search";
import {
  getDefaultNewTabHref,
  getProductDetailCtxAdapter,
} from "./workspace-config";

export type NavigateOptions = {
  newTab?: boolean;
  replace?: boolean;
  skipHistory?: boolean;
  /** Titre provisoire (texte du lien cliqué) — évite « Catalogue · 123 ». */
  title?: string;
  /**
   * Lien issu du panneau assistant / recherche : forcer la fiche produit
   * autonome (`ctx=catalogue`), sans héritage soft de l'onglet courant.
   */
  preferCatalogue?: boolean;
};

export type OpenExternalSiteOpts = {
  siteId: number;
  url: string;
  title?: string;
  electronTabId?: string;
  /**
   * true : forcer opts.url même si un onglet existe déjà (SiteLink, barre
   * d'adresse). false/omit : réactivation - conserver l'URL live SPA.
   */
  navigateUrl?: boolean;
};

type TabWorkspaceContextValue = {
  ready: boolean;
  tabs: WorkspaceTab[];
  activeTabId: string;
  activeTab: WorkspaceTab | null;
  /** Onglet épinglé (Dashboard) : toujours premier, non fermable. */
  pinnedTabId: string | null;
  /** Pastilles de notification par onglet (ex. ajouts à une sélection). */
  tabBadges: Record<string, number>;
  canGoBack: boolean;
  canGoForward: boolean;
  navigate: (href: string, opts?: NavigateOptions) => void;
  openNewTab: (href?: string) => void;
  activateTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  setTabLocked: (tabId: string, locked: boolean) => void;
  moveTab: (tabId: string, toIndex: number) => void;
  goBack: () => void;
  goForward: () => void;
  setTabMeta: (href: string, meta: TabMeta) => void;
  /**
   * Ouvre ou **focus** un chemin workspace (contrat moderne, pas pastille-only).
   *
   * - Onglet déjà actif sur ce pathname → `"active"` (data-changed suffit
   *   pour rafraîchir via `useCreezioResource`).
   * - Onglet existant inactif → active l'onglet (`activateTab` / route) →
   *   `"focused"`.
   * - Aucun onglet → `navigate(href, { newTab: true })` → `"opened"`.
   *
   * Usage typique : mutation métier qui doit **montrer** la cible
   * (ex. `openOrNotify("/<selection>")` depuis un bouton catalogue).
   */
  openOrNotify: (href: string) => "opened" | "focused" | "active";
  /**
   * Ouvre / réactive un onglet workspace pour un site externe Electron
   * (même barre que Dashboard/Produits). Ne crée pas la WebContentsView —
   * l'appelant (SiteLink / DesktopBridge) a déjà fait openTab IPC.
   */
  openExternalSite: (opts: OpenExternalSiteOpts) => void;
  /** Met à jour le lien electronTabId / titre d'un onglet site. */
  patchExternalSiteTab: (
    siteId: number,
    patch: Partial<{ electronTabId: string; url: string; title: string }>,
  ) => void;
  currentHref: string;
  /**
   * Surface que regarde l'utilisateur (CRM React vs site externe).
   * Source de vérité unique pour le cerveau assistant.
   */
  activeSurface: ActiveSurface;
};

const TabWorkspaceContext = createContext<TabWorkspaceContextValue | null>(null);

/**
 * Pont module-scope vers le `navigate` du provider monté. Nécessaire pour les
 * surfaces montées HORS du TabWorkspaceProvider (ex. @creezio/interactive-demo
 * dans le chrome marque) : un `router.push` direct sur l'onglet épinglé
 * (Dashboard) est réaligné par le provider — seule la navigation workspace
 * ouvre/active correctement un onglet.
 */
let workspaceNavigateBridge:
  | ((href: string, opts?: NavigateOptions) => void)
  | null = null;

/** `navigate` workspace courant, ou null hors provider / avant hydratation. */
export function getWorkspaceTabNavigate():
  | ((href: string, opts?: NavigateOptions) => void)
  | null {
  return workspaceNavigateBridge;
}

function loadPersisted(): WorkspacePersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspacePersistedState;
    if (!parsed?.tabs?.length || !parsed.activeTabId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persist(state: WorkspacePersistedState) {
  try {
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function hrefOf(pathname: string, search: string) {
  return normalizeHref(search ? `${pathname}?${search}` : pathname);
}

function withConfiguredCtx(
  href: string,
  opts: { fromHref?: string | null; preferCatalogue?: boolean },
): string {
  const adapter = getProductDetailCtxAdapter();
  if (!adapter) return href;
  const path = href.split("?")[0] || "";
  if (!adapter.isDetailPath(path)) return href;
  return opts.preferCatalogue
    ? adapter.withCatalogueCtx(href)
    : adapter.withInferredCtx(href, opts.fromHref);
}

/**
 * Garantit l'invariant : UN seul onglet Dashboard, TOUJOURS en position 0,
 * href propre `/dashboard` (pas de doublon fermable).
 */
function withPinnedDashboard(tabs: WorkspaceTab[]): {
  tabs: WorkspaceTab[];
  pinnedId: string;
} {
  const dashExisting = tabs.find((t) => isDashboardHref(t.href));
  const others = tabs.filter((t) => !isDashboardHref(t.href));
  const base = dashExisting ?? createTab(DASHBOARD_PATH, { title: "Dashboard" });
  const pinned: WorkspaceTab = {
    ...base,
    href: DASHBOARD_PATH,
    title: base.title || "Dashboard",
    history: [DASHBOARD_PATH],
    historyIndex: 0,
  };
  return { tabs: [pinned, ...others], pinnedId: pinned.id };
}

/** Pathname normalisé (sans query) pour la déduplication d'onglets. */
function pathnameOf(href: string): string {
  return normalizeHref(href).split("?")[0] || "/";
}

/**
 * Onglet existant qui affiche déjà la même page (pathname).
 * Dashboard → toujours l'épinglé. Sinon préférer l'onglet actif s'il match
 * (filtres / pagination dans le même onglet), sinon le plus ancien.
 */
function findExistingTabForHref(
  tabs: WorkspaceTab[],
  href: string,
  opts: { activeTabId: string | null; pinnedTabId: string | null },
): WorkspaceTab | null {
  if (isDashboardHref(href)) {
    return (
      tabs.find((t) => t.id === opts.pinnedTabId) ||
      tabs.find((t) => isDashboardHref(t.href)) ||
      null
    );
  }
  const path = pathnameOf(href);
  const active = tabs.find((t) => t.id === opts.activeTabId);
  if (active && pathnameOf(active.href) === path) return active;
  return tabs.find((t) => pathnameOf(t.href) === path) || null;
}

function findExternalSiteTab(
  tabs: WorkspaceTab[],
  siteId: number,
): WorkspaceTab | null {
  const href = externalSiteHref(siteId);
  return (
    tabs.find((t) => t.externalSite?.siteId === siteId) ||
    tabs.find((t) => pathnameOf(t.href) === pathnameOf(href)) ||
    null
  );
}

function closeElectronTab(tab: WorkspaceTab | undefined): void {
  const electronId = tab?.externalSite?.electronTabId;
  if (!electronId) return;
  try {
    void getShellDesktopApi()?.closeTab(electronId);
  } catch {
    /* ignore */
  }
}

/**
 * Ferme les onglets qui dupliquent le même pathname (garde `keepId`).
 * Invalide le keep-alive des onglets fermés.
 */
function dropDuplicatePathTabs(
  tabs: WorkspaceTab[],
  href: string,
  keepId: string,
): WorkspaceTab[] {
  const path = pathnameOf(href);
  const next: WorkspaceTab[] = [];
  for (const t of tabs) {
    if (t.id === keepId) {
      next.push(t);
      continue;
    }
    if (pathnameOf(t.href) === path || (isDashboardHref(href) && isDashboardHref(t.href))) {
      invalidateKeepAlive(t.href);
      continue;
    }
    next.push(t);
  }
  return next;
}

export function TabWorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const search = useLocationSearch(pathname);
  const currentHref = hrefOf(pathname, search);
  const inWorkspace = isWorkspacePath(pathname);

  const [ready, setReady] = useState(false);
  // id stable "boot" pour éviter un mismatch d'hydratation (pas de random au 1er paint)
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => [
    createTab(currentHref, { id: "boot" }),
  ]);
  const [activeTabId, setActiveTabId] = useState("boot");
  const [pinnedTabId, setPinnedTabId] = useState<string | null>(null);
  const [tabBadges, setTabBadges] = useState<Record<string, number>>({});

  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const pinnedTabIdRef = useRef(pinnedTabId);
  const currentHrefRef = useRef(currentHref);
  const hydratedRef = useRef(false);
  // Derniers titres publiés par les panes, par URL. Sert à restaurer le vrai
  // titre lors d'un back/forward vers une pane gelée (qui ne re-publie pas :
  // ses deps n'ont pas changé) au lieu du titre générique dérivé de l'URL.
  const metaByHrefRef = useRef(new Map<string, TabMeta>());

  const metaFor = useCallback((href: string): TabMeta => {
    const known = metaByHrefRef.current.get(normalizeHref(href));
    return {
      title: known?.title || titleFromHref(href),
      subtitle: known?.subtitle,
      kind: known?.kind,
      trail: known?.trail,
      fullscreen: known?.fullscreen ?? isFullscreenHref(href),
    };
  }, []);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);
  useEffect(() => {
    pinnedTabIdRef.current = pinnedTabId;
  }, [pinnedTabId]);
  useEffect(() => {
    currentHrefRef.current = currentHref;
  }, [currentHref]);

  const routeTo = useCallback(
    (href: string, replace = true) => {
      const h = normalizeHref(href);
      if (replace) router.replace(h);
      else router.push(h);
    },
    [router],
  );

  // Hydratation session
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    if (!inWorkspace) {
      setReady(true);
      return;
    }

    const saved = loadPersisted();
    if (saved) {
      let normalized = saved.tabs.map((t) => ensureTabHistory(t));
      let pinned = withPinnedDashboard(normalized);
      // L'URL demandée (lien direct, F5, clic avant hydratation) prime TOUJOURS
      // sur l'onglet actif sauvegardé — plus de router.replace vers une vieille page.
      let active =
        pinned.tabs.find((t) => normalizeHref(t.href) === currentHref) ||
        pinned.tabs.find((t) => samePathname(t.href, currentHref));
      if (active && normalizeHref(active.href) !== currentHref) {
        const meta = metaFor(currentHref);
        active = applyTabMeta(replaceTabHistory(active, currentHref), meta);
        pinned = {
          ...pinned,
          tabs: pinned.tabs.map((t) => (t.id === active!.id ? active! : t)),
        };
      }
      if (!active) {
        if (isDashboardHref(currentHref)) {
          active = pinned.tabs[0]!;
        } else {
          const meta = metaFor(currentHref);
          const tab = createTab(currentHref, {
            title: meta.title,
            subtitle: meta.subtitle,
            kind: meta.kind,
            trail: meta.trail,
          });
          pinned = { tabs: [...pinned.tabs, tab], pinnedId: pinned.pinnedId };
          active = tab;
        }
      }
      setTabs(pinned.tabs);
      setPinnedTabId(pinned.pinnedId);
      setActiveTabId(active.id);
      // Ne jamais rediriger hors de currentHref. Sync seulement si on a
      // réactivé le dashboard alors que l'URL est déjà le dashboard.
    } else {
      const tab = createTab(currentHref);
      const pinned = withPinnedDashboard([tab]);
      setTabs(pinned.tabs);
      setPinnedTabId(pinned.pinnedId);
      setActiveTabId(tab.id);
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persistance — ordre des onglets + piles d'historique par onglet
  useEffect(() => {
    if (!ready || !inWorkspace || !tabs.length || !activeTabId) return;
    persist({ tabs, activeTabId });
  }, [ready, inWorkspace, tabs, activeTabId]);

  // Sync URL → onglet actif (après navigation Next)
  // Ne touche PAS à l'historique ni à l'ordre des onglets.
  useEffect(() => {
    if (!ready || !inWorkspace) return;

    // Si l'URL courante correspond déjà à un AUTRE onglet → basculer dessus
    // au lieu d'écraser l'onglet actif (anti-doublon Dashboard / Catalogue…).
    const existing = findExistingTabForHref(tabsRef.current, currentHref, {
      activeTabId: activeTabIdRef.current,
      pinnedTabId: pinnedTabIdRef.current,
    });
    if (existing && existing.id !== activeTabIdRef.current) {
      const cleaned = withPinnedDashboard(
        dropDuplicatePathTabs(tabsRef.current, currentHref, existing.id),
      );
      const keep =
        cleaned.tabs.find((t) => t.id === existing.id) ||
        cleaned.tabs.find((t) => t.id === cleaned.pinnedId) ||
        existing;
      const meta = metaFor(currentHref);
      const updated = samePathname(keep.href, currentHref)
        ? applyTabMeta(replaceTabHistory(keep, currentHref), meta)
        : applyTabMeta(keep, meta);
      const nextTabs = cleaned.tabs.map((t) =>
        t.id === updated.id ? updated : t,
      );
      tabsRef.current = nextTabs;
      pinnedTabIdRef.current = cleaned.pinnedId;
      activeTabIdRef.current = updated.id;
      setTabs(nextTabs);
      setPinnedTabId(cleaned.pinnedId);
      setActiveTabId(updated.id);
      return;
    }

    setTabs((prev) => {
      if (!prev.length) {
        const tab = createTab(currentHref);
        setActiveTabId(tab.id);
        return [tab];
      }
      const active = prev.find((t) => t.id === activeTabIdRef.current);
      if (!active) return prev;
      if (active.href === currentHref) return prev;
      // Onglet protégé (Dashboard ou verrouillage utilisateur) : son contenu
      // ne peut JAMAIS être remplacé. Si l'URL diverge via un router.push
      // direct, on réaligne l'URL ; les navigations workspace légitimes
      // passent par navigate(), qui ouvre un nouvel onglet dans ce cas.
      if (
        isWorkspaceTabLocked(active, pinnedTabIdRef.current) &&
        !samePathname(active.href, currentHref)
      ) {
        routeTo(active.href, true);
        return prev;
      }
      const meta = metaFor(currentHref);
      // URL modifiée hors navigate() (router.replace/push des filtres, vues,
      // recherche…) : même pathname → remplace l'entrée d'historique (vue ou
      // filtre ≠ nouvelle page) ; pathname différent → vraie navigation, on
      // empile pour que « précédent » fonctionne.
      const update = samePathname(active.href, currentHref)
        ? replaceTabHistory(active, currentHref)
        : pushTabHistory(active, currentHref);
      return prev.map((t) =>
        t.id === active.id ? applyTabMeta(update, meta) : t,
      );
    });
  }, [currentHref, ready, inWorkspace, metaFor, routeTo]);

  const navigate = useCallback(
    (href: string, opts?: NavigateOptions) => {
      const activeForCtx = tabsRef.current.find(
        (t) => t.id === activeTabIdRef.current,
      );
      const h = normalizeHref(
        withConfiguredCtx(href, {
          fromHref: activeForCtx?.href,
          preferCatalogue: opts?.preferCatalogue,
        }),
      );
      const pathOnly = h.split("?")[0] || h;
      if (!isWorkspacePath(pathOnly)) {
        routeTo(h, opts?.replace ?? false);
        return;
      }

      const provisionalTitle = (opts?.title || "").trim() || undefined;
      const resolveMeta = (target: string): TabMeta => {
        const known = metaFor(target);
        return {
          ...known,
          title: provisionalTitle || known.title,
        };
      };

      // Anti-doublon : si la page est déjà ouverte → basculer vers cet onglet
      // (ex. clic sidebar Dashboard alors que l'épinglé existe déjà).
      const existing = findExistingTabForHref(tabsRef.current, h, {
        activeTabId: activeTabIdRef.current,
        pinnedTabId: pinnedTabIdRef.current,
      });
      if (existing) {
        const targetHref = isDashboardHref(h) ? DASHBOARD_PATH : h;
        if (
          existing.id === activeTabIdRef.current &&
          normalizeHref(existing.href) === targetHref &&
          targetHref === currentHrefRef.current
        ) {
          return;
        }
        const cleaned = withPinnedDashboard(
          dropDuplicatePathTabs(tabsRef.current, h, existing.id),
        );
        const target =
          cleaned.tabs.find((t) => t.id === existing.id) ||
          (isDashboardHref(h)
            ? cleaned.tabs.find((t) => t.id === cleaned.pinnedId)
            : null) ||
          existing;
        const meta = resolveMeta(targetHref);
        const updated =
          normalizeHref(target.href) === targetHref
            ? applyTabMeta(target, meta)
            : applyTabMeta(
                samePathname(target.href, targetHref) || opts?.skipHistory
                  ? replaceTabHistory(target, targetHref)
                  : pushTabHistory(target, targetHref),
                meta,
              );
        const nextTabs = cleaned.tabs.map((t) =>
          t.id === updated.id ? updated : t,
        );
        tabsRef.current = nextTabs;
        pinnedTabIdRef.current = cleaned.pinnedId;
        activeTabIdRef.current = updated.id;
        setTabs(nextTabs);
        setPinnedTabId(cleaned.pinnedId);
        setActiveTabId(updated.id);
        setTabBadges((prev) => {
          if (!prev[updated.id]) return prev;
          const next = { ...prev };
          delete next[updated.id];
          return next;
        });
        if (normalizeHref(targetHref) !== currentHrefRef.current) {
          routeTo(targetHref, true);
        }
        return;
      }

      // Depuis tout onglet protégé : une autre page s'ouvre dans un nouvel
      // onglet. Une variation de query sur la même page reste une vue/filtre,
      // comme pour le Dashboard dont la query est ignorée.
      const activeForLock = tabsRef.current.find(
        (t) => t.id === activeTabIdRef.current,
      );
      if (
        !opts?.newTab &&
        activeForLock &&
        shouldOpenLockedNavigationInNewTab(
          activeForLock,
          h,
          pinnedTabIdRef.current,
        )
      ) {
        opts = { ...opts, newTab: true };
      }

      if (opts?.newTab) {
        const prev = tabsRef.current;
        let next = prev;
        if (prev.length >= MAX_TABS) {
          const victim =
            prev.find(
              (t) =>
                t.id !== activeTabIdRef.current &&
                !isWorkspaceTabLocked(t, pinnedTabIdRef.current),
            ) ||
            prev.find((t) => !isWorkspaceTabLocked(t, pinnedTabIdRef.current));
          if (victim) {
            invalidateKeepAlive(victim.href);
            next = prev.filter((t) => t.id !== victim.id);
          }
        }
        const meta = resolveMeta(h);
        const tab = createTab(h, {
          title: meta.title,
          subtitle: meta.subtitle,
          kind: meta.kind,
          trail: meta.trail,
        });
        const pinned = withPinnedDashboard([...next, tab]);
        // Refs synchrones AVANT routeTo : sinon le sync URL→onglet court
        // avec l'ancien activeTabId et écrase l'onglet produit actif.
        tabsRef.current = pinned.tabs;
        pinnedTabIdRef.current = pinned.pinnedId;
        activeTabIdRef.current = tab.id;
        setTabs(pinned.tabs);
        setPinnedTabId(pinned.pinnedId);
        setActiveTabId(tab.id);
        routeTo(h, opts.replace ?? false);
        return;
      }

      if (h === currentHrefRef.current) return;

      // Page absente des onglets → navigation dans l'onglet actif.
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTabIdRef.current) return t;
          const meta = resolveMeta(h);
          // Même page, seuls les query params changent (vue liste/carte,
          // filtres, pagination) → on REMPLACE l'entrée d'historique au lieu
          // d'empiler : « précédent » revient à la page d'avant, pas à
          // l'état de vue/filtre d'avant.
          const sameParamsOnlyChange = samePathname(t.href, h);
          const next =
            opts?.skipHistory || sameParamsOnlyChange
              ? replaceTabHistory(t, h)
              : pushTabHistory(t, h);
          return applyTabMeta(next, meta);
        }),
      );
      routeTo(h, opts?.replace ?? true);
    },
    [routeTo, metaFor],
  );

  const openNewTab = useCallback(
    (href?: string) => {
      navigate(href || getDefaultNewTabHref(), { newTab: true });
    },
    [navigate],
  );

  /** Switch d'onglet : change l'actif, PAS l'ordre, PAS l'historique. */
  const activateTab = useCallback(
    (tabId: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab) return;
      // Consulter l'onglet efface sa pastille de notification.
      setTabBadges((prev) => {
        if (!prev[tabId]) return prev;
        const next = { ...prev };
        delete next[tabId];
        return next;
      });
      if (tabId === activeTabIdRef.current) return;
      activeTabIdRef.current = tabId;
      setActiveTabId(tabId);
      if (normalizeHref(tab.href) !== currentHrefRef.current) {
        routeTo(tab.href, true);
      }
    },
    [routeTo],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      const prev = tabsRef.current;
      const idx = prev.findIndex((t) => t.id === tabId);
      if (idx < 0) return;
      const closing = prev[idx]!;
      // Dashboard et onglets verrouillés par l'utilisateur ne se ferment jamais.
      if (isWorkspaceTabLocked(closing, pinnedTabIdRef.current)) return;
      // Ferme la WebContentsView Electron mais GARDE les cookies (partition).
      closeElectronTab(closing);
      if (isExternalSiteHref(closing.href)) {
        try {
          void getShellDesktopApi()?.showCrm?.();
        } catch {
          /* ignore */
        }
      }
      invalidateKeepAlive(closing.href);
      setTabBadges((badges) => {
        if (!badges[tabId]) return badges;
        const next = { ...badges };
        delete next[tabId];
        return next;
      });

      if (prev.length === 1) {
        const pinned = withPinnedDashboard([]);
        setTabs(pinned.tabs);
        setPinnedTabId(pinned.pinnedId);
        setActiveTabId(pinned.pinnedId);
        routeTo(DASHBOARD_PATH, true);
        return;
      }

      const pinned = withPinnedDashboard(prev.filter((t) => t.id !== tabId));
      setTabs(pinned.tabs);
      setPinnedTabId(pinned.pinnedId);
      if (activeTabIdRef.current === tabId) {
        // Chrome : préférer le voisin de droite, sinon gauche
        const list = pinned.tabs;
        const fallback = list[idx] || list[idx - 1] || list[0]!;
        setActiveTabId(fallback.id);
        routeTo(fallback.href, true);
      }
    },
    [routeTo],
  );

  const setTabLocked = useCallback((tabId: string, locked: boolean) => {
    // Le Dashboard est un verrou système : il ne peut pas être déverrouillé.
    if (tabId === pinnedTabIdRef.current) return;
    const current = tabsRef.current.find((t) => t.id === tabId);
    if (!current || current.locked === locked) return;
    const nextTabs = tabsRef.current.map((t) =>
      t.id === tabId ? { ...t, locked } : t,
    );
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
  }, []);

  const patchExternalSiteTab = useCallback(
    (
      siteId: number,
      patch: Partial<{ electronTabId: string; url: string; title: string }>,
    ) => {
      setTabs((prev) => {
        let changed = false;
        const next = prev.map((t) => {
          const meta = t.externalSite;
          const metaSiteId = meta?.siteId;
          if (metaSiteId !== siteId && !isExternalSiteHref(t.href)) {
            return t;
          }
          if (
            metaSiteId !== siteId &&
            pathnameOf(t.href) !== pathnameOf(externalSiteHref(siteId))
          ) {
            return t;
          }
          const nextTitle =
            patch.title !== undefined ? patch.title.trim() || t.title : t.title;
          const nextUrl =
            patch.url !== undefined ? patch.url : (meta?.url ?? "");
          const nextElectronId =
            patch.electronTabId !== undefined
              ? patch.electronTabId
              : meta?.electronTabId;
          if (
            nextTitle === t.title &&
            nextUrl === (meta?.url ?? "") &&
            nextElectronId === meta?.electronTabId &&
            t.externalSite?.siteId === siteId
          ) {
            return t;
          }
          changed = true;
          return {
            ...t,
            title: nextTitle,
            externalSite: {
              siteId,
              url: nextUrl,
              electronTabId: nextElectronId,
            },
          };
        });
        return changed ? next : prev;
      });
    },
    [],
  );

  const openExternalSite = useCallback(
    (opts: OpenExternalSiteOpts) => {
      const sid = Math.floor(opts.siteId);
      if (!Number.isFinite(sid) || sid < 0) return;
      const href = externalSiteHref(sid);
      const existing = findExternalSiteTab(tabsRef.current, sid);

      if (existing) {
        // Réactivation (sidebar Hermes/n8n) : garder l'URL live SPA.
        // Navigation explicite (SiteLink / navigateur) : navigateUrl → seed.
        const existingMeta = existing.externalSite;
        const liveUrl = (existingMeta?.url || "").trim();
        const seedUrl = (opts.url || "").trim();
        const nextUrl = opts.navigateUrl
          ? seedUrl || liveUrl
          : liveUrl || seedUrl;
        const externalSite = {
          siteId: sid,
          url: nextUrl,
          electronTabId: opts.electronTabId || existingMeta?.electronTabId,
        };
        const updated: WorkspaceTab = {
          ...existing,
          title: (opts.title || "").trim() || existing.title,
          href,
          fullscreen: true,
          externalSite,
        };
        const nextTabs = tabsRef.current.map((t) =>
          t.id === existing.id ? updated : t,
        );
        tabsRef.current = nextTabs;
        activeTabIdRef.current = existing.id;
        setTabs(nextTabs);
        setActiveTabId(existing.id);
        setTabBadges((prev) => {
          if (!prev[existing.id]) return prev;
          const next = { ...prev };
          delete next[existing.id];
          return next;
        });
        if (normalizeHref(href) !== currentHrefRef.current) {
          routeTo(href, true);
        }
        return;
      }

      const prev = tabsRef.current;
      let next = prev;
      if (prev.length >= MAX_TABS) {
        const victim =
          prev.find(
            (t) =>
              t.id !== activeTabIdRef.current &&
              !isWorkspaceTabLocked(t, pinnedTabIdRef.current),
          ) ||
          prev.find((t) => !isWorkspaceTabLocked(t, pinnedTabIdRef.current));
        if (victim) {
          closeElectronTab(victim);
          invalidateKeepAlive(victim.href);
          next = prev.filter((t) => t.id !== victim.id);
        }
      }
      const tab = createExternalSiteTab({
        siteId: sid,
        url: opts.url,
        title: opts.title,
        electronTabId: opts.electronTabId,
      });
      const pinned = withPinnedDashboard([...next, tab]);
      tabsRef.current = pinned.tabs;
      pinnedTabIdRef.current = pinned.pinnedId;
      activeTabIdRef.current = tab.id;
      setTabs(pinned.tabs);
      setPinnedTabId(pinned.pinnedId);
      setActiveTabId(tab.id);
      routeTo(href, true);
    },
    [routeTo],
  );

  /** Réordonne un onglet (drag & drop) — ne touche ni l'actif ni les historiques.
   *  Le Dashboard épinglé reste en position 0 : ni déplaçable, ni délogeable. */
  const moveTab = useCallback((tabId: string, toIndex: number) => {
    if (tabId === pinnedTabIdRef.current) return;
    setTabs((prev) => {
      const from = prev.findIndex((t) => t.id === tabId);
      if (from < 0) return prev;
      const min = prev[0] && prev[0].id === pinnedTabIdRef.current ? 1 : 0;
      const to = Math.min(Math.max(min, toIndex), prev.length - 1);
      if (from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  }, []);

  /**
   * Focus l'onglet du pathname s'il existe ; sinon l'ouvre en nouvel onglet.
   * Ne pose plus de pastille seule — l'utilisateur doit **voir** la cible.
   */
  const openOrNotify = useCallback(
    (href: string): "opened" | "focused" | "active" => {
      const h = normalizeHref(href);
      const path = h.split("?")[0] || h;
      // Un seul onglet par pathname — on prend le plus ancien, on ferme les doublons.
      const matches = tabsRef.current.filter(
        (t) => (normalizeHref(t.href).split("?")[0] || "/") === path,
      );
      const existing = matches[0];
      if (matches.length > 1) {
        const keepId = existing!.id;
        const drop = new Set(matches.slice(1).map((t) => t.id));
        for (const t of matches.slice(1)) invalidateKeepAlive(t.href);
        const cleaned = withPinnedDashboard(
          tabsRef.current.filter((t) => !drop.has(t.id)),
        );
        tabsRef.current = cleaned.tabs;
        pinnedTabIdRef.current = cleaned.pinnedId;
        setTabs(cleaned.tabs);
        setPinnedTabId(cleaned.pinnedId);
        setTabBadges((prev) => {
          const next = { ...prev };
          drop.forEach((id) => {
            delete next[id];
          });
          return next;
        });
        if (drop.has(activeTabIdRef.current)) {
          activeTabIdRef.current = keepId;
          setActiveTabId(keepId);
        }
      }
      if (existing) {
        if (existing.id === activeTabIdRef.current) return "active";
        // Focus (pas pastille) : activateTab efface aussi une éventuelle badge.
        activateTab(existing.id);
        return "focused";
      }
      navigate(h, { newTab: true });
      return "opened";
    },
    [activateTab, navigate],
  );

  /** ← agit uniquement sur l'historique de l'onglet actif — ne change jamais l'ordre. */
  const goBack = useCallback(() => {
    const active = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
    if (!active || active.historyIndex <= 0) return;
    const nextIdx = active.historyIndex - 1;
    const href = active.history[nextIdx];
    if (!href) return;
    const meta = metaFor(href);
    setTabs((prev) =>
      prev.map((t) =>
        t.id === active.id
          ? applyTabMeta(
              { ...t, historyIndex: nextIdx, href },
              meta,
            )
          : t,
      ),
    );
    routeTo(href, true);
  }, [routeTo, metaFor]);

  /** → agit uniquement sur l'historique de l'onglet actif — ne change jamais l'ordre. */
  const goForward = useCallback(() => {
    const active = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
    if (!active || active.historyIndex >= active.history.length - 1) return;
    const nextIdx = active.historyIndex + 1;
    const href = active.history[nextIdx];
    if (!href) return;
    const meta = metaFor(href);
    setTabs((prev) =>
      prev.map((t) =>
        t.id === active.id
          ? applyTabMeta(
              { ...t, historyIndex: nextIdx, href },
              meta,
            )
          : t,
      ),
    );
    routeTo(href, true);
  }, [routeTo, metaFor]);

  const setTabMeta = useCallback((href: string, meta: TabMeta) => {
    const h = normalizeHref(href);
    if (meta.title) {
      metaByHrefRef.current.set(h, {
        title: meta.title,
        subtitle: meta.subtitle,
        kind: meta.kind,
        trail: meta.trail,
        fullscreen: meta.fullscreen,
      });
    }
    // Cible le/les onglets dont l'URL correspond à la pane émettrice (href),
    // jamais « l'onglet actif du moment » : au switch optimiste, activeTabId
    // bascule avant l'URL et l'onglet cliqué recevait brièvement le titre
    // de l'ancienne page (flash de titre croisé).
    setTabs((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        if (normalizeHref(t.href) !== h) return t;
        const updated = applyTabMeta(t, meta);
        if (updated !== t) changed = true;
        return updated;
      });
      return changed ? next : prev;
    });
  }, []);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) || tabs[0] || null,
    [tabs, activeTabId],
  );

  const activeSurface = useMemo(
    () => resolveActiveSurface({ activeTab }),
    [activeTab],
  );

  const canGoBack = Boolean(activeTab && activeTab.historyIndex > 0);
  const canGoForward = Boolean(
    activeTab &&
      activeTab.historyIndex >= 0 &&
      activeTab.historyIndex < activeTab.history.length - 1,
  );

  // Surface native symétrique : quitter site → showCrm ; revenir → activate
  // (contentRect Electron conservé — rect optionnel). Sans activate ici,
  // seul le slot paneActive pouvait réafficher : course keep-alive → bug
  // « contenu de l'onglet précédent ».
  useEffect(() => {
    if (!ready) return;
    const api = getShellDesktopApi();
    if (!api) return;
    const externalMeta = activeTab?.externalSite;
    const cmd =
      !activeTab || !isExternalSiteHref(activeTab.href)
        ? reduceExternalSiteSurfaceCommand({ type: "leave-external" })
        : reduceExternalSiteSurfaceCommand({
            type: "enter-external",
            electronTabId: externalMeta?.electronTabId,
          });
    if (cmd.type === "show-crm") {
      // Bridge thin (client remote-only) sans surface tabs native : feature-off.
      void api.showCrm?.();
    } else if (cmd.type === "activate" && api.activateTab) {
      void api.activateTab(cmd.tabId);
    }
  }, [ready, activeTabId, activeTab]);

  const value = useMemo<TabWorkspaceContextValue>(
    () => ({
      ready,
      tabs,
      activeTabId,
      activeTab,
      pinnedTabId,
      tabBadges,
      canGoBack,
      canGoForward,
      navigate,
      openNewTab,
      activateTab,
      closeTab,
      setTabLocked,
      moveTab,
      goBack,
      goForward,
      setTabMeta,
      openOrNotify,
      openExternalSite,
      patchExternalSiteTab,
      currentHref,
      activeSurface,
    }),
    [
      ready,
      tabs,
      activeTabId,
      activeTab,
      pinnedTabId,
      tabBadges,
      canGoBack,
      canGoForward,
      navigate,
      openNewTab,
      activateTab,
      closeTab,
      setTabLocked,
      moveTab,
      goBack,
      goForward,
      setTabMeta,
      openOrNotify,
      openExternalSite,
      patchExternalSiteTab,
      currentHref,
      activeSurface,
    ],
  );

  // Publie le navigate courant pour les consommateurs hors provider
  // (getWorkspaceTabNavigate) — ex. démo interactive montée dans le chrome.
  useEffect(() => {
    workspaceNavigateBridge = navigate;
    return () => {
      if (workspaceNavigateBridge === navigate) workspaceNavigateBridge = null;
    };
  }, [navigate]);

  return (
    <TabWorkspaceContext.Provider value={value}>
      {children}
    </TabWorkspaceContext.Provider>
  );
}

export function useTabWorkspace() {
  const ctx = useContext(TabWorkspaceContext);
  if (!ctx) {
    throw new Error("useTabWorkspace must be used within TabWorkspaceProvider");
  }
  return ctx;
}

export function useTabWorkspaceOptional() {
  return useContext(TabWorkspaceContext);
}

export function useOpenTab() {
  const workspace = useTabWorkspace();
  return useCallback(
    (href: string, opts?: NavigateOptions) => workspace.navigate(href, opts),
    [workspace],
  );
}


configureTabWorkspaceHost({
  useTabWorkspace,
  useOpenTab,
});

/** Branche l'assistant kit sur le même TabWorkspaceProvider (liens chat → navigate). */
configureAssistantTabWorkspace(useTabWorkspaceOptional);
