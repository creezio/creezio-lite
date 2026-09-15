"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import {
  ASSISTANT_PANEL_WIDTH_PX,
  useAssistantUi,
} from "@creezio/assistant/ui";
import { cn, getShellUiBrand } from "@creezio/shell-ui";
import { Sidebar } from "../layout/sidebar";
import { Button } from "../primitives/button";
import { GlobalSearchProvider } from "../search/global-search-provider";
import { PageToolbarProvider } from "../layout/page-toolbar-context";
import { KeepAliveOutlet } from "./keep-alive";
import { useTabWorkspace } from "./tab-workspace-context";
import { isWorkspacePath, normalizeHref } from "./types";
import { useLocationSearch } from "./use-location-search";
import { WorkspaceTabBar } from "./workspace-tab-bar";
import {
  getPreferCatalogueSelector,
  getSidebarCollapsedKey,
} from "./workspace-config";

type SidebarChromeProps = {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
};

/** Sidebar marque (élément) reçoit les props chrome ; sinon Sidebar kit. */
function renderSidebarSlot(
  sidebar: ReactNode | undefined,
  props: SidebarChromeProps,
): ReactNode {
  if (sidebar == null) {
    return <Sidebar {...props} />;
  }
  if (isValidElement(sidebar)) {
    return cloneElement(
      sidebar as ReactElement<Partial<SidebarChromeProps>>,
      props,
    );
  }
  return sidebar;
}

function resolveInternalHref(anchor: HTMLAnchorElement): string | null {
  const raw = anchor.getAttribute("href");
  if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) {
    return null;
  }
  if (anchor.target === "_blank" || anchor.hasAttribute("download")) return null;
  if (anchor.dataset.workspaceNav === "ignore") return null;

  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (!isWorkspacePath(url.pathname)) return null;
  return normalizeHref(`${url.pathname}${url.search}`);
}

/** Texte lisible du lien pour titre d'onglet provisoire. */
function linkLabel(anchor: HTMLAnchorElement): string | undefined {
  const titled = (anchor.getAttribute("title") || "").trim();
  if (titled) return titled.slice(0, 80);
  const text = (anchor.innerText || anchor.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length < 2) return undefined;
  return text.slice(0, 80);
}

