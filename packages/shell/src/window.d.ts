/**
 * Augmentation Window générique — les apps brancheront leur alias
 * (`acmeDesktop` / `certivanDesktop` / `fiduDesktop`) en Phase G.
 *
 * Ici on expose seulement un index optionnel pour le kit.
 */
import type { DesktopBridge } from "./types.js";

declare global {
  interface Window {
    /** Alias générique kit (tests / console). Les marques utilisent leur bridgeName. */
    creezioDesktop?: DesktopBridge;
  }
}

export {};
