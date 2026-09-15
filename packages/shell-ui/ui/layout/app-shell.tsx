"use client";

import { useEffect, type ReactNode } from "react";
import { usePaneActive, usePaneHref } from "../workspace/keep-alive";
import { useTabWorkspaceOptional } from "../workspace/tab-workspace-host";
import type { PageKind, TrailCrumb } from "../workspace/types";
import { useRegisterPageToolbar } from "./page-toolbar-context";

/**
 * Cadre de page CRM — API unique.
 *
 * `title` → label d'onglet (toujours).
 * `kind="section"` → bandeau toolbar sous les onglets (recherche + actions).
 * `kind="entity"` → fil d'Ariane dans le bandeau ; titre via EntityHeader.
 */
export function AppShell({
  children,
  title,
  subtitle,
  kind = "section",
  trail,
  fullscreen,
  actions,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  kind?: PageKind;
  /** Fil d'Ariane sticky — requis si kind=entity. */
  trail?: TrailCrumb[];
  /** Canvas plein écran — masque le bandeau sous les onglets. */
  fullscreen?: boolean;
  /** Boutons / toggles affichés à droite du bandeau sticky. */
  actions?: ReactNode;
}) {
  const workspace = useTabWorkspaceOptional();
  const paneHref = usePaneHref();
  const paneActive = usePaneActive();
  const ready = workspace?.ready ?? false;
  const setTabMeta = workspace?.setTabMeta;
  const targetHref = paneHref ?? workspace?.currentHref ?? null;
  const trailKey = JSON.stringify(trail ?? null);

  useRegisterPageToolbar(paneActive ? targetHref : null, actions);

  useEffect(() => {
    if (!ready || !setTabMeta || !targetHref) return;
    setTabMeta(targetHref, {
      title,
      subtitle,
      kind,
      trail: trailKey ? (JSON.parse(trailKey) as TrailCrumb[]) : undefined,
      fullscreen,
    });
  }, [ready, setTabMeta, targetHref, title, subtitle, kind, trailKey, fullscreen]);

  return <div className="contents">{children}</div>;
}
