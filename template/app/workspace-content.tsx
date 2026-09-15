"use client";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '@lite/auth/ui';
import { AppShell } from '@lite/shell-ui/ui';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@lite/shell-ui/ui/kit';
import { createClient, useLoad } from '@/runtime/ui/client';
import { ModuleView, State } from '@/runtime/ui/module-view';
import { FilesView, TeamView, AuditView, SettingsView } from '@/runtime/ui/system-views';
import { subscribeDataChanged } from '@lite/shell-ui';
import type { Workspace } from '@/runtime/core';
import { appDefinition } from './app-definition';
const names:Record<string,string>={documents:'Documents',collaborateurs:'Collaborateurs',parametres:'Préférences',activity:'Activité'};
export function WorkspaceContent({page}:{page:string}) {
  const {me}=useSession(),api=useMemo(()=>createClient(''),[]),[revision,setRevision]=useState(0);
  const refresh=useCallback(()=>setRevision(r=>r+1),[]);
  const {data,error,loading}=useLoad<{workspace:Workspace}>(()=>api('modules'),[api,revision]);
  const module=appDefinition.modules.find(m=>m.id===page),title=module?.name??names[page]??page;
  useEffect(()=>subscribeDataChanged(refresh,{resource:page}),[refresh,page]);
  async function changed(id?:string){if(id){await api('workspaces/select',{method:'POST',body:JSON.stringify({workspaceId:id})});location.assign('/dashboard');}else refresh();}
  return <AppShell title={title}><State error={error} loading={loading}/>{data&&<>
    {module?<ModuleView module={module} api={api} role={data.workspace.role} revision={revision} onMutation={refresh}/>:page==='documents'?<FilesView api={api} workspace={data.workspace} revision={revision} onMutation={refresh}/>:page==='collaborateurs'?<TeamView api={api} workspace={data.workspace} revision={revision} onMutation={refresh}/>:page==='activity'?<AuditView api={api} revision={revision}/>:page==='parametres'?<><WorkspaceSelector current={data.workspace.id}/><SettingsView api={api} workspace={data.workspace} onChanged={changed}/></>:<p>Page introuvable.</p>}
  </>}</AppShell>;
}
function WorkspaceSelector({current}:{current:string}){
  const api=useMemo(()=>createClient(''),[]),[error,setError]=useState('');const {data}=useLoad<{workspaces:Workspace[]}>(()=>api('session'),[api]);
  return <div className="px-6 pt-6 max-w-sm"><Select value={current} onValueChange={id=>{void api('workspaces/select',{method:'POST',body:JSON.stringify({workspaceId:id})}).then(()=>location.assign('/dashboard')).catch(e=>setError(e.message));}}><SelectTrigger aria-label="Espace de travail"><SelectValue/></SelectTrigger><SelectContent>{data?.workspaces.map(w=><SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select><State error={error}/></div>;
}
export function InvitationDialog(){
  const {me}=useSession(),api=useMemo(()=>createClient(''),[]),[token,setToken]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(/^#invite=[a-f0-9]{64}$/.test(location.hash)){setToken(location.hash.slice(8));history.replaceState(null,'',location.pathname);}},[]);
  if(!me)return null;
  return <Dialog open={Boolean(token)} onOpenChange={o=>{if(!o&&!busy)setToken('');}}><DialogContent><DialogHeader><DialogTitle>Rejoindre un espace</DialogTitle><DialogDescription>Acceptez cette invitation avec votre compte ChatGPT.</DialogDescription></DialogHeader><State error={error}/><Button disabled={busy} onClick={()=>{setBusy(true);void api('invites/accept',{method:'POST',body:JSON.stringify({token})}).then(r=>api('workspaces/select',{method:'POST',body:JSON.stringify({workspaceId:r.workspaceId})})).then(()=>location.assign('/dashboard')).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>{busy?'Vérification…':'Accepter l’invitation'}</Button></DialogContent></Dialog>;
}
