"use client";

import { SessionUsageAnalyticsProvider } from "@/runtime/modules/observability/ui/session-usage-analytics-provider";
import { InvitationDialog } from "./workspace-content";
import { useEffect, useMemo, type ReactNode } from "react";
import { emitDataChanged } from "@lite/shell-ui";
import { registerServerTools, type ModelContext } from "@/runtime/ui/webmcp";
import { createClient } from "@/runtime/ui/client";
import { appDefinition } from "./app-definition";
import { SessionProvider, RequireSession, useSession } from "@lite/auth/ui";
import { LiteUiBoot } from "@lite/os-ui/boot";
import { InteractiveDemoRoot } from "@lite/interactive-demo/ui";
import {
  configureSidebar, configureDefaultNewTabHref, configureSidebarCollapsedKey,
  configureGlobalSearch, defaultOsAdminNavItems, getSidebarHost,
  NavCatalogLoader, WorkspaceRoot, Toaster,
} from "@lite/shell-ui/ui";
import brand from "@/brand.json";
import { WorkspacePaneRouterContext } from "../runtime/modules/shell-ui/ui/workspace/keep-alive";
import { SitesPaneRouter } from "./sites-pane-router";
import { moduleRegistry } from "@/runtime/core/registry";

const registeredModules=moduleRegistry(appDefinition);
const available = new Set(["/dashboard", "/parametres", "/admin/nav", "/admin/activity", "/admin/analytics", "/admin/api", "/admin/mcp", "/admin/access", "/admin/search", "/admin/connections", "/search", ...registeredModules.map(m => m.href)]);
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
  persistHistory:false,
  placeholder:"Rechercher dans les données…",
  indexLabels:{...Object.fromEntries(registeredModules.map(m=>[m.id,m.name])),pages:'Navigation',results:'Tous les résultats'},
  search: async (query,signal) => {
    for(let batch=0;batch<40;batch++){
      const response=await fetch(`/api/v1/search?q=${encodeURIComponent(query)}&limit=100`,{signal,cache:'no-store'});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error?.message??'Recherche indisponible.');
      if(!result.indexing)return [
        ...result.items,...(result.pages??[]),
        ...(result.total>100?[{index:'results',id:'all',title:`Voir les ${result.total} résultats`,description:'Parcourir tous les résultats',href:`/search?q=${encodeURIComponent(query)}`}]:[]),
      ].map((hit:any)=>({...hit,subtitle:hit.description}));
    }
    throw new Error('L’indexation des données existantes se poursuit. Relancez la recherche dans un instant.');
  },
});

function DemoInSession() {
  const {me}=useSession();
  return <InteractiveDemoRoot launcher="sidebar" userKey={me?.user} role={me?.brandRole}/>;
}

/** The factory's original providers and WorkspaceRoot own the chrome. */
export function BrandChrome({children}:{children:ReactNode}) {
  return <LiteUiBoot desktopApiGlobal={`${brand.id}Desktop`} productName={brand.name} publicHostSuffix="chatgpt.site" login={{tagline:brand.description}}>
    <SessionProvider>
      <RequireSession>
        <NavCatalogLoader includePlugins={false} adminFromCatalog/>
        <SessionTools/>
        <SessionUsageAnalyticsProvider><></></SessionUsageAnalyticsProvider>
        <WorkspacePaneRouterContext.Provider value={SitesPaneRouter}>
          <WorkspaceRoot hideAssistantOn={()=>true}>{children}</WorkspaceRoot>
        </WorkspacePaneRouterContext.Provider>
      </RequireSession>
      <DemoInSession/>
      <InvitationDialog/>
      <Toaster/>
    </SessionProvider>
  </LiteUiBoot>;
}

function SessionTools(){
  const {me}=useSession(),api=useMemo(()=>createClient(''),[]);
  useEffect(()=>{if(!me)return;const context=(document as Document&{modelContext?:ModelContext}).modelContext;
    if(context?.registerTool)return registerServerTools(context,api,()=>{for(const m of appDefinition.modules)emitDataChanged({resource:m.id,source:'webmcp'});});
  },[api,me]);
  return null;
}
