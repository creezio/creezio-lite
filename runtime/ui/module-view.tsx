'use client';
import { DataTable, Badge } from '@lite/shell-ui/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Search, Pencil, Archive, ChevronLeft, ChevronRight, FolderOpen } from 'lucide-react';
import { Button } from '@lite/shell-ui/ui/kit';
import { Input } from '@lite/shell-ui/ui/kit';
import { Textarea } from '@lite/shell-ui/ui/kit';
import { Label } from '@lite/shell-ui/ui/kit';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@lite/shell-ui/ui/kit';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@lite/shell-ui/ui/kit';
import { Skeleton } from '@lite/shell-ui/ui/kit';
import { toast } from 'sonner';
import type { Field, Module, RecordData, Role } from '../core/types';
import { EntityHeader } from './entity-header';
import { useLoad, type Api } from './client';

export function State({error,loading}:{error?:string;loading?:boolean}) {return error?<div role="alert" className="error-box">{error}</div>:loading?<div aria-label="Chargement" className="space-y-3"><Skeleton className="h-12 w-full"/><Skeleton className="h-12 w-full"/><Skeleton className="h-12 w-3/4"/></div>:null;}
export function Empty({title,children}:{title:string;children?:React.ReactNode}) {return <div className="empty-state"><FolderOpen size={32} strokeWidth={1.3}/><h3>{title}</h3>{children}</div>;}
function format(value:unknown,field:Field) {if(value===null||value===undefined||value==='')return '—';if(field.type==='boolean')return value?'Oui':'Non';if(field.type==='number')return Number(value).toLocaleString('fr-FR');if(field.type==='date')return String(value).split('-').reverse().join('/');return String(value);}
export function RecordForm({module,record,api,onSaved,onCancel}:{module:Module;record:RecordData|null;api:Api;onSaved:()=>void;onCancel:()=>void}) {
  const [values,setValues]=useState<Record<string,unknown>>(()=>record?.data??Object.fromEntries(module.fields.map(f=>[f.key,f.type==='boolean'?false:''])));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:React.FormEvent){event.preventDefault();setBusy(true);setError('');try{const data=Object.fromEntries(module.fields.map(f=>[f.key,f.type==='number'&&values[f.key]!==''&&values[f.key]!==null?Number(values[f.key]):values[f.key]]));await api(`modules/${module.id}/records${record?'/'+record.id:''}`,{method:record?'PATCH':'POST',body:JSON.stringify({data,...(record?{version:record.version}:{})})});toast.success(record?'Modifications enregistrées':'Document créé');onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <form onSubmit={submit} className="record-form"><div className="form-fields">{module.fields.map(field=><div className={field.type==='textarea'?'field field-wide':'field'} key={field.key}><Label htmlFor={`field-${field.key}`}>{field.label}{field.required?' *':''}</Label>{field.type==='select'?<Select value={String(values[field.key]??'')} onValueChange={v=>setValues({...values,[field.key]:v})}><SelectTrigger id={`field-${field.key}`} aria-required={field.required}><SelectValue placeholder="Choisir…"/></SelectTrigger><SelectContent>{field.options?.map(option=><SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select>:field.type==='boolean'?<Checkbox id={`field-${field.key}`} checked={values[field.key]===true} onCheckedChange={v=>setValues({...values,[field.key]:v===true})}/>:field.type==='textarea'?<Textarea id={`field-${field.key}`} value={String(values[field.key]??'')} onChange={e=>setValues({...values,[field.key]:e.target.value})} required={field.required} maxLength={field.maxLength??5000} rows={4}/>:<Input id={`field-${field.key}`} type={['number','email','date'].includes(field.type)?field.type:'text'} value={String(values[field.key]??'')} onChange={e=>setValues({...values,[field.key]:e.target.value})} required={field.required} min={field.min} max={field.max} maxLength={field.maxLength??300} step={field.type==='number'?'any':undefined}/>}</div>)}</div><State error={error}/><div className="form-actions"><Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Annuler</Button><Button type="submit" disabled={busy}>{busy?'Enregistrement…':'Enregistrer'}</Button></div></form>;
}
/** Titles use document navigation: query-only SPA transitions can leave a cold
 * keep-alive pane unresolved in the Sites adapter. The workspace opt-out also
 * preserves native keyboard and modifier-click behavior. */
export function moduleRecordColumns(module:Module):ColumnDef<RecordData>[] {
  const title=module.fields.find(field=>field.key===module.titleField);
  const visible=module.fields.filter(field=>field.type!=='textarea').slice(0,5);
  if(title&&!visible.some(field=>field.key===title.key))visible.unshift(title);
  return visible.map(field=>({id:field.key,accessorFn:row=>format(row.data[field.key],field),header:field.label,cell:({row})=>{
    const value=format(row.original.data[field.key],field);
    const content=field.type==='select'?<Badge variant="secondary">{value}</Badge>:<span>{value}</span>;
    return field.key===module.titleField?<a data-workspace-nav="ignore" href={'/'+module.id+'?record='+encodeURIComponent(row.original.id)} className="font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{content}</a>:content;
  }}));
}
export function ModuleView({module,api,role,revision,onMutation}:{module:Module;api:Api;role:Role;revision:number;onMutation:()=>void}) {
  const router=useRouter(),selectedId=useSearchParams().get('record');
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[offset,setOffset]=useState(0),[filter,setFilter]=useState('all');
  const [editing,setEditing]=useState<RecordData|null|undefined>(undefined),[archiving,setArchiving]=useState<RecordData|null>(null),[busy,setBusy]=useState(false);
  // Entities and collections are only written through declared commands: the generic page shows reads only.
  const statusField=module.fields.find(f=>f.type==='select'),canWrite=(module.kind??'module')==='module'&&(module.writeRoles??['owner','admin','member']).includes(role);
  useEffect(()=>{const t=setTimeout(()=>{setSearch(query);setOffset(0);},250);return()=>clearTimeout(t);},[query]);
  const params=new URLSearchParams({q:search,offset:String(offset),limit:'30'});if(filter!=='all'&&statusField){params.set('field',statusField.key);params.set('value',filter);}
  const {data,error,loading}=useLoad<{items:RecordData[];total:number}>(()=>api(`modules/${module.id}/records?${params}`),[api,module.id,search,offset,filter,revision]);
  const columns=moduleRecordColumns(module);
  if(canWrite)columns.push({id:'actions',header:'Actions',enableSorting:false,cell:({row})=><div className="flex gap-1"><Button variant="ghost" size="icon" aria-label={`Modifier ${row.original.data[module.titleField]}`} onClick={()=>setEditing(row.original)}><Pencil size={15}/></Button><Button variant="ghost" size="icon" aria-label={`Archiver ${row.original.data[module.titleField]}`} onClick={()=>setArchiving(row.original)}><Archive size={15}/></Button></div>});
  async function archive(){if(!archiving)return;setBusy(true);try{await api(`modules/${module.id}/records/${archiving.id}`,{method:'DELETE',body:JSON.stringify({version:archiving.version})});setArchiving(null);onMutation();toast.success('Document archivé');}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}}
  return <section className="workspace-section space-y-5"><EntityHeader title={module.name} description={module.description} actions={canWrite?<Button onClick={()=>setEditing(null)}><Plus size={16}/>Nouveau {module.singular.toLowerCase()}</Button>:undefined}/>
    <State error={error}/>{loading?<p className="text-sm text-slate-500" role="status">Chargement…</p>:null}
    {selectedId?<RecordDetail module={module} api={api} id={selectedId} revision={revision} onClose={()=>router.replace(`/${module.id}`)} onEdit={canWrite?record=>{router.replace(`/${module.id}`);setEditing(record);}:undefined}/>:null}
    <DataTable columns={columns} data={data?.items??[]} searchPlaceholder={`Rechercher dans ${module.name}…`} searchValue={query} onSearchValueChange={setQuery} remotePage={{index:offset/30,size:30,total:data?.total??0,onChange:index=>setOffset(index*30)}} filterSlot={statusField?<Select value={filter} onValueChange={v=>{setFilter(v);setOffset(0);}}><SelectTrigger className="w-48" aria-label={`Filtrer par ${statusField.label}`}><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Tous les statuts</SelectItem>{statusField.options?.map(v=><SelectItem value={v} key={v}>{v}</SelectItem>)}</SelectContent></Select>:undefined}/>
    <Dialog open={editing!==undefined} onOpenChange={open=>{if(!open)setEditing(undefined);}}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editing?'Modifier':'Créer'} {module.singular.toLowerCase()}</DialogTitle><DialogDescription>{module.description}</DialogDescription></DialogHeader>{editing!==undefined?<RecordForm key={editing?.id??'new'} module={module} record={editing} api={api} onCancel={()=>setEditing(undefined)} onSaved={()=>{setEditing(undefined);onMutation();}}/>:null}</DialogContent></Dialog>
    <Dialog open={Boolean(archiving)} onOpenChange={open=>{if(!open&&!busy)setArchiving(null);}}><DialogContent><DialogHeader><DialogTitle>Archiver ce document ?</DialogTitle><DialogDescription>Il sera retiré de la liste. Les données et l’historique seront conservés.</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>setArchiving(null)}>Annuler</Button><Button disabled={busy} onClick={()=>void archive()}>Archiver</Button></div></DialogContent></Dialog>
  </section>;
}

