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
export function useLoad<T>(load:()=>Promise<T>, dependencies: unknown[]) {
  const [state,setState]=useState<{data:T|null;error:string;loading:boolean}>({data:null,error:'',loading:true});
  useEffect(()=>{let active=true;setState({data:null,error:'',loading:true});load().then(data=>{if(active)setState({data,error:'',loading:false});}).catch(e=>{if(active)setState({data:null,error:e.message,loading:false});});return()=>{active=false;};},dependencies); // caller supplies stable dependency set
  return state;
}
