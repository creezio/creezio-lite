"use client";

import { InvitationDialog } from "./workspace-content";
import { useEffect, useMemo, type ReactNode } from "react";
import { emitDataChanged } from "@creezio/shell-ui";
import { registerLiteTools, type ModelContext } from "@/creezio/ui/webmcp";
import { createClient } from "@/creezio/ui/client";
import { appDefinition } from "./app-definition";
import { SessionProvider, RequireSession, useSession } from "@creezio/auth/ui";
import { CreezioUiBoot } from "@creezio/os-ui/boot";
import { InteractiveDemoRoot } from "@creezio/interactive-demo/ui";
import {
  configureSidebar, configureDefaultNewTabHref, configureSidebarCollapsedKey,
  configureGlobalSearch, defaultOsAdminNavItems, getSidebarHost,
  NavCatalogLoader, WorkspaceRoot, Toaster,
} from "@creezio/shell-ui/ui";
import brand from "@/brand.json";

const available = new Set(["/dashboard", "/taches", "/support", "/documents", "/collaborateurs", "/parametres", "/admin/nav", "/admin/activity", ...brand.modules.map(m => `/${m.id}`)]);
configureSidebar({
  getNavItems: () => [],
  getAdminItems: () => defaultOsAdminNavItems({includePlugins:false}).filter(item => available.has(item.href)),
  canShowHref: href => available.has(href),
  renderTools: () => null,
  logoutHref: "/signout-with-chatgpt?return_to=%2Flogin",
  allowImpersonation: false,
});
configureDefaultNewTabHref("/dashboard");
configureSidebarCollapsedKey(`${brand.id}-sidebar-collapsed`);
configureGlobalSearch({
  storageKey:`${brand.id}-search`,
  placeholder:"Rechercher une page…",
  search: async query => {
    const q=query.trim().toLocaleLowerCase('fr');
    return getSidebarHost().getNavItems().filter(n=>n.label.toLocaleLowerCase('fr').includes(q)).map(n=>({index:'pages',id:n.href,title:n.label,href:n.href}));
  },
});

function DemoInSession() {
  const {me}=useSession();
  return <InteractiveDemoRoot launcher="sidebar" userKey={me?.user} role={me?.brandRole}/>;
}

/** The factory's original providers and WorkspaceRoot own the chrome. */
export function BrandChrome({children}:{children:ReactNode}) {
  return <CreezioUiBoot desktopApiGlobal={`${brand.id}Desktop`} productName={brand.name} publicHostSuffix="chatgpt.site" login={{tagline:brand.description}}>
    <SessionProvider>
      <RequireSession>
        <NavCatalogLoader includePlugins={false} adminFromCatalog/>
        <SessionTools/>
        <WorkspaceRoot hideAssistantOn={()=>true}>{children}</WorkspaceRoot>
      </RequireSession>
      <DemoInSession/>
      <InvitationDialog/>
      <Toaster/>
    </SessionProvider>
  </CreezioUiBoot>;
}

function SessionTools(){
  const {me}=useSession(),api=useMemo(()=>createClient(''),[]);
  useEffect(()=>{if(!me)return;const context=(document as Document&{modelContext?:ModelContext}).modelContext;
    if(context?.registerTool)return registerLiteTools(context,api,appDefinition.modules.filter(m=>me.permissions.includes(`module.${m.id}.read`)),()=>{for(const m of appDefinition.modules)emitDataChanged({resource:m.id,source:'webmcp'});});
  },[api,me]);
  return null;
}
