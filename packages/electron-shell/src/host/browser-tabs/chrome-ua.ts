// @ts-nocheck — Electron WebContents/session (shim kit mince, N7)
/**
 * User-Agent cohérent pour toutes les vues (CRM + onglets fournisseurs).
 *
 * Objectif : ne PAS exposer le token `Electron/x.y` ni le nom de l'app dans
 * l'UA (certains sites le refusent), tout en restant COHÉRENT avec les
 * Client Hints (`Sec-CH-UA`) que Chromium renseigne déjà (brands Chromium).
 *
 * On dérive la version Chrome réelle du runtime (process.versions.chrome)
 * plutôt que de figer une version : l'UA suit alors les mises à jour
 * d'Electron sans divergence UA ↔ moteur.
 *
 * Volontairement AUCUN patch de furtivité supplémentaire (navigator.webdriver
 * n'est pas posé par Electron ; l'utilisateur se connecte lui-même, IP
 * résidentielle, fenêtre visible → profil « humain » à préserver).
 */

import { loadElectron } from "@creezio/host-runtime";

function chromeMajorVersion(): string {
  return (process.versions.chrome || "131.0.0.0").split(".")[0] + ".0.0.0";
}

function platformToken(): string {
  switch (process.platform) {
    case "darwin":
      return "Macintosh; Intel Mac OS X 10_15_7";
    case "win32":
      return "Windows NT 10.0; Win64; x64";
    default:
      return "X11; Linux x86_64";
  }
}

export const CHROME_UA = `Mozilla/5.0 (${platformToken()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajorVersion()} Safari/537.36`;

/** À appeler AVANT app.whenReady() / toute navigation. */
export function installUserAgent(): void {
  const { app } = loadElectron();
  app.userAgentFallback = CHROME_UA;
}
