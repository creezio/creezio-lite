"use client";
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';

import {readBrowserSessionResponse} from './browser-session-response';

export type BrowserState={active:boolean;kind:'desktop'|'controller'|null;desktopConnected:boolean;desktopPath?:string|null;workspaceId?:string;actions?:unknown[]};
type Session={windowId:string;mobile:boolean;ready:boolean;state:BrowserState;error:string;takeover:()=>void;report:(event:string,fields?:Record<string,unknown>)=>Promise<void>};
const Context=createContext<Session|null>(null);
export const useBrowserSession=()=>useContext(Context);
export function BrowserSessionProvider({children}:{children:ReactNode}) {
  const [id,setId]=useState(''),[mobile,setMobile]=useState(false),[ready,setReady]=useState(false),[state,setState]=useState<BrowserState>({active:false,kind:null,desktopConnected:false}),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const takeover=useRef(false),identity=useRef(''),workspace=useRef<string|undefined>(undefined);
  async function report(event:string,fields:Record<string,unknown>={}) {
    if(!identity.current)return;
    try{await fetch('/api/v1/assistant/browser/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({windowId:identity.current,event,...fields}),keepalive:true});}catch{}
  }
  useEffect(()=>{
    // A fresh identity per document prevents duplicated tabs sharing a lease.
    const windowId=identity.current||crypto.randomUUID();identity.current=windowId;setId(windowId);
    const phone=/Android.*Mobile|iPhone|iPod/i.test(navigator.userAgent)||(window.matchMedia('(pointer: coarse)').matches&&Math.min(screen.width,screen.height)<600);
    setMobile(phone);
    let stopped=false,ws:WebSocket|undefined,pollTimer:ReturnType<typeof setTimeout>|undefined,wsTimer:ReturnType<typeof setInterval>|undefined,watch:ReturnType<typeof setInterval>|undefined;
    let connected=false,lastState=0,polling=false,wsLast=0;const controller=new AbortController();
    const post=async(path:string,body:Record<string,unknown>)=>{
      const res=await fetch('/api/v1/assistant/browser/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({windowId,...body}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(6000)])});
      return readBrowserSessionResponse(res);
    };
    const receive=(next:BrowserState)=>{
      if(stopped)return;
      if(workspace.current&&workspace.current!==next.workspaceId){window.location.reload();return;}
      workspace.current=next.workspaceId;lastState=performance.now();connected=next.active;
      setReady(true);setState(next);setError('');
      if(next.active&&next.kind==='desktop')for(const action of next.actions??[])window.dispatchEvent(new CustomEvent('lite-assistant-ui-action',{detail:{...(action as object),windowId}}));
    };
    async function poll(){
      if(stopped||polling)return;polling=true;
      try{receive(await post('poll',{path:window.location.pathname}));}
      catch(e){if(!stopped){setError(e instanceof Error?e.message:'Connexion interrompue.');if((e as {status?:number}).status===401||performance.now()-lastState>8000)setState(s=>({...s,active:false}));}}
      finally{polling=false;if(!stopped)pollTimer=setTimeout(poll,2000);}
    }
    const fallback=()=>{if(stopped)return;if(wsTimer)clearInterval(wsTimer);ws?.close();if(!pollTimer&&!polling){void report('transport.fallback',{transport:'http'});void poll();}};
    async function start(){
      try{
        const initial=await post('connect',{kind:phone?'controller':'desktop',takeover:takeover.current});takeover.current=false;
        if(stopped){release();return;}
        receive(initial);if(!initial.active)return;
        try{
          const url=new URL('/api/v1/assistant/browser/socket',window.location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('windowId',windowId);if(initial.workspaceId)url.searchParams.set('workspace',initial.workspaceId);
          ws=new WebSocket(url);
          const pulse=()=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'pulse',path:window.location.pathname}));};
          ws.onopen=()=>{wsLast=performance.now();pulse();wsTimer=setInterval(pulse,1500);};
          ws.onmessage=e=>{try{const data=JSON.parse(e.data);if(data.type==='state'){wsLast=performance.now();receive(data);}else fallback();}catch{fallback();}};
          ws.onclose=fallback;ws.onerror=fallback;
          watch=setInterval(()=>{if(performance.now()-(wsLast||lastState)>5000)fallback();if(performance.now()-lastState>8000&&connected){connected=false;setState(s=>({...s,active:false}));setError('Connexion interrompue. Les actions sont suspendues.');}},1000);
        }catch{fallback();}
      }catch(e){if(!stopped){setReady(true);setError(e instanceof Error?e.message:'Connexion indisponible.');}}
    }
    const onError=(event:ErrorEvent)=>void report('browser.error',{code:event.error?.name??'Error'});
    const onRejection=(event:PromiseRejectionEvent)=>void report('browser.rejection',{code:event.reason?.name??'Error'});
    const release=()=>{try{navigator.sendBeacon('/api/v1/assistant/browser/release',new Blob([JSON.stringify({windowId})],{type:'application/json'}));}catch{}};
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onRejection);window.addEventListener('pagehide',release);
    void start();
    return()=>{stopped=true;controller.abort();if(pollTimer)clearTimeout(pollTimer);if(wsTimer)clearInterval(wsTimer);if(watch)clearInterval(watch);ws?.close();release();window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onRejection);window.removeEventListener('pagehide',release);};
  },[attempt]);
  return <Context.Provider value={{windowId:id,mobile,ready,state,error,takeover:()=>{takeover.current=!error;workspace.current=undefined;setReady(false);setAttempt(n=>n+1);},report}}>{children}</Context.Provider>;
}
function BrowserInterruption({session}:{session:Session}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const element=dialog.current;if(!element)return;
    const stopEscape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();}};
    // Intercept before document-level Radix listeners, including document hydration roots.
    const stopPointerDown=(event:PointerEvent)=>event.stopPropagation();
    element.addEventListener('pointerdown',stopPointerDown);
    window.addEventListener('keydown',stopEscape,true);
    if(!element.open)element.showModal();
    return()=>{element.removeEventListener('pointerdown',stopPointerDown);window.removeEventListener('keydown',stopEscape,true);if(element.open)element.close();};
  },[]);
  return <dialog ref={dialog} data-lite-assistant-ui aria-labelledby="lite-browser-interruption-title" style={{pointerEvents:'auto'}} onCancel={event=>event.preventDefault()} className="m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-slate-50 p-6 backdrop:bg-slate-950/40">
    <div className="flex h-full items-center justify-center"><div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm" role="status">
      <h1 id="lite-browser-interruption-title" className="text-xl font-semibold text-slate-900">{!session.ready?'Connexion à votre espace…':session.error?'Connexion interrompue':'Une autre fenêtre est active'}</h1>
      {session.ready&&<><p className="mt-3 text-base text-slate-600">{session.error||'Vous pouvez continuer ici. L’autre fenêtre sera mise en pause.'}</p><button type="button" autoFocus className="mt-5 rounded-lg bg-slate-900 px-4 py-3 text-base text-white" onClick={session.takeover}>{session.error?'Réessayer la connexion':'Continuer dans cette fenêtre'}</button></>}
    </div></div>
  </dialog>;
}
export function BrowserWindowGate({children}:{children:ReactNode}) {
  const session=useBrowserSession();if(!session)return <>{children}</>;
  const inactive=!session.ready||!session.state.active;
  return <>
    {!session.mobile&&<div hidden={!session.state.active} inert={!session.state.active}>{children}</div>}
    {inactive&&<BrowserInterruption session={session}/>}
  </>;
}
export function BrowserConnectionStatus(){
  const session=useBrowserSession();const [events,setEvents]=useState<unknown[]|null>(null);
  if(!session)return null;
  return <div className="border-b border-slate-100 px-3 py-2 text-sm text-slate-600">
    <div className="flex items-center justify-between gap-2"><span>{session.mobile?(session.state.desktopConnected?'Ordinateur connecté · pilotage disponible':'Aucun ordinateur connecté'):session.state.active?'Cette fenêtre est pilotable':'Pilotage en pause'}</span><button type="button" className="text-xs underline" onClick={async()=>{if(events){setEvents(null);return;}try{const r=await fetch('/api/v1/assistant/browser/diagnostics');const d=await r.json();setEvents(d.events??[]);}catch{setEvents([]);}}}>Diagnostics</button></div>
    {events&&<div className="mt-2 max-h-48 overflow-auto"><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(events,null,2)}</pre></div>}
  </div>;
}
