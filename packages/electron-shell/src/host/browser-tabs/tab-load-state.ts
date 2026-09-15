/**
 * Machine d'état pure du chargement d'onglet site externe (WebContentsView).
 *
 * Objectif UX : spinner React uniquement pour un chargement **intentionnel**
 * (openTab / loadAndWait → intent-load). Les navigations main-frame initiées
 * par le site (liens, redirects SPA mal classées, History API) ne doivent
 * PAS masquer la WebContentsView — sinon flash « Chargement du site… » et
 * impression de reload de toute la zone contenu.
 *
 * Ne jamais rebloquer l'UI sur did-start-loading parasite (iframes,
 * sous-ressources) après did-finish-load.
 */

export type TabLoadPhase = "loading" | "ready" | "error";

export type TabLoadSignal =
  /** openTab / loadAndWait — afficher le spinner immédiatement. */
  | { type: "intent-load" }
  /**
   * did-start-navigation. Ne force plus loading : seul intent-load masque
   * la vue (soft-nav / nav in-site restent visibles).
   */
  | {
      type: "main-nav-start";
      isMainFrame: boolean;
      isInPlace: boolean;
      url?: string;
    }
  /** did-start-loading — trop large, ne doit JAMAIS faire basculer l'UI. */
  | { type: "resource-start" }
  | { type: "main-finish"; url?: string }
  | { type: "main-fail"; isMainFrame: boolean; aborted?: boolean }
  /** did-stop-loading : filet si finish raté alors que Chromium est idle. */
  | { type: "stop-loading"; stillLoading: boolean; url?: string }
  /** activate : page déjà !isLoading() → forcer ready (listener IPC tardif). */
  | { type: "sync-already-idle"; url?: string };

function isErrorPageUrl(url?: string): boolean {
  return Boolean(url && url.startsWith("data:text/html"));
}

/**
 * Réduit la phase native/React à partir d'un signal de navigation.
 * Les transitions sont idempotentes quand le signal est ignoré.
 */
export function reduceTabNativeLoadState(
  current: TabLoadPhase,
  signal: TabLoadSignal,
): TabLoadPhase {
  switch (signal.type) {
    case "intent-load":
      return "loading";
    case "main-nav-start":
      // Soft-nav : ne pas masquer la vue. Le spinner ne s'affiche que via
      // intent-load (openTab explicite). On ignore aussi iframes / in-place.
      return current;
    case "resource-start":
      return current;
    case "main-finish":
      if (isErrorPageUrl(signal.url)) return "error";
      return "ready";
    case "main-fail":
      if (!signal.isMainFrame || signal.aborted) return current;
      return "error";
    case "stop-loading":
      if (signal.stillLoading) return current;
      if (current !== "loading") return current;
      if (isErrorPageUrl(signal.url)) return "error";
      return "ready";
    case "sync-already-idle":
      if (current === "error") return "error";
      if (isErrorPageUrl(signal.url)) return "error";
      return "ready";
    default:
      return current;
  }
}