/** A collection record links to its declared parent through the real parentField; no URL is built without a valid parent id. */
export function parentHref(module:Module,data:Record<string,unknown>):string|null{
  if(module.kind!=='collection'||!module.parent||!module.parentField)return null;
  const parentId=data[module.parentField];
  return typeof parentId==='string'&&parentId&&!/[\/\\]/.test(parentId)?`/${module.parent}?record=${encodeURIComponent(parentId)}`:null;
}
function RecordDetail({module,api,id,revision,onClose,onEdit}:{module:Module;api:Api;id:string;revision:number;onClose:()=>void;onEdit?:(record:RecordData)=>void}){
  const {data,error,loading}=useLoad<{record:RecordData}>(()=>api(`modules/${module.id}/records/${encodeURIComponent(id)}`),[api,module.id,id,revision]);
  const parent=data?parentHref(module,data.record.data):null;
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{data?String(data.record.data[module.titleField]):module.singular}</DialogTitle><DialogDescription>{module.name}</DialogDescription></DialogHeader><State error={error} loading={loading}/>{data?<><dl className="grid grid-cols-1 sm:grid-cols-2 gap-5">{module.fields.map(field=><div key={field.key} className={field.type==='textarea'?'sm:col-span-2':''}><dt className="text-sm text-muted-foreground">{field.label}</dt><dd className="whitespace-pre-wrap break-words mt-1">{field.key===module.parentField&&parent?<a className="underline" href={parent}>{format(data.record.data[field.key],field)}</a>:format(data.record.data[field.key],field)}</dd></div>)}</dl>{onEdit?<div className="flex justify-end"><Button onClick={()=>onEdit(data.record)}><Pencil size={15}/>Modifier</Button></div>:null}</>:null}</DialogContent></Dialog>;
}
