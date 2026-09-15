"use client";

import { useEffect, type ReactNode } from "react";
import {
  configureShellUiBrand,
  installCreezioDataChangedFetch,
  type ShellUiLoginBrand,
} from "@creezio/shell-ui";
import type { InteractiveDemoRootProps } from "@creezio/interactive-demo/ui";
import "@creezio/interactive-demo/ui/interactive-demo.css";

export type CreezioUiBootProps = {
  children: ReactNode;
  /** Global bridge Electron (ex. acmeDesktop). */
  desktopApiGlobal: string;
  productName: string;
  publicHostSuffix: string;
  /**
   * Panneau brand de la page login split-screen (@creezio/auth LoginPage).
   * Absent = défaut neutre (gradient encre, tuile initiale, pas de tagline).
   */
  login?: ShellUiLoginBrand;
  /**
   * @deprecated Le lecteur unique vit dans BrandChrome (SessionProvider).
   * Conservé pour ne pas casser les props existantes ; ignoré ici.
   */
  interactiveDemo?: InteractiveDemoRootProps;
};

/**
 * Boot client OS — identity desktop + tokens shell-ui + fetch → bus data.
 * Le lecteur démo (`InteractiveDemoRoot`) est monté **une fois** dans le
 * BrandChrome factory, à l'intérieur de `SessionProvider` (rôle / userKey).
 * Ne pas remonter un second root ici (double curseur / Foove #101).
 *
 * configureShellUiBrand est appelé AU RENDER (parent avant enfants) pour que
 * la marque soit correcte dès le 1er paint de /login — zéro flash du défaut.
 * Idempotent : configureShellUiBrand no-op si rien ne change (StrictMode OK).
 */
export function CreezioUiBoot({
  children,
  desktopApiGlobal,
  productName,
  publicHostSuffix,
  login,
}: CreezioUiBootProps) {
  configureShellUiBrand({
    desktopApiGlobal,
    productName,
    publicHostSuffix,
    login,
  });
  useEffect(() => {
    installCreezioDataChangedFetch();
  }, []);
  return <>{children}</>;
}
