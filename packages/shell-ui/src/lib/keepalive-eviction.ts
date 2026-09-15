/**
 * Politique d'éviction keep-alive (pur / testable).
 * Les panes fullscreen (`/site/*` + matchers marque) ne sont jamais évincées.
 */

const DASHBOARD_PATH = "/dashboard";

/** Matchers fullscreen injectables (marque) — ex. canvas Optimiser TF. */
let fullscreenMatchers: Array<(href: string) => boolean> = [];

export function configureKeepAliveFullscreenMatchers(
  matchers: Array<(href: string) => boolean>,
): void {
  fullscreenMatchers = matchers;
}

function normalizeHref(href: string): string {
  try {
    const url = new URL(href, "http://local.invalid");
    const path = url.pathname === "/" ? DASHBOARD_PATH : url.pathname || "/";
    const search = url.search || "";
    return `${path}${search}`;
  } catch {
    return href.split("#")[0] || "/";
  }
}

function isExternalSiteHref(href: string): boolean {
  const path = normalizeHref(href).split("?")[0] || "/";
  return path === "/site" || path.startsWith("/site/");
}

function isFullscreenHref(href: string): boolean {
  if (isExternalSiteHref(href)) return true;
  return fullscreenMatchers.some((m) => m(href));
}

export function isKeepAliveProtectedKey(key: string): boolean {
  return isFullscreenHref(normalizeHref(key));
}

/**
 * Clés évinçables (plus anciennes d'abord), hors display/route et hors protégées.
 */
export function rankKeepAliveEvictionKeys(
  keys: string[],
  lastActiveAt: Record<string, number>,
  opts: { displayKey: string; routeKey: string },
): string[] {
  return keys
    .filter(
      (key) =>
        key !== opts.displayKey &&
        key !== opts.routeKey &&
        !isKeepAliveProtectedKey(key),
    )
    .sort((a, b) => (lastActiveAt[a] || 0) - (lastActiveAt[b] || 0));
}
