'use client';
import { useEffect, useState } from 'react';
export type Api = <T = any>(path: string, init?: RequestInit) => Promise<T>;
export function createClient(workspace: string): Api {
  return async (path,init={}) => {
    const url = new URL(`/api/v1/${path}`,window.location.origin);
    if(workspace) url.searchParams.set('workspace',workspace);
    const response=await fetch(url,{...init,credentials:'same-origin',headers:{...(typeof init.body==='string'?{'Content-Type':'application/json'}:{}),...init.headers}});
    const result:any=await response.json();
    if(!response.ok) throw new Error((typeof result.error==='string'?result.error:result.error?.message)??'Action impossible.');
    return result;
  };
}
/** Retain a loaded view only while its identity (including auth/workspace) is unchanged.
 * Revision is a refresh trigger, not the identity of the data. Late responses are discarded.
 */
export function useLoad<T>(load:()=>Promise<T>, dependencies: unknown[], identity: unknown[] = dependencies) {
  type State = {identity:unknown[];data:T|null;error:string;loading:boolean};
  const same=(a:unknown[],b:unknown[])=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const [state,setState]=useState<State>({identity,data:null,error:'',loading:true});
  useEffect(()=>{
    let active=true;
    setState(previous=>({identity,data:same(previous.identity,identity)?previous.data:null,error:'',loading:true}));
    load().then(data=>{if(active)setState({identity,data,error:'',loading:false});})
      .catch(error=>{if(active)setState({identity,data:null,error:error instanceof Error?error.message:'Chargement impossible.',loading:false});});
    return()=>{active=false;};
  },dependencies); // caller supplies the complete, stable dependency set
  if(!same(state.identity,identity))return {data:null,error:'',loading:true};
  return {data:state.data,error:state.error,loading:state.loading};
}
