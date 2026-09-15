"use client";

import { useEffect, useState } from "react";

const LOCATION_EVENT = "creezio-locationchange";
let historyPatched = false;

/**
 * Next App Router change l'URL via history.pushState/replaceState, qui
 * n'émettent AUCUN événement natif. Sans ça, une navigation qui ne change
 * que la query (ex. /produits → /produits?view=sku) ne resynchronise jamais
 * le hook (pathname identique, pas de popstate) : routeKey/cacheKey restent
 * figés sur l'ancienne URL et les panes keep-alive se mélangent.
 */
function patchHistoryOnce() {
  if (historyPatched || typeof window === "undefined") return;
  historyPatched = true;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = ((...args: Parameters<History["pushState"]>) => {
      const result = original(...args);
      window.dispatchEvent(new Event(LOCATION_EVENT));
      return result;
    }) as History["pushState"];
  }
}

/**
 * Query string sans `?`, lue depuis window.location (évite Suspense useSearchParams).
 * Se met à jour au changement de pathname, sur popstate ET sur tout
 * pushState/replaceState (navigations Next qui ne changent que la query).
 */
export function useLocationSearch(pathname: string): string {
  const [, bump] = useState(0);

  useEffect(() => {
    patchHistoryOnce();
    const sync = () => bump((n) => n + 1);
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener(LOCATION_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(LOCATION_EVENT, sync);
    };
  }, [pathname]);

  if (typeof window === "undefined") return "";
  return window.location.search.replace(/^\?/, "");
}
