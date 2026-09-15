/**
 * Routage observation/action selon activeSurface.
 * Pure (pas d'I/O) — testable hors Electron.
 */

import {
  isExternalActiveSurface,
  type ActiveSurface,
} from "./active-surface.js";
import {
  isSurfaceTool,
  isUiTool,
  surfaceToolVerb,
  type SupplierActionType,
  type UiActionType,
} from "./ui-actions.js";

export type SurfaceRoute =
  | {
      /** SoT `external` ; alias wire `supplier` encore émis en dual-compat. */
      kind: "external" | "supplier";
      tool: SupplierActionType;
      tabId?: string;
      args: Record<string, unknown>;
    }
  | {
      kind: "crm";
      tool: UiActionType;
      args: Record<string, unknown>;
    }
  | {
      kind: "reject";
      error: string;
      hint?: string;
    };

/**
 * Décide où envoyer un tool surface_* / ui_* / supplier_* selon la surface.
 * Ne dispatch pas — pure décision.
 */
export function routeSurfaceTool(
  name: string,
  args: Record<string, unknown>,
  activeSurface: ActiveSurface | null | undefined,
): SurfaceRoute {
  if (isSurfaceTool(name)) {
    const verb = surfaceToolVerb(name);
    if (!verb) {
      return { kind: "reject", error: `outil surface inconnu: ${name}` };
    }
    const overrideTab =
      typeof args.tabId === "string" && args.tabId ? args.tabId : undefined;
    const surfaceTab =
      isExternalActiveSurface(activeSurface)
        ? activeSurface.tabId || undefined
        : undefined;
    const tabId = overrideTab || surfaceTab;
    const preferSupplier =
      Boolean(overrideTab) || isExternalActiveSurface(activeSurface);

    if (preferSupplier) {
      if (!tabId) {
        return {
          kind: "reject",
          error:
            "Surface site externe sans tabId — appelle d'abord external_list_tabs / supplier_list_tabs ou rouvre l'onglet site.",
          hint: "activeSurface.tabId manquant",
        };
      }
      return {
        kind: "external",
        tool: `external_${verb}` as SupplierActionType,
        tabId,
        args: { ...args, tabId },
      };
    }

    if (verb === "read") {
      return { kind: "crm", tool: "list_targets", args };
    }
    return { kind: "crm", tool: verb as UiActionType, args };
  }

  if (isUiTool(name)) {
    if (isExternalActiveSurface(activeSurface)) {
      return {
        kind: "reject",
        error:
          "Surface active = site externe. Utilise surface_* (ou external_* / supplier_*) — ui_* ne voit pas le site externe (slot /site/<id> vide).",
        hint: "Appelle surface_list_targets puis surface_type / surface_click.",
      };
    }
    return {
      kind: "crm",
      tool: name.replace(/^ui_/, "") as UiActionType,
      args,
    };
  }

  return { kind: "reject", error: `outil non routable: ${name}` };
}

/**
 * Shrink ContentRect pour le chrome assistant **panel ouvert** (push layout).
 * Panel fermé : chromeRightPx = 0 — le FAB Electron est topmost, pas un gutter.
 */
export function contentRectWithAssistantSafeArea(
  rect: { x: number; y: number; width: number; height: number },
  opts: {
    windowWidth: number;
    chromeRightPx: number;
  },
): { x: number; y: number; width: number; height: number } {
  if (opts.chromeRightPx <= 0) return { ...rect };
  const maxRight = opts.windowWidth - opts.chromeRightPx;
  const right = rect.x + rect.width;
  if (right <= maxRight) return { ...rect };
  const width = Math.max(1, maxRight - rect.x);
  return { x: rect.x, y: rect.y, width, height: rect.height };
}
