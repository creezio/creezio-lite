// @ts-nocheck — Electron WebContents/session (shim kit mince, N7)
/**
 * Exécuteur des actions `external_*` (alias déprécié `supplier_*`) sur
 * les onglets sites externes.
 *
 * Architecture hybride (portage de src/components/assistant/ui-driver.tsx) :
 * - ÉNUMÉRATION / RÉSOLUTION des cibles : JavaScript exécuté dans un MONDE
 *   ISOLÉ de la page (executeJavaScriptInIsolatedWorld) — même logique que
 *   la souris virtuelle du CRM (sélecteur interactif, labels, refs stables,
 *   similarité Dice), mais invisible et inaccessible au site tiers.
 * - ENTRÉES : CDP via webContents.debugger (Input.dispatchMouseEvent /
 *   dispatchKeyEvent) → événements TRUSTED, indiscernables d'un vrai
 *   utilisateur (contrairement à dispatchEvent JS).
 *
 * SoT driver : `@creezio/browser-host` — scripts in-page (DRIVER_HELPERS,
 * FAKE_CURSOR_INJECT) et handlers portables derrière `CdpTransport`
 * partagés avec le Chromium sidecar serveur (AUCUN fork de logique).
 * Ce fichier ne garde que l'adaptation Electron (WebContents/debugger)
 * et la gestion des onglets (open_tab / list_tabs / activate).
 */

import type { SupplierTab, SupplierTabManager } from "./browser-tab-manager.js";
import type { WebContents } from "electron";
import {
  DRIVER_HELPERS,
  FAKE_CURSOR_INJECT,
  driverVerbOf,
  runDriverVerb,
  type CdpTransport,
} from "@creezio/browser-host";
import { checkWebHostAllowed } from "@creezio/platform-core";

/** Monde isolé dédié (≠ 0 main world, ≠ mondes des extensions). */
const ISOLATED_WORLD_ID = 1999;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── Évaluation dans le monde isolé ── */

async function evalIsolated<T>(wc: WebContents, expression: string): Promise<T> {
  // DRIVER_HELPERS + FAKE_CURSOR_INJECT sont idempotents — réinjectés à
  // chaque évaluation (contrat CdpTransport.evalIsolated partagé).
  const code = `${DRIVER_HELPERS}\n${FAKE_CURSOR_INJECT}\n(async () => (${expression}))()`;
  return (await wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code }])) as T;
}

/* ── CDP (entrées trusted) ── */

function ensureDebugger(tab: SupplierTab): void {
  const dbg = tab.view.webContents.debugger;
  if (!tab.debuggerAttached || !dbg.isAttached()) {
    dbg.attach("1.3");
    tab.debuggerAttached = true;
  }
}

async function cdp(
  tab: SupplierTab,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  ensureDebugger(tab);
  return (await tab.view.webContents.debugger.sendCommand(method, params)) as Record<
    string,
    unknown
  >;
}

/** Adaptation Electron du transport driver partagé (browser-host). */
function transportFor(tab: SupplierTab): CdpTransport {
  return {
    cdp: (method, params) => cdp(tab, method, params),
    evalIsolated: (expression) =>
      evalIsolated(tab.view.webContents, expression),
    viewport: async () => {
      const bounds = tab.view.getBounds();
      return { width: bounds.width, height: bounds.height };
    },
    fallbackPage: async () => {
      const wc = tab.view.webContents;
      if (wc.isDestroyed()) return { url: "", title: "" };
      return { url: wc.getURL(), title: wc.getTitle() };
    },
  };
}

/** Capture d'écran (PNG base64) — pour la vision LLM (usage futur). */
export async function captureScreenshot(tab: SupplierTab): Promise<string> {
  const res = await cdp(tab, "Page.captureScreenshot", { format: "png" });
  return String(res.data || "");
}

type Result = Record<string, unknown>;

async function pageOf(tab: SupplierTab): Promise<Result> {
  try {
    return await evalIsolated<Result>(
      tab.view.webContents,
      "globalThis.__tfsup.pageContext()",
    );
  } catch {
    return { url: tab.view.webContents.getURL(), title: tab.view.webContents.getTitle() };
  }
}

