"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { getShellDesktopApi } from "@creezio/shell-ui";
import {
  AssistantProvider,
  AssistantWidget,
  UiDriver,
} from "@creezio/assistant/ui";
import { DesktopBridge } from "../desktop/desktop-bridge";
import { AuthWindowChrome } from "../desktop/auth-window-chrome";
import { AiWorkspaceAgentHost } from "./ai-workspace-agent-host";
import { AiWorkspaceBanner } from "./ai-workspace-banner";
import { ImpersonationBanner } from "./impersonation-banner";
import { TabWorkspaceProvider } from "./tab-workspace-context";
import { WorkspaceShell } from "./workspace-shell";

function isAuthSurface(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/setup" ||
    pathname.startsWith("/setup/") ||
    pathname === "/onboarding" ||
    pathname.startsWith("/onboarding/")
  );
}

function isServerCockpitSurface(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === "/server-cockpit" || pathname.startsWith("/server-cockpit/")
  );
}

/**
 * Surfaces publiques « bare » (ADR-module-natif-hybride) : rendu sans aucun
 * chrome OS (sidebar, onglets, assistant). Cas actuel : la landing page
 * @creezio/landing servie sur /lp, ou via le host public lp.{zone} (le
 * middleware marque réécrit / → /lp mais usePathname garde l'URL navigateur).
 */
function isPublicBareSurface(pathname: string | null): boolean {
  if (pathname === "/lp" || pathname?.startsWith("/lp/")) return true;
  if (
    typeof window !== "undefined" &&
    window.location.hostname.toLowerCase().startsWith("lp.")
  ) {
    return true;
  }
  return false;
}

function defaultHideAssistantOn(pathname: string | null): boolean {
  return (
    isAuthSurface(pathname) ||
    isServerCockpitSurface(pathname) ||
    isPublicBareSurface(pathname)
  );
}

export function WorkspaceRoot({
  children,
  wrapWorkspace,
  banners,
  sidebar,
  footbar,
  afterShell,
  hideAssistantOn = defaultHideAssistantOn,
}: {
  children: ReactNode;
  wrapWorkspace?: (node: ReactNode) => ReactNode;
  banners?: ReactNode;
  sidebar?: ReactNode;
  footbar?: ReactNode;
  /** Slot ADDITIF rendu après le chrome par défaut (assistant inclus) —
   *  ne remplace PAS le widget assistant (pour le masquer : hideAssistantOn). */
  afterShell?: ReactNode;
  hideAssistantOn?: (pathname: string | null) => boolean;
}) {
  const pathname = usePathname();
  const authSurface = isAuthSurface(pathname);
  const serverCockpit = isServerCockpitSurface(pathname);
  const hideAssistant = hideAssistantOn(pathname);

  // Hors session / cockpit serveur : masquer le FAB Electron topmost.
  useEffect(() => {
    if (!hideAssistant) return;
    void getShellDesktopApi()?.setAssistantChrome?.("hidden");
  }, [hideAssistant]);

  // Surface publique (ex. landing /lp) : contenu nu, aucun shell ni assistant.
  if (isPublicBareSurface(pathname)) {
    return <>{children}</>;
  }

  const content = authSurface ? (
    <AuthWindowChrome>{children}</AuthWindowChrome>
  ) : serverCockpit ? (
    <AuthWindowChrome variant="dark">{children}</AuthWindowChrome>
  ) : (
    children
  );

  const shell = (
    <WorkspaceShell sidebar={sidebar} footbar={footbar}>
      {hideAssistant ? null : <AiWorkspaceBanner />}
      <ImpersonationBanner />
      {banners}
      {content}
    </WorkspaceShell>
  );

  const wrappedShell = wrapWorkspace ? wrapWorkspace(shell) : shell;
  // afterShell est un slot ADDITIF : il s'insère APRÈS le chrome par défaut
  // (bridge desktop, widget assistant, UiDriver, agent host). Le remplacer
  // ferait disparaître l'assistant — régression prod constatée (une marque y
  // montait sa cloche d'alertes et perdait FAB + panneau chat).
  const defaultAfterShell = (
    <>
      <DesktopBridge />
      {hideAssistant ? null : (
        <>
          <AssistantWidget />
          <UiDriver />
          <AiWorkspaceAgentHost />
        </>
      )}
      {afterShell}
    </>
  );

  // AssistantProvider DOIT envelopper WorkspaceShell + AssistantWidget :
  // les deux appellent useAssistantUi() du même module kit. Un provider
  // marque local (createContext jumeau) ne suffit PAS — crash prod
  // « useAssistantUi must be used within AssistantProvider ».
  return (
    <AssistantProvider>
      <TabWorkspaceProvider>
        {wrappedShell}
        {defaultAfterShell}
      </TabWorkspaceProvider>
    </AssistantProvider>
  );
}
