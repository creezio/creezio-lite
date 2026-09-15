"use client";

import { useEffect, type ReactNode } from "react";
import {
  configureShellUiBrand,
  installLiteDataChangedFetch,
  type ShellUiLoginBrand,
} from "@lite/shell-ui";
import type { InteractiveDemoRootProps } from "@lite/interactive-demo/ui";
import "@lite/interactive-demo/ui/interactive-demo.css";

export type LiteUiBootProps = {
  children: ReactNode;
  /** Global bridge Electron (ex. acmeDesktop). */
  desktopApiGlobal: string;
  productName: string;
  publicHostSuffix: string;
  /**
   * Panneau brand de la page login split-screen (@lite/auth LoginPage).
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
export function LiteUiBoot({
  children,
  desktopApiGlobal,
  productName,
  publicHostSuffix,
  login,
}: LiteUiBootProps) {
  configureShellUiBrand({
    desktopApiGlobal,
    productName,
    publicHostSuffix,
    login,
  });
  useEffect(() => {
    installLiteDataChangedFetch();
  }, []);
  return <>{children}</>;
}
