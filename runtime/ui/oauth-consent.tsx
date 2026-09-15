'use client';
import {useState} from 'react';
import {ShieldCheck} from 'lucide-react';
import {Button,Card,Label,Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@lite/shell-ui/ui/kit';
import type {OAuthConsent} from '../core/mcp-oauth';

export function OAuthConsentForm({consent,appName}:{consent:OAuthConsent;appName:string}){
  const [workspace,setWorkspace]=useState(consent.workspaces[0]?.id??''),[scope,setScope]=useState('crm:read');
  const selected=consent.workspaces.find(w=>w.id===workspace),canWrite=consent.scope.includes('crm:write')&&selected?.role!=='viewer';
  return <main className="min-h-screen grid place-items-center bg-background p-4 sm:p-8">
    <Card className="w-full max-w-xl space-y-5 p-6 sm:p-8">
      <ShieldCheck className="h-8 w-8 text-primary" aria-hidden="true"/>
      <div className="space-y-2"><h1 className="text-2xl font-semibold">Connecter {consent.clientName} à {appName}</h1><p className="text-muted-foreground">Compte : {consent.email}</p></div>
      <p>Cette application demande l’accès à vos données. Choisissez l’espace et les actions que vous autorisez.</p>
      <p className="text-sm text-muted-foreground break-all">Application de retour : {consent.redirectOrigin}</p>
      <form action="/oauth/decision" method="post" target="_top" className="space-y-5">
        <input type="hidden" name="request" value={consent.requestId}/><input type="hidden" name="csrf" value={consent.csrf}/>
        {consent.workspaces.length?<>
          <div className="space-y-2"><Label>Espace</Label><Select name="workspace" value={workspace} onValueChange={value=>{setWorkspace(value);setScope('crm:read');}}><SelectTrigger aria-label="Espace autorisé"><SelectValue/></SelectTrigger><SelectContent>{consent.workspaces.map(w=><SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Accès autorisé</Label><Select name="scope" value={scope} onValueChange={setScope}><SelectTrigger aria-label="Accès autorisé"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="crm:read">Lecture seule</SelectItem>{canWrite&&<SelectItem value="crm:read crm:write">Lecture et écriture</SelectItem>}</SelectContent></Select></div>
          <p className="text-sm text-muted-foreground">L’application restera limitée à vos permissions. La connexion peut être révoquée dans l’administration MCP.</p>
        </>:<p role="alert">Ce compte n’a accès à aucun espace. Connectez-vous avec le compte utilisé dans {appName}.</p>}
        <div className="flex justify-end gap-3"><Button type="submit" name="decision" value="deny" variant="outline">Refuser</Button><Button type="submit" name="decision" value="approve" disabled={!workspace}>Autoriser</Button></div>
      </form>
    </Card>
  </main>;
}
