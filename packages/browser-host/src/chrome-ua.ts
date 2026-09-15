/**
 * User-Agent cohérent pour le sidecar Chromium serveur — même intention que
 * `chrome-ua.ts` d'electron-shell : pas de token `HeadlessChrome`, version
 * Chrome RÉELLE du binaire (dérivée de Browser.getVersion), plateforme Linux.
 */

/** "Chrome/131.0.6778.85" ou "HeadlessChrome/150.0.0.0" → "131.0.0.0". */
export function chromeMajorFromProduct(product: string): string {
  const m = /Chrome\/(\d+)/i.exec(product || "");
  return (m ? m[1] : "131") + ".0.0.0";
}

/** UA "humain" Linux x86_64 aligné sur la version du binaire. */
export function chromeUaForProduct(product: string): string {
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajorFromProduct(product)} Safari/537.36`;
}
