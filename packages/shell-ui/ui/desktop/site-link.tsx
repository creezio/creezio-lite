"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";

/**
 * Lien vers un **site externe** (outil, portail, marketplace… — le métier
 * est décidé par la marque via libellés UI, pas par ce composant).
 *
 * - App desktop (Electron) : ouvre un onglet workspace puis WebContentsView.
 * - Navigateur web : lien target=_blank.
 */

import { useCallback, type MouseEvent, type ReactNode } from "react";
import {
  openExternalSiteFromWorkspace,
  useTabWorkspaceOptional,
} from "../workspace/tab-workspace-host";

const DEFAULT_EXTERNAL_SITE_TITLE = "Site externe";

export function SiteLink({
  url,
  siteId = 0,
  /** @deprecated → `siteId` */
  fournisseurId,
  className,
  title,
  children,
  "data-creezio-aid": aid,
  /** @deprecated attribut TF — utiliser data-creezio-aid ou brand.aidAttr */
  "data-tf2-aid": aidLegacy,
}: {
  url: string;
  /** Id de partition persistante. 0 = onglet générique (hash host). */
  siteId?: number;
  /** @deprecated → `siteId` */
  fournisseurId?: number;
  className?: string;
  title?: string;
  children: ReactNode;
  "data-creezio-aid"?: string;
  "data-tf2-aid"?: string;
}) {
  const workspace = useTabWorkspaceOptional();
  const resolvedSiteId = siteId || fournisseurId || 0;
  const aidAttr = getShellUiBrand().aidAttr ?? "data-creezio-aid";
  const aidValue = aid ?? aidLegacy;

  const onClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      const api = getShellDesktopApi();
      if (!api) return;
      e.preventDefault();

      let tabTitle = (title || "").trim();
      if (!tabTitle) {
        try {
          tabTitle = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          tabTitle = DEFAULT_EXTERNAL_SITE_TITLE;
        }
      }

      if (workspace?.openExternalSite) {
        openExternalSiteFromWorkspace(workspace, {
          siteId: resolvedSiteId,
          url,
          title: tabTitle,
          navigateUrl: true,
        });
        return;
      }

      api
        .openTab(resolvedSiteId, url)
        .then((res: { siteId?: number; fournisseurId?: number }) => {
          const id = res.siteId ?? res.fournisseurId ?? resolvedSiteId;
          window.location.assign(`/site/${id}`);
        })
        .catch(() => {
          window.open(url, "_blank", "noreferrer");
        });
    },
    [url, resolvedSiteId, title, workspace],
  );

  const extraAid =
    aidValue != null
      ? ({ [aidAttr]: aidValue } as Record<string, string>)
      : undefined;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={className}
      title={title}
      onClick={onClick}
      {...extraAid}
    >
      {children}
    </a>
  );
}
