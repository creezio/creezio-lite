"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { cn } from "@creezio/shell-ui";
import { rankKeepAliveEvictionKeys } from "@creezio/shell-ui";
import { MAX_KEEPALIVE, isFullscreenHref } from "./types";

type CacheEntry = {
  node: ReactNode;
  lastActiveAt: number;
};

/**
 * Href (clé de cache) de la pane keep-alive dans laquelle un composant est
 * rendu. Stable pour toute la vie de la pane — contrairement à `currentHref`
 * qui suit l'URL globale et change quand ON NAVIGUE DANS UN AUTRE ONGLET.
 * C'est la cible correcte pour publier le titre d'une page vers son onglet.
 */
const PaneHrefContext = createContext<string | null>(null);
/** true hors keep-alive ; false sur les panes inactives (évite d'écraser la toolbar). */
const PaneActiveContext = createContext(true);

export function usePaneHref(): string | null {
  return useContext(PaneHrefContext);
}

export function usePaneActive(): boolean {
  return useContext(PaneActiveContext);
}

/**
 * Gel du router App Router par pane (pattern « FrozenRouter »).
 *
 * Dans App Router, `children` n'est PAS un instantané : c'est un élément
 * `LayoutRouter` qui lit la route courante via `LayoutRouterContext`. Sans
 * gel, chaque navigation re-rend TOUTES les panes vers la nouvelle route
 * (naviguer dans l'onglet B changeait le contenu de l'onglet A).
 *
 * Tant que la pane correspond à l'URL réellement rendue (`live`), on laisse
 * passer le contexte réel (données fraîches, router.refresh, etc.) et on le
 * mémorise. Dès que la route s'en va, la pane rend le dernier contexte
 * capturé : son contenu reste figé sur SA route.
 */
function PaneRouterFreeze({
  live,
  children,
}: {
  live: boolean;
  children: ReactNode;
}) {
  const ctx = useContext(LayoutRouterContext);
  const frozenRef = useRef(ctx);
  if (live) {
    frozenRef.current = ctx;
  }
  return (
    <LayoutRouterContext.Provider value={live ? ctx : frozenRef.current}>
      {children}
    </LayoutRouterContext.Provider>
  );
}

/**
 * Pool keep-alive : panes empilées (absolute + visibility), pas de display:none.
 *
 * - `routeKey` : URL réellement rendue par Next (source de `children`)
 * - `activeHref` : URL de l'onglet actif (switch optimiste)
 * - Chaque pane rend `children` sous un LayoutRouterContext gelé sur SA route
 *   (voir PaneRouterFreeze) + un PaneHrefContext stable pour le titre
 * - Scroll natif par pane ; charts Leaflet/Recharts gardent leurs dimensions
 */
export function KeepAliveOutlet({
  routeKey,
  activeHref,
  children,
  max = MAX_KEEPALIVE,
}: {
  routeKey: string;
  activeHref: string;
  children: ReactNode;
  max?: number;
}) {
  const cacheRef = useRef(new Map<string, CacheEntry>());
  const paneRefs = useRef(new Map<string, HTMLDivElement | null>());
  const [, bump] = useState(0);

  // Sync children uniquement sous routeKey (jamais sous une URL pas encore naviguée)
  const routeEntry = cacheRef.current.get(routeKey);
  if (!routeEntry) {
    cacheRef.current.set(routeKey, {
      node: children,
      lastActiveAt: Date.now(),
    });
  } else {
    routeEntry.node = children;
    routeEntry.lastActiveAt = Date.now();
  }

  // Affichage optimiste : si l'onglet cible a déjà une pane, la montrer tout
  // de suite (sans attendre router.replace). Si la cible est froide (pas en
  // cache) → placeholder, JAMAIS l'ancienne pane (bug « contenu page précédente »).
  const coldTarget =
    activeHref !== routeKey && !cacheRef.current.has(activeHref);
  const displayKey: string | null = coldTarget
    ? null
    : activeHref !== routeKey && cacheRef.current.has(activeHref)
      ? activeHref
      : routeKey;

  if (cacheRef.current.size > max) {
    // Ne jamais évincer /site/* (Hermes, sites externes) ni un canvas fullscreen :
    // sinon au retour d'onglet displayKey retombe sur routeKey (CRM précédent).
    const lastActiveAt: Record<string, number> = {};
    Array.from(cacheRef.current.entries()).forEach(([key, entry]) => {
      lastActiveAt[key] = entry.lastActiveAt;
    });
    const ranked = rankKeepAliveEvictionKeys(
      Array.from(cacheRef.current.keys()),
      lastActiveAt,
      { displayKey: displayKey ?? routeKey, routeKey },
    );
    while (cacheRef.current.size > max && ranked.length) {
      const evictKey = ranked.shift()!;
      cacheRef.current.delete(evictKey);
      paneRefs.current.delete(evictKey);
    }
  }

  useEffect(() => {
    function onInvalidate(e: Event) {
      const key = (e as CustomEvent<string>).detail;
      if (!key) return;
      cacheRef.current.delete(key);
      paneRefs.current.delete(key);
      bump((n) => n + 1);
    }
    window.addEventListener("creezio-keepalive-invalidate", onInvalidate);
    window.addEventListener("creezio-keepalive-unfreeze", onInvalidate);
    return () => {
      window.removeEventListener("creezio-keepalive-invalidate", onInvalidate);
      window.removeEventListener("creezio-keepalive-unfreeze", onInvalidate);
    };
  }, []);

  return (
    <div className="workspace-pane-stack relative h-full min-h-0 w-full">
      {Array.from(cacheRef.current.entries()).map(([key, entry]) => {
        const active = displayKey != null && key === displayKey;
        const fullscreen = isFullscreenHref(key);
        return (
          <div
            key={key}
            ref={(el) => {
              paneRefs.current.set(key, el);
              if (el) {
                if (active) el.removeAttribute("inert");
                else el.setAttribute("inert", "");
              }
            }}
            data-workspace-pane={key}
            data-active={active ? "true" : "false"}
            aria-hidden={!active}
            className={cn(
              "workspace-pane absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain",
              fullscreen
                ? "overflow-hidden bg-white p-0"
                : "bg-white p-4 pt-3 md:p-6 md:pt-4",
              "[scrollbar-gutter:stable]",
              // visibility (pas display:none) : préserve dimensions → pas de reflow Recharts/Leaflet
              active
                ? "z-[1] visible pointer-events-auto"
                : "z-0 invisible pointer-events-none",
            )}
          >
            <PaneHrefContext.Provider value={key}>
              <PaneActiveContext.Provider value={active}>
                <PaneRouterFreeze live={key === routeKey}>
                  {entry.node}
                </PaneRouterFreeze>
              </PaneActiveContext.Provider>
            </PaneHrefContext.Provider>
          </div>
        );
      })}
      {coldTarget ? (
        <div
          data-workspace-pane-placeholder={activeHref}
          data-active="true"
          className="workspace-pane absolute inset-0 z-[2] flex items-center justify-center bg-white"
          aria-busy="true"
          aria-live="polite"
        >
          <div className="h-8 w-8 animate-pulse rounded-full bg-slate-200" />
        </div>
      ) : null}
    </div>
  );
}

export function invalidateKeepAlive(href: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("creezio-keepalive-invalidate", { detail: href }),
  );
}

export function unfreezeKeepAlive(href: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("creezio-keepalive-unfreeze", { detail: href }),
  );
}
