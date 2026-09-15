/**
 * Comparaison d'URL « même document » pour onglets sites externes.
 *
 * Ignore le hash (soft-nav SPA). Normalise trailing slash sur pathname,
 * hostname en minuscules, et aligne localhost ↔ 127.0.0.1.
 * Dupliqué volontairement dans electron/tab-url.ts (rootDir Electron isolé).
 */

export function normalizeTabDocumentUrl(raw: string): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("about:")) {
    return null;
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    let host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "[::1]") host = "127.0.0.1";
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    let pathname = u.pathname || "/";
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    return `${u.protocol}//${host}:${port}${pathname}${u.search}`;
  } catch {
    return null;
  }
}

/** true si a et b désignent le même document (pas besoin de loadURL). */
export function isSameTabDocument(a: string, b: string): boolean {
  const na = normalizeTabDocumentUrl(a);
  const nb = normalizeTabDocumentUrl(b);
  if (!na || !nb) return false;
  return na === nb;
}

/** Même origine (scheme + host + port normalisés). */
export function isSameTabOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(String(a || "").trim());
    const ub = new URL(String(b || "").trim());
    if (ua.protocol !== ub.protocol) return false;
    const norm = (h: string) => {
      const x = h.toLowerCase();
      return x === "localhost" || x === "[::1]" ? "127.0.0.1" : x;
    };
    if (norm(ua.hostname) !== norm(ub.hostname)) return false;
    const portA = ua.port || (ua.protocol === "https:" ? "443" : "80");
    const portB = ub.port || (ub.protocol === "https:" ? "443" : "80");
    return portA === portB;
  } catch {
    return false;
  }
}
