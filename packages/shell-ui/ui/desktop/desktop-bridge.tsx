"use client";

import { getShellDesktopApi } from "@creezio/shell-ui";

/**
 * Pont desktop global (monté dans WorkspaceRoot, no-op en web).
 *
 * Écoute les ouvertures d’onglet **site externe** depuis le process principal
 * Electron (`onExternalTabOpened` / alias déprécié `onSupplierTabOpened`)
 * → active l’onglet workspace correspondant.
 */

import { useEffect, useRef } from "react";
import {
  useTabWorkspaceOptional,
  openExternalSiteFromWorkspace,
  type OpenExternalSiteOpts,
} from "../workspace/tab-workspace-host";

const DEFAULT_EXTERNAL_SITE_TITLE = "Site externe";

function titleFromInfo(url: string, rawTitle?: string): string {
  const t = (rawTitle || "").trim();
  if (t) return t;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return DEFAULT_EXTERNAL_SITE_TITLE;
  }
}

function resolveOpenFn(workspace: any): ((opts: OpenExternalSiteOpts) => void) | null {
  if (!workspace) return null;
  return workspace.openExternalSite ?? null;
}

export function DesktopBridge() {
  const workspace = useTabWorkspaceOptional();
  const openRef = useRef(resolveOpenFn(workspace));
  const readyRef = useRef(Boolean(workspace?.ready));
  const pendingRef = useRef<OpenExternalSiteOpts[]>([]);
  openRef.current = resolveOpenFn(workspace);
  readyRef.current = Boolean(workspace?.ready);

  useEffect(() => {
    const open = resolveOpenFn(workspace);
    if (!workspace?.ready || !open) return;
    const pending = pendingRef.current;
    if (!pending.length) return;
    pendingRef.current = [];
    for (const opts of pending) open(opts);
  }, [workspace?.ready, workspace]);

  useEffect(() => {
    const api = getShellDesktopApi();
    // SoT : onExternalTabOpened ; alias déprécié onSupplierTabOpened
    const subscribe =
      api?.onExternalTabOpened ?? api?.onSupplierTabOpened;
    if (!subscribe) return;
    return subscribe((info: {
      siteId?: number;
      /** @deprecated → siteId */
      fournisseurId?: number;
      url: string;
      title?: string;
      tabId?: string;
      electronTabId?: string;
    }) => {
      const opts: OpenExternalSiteOpts = {
        siteId: info.siteId ?? info.fournisseurId ?? 0,
        url: info.url,
        title: titleFromInfo(info.url, info.title),
        electronTabId: info.electronTabId ?? info.tabId,
      };
      if (readyRef.current && openRef.current) {
        openRef.current(opts);
      } else {
        pendingRef.current.push(opts);
      }
    });
  }, []);

  return null;
}

/** @deprecated — préférer openExternalSiteFromWorkspace */
export { openExternalSiteFromWorkspace };
