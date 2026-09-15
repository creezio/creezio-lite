'use client';
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Button, Card, Input } from '@lite/shell-ui/ui/kit';
import { Checkbox } from '@/components/ui/checkbox';
import { createClient, useLoad, type Api } from './client';
import { State } from './module-view';
import { EntityHeader } from './entity-header';
import type { SearchPolicy } from '../core/search';

function ModuleSettings({module,api,onSaved}:{module:SearchPolicy&{indexed:number};api:Api;onSaved:()=>void}){
  const [enabled,setEnabled]=useState(module.search.enabled),[fields,setFields]=useState(module.search.fields),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const dirty=enabled!==module.search.enabled||JSON.stringify(fields)!==JSON.stringify(module.search.fields);
  async function save(){setBusy(true);setError('');try{await api(`admin/search/${module.id}`,{method:'PUT',body:JSON.stringify({enabled,fields,version:module.version})});onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <Card className="p-5 space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{module.name}</h2><p className="text-sm text-muted-foreground">{module.indexed} élément{module.indexed>1?'s':''} indexé{module.indexed>1?'s':''}</p></div><label className="flex items-center gap-2 text-sm"><Checkbox checked={enabled} onCheckedChange={v=>setEnabled(v===true)} aria-label={`Rechercher dans ${module.name}`}/>Inclus dans la recherche</label></div>
    <fieldset disabled={!enabled||busy} className="flex flex-wrap gap-x-6 gap-y-3"><legend className="text-sm mb-3">Champs recherchables</legend>{module.fields.map(field=><label key={field.key} className="flex items-center gap-2 text-sm"><Checkbox checked={fields.includes(field.key)} onCheckedChange={v=>setFields(list=>v?[...list,field.key]:list.filter(k=>k!==field.key))} aria-label={`${module.name} : ${field.label}`}/>{field.label}</label>)}</fieldset>
    {module.id==='files'?<p className="text-sm text-muted-foreground">La recherche porte sur le nom et le type du fichier. Le texte à l’intérieur des PDF, images et autres pièces jointes n’est pas extrait.</p>:null}
    {module.readRoles.length<4?<p className="text-sm text-muted-foreground">Les résultats restent réservés aux personnes autorisées à consulter ce module.</p>:null}
    <State error={error}/><div className="flex justify-end"><Button disabled={!dirty||busy} onClick={()=>void save()}>{busy?'Enregistrement…':'Enregistrer'}</Button></div>
  </Card>;
}
export function SearchSettings(){
  const api=useMemo(()=>createClient(''),[]),[revision,setRevision]=useState(0),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const {data,error:loadError,loading}=useLoad<{modules:(SearchPolicy&{indexed:number})[]}>(()=>api('admin/search'),[api,revision]);
  async function index(reset=false){setBusy(true);setError('');setMessage('Indexation en cours…');try{let pending=true;for(let page=0;page<200&&pending;page++){const result=await api('admin/search/reindex',{method:'POST',body:JSON.stringify({reset:reset&&page===0})});pending=result.indexing;}setMessage(pending?'L’indexation se poursuit. Cliquez pour continuer.':'L’index est à jour.');setRevision(r=>r+1);}catch(e){setError((e as Error).message);setMessage('');}finally{setBusy(false);}}
  return <section className="workspace-section"><EntityHeader title="Recherche" description="Choisissez les données que votre équipe peut retrouver. Les nouveaux modules sont inscrits automatiquement." actions={<Button variant="outline" disabled={busy} onClick={()=>void index()}><RefreshCw size={16}/>{busy?'Indexation…':'Mettre l’index à jour'}</Button>}/>
    <State error={error||loadError} loading={loading}/>{message?<p role="status" className="text-sm">{message}</p>:null}
    <Input aria-label="Filtrer les modules de recherche" placeholder="Filtrer les modules…" value={query} onChange={e=>setQuery(e.target.value)} className="max-w-sm"/>
    {data?.modules.filter(m=>m.name.toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr'))).map(module=><ModuleSettings key={`${module.id}-${module.version}-${revision}`} module={module} api={api} onSaved={()=>setRevision(r=>r+1)}/>)}
  </section>;
}
