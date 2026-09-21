'use client';
import {useEffect,useState} from 'react';
import {Input} from '@lite/shell-ui/ui/kit';
export type ReferenceOption={id:string;label:string};
export type ReferencePickerProps={
  sourceKey:string;load:(query:string)=>Promise<ReferenceOption[]>;value:string;
  onChange:(value:string)=>void;required?:boolean;label?:string;multiple?:boolean;id?:string;
};
/** Adapted from the existing WinHub reference editor; options still come from authorized server reads.
 * sourceKey includes the caller's workspace/identity when it can change without remounting.
 */
export function ReferencePicker(props:ReferencePickerProps){return <ReferencePickerState key={props.sourceKey} {...props}/>;}
function ReferencePickerState({load,value,onChange,required=false,label='Référence',multiple=false,id}:ReferencePickerProps){
 const [items,setItems]=useState<ReferenceOption[]>([]),[known,setKnown]=useState<Record<string,string>>({}),[query,setQuery]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
 const selected=value.split(/[\n,]/).map(v=>v.trim()).filter(Boolean);
 useEffect(()=>{let active=true;setLoading(true);const timer=setTimeout(()=>{
  void load(query).then(options=>{if(active){setItems(options);setKnown(previous=>({...previous,...Object.fromEntries(options.map(r=>[r.id,r.label]))}));setError('');}})
   .catch(e=>{if(active){setItems([]);setError(e instanceof Error?e.message:'Références indisponibles.');}})
   .finally(()=>{if(active)setLoading(false);});
 },200);return()=>{active=false;clearTimeout(timer);};},[load,query,revision]);
 const options=[...selected.filter(v=>!items.some(r=>r.id===v)).map(id=>({id,label:known[id]??'Sélection enregistrée'})),...items];
 return <div className="space-y-2"><Input aria-label={'Rechercher : '+label} placeholder="Rechercher par nom…" value={query} onChange={e=>setQuery(e.target.value)}/>
 {multiple?<><select id={id} disabled={loading||!!error} className="h-10 w-full rounded-md border bg-background px-3 text-sm" aria-label={'Ajouter : '+label} value="" required={required&&!selected.length} onChange={e=>{if(e.target.value)onChange([...new Set([...selected,e.target.value])].join('\n'));}}><option value="">Ajouter une sélection…</option>{items.filter(r=>!selected.includes(r.id)).map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select>
 {!!selected.length&&<ul className="space-y-1">{selected.map(v=><li key={v} className="flex items-center gap-2 rounded border p-2 text-sm"><span>{known[v]??'Sélection enregistrée'}</span><button type="button" className="ml-auto text-xs underline" aria-label={'Retirer '+(known[v]??'la sélection')} onClick={()=>onChange(selected.filter(other=>other!==v).join('\n'))}>Retirer</button></li>)}</ul>}</>
 :<select id={id} disabled={loading||!!error} className="h-10 w-full rounded-md border bg-background px-3 text-sm" aria-label={'Choisir : '+label} value={value} required={required} onChange={e=>onChange(e.target.value)}><option value="">Choisir…</option>{options.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select>}
 {error&&<div role="alert" className="text-xs text-destructive">{error} <button type="button" onClick={()=>setRevision(v=>v+1)}>Réessayer</button></div>}
 {loading?<p className="text-xs text-muted-foreground">Chargement des choix…</p>:!items.length&&!error&&<p className="text-xs text-muted-foreground">Aucune référence accessible.</p>}
 </div>;
}
