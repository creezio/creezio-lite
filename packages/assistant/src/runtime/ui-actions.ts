/**
 * Actions UI pilotées par l'assistant (souris virtuelle côté navigateur).
 *
 * Aller-retour : la boucle LLM émet un événement SSE `ui_action` → le
 * navigateur (UiDriver) exécute l'action visuellement (faux curseur) →
 * il POST le résultat sur /api/v1/assistant/ui-actions/:id/result →
 * la promesse serveur se résout et le tool retourne le résultat au LLM.
 *
 * Extension desktop (Electron) : les actions `external_*` (alias déprécié
 * `supplier_*`) ciblent les onglets sites externes. Canal SSE historique
 * GET /api/v1/assistant/supplier-actions/stream (nom wire TF — inchangé).
 * Le résultat revient par la même route REST que les actions ui_*.
 *
 * Fonctionne car l'app tourne dans un seul process Node (registre mémoire).
 */

import { randomUUID } from "crypto";
import { desktopOfflineError, isDesktopOnline } from "../brand/desktop-presence-shim.js";

export type UiActionType =
  | "list_targets"
  | "click"
  | "type"
  | "scroll"
  | SupplierActionType;

/** Actions onglet site externe (SoT = external_* ; supplier_* = alias déprécié TF). */
export type ExternalSiteActionType =
  | "external_list_tabs"
  | "external_open_tab"
  | "external_list_targets"
  | "external_click"
  | "external_type"
  | "external_scroll"
  | "external_read"
  | "supplier_list_tabs"
  | "supplier_open_tab"
  | "supplier_list_targets"
  | "supplier_click"
  | "supplier_type"
  | "supplier_scroll"
  | "supplier_read"
  | "open_external_tab"

/** @deprecated → ExternalSiteActionType */
export type SupplierActionType =
  | ExternalSiteActionType
  | "ai_workspace_ensure"
  | "ai_workspace_show"
  | "ai_workspace_show_owner"
  | "ai_workspace_navigate"
  | "ai_workspace_open_tab"
  | "ai_workspace_list_tabs"
  | "ai_workspace_list"
  | "ai_workspace_ui_action"
  | "ai_workspace_web_action"
  | "ai_workspace_screencast_start"
  | "ai_workspace_screencast_stop"
  | "ai_workspace_close";

export type UiActionRequest = {
  actionId: string;
  type: UiActionType;
  /** Onglet site externe ciblé (actions external_* / supplier_*). */
  tabId?: string;
  params: Record<string, unknown>;
  targetUserId?: string;
};

type Pending = {
  resolve: (result: Record<string, unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
};

type SupplierSubscriber = { meta: SupplierSubscriberMeta; fn: (req: UiActionRequest) => void };
export type SupplierSubscriberMeta = { userId: string; deviceId: string; subscriptionId: string };

/** Survit au HMR dev grâce à globalThis ; en prod c'est un simple module singleton. */
const globalStore = globalThis as unknown as {
  __creezioUiActionPending?: Map<string, Pending>;
  __creezioSupplierSubscribers?: Map<string, SupplierSubscriber>;
};
const pending: Map<string, Pending> =
  globalStore.__creezioUiActionPending ?? new Map();
globalStore.__creezioUiActionPending = pending;

const supplierSubscribers: Map<string, SupplierSubscriber> =
  globalStore.__creezioSupplierSubscribers ?? new Map();
globalStore.__creezioSupplierSubscribers = supplierSubscribers;

const ACTION_TIMEOUT_MS = 25000;
/** Sites externes (navigation, chargements) plus lents que le CRM. */
const SUPPLIER_ACTION_TIMEOUT_MS = 45000;

export type EmitFn = (event: string, data: unknown) => void;

/**
 * Émet l'action vers le navigateur (SSE) et attend son résultat.
 * Timeout → résultat d'erreur exploitable par le LLM.
 */
export function dispatchUiAction(
  emit: EmitFn,
  type: UiActionType,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const actionId = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(actionId);
      resolve({
        ok: false,
        error:
          "Navigateur injoignable (pas de réponse en 25s) — l'utilisateur a peut-être fermé la page.",
      });
    }, ACTION_TIMEOUT_MS);
    pending.set(actionId, { resolve, timer });
    emit("ui_action", { actionId, type, params } satisfies UiActionRequest);
  });
}

/**
 * Abonne l'app desktop au flux d'actions sites externes (wire `supplier-actions`).
 * Retourne la fonction de désabonnement.
 */
export function subscribeSupplierActions(fn: (req: UiActionRequest) => void, opts: { userId: string; deviceId?: string }): { unsubscribe: () => void; meta: SupplierSubscriberMeta } {
  const meta = { userId: opts.userId, deviceId: opts.deviceId || "host", subscriptionId: randomUUID() };
  supplierSubscribers.set(meta.subscriptionId, { meta, fn });
  return { meta, unsubscribe: () => supplierSubscribers.delete(meta.subscriptionId) };
}
export const hasSupplierBridgeForUser = (userId: string) => Array.from(supplierSubscribers.values()).some((s) => s.meta.userId === userId) || isDesktopOnline(userId);
export type DispatchSupplierOpts = { targetUserId?: string; requireTargetOnline?: boolean };

