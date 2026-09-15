/**
 * Commandes de surface native (WebContentsView) dérivées de l'onglet workspace.
 * Pur / testable - pas d'Electron.
 *
 * Quitter un onglet site externe -> showCrm (masquer Chromium).
 * Entrer / revenir sur un onglet site externe avec electronTabId -> activate.
 */

export type ExternalSiteSurfaceSignal =
  | { type: "leave-external" }
  | { type: "enter-external"; electronTabId?: string | null };

export type ExternalSiteSurfaceCommand =
  | { type: "show-crm" }
  | { type: "activate"; tabId: string }
  | { type: "noop" };

/**
 * Réduit le signal workspace -> commande IPC desktop.
 * Symétrique : leave = showCrm, enter avec id = activate, enter sans id = noop
 * (le slot ouvrira via openTab).
 */
export function reduceExternalSiteSurfaceCommand(
  signal: ExternalSiteSurfaceSignal,
): ExternalSiteSurfaceCommand {
  if (signal.type === "leave-external") {
    return { type: "show-crm" };
  }
  const id = String(signal.electronTabId || "").trim();
  if (!id) return { type: "noop" };
  return { type: "activate", tabId: id };
}

/**
 * @deprecated Use ExternalSiteSurfaceSignal with leave-external/enter-external.
 */
export type SupplierSurfaceSignal =
  | { type: "leave-supplier" }
  | { type: "enter-supplier"; electronTabId?: string | null };

/** @deprecated Use ExternalSiteSurfaceCommand. */
export type SupplierSurfaceCommand = ExternalSiteSurfaceCommand;

/** @deprecated Use reduceExternalSiteSurfaceCommand. */
export function reduceSupplierSurfaceCommand(
  signal: SupplierSurfaceSignal | ExternalSiteSurfaceSignal,
): ExternalSiteSurfaceCommand {
  if (signal.type === "leave-supplier") {
    return reduceExternalSiteSurfaceCommand({ type: "leave-external" });
  }
  if (signal.type === "enter-supplier") {
    return reduceExternalSiteSurfaceCommand({
      type: "enter-external",
      electronTabId: signal.electronTabId,
    });
  }
  return reduceExternalSiteSurfaceCommand(signal);
}
