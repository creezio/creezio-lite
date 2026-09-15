"use client";
import { AppShell, KpiStrip } from '@lite/shell-ui/ui';
import { useLoad } from '@/runtime/ui/client';
import brand from '@/brand.json';
export default function Dashboard(){
  const {data,error}=useLoad<{modules:{id:string;name:string;count:number}[]}>(()=>fetch('/api/v1/dashboard').then(async r=>{if(!r.ok)throw new Error('Chargement impossible');return r.json();}),[]);
  return <AppShell title="Tableau de bord"><div className="mx-auto w-full max-w-7xl space-y-6 p-6">
    <div><h1 className="text-2xl font-semibold text-slate-900">{brand.name}</h1><p className="mt-1 text-sm text-slate-500">{brand.description}</p></div>
    {error?<p role="alert">{error}</p>:data?<KpiStrip items={data.modules.map(m=>({label:m.name,value:m.count,href:`/${m.id}`}))}/>:<p className="text-sm text-slate-500">Chargement…</p>}
  </div></AppShell>;
}