/* ── Point d'entrée ── */

export type SupplierActionRequest = {
  actionId: string;
  type: string;
  tabId?: string;
  params: Record<string, unknown>;
};

export type SupplierActionHooks = {
  /** Demande à l'UI CRM d'ouvrir/activer l'onglet workspace correspondant. */
  onTabOpened?: (info: {
    tabId: string;
    fournisseurId: number;
    url: string;
    title: string;
  }) => void;
};

/**
 * Exécute une action external_* / supplier_* et retourne un résultat
 * JSON-compatible (même contrat que executeUiAction : jamais de throw).
 */
export async function executeSupplierAction(
  manager: SupplierTabManager,
  req: SupplierActionRequest,
  hooks?: SupplierActionHooks,
): Promise<Result> {
  try {
    const actionType = String(req.type || "").replace(/^supplier_/, "external_");

    if (
      actionType === "external_list_tabs" ||
      req.type === "supplier_list_tabs"
    ) {
      return { ok: true, tabs: manager.list() };
    }

    if (
      actionType === "external_open_tab" ||
      req.type === "supplier_open_tab"
    ) {
      // site_id opaque : entier historique ou UUID marque (string).
      const rawSiteId = req.params.site_id ?? req.params.fournisseur_id ?? 0;
      const siteId: number | string =
        typeof rawSiteId === "string" && rawSiteId.trim() && !Number.isFinite(Number(rawSiteId))
          ? rawSiteId.trim()
          : Number(rawSiteId);
      const url = typeof req.params.url === "string" ? req.params.url : "";
      if (
        typeof siteId === "number" &&
        (!Number.isFinite(siteId) || siteId <= 0)
      ) {
        return { ok: false, error: "site_id invalide" };
      }
      if (!/^https?:\/\//i.test(url)) {
        return { ok: false, error: "url invalide (http(s):// requis)" };
      }
      // H0 — allowlist `*_WEB_ALLOWED_HOSTS` appliquée AU NIVEAU HOST (défense
      // en profondeur : couvre aussi les appels hors runner de tâches).
      const hostCheck = checkWebHostAllowed(url);
      if (!hostCheck.ok) {
        return { ok: false, error: hostCheck.error, code: hostCheck.code };
      }
      const tab = await manager.openTab(siteId, url);
      const page = await pageOf(tab);
      const title =
        typeof page.title === "string" && page.title
          ? page.title
          : tab.view.webContents.getTitle() || url;
      hooks?.onTabOpened?.({
        tabId: tab.tabId,
        fournisseurId: tab.siteId ?? tab.fournisseurId,
        url: tab.view.webContents.getURL() || url,
        title,
      });
      return { ok: true, tabId: tab.tabId, page };
    }

    const tabId = req.tabId || (typeof req.params.tabId === "string" ? req.params.tabId : "");
    const tab = tabId ? manager.get(tabId) : manager.getActive();
    if (!tab) {
      return {
        ok: false,
        error: `Onglet introuvable (tabId=${tabId || "—"}). Faire external_list_tabs (alias supplier_list_tabs) d'abord.`,
        tabs: manager.list(),
      };
    }
    // S'assurer que la vue est celle active (bounds content-area déjà connus).
    manager.activate(tab.tabId);
    hooks?.onTabOpened?.({
      tabId: tab.tabId,
      fournisseurId: tab.fournisseurId,
      url: tab.view.webContents.isDestroyed() ? "" : tab.view.webContents.getURL(),
      title: tab.view.webContents.isDestroyed() ? "" : tab.view.webContents.getTitle(),
    });
    if (tab.view.webContents.isLoading()) {
      await sleep(1500);
    }

    // SoT = external_* ; supplier_* déjà normalisé ci-dessus.
    const verb = driverVerbOf(actionType);
    if (!verb) {
      return { ok: false, error: `Action inconnue: ${req.type}` };
    }
    return await runDriverVerb(transportFor(tab), verb, req.params);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Erreur exécution action site externe",
    };
  }
}
