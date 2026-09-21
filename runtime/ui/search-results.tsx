'use client';
import { useEffect, useMemo, useState } from 'react';
import { useWorkspaceRouter as useRouter, usePaneSearchParams as useSearchParams } from '@lite/shell-ui/ui/workspace/pane-location';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Input, Card } from '@lite/shell-ui/ui/kit';
import { createClient } from './client';
import { EntityHeader } from './entity-header';
import { Empty, State } from './module-view';

type Result={items:{id:string;index:string;title:string;description:string;moduleName:string;href:string}[];total:number;indexing:boolean};
export function SearchResults(){
  const params=useSearchParams(),router=useRouter(),q=params.get('q')??'',offset=Math.max(0,Number(params.get('offset'))||0);
  const [draft,setDraft]=useState(q),[data,setData]=useState<Result|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const api=useMemo(()=>createClient(''),[]);
  useEffect(()=>setDraft(q),[q]);
  useEffect(()=>{const controller=new AbortController();setData(null);setError('');setLoading(true);
    void (async()=>{try{for(let batch=0;batch<40;batch++){const result=await api<Result>(`search?q=${encodeURIComponent(q)}&limit=30&offset=${offset}`,{signal:controller.signal});if(!result.indexing){setData(result);return;}}
      setError('L’indexation des données existantes se poursuit. Relancez la recherche.');
    }catch(e){if(!controller.signal.aborted)setError((e as Error).message);}finally{if(!controller.signal.aborted)setLoading(false);}})();return()=>controller.abort();
  },[api,q,offset]);
  const go=(value:string,start=0)=>router.push(`/search?q=${encodeURIComponent(value)}&offset=${start}`);
  return <section className="workspace-section"><EntityHeader title="Recherche" description="Retrouvez les données des modules auxquels vous avez accès."/>
    <form className="flex gap-2" onSubmit={e=>{e.preventDefault();go(draft);}}><Input aria-label="Rechercher dans toutes les données" value={draft} maxLength={120} onChange={e=>setDraft(e.target.value)} placeholder="Un nom, une référence, un mot…"/><Button type="submit"><Search size={16}/>Rechercher</Button></form>
    <State error={error} loading={loading}/>{data?<><p role="status" className="text-sm text-muted-foreground">{data.total} résultat{data.total>1?'s':''}{q?` pour « ${q} »`:''}</p>
    {data.items.length?data.items.map(hit=><Card key={`${hit.index}-${hit.id}`} className="p-4"><a href={hit.href} className="font-semibold hover:underline">{hit.title}</a><p className="text-xs text-muted-foreground mt-1">{hit.moduleName}</p><p className="text-sm mt-2 break-words">{hit.description}</p></Card>):<Empty title={q?'Aucun résultat':'Saisissez une recherche'}/>}
    <div className="pagination"><span>Page {Math.floor(offset/30)+1}</span><div><Button variant="outline" size="icon" aria-label="Page précédente" disabled={!offset} onClick={()=>go(q,Math.max(0,offset-30))}><ChevronLeft size={16}/></Button><Button variant="outline" size="icon" aria-label="Page suivante" disabled={offset+30>=data.total} onClick={()=>go(q,offset+30)}><ChevronRight size={16}/></Button></div></div></>:null}
  </section>;
}