export function WorkspaceShell({
  children,
  sidebar,
  footbar,
}: {
  children: ReactNode;
  sidebar?: ReactNode;
  footbar?: ReactNode;
}) {
  const pathname = usePathname() || "/";
  const search = useLocationSearch(pathname);
  // normalizeHref canonise "/" → /dashboard : la page racine (pure redirection)
  // ne doit jamais avoir sa propre pane keep-alive (boucle router.replace).
  const cacheKey = normalizeHref(search ? `${pathname}?${search}` : pathname);
  const inWorkspace = isWorkspacePath(pathname);

  const { navigate, ready, activeTab } = useTabWorkspace();
  const { open, hydrated } = useAssistantUi();
  const brand = getShellUiBrand();
  // Panel ouvert : push layout historique (pr-[400px]).
  // Panel fermé : PAS de gutter — FAB en overlay (React web / Electron topmost).
  const rightChromePx = hydrated && open ? ASSISTANT_PANEL_WIDTH_PX : 0;
  const activeHref = activeTab ? normalizeHref(activeTab.href) : cacheKey;

  const [navOpen, setNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  /** Clics interceptés avant hydratation workspace — rejoués dès ready. */
  const pendingNavRef = useRef<{
    href: string;
    newTab: boolean;
    title?: string;
    preferCatalogue?: boolean;
  } | null>(null);

  const closeNav = useCallback(() => setNavOpen(false), []);

  // Préférence sidebar réduite persistée (localStorage).
  useEffect(() => {
    try {
      if (window.localStorage.getItem(getSidebarCollapsedKey()) === "1") {
        setSidebarCollapsed(true);
      }
    } catch {
      // stockage indisponible : on reste déplié
    }
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(getSidebarCollapsedKey(), next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (wasOpenRef.current && !navOpen) {
      menuButtonRef.current?.focus();
    }
    wasOpenRef.current = navOpen;
  }, [navOpen]);

  // Rejouer la navigation en file dès que le workspace est prêt.
  useEffect(() => {
    if (!ready || !pendingNavRef.current) return;
    const pending = pendingNavRef.current;
    pendingNavRef.current = null;
    navigate(pending.href, {
      newTab: pending.newTab,
      title: pending.title,
      preferCatalogue: pending.preferCatalogue,
    });
  }, [ready, navigate]);

  // Interception dès le premier paint (même avant ready) — évite le rechargement MPA.
  useEffect(() => {
    if (!inWorkspace) return;

    function dispatchNav(
      href: string,
      newTab: boolean,
      title?: string,
      preferCatalogue?: boolean,
    ) {
      if (!ready) {
        pendingNavRef.current = { href, newTab, title, preferCatalogue };
        return;
      }
      navigate(href, { newTab, title, preferCatalogue });
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      const href = resolveInternalHref(anchor);
      if (!href) return;

      const newTab = e.metaKey || e.ctrlKey || e.shiftKey;
      const preferCatalogue = Boolean(
        anchor.closest(getPreferCatalogueSelector()),
      );
      e.preventDefault();
      dispatchNav(href, newTab, linkLabel(anchor), preferCatalogue);
    }

    function onAuxClick(e: MouseEvent) {
      if (e.button !== 1 || e.defaultPrevented) return;
      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      const href = resolveInternalHref(anchor);
      if (!href) return;
      const preferCatalogue = Boolean(
        anchor.closest(getPreferCatalogueSelector()),
      );
      e.preventDefault();
      dispatchNav(href, true, linkLabel(anchor), preferCatalogue);
    }

    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onAuxClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onAuxClick, true);
    };
  }, [inWorkspace, ready, navigate]);

  if (!inWorkspace) {
    return <>{children}</>;
  }

  return (
    <GlobalSearchProvider>
      <PageToolbarProvider>
      <div
        className={cn(
          // h-dvh : hauteur viewport stable (PWA standalone incluse)
          "flex h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-slate-50 via-white to-sky-50/40",
          "transition-[padding] duration-200 ease-out",
          // md+ : push layout uniquement panel ouvert (pas de gutter FAB)
          rightChromePx > 0 && "md:pr-[var(--assistant-chrome-right)]",
        )}
        style={
          {
            "--assistant-panel-width": `${ASSISTANT_PANEL_WIDTH_PX}px`,
            "--assistant-chrome-right": `${rightChromePx}px`,
          } as CSSProperties
        }
        data-creezio-assistant-chrome={hydrated && open ? "panel" : "fab-overlay"}
      >
        {renderSidebarSlot(sidebar, {
          collapsed: sidebarCollapsed,
          onToggleCollapse: toggleSidebarCollapsed,
          mobileOpen: navOpen,
          onMobileClose: closeNav,
        })}
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col transition-[margin] duration-200 ease-out",
            sidebarCollapsed ? "md:ml-16" : "md:ml-64",
          )}
        >
          <header className="sticky top-0 z-20 shrink-0 bg-[#ebe7df] px-2 sm:px-3 md:px-4 md:pr-0">
            <div className="flex items-stretch gap-1.5">
              <Button
                ref={menuButtonRef}
                type="button"
                variant="outline"
                size="icon"
                className={cn(
                  brand.titlebarNoDragClass,
                  "mt-1.5 h-7 w-7 shrink-0 border-slate-300/80 bg-white/70 md:hidden",
                )}
                onClick={() => setNavOpen(true)}
                aria-label="Ouvrir le menu de navigation"
                aria-expanded={navOpen}
                aria-controls="mobile-nav"
              >
                <Menu className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex-1">
                <WorkspaceTabBar />
              </div>
            </div>
          </header>
          {/* Scroll délégué aux panes keep-alive (pas au main) → scrollY natif par onglet */}
          <main className="relative min-h-0 flex-1 overflow-hidden bg-white">
            <KeepAliveOutlet routeKey={cacheKey} activeHref={activeHref}>
              {children}
            </KeepAliveOutlet>
          </main>
          {footbar}
        </div>
      </div>
      </PageToolbarProvider>
    </GlobalSearchProvider>
  );
}
