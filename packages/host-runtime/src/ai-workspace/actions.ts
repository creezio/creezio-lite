// @ts-nocheck — IPC WebContents + hooks marque
/**
 * Exécuteur bridge des actions `ai_workspace_*` (N2 kit).
 * Route vers AiWorkspaceManager (+ supplier-tabs marque via bindings).
 */

import type { AiWorkspaceManager } from "./manager.js";
import type { AiScreencaster } from "./screencast.js";
import type { SupplierActionRequest } from "./types.js";
import { getAiWorkspaceHostBindings } from "./bindings.js";
import { logError } from "../logger.js";

type Result = Record<string, unknown>;

function aiUserIdOf(params: Record<string, unknown>): string {
  const raw =
    params.ai_user_id ?? params.aiUserId ?? params.user_id ?? params.userId;
  return typeof raw === "string" ? raw.trim() : "";
}

async function runSupplierAction(
  tabs: unknown,
  req: SupplierActionRequest,
  hooks?: {
    onTabOpened?: (info: {
      tabId: string;
      fournisseurId: number;
      url: string;
      title: string;
    }) => void;
  },
): Promise<Result> {
  const ex = getAiWorkspaceHostBindings().executeSupplierAction;
  if (!ex) return { ok: false, error: "executeSupplierAction absent" };
  return ex(tabs as never, req, hooks);
}

export async function executeAiWorkspaceAction(
  manager: AiWorkspaceManager,
  req: SupplierActionRequest,
  screencaster?: AiScreencaster,
): Promise<Result> {
  try {
    const type = String(req.type || "");
    const params = req.params || {};
    const aiUserId = aiUserIdOf(params);

    if (type === "ai_workspace_list") {
      return { ok: true, workspaces: manager.list() };
    }

    if (type === "ai_workspace_show_owner") {
      manager.showOwner();
      return { ok: true, active: null };
    }

    if (type === "ai_workspace_ensure") {
      if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
      const token = typeof params.token === "string" ? params.token : "";
      const baseUrl = typeof params.base_url === "string" ? params.base_url : "";
      const label = typeof params.label === "string" ? params.label : aiUserId;
      if (!token || !baseUrl) {
        return { ok: false, error: "token et base_url requis" };
      }
      const info = await manager.ensure({
        userId: aiUserId,
        token,
        baseUrl,
        label,
      });
      if (params.show === true || params.show === "1") {
        manager.show(aiUserId);
      }
      void (async () => {
        try {
          await getAiWorkspaceHostBindings().onWorkspaceEnsured?.(aiUserId);
        } catch (e) {
          logError("ai-workspace", e);
        }
      })();
      return { ok: true, workspace: info };
    }

    if (type === "ai_workspace_show") {
      if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
      try {
        const info = manager.show(aiUserId);
        return { ok: true, workspace: info };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          code: "ai_workspace_missing",
        };
      }
    }

    if (type === "ai_workspace_navigate") {
      if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
      const href =
        (typeof params.href === "string" && params.href) ||
        (typeof params.path === "string" && params.path) ||
        "";
      if (!href.startsWith("/")) {
        return { ok: false, error: "href/path CRM requis (ex. /clients)" };
      }
      try {
        manager.show(aiUserId);
      } catch {
        return {
          ok: false,
          error: "Espace IA absent — ensure d’abord",
          code: "ai_workspace_missing",
        };
      }
      const actionId = req.actionId || `nav-${Date.now()}`;
      return manager.navigateCrm(aiUserId, href, actionId);
    }

    if (type === "ai_workspace_list_tabs") {
      if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
      return { ok: true, tabs: manager.listTabs(aiUserId) };
    }

    if (
      type === "ai_workspace_open_tab" ||
      type === "ai_workspace_supplier_open_tab"
    ) {
      if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
      const tabs = manager.getTabs(aiUserId);
      const view = manager.getView(aiUserId);
      if (!tabs || !view) {
        return {
          ok: false,
          error: "Espace IA absent — ensure d’abord",
          code: "ai_workspace_missing",
        };
      }
      try {
        manager.show(aiUserId);
      } catch (e) {
        logError("ai-workspace", e);
      }
      return runSupplierAction(
        tabs,
        {
          actionId: req.actionId,
          type: "supplier_open_tab",
          tabId: req.tabId,
          params,
        },
        {
          onTabOpened: (info) => {
            try {
              if (!view.webContents.isDestroyed()) {
                view.webContents.send("desktop:supplier-tab-opened", info);
              }
            } catch (e) {
              logError("ai-workspace", e);
            }
          },
        },
      );
    }

    if (type === "ai_workspace_web_action") {
      if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
      const webType =
        (typeof params.web_type === "string" && params.web_type) || "";
      // SoT = external_* ; alias déprécié TF = supplier_*.
      if (
        !webType.startsWith("external_") &&
        !webType.startsWith("supplier_")
      ) {
        return {
          ok: false,
          error: "web_type external_* requis (alias supplier_* accepté)",
        };
      }
      const webParams =
        params.web_params && typeof params.web_params === "object"
          ? (params.web_params as Record<string, unknown>)
          : {};
      const tabs = manager.getTabs(aiUserId);
      if (!tabs) {
        return {
          ok: false,
          error: "Espace IA absent — ensure d’abord",
          code: "ai_workspace_missing",
        };
      }
      try {
        manager.show(aiUserId);
      } catch (e) {
        logError("ai-workspace", e);
      }
      const webTabId =
        typeof params.tab_id === "string" && params.tab_id
          ? params.tab_id
          : req.tabId;
      return runSupplierAction(tabs, {
        actionId: req.actionId,
        type: webType,
        tabId: webTabId,
        params: webParams,
      });
    }

    if (type === "ai_workspace_screencast_start") {
      if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
      if (!screencaster) {
        return { ok: false, error: "Screencast indisponible sur cet hôte" };
      }
      return screencaster.start(aiUserId);
    }

    if (type === "ai_workspace_close") {
      if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
      try {
        void screencaster?.stop(aiUserId);
      } catch (e) {
        logError("ai-workspace", e);
      }
      const closed = manager.closeWorkspace(aiUserId);
      return { ok: true, closed };
    }

    if (type === "ai_workspace_screencast_stop") {
      if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
      if (!screencaster) return { ok: true, already: true };
      return screencaster.stop(aiUserId);
    }

    if (type === "ai_workspace_ui_action") {
      if (!aiUserId) return { ok: false, error: "ai_user_id requis" };
      const uiType =
        (typeof params.ui_type === "string" && params.ui_type) ||
        (typeof params.type === "string" && params.type) ||
        "";
      const uiParams =
        params.ui_params && typeof params.ui_params === "object"
          ? (params.ui_params as Record<string, unknown>)
          : params;
      if (!uiType) return { ok: false, error: "ui_type requis" };
      try {
        manager.show(aiUserId);
      } catch {
        return {
          ok: false,
          error: "Espace IA absent — ensure d’abord",
          code: "ai_workspace_missing",
        };
      }
      return manager.runUiAction(aiUserId, {
        actionId: req.actionId,
        type: uiType,
        params: uiParams,
        tabId: req.tabId,
      });
    }

    return { ok: false, error: `Action IA inconnue: ${type}` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function isAiWorkspaceActionType(type: string): boolean {
  return String(type || "").startsWith("ai_workspace_");
}
