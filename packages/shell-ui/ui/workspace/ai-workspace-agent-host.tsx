"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";

/**
 * Bus agent dans chaque vue CRM (surtout partitions IA).
 * Reçoit navigate / ui-action depuis le main Electron et exécute le
 * même pipeline fake-cursor que le chat (UiDriver), puis ACK IPC.
 */

import { useEffect } from "react";
import { runUiAction, runUiNavigate } from "@creezio/assistant/ui";
import { useTabWorkspace } from "./tab-workspace-host";

export function AiWorkspaceAgentHost() {
  const { navigate } = useTabWorkspace();

  useEffect(() => {
    const api = typeof window !== "undefined" ? getShellDesktopApi() : undefined;
    if (!api?.onAiWorkspaceNavigate && !api?.onAiWorkspaceUiAction) return;

    const offNav = api.onAiWorkspaceNavigate?.((ev: { href: string; actionId?: string }) => {
      void (async () => {
        const result = await runUiNavigate(ev.href, (href) => {
          navigate(href, { newTab: false });
        });
        api.ackAiWorkspaceAction?.(ev.actionId, result);
      })();
    });

    const offUi = api.onAiWorkspaceUiAction?.((ev: { type: string; params: Record<string, unknown>; actionId?: string }) => {
      void (async () => {
        let result: Record<string, unknown>;
        if (ev.type === "navigate") {
          const href =
            (typeof ev.params.href === "string" && ev.params.href) ||
            (typeof ev.params.path === "string" && ev.params.path) ||
            "";
          result = await runUiNavigate(href, (h) => navigate(h, { newTab: false }));
        } else {
          result = await runUiAction({ type: ev.type, params: ev.params || {} });
        }
        api.ackAiWorkspaceAction?.(ev.actionId, result);
      })();
    });

    return () => {
      offNav?.();
      offUi?.();
    };
  }, [navigate]);

  return null;
}