/** Vrai si l'app desktop est connectée (au moins un abonné actions site externe). */
export function hasSupplierBridge(): boolean {
  return supplierSubscribers.size > 0;
}

/**
 * Émet une action `external_*` / `supplier_*` vers l'app desktop.
 * Sans app desktop connectée → erreur immédiate exploitable par le LLM.
 */
export function dispatchSupplierAction(
  type: SupplierActionType,
  params: Record<string, unknown>,
  tabId?: string, opts?: DispatchSupplierOpts,
): Promise<Record<string, unknown>> {
  const targetUserId = opts?.targetUserId?.trim();
  const recipients = Array.from(supplierSubscribers.values()).filter((s) => !targetUserId || s.meta.userId === targetUserId);
  if (!recipients.length && targetUserId && opts?.requireTargetOnline) return Promise.resolve(desktopOfflineError(targetUserId));
  if (recipients.length === 0) {
    return Promise.resolve({
      ok: false,
      error:
        "App desktop non connectée — les onglets sites externes ne sont pilotables que depuis l'application de bureau.",
    });
  }
  const actionId = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(actionId);
      resolve({
        ok: false,
        error:
          "App desktop injoignable (pas de réponse en 45s) — l'onglet site externe est peut-être fermé ou la page charge encore.",
      });
    }, SUPPLIER_ACTION_TIMEOUT_MS);
    pending.set(actionId, { resolve, timer });
    const request: UiActionRequest = { actionId, type, params, ...(tabId ? { tabId } : {}), ...(targetUserId ? { targetUserId } : {}) };
    recipients.forEach(({ fn }) => {
      try {
        fn(request);
      } catch {
        /* un abonné mort ne doit pas bloquer les autres */
      }
    });
  });
}

/** Appelé par la route REST quand le navigateur renvoie le résultat. */
export function resolveUiAction(
  actionId: string,
  result: Record<string, unknown>,
): boolean {
  const entry = pending.get(actionId);
  if (!entry) return false;
  pending.delete(actionId);
  clearTimeout(entry.timer);
  entry.resolve(result);
  return true;
}

export const UI_TOOL_NAMES = new Set([
  "ui_list_targets",
  "ui_click",
  "ui_type",
  "ui_scroll",
]);

export const EXTERNAL_SITE_TOOL_NAMES = new Set([
  "external_list_tabs",
  "external_open_tab",
  "external_list_targets",
  "external_click",
  "external_type",
  "external_scroll",
  "external_read",
  "supplier_list_tabs",
  "supplier_open_tab",
  "supplier_list_targets",
  "supplier_click",
  "supplier_type",
  "supplier_scroll",
  "supplier_read",
  "open_external_tab",
  "ai_workspace_ensure",
  "ai_workspace_show",
  "ai_workspace_navigate",
  "ai_workspace_open_tab",
  "ai_workspace_list_tabs",
]);

/** @deprecated → EXTERNAL_SITE_TOOL_NAMES */
export const SUPPLIER_TOOL_NAMES = EXTERNAL_SITE_TOOL_NAMES;

/** Façade unifiée — routée vers ui_* ou supplier_* selon activeSurface. */
export const SURFACE_TOOL_NAMES = new Set([
  "surface_list_targets",
  "surface_click",
  "surface_type",
  "surface_scroll",
  "surface_read",
]);

export function isUiTool(name: string): boolean {
  return UI_TOOL_NAMES.has(name);
}

export function isExternalSiteTool(name: string): boolean {
  return EXTERNAL_SITE_TOOL_NAMES.has(name);
}

/** @deprecated → isExternalSiteTool */
export function isSupplierTool(name: string): boolean {
  return isExternalSiteTool(name);
}

/** Mappe external_* / supplier_* → verbe driver. */
export function externalSiteToolVerb(
  name: string,
):
  | "list_tabs"
  | "open_tab"
  | "list_targets"
  | "click"
  | "type"
  | "scroll"
  | "read"
  | null {
  const n = name.replace(/^supplier_/, "external_");
  switch (n) {
    case "external_list_tabs":
      return "list_tabs";
    case "external_open_tab":
      return "open_tab";
    case "external_list_targets":
      return "list_targets";
    case "external_click":
      return "click";
    case "external_type":
      return "type";
    case "external_scroll":
      return "scroll";
    case "external_read":
      return "read";
    default:
      return null;
  }
}

export function isSurfaceTool(name: string): boolean {
  return SURFACE_TOOL_NAMES.has(name);
}

/** Mappe surface_* → verbe ui/supplier (list_targets, click, …). */
export function surfaceToolVerb(
  name: string,
): "list_targets" | "click" | "type" | "scroll" | "read" | null {
  switch (name) {
    case "surface_list_targets":
      return "list_targets";
    case "surface_click":
      return "click";
    case "surface_type":
      return "type";
    case "surface_scroll":
      return "scroll";
    case "surface_read":
      return "read";
    default:
      return null;
  }
}
