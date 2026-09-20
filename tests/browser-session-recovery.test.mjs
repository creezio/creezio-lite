import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const deps=createRequire(new URL('../template/package.json',import.meta.url));
const ts=deps('typescript');
const React=deps('react');
const {create,act}=deps('react-test-renderer');
const source=await readFile(new URL('../runtime/modules/assistant/ui/browser-session.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText
 .replaceAll('"react/jsx-runtime"',JSON.stringify(pathToFileURL(deps.resolve('react/jsx-runtime')).href))
 .replaceAll("'react'",JSON.stringify(pathToFileURL(deps.resolve('react')).href))
 .replaceAll("'./browser-session-response'",JSON.stringify(new URL('../runtime/modules/assistant/ui/browser-session-response.ts',import.meta.url).href))
 .replaceAll("'./browser-session-identity'",JSON.stringify('data:text/javascript;base64,'+Buffer.from("export const claimBrowserWindowIdentity=async()=>({windowId:globalThis.fixtureWindowId??=crypto.randomUUID(),close(){}})").toString('base64')));
const {BrowserSessionProvider,BrowserWindowGate,useBrowserSession}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));

test('UI: temporary connection failure retries manually without taking over another window',async()=>{
 const names=['window','navigator','screen','WebSocket','fetch','IS_REACT_ACT_ENVIRONMENT','fixtureWindowId'];const saved=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const pendingReleases=[];let leaseActive=false;
 const globals={window:{location:{href:'https://fixture.example/',pathname:'/',reload(){}},matchMedia:()=>({matches:false}),addEventListener(){},removeEventListener(){},dispatchEvent(){}},navigator:{userAgent:'Fixture desktop',sendBeacon:()=>{pendingReleases.push(()=>{leaseActive=false;});return true;}},screen:{width:1400,height:900},WebSocket:class {constructor(){throw Error('Fixture HTTP only')}},IS_REACT_ACT_ENVIRONMENT:true};
 const attempts=[];let instance;
 const dialogListeners=new Map();let dialogClosed=false;
 const nativeDialog={open:false,showModal(){this.open=true;},close(){this.open=false;dialogClosed=true;},addEventListener(type,listener){dialogListeners.set(type,listener);},removeEventListener(type,listener){assert.equal(dialogListeners.get(type),listener);dialogListeners.delete(type);}};
 globals.fetch=async(url,options)=>{const body=JSON.parse(options.body);if(url.endsWith('/connect')){attempts.push(body);if(attempts.length>1)leaseActive=true;return attempts.length===1?new Response('Your worker restarted mid-request.',{status:503}):Response.json(attempts.length===2?{active:false,kind:null,desktopConnected:true,leaseUntil:null,releaseToken:null}:{active:true,kind:'desktop',desktopConnected:true,leaseUntil:'2099-01-01T00:00:00.000Z',releaseToken:'fixture-lease-current'});}return Response.json({active:true,kind:'desktop',desktopConnected:true,leaseUntil:'2099-01-01T00:00:00.000Z',releaseToken:'fixture-lease-current'});};
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 try{
  await act(async()=>{instance=create(React.createElement(BrowserSessionProvider,null,React.createElement(BrowserWindowGate,null,'Protected content')),{createNodeMock:element=>element.type==='dialog'?nativeDialog:null});});
  const button=()=>instance.root.findByType('button');
  assert.equal(button().children.join(''),'Réessayer la connexion');
  const gate=instance.root.findByProps({'data-lite-assistant-ui':true});
  assert.equal(nativeDialog.open,true);
  let pointerStopped=false;dialogListeners.get('pointerdown')({stopPropagation(){pointerStopped=true;}});assert.equal(pointerStopped,true,'native pointer interception precedes document-level Radix dismissal even when React hydrates document');
  assert.equal(gate.type,'dialog','session interruption uses the browser top layer instead of guessing an open app dialog');
  assert.equal(button().props.type,'button');assert.equal(button().props.autoFocus,true);
  let cancelPrevented=false;gate.props.onCancel({preventDefault(){cancelPrevented=true;}});assert.equal(cancelPrevented,true,'Escape cannot expose inactive form controls');
  assert.match(JSON.stringify(instance.toJSON()),/Connexion momentanément indisponible/);
  assert.doesNotMatch(JSON.stringify(instance.toJSON()),/worker restarted|SyntaxError/);
  await act(async()=>{button().props.onClick();});
  assert.equal(attempts.length,2);assert.equal(attempts[1].takeover,false);
  assert.equal(attempts[1].windowId,attempts[0].windowId,'a manual retry keeps the document lease identity');
  assert.equal(button().children.join(''),'Continuer dans cette fenêtre');
  await act(async()=>{button().props.onClick();});
  assert.equal(attempts[2].takeover,true,'takeover requires explicit action on a confirmed competing-window state');
  for(const deliver of pendingReleases)deliver();
  assert.equal(leaseActive,true,'a delayed old-attempt release must not delete the replacement lease with the same window identity');
  assert.equal(pendingReleases.length,0,'retry cleanup must not release a document that is still mounted');
  await act(async()=>instance.unmount());instance=null;
  assert.equal(pendingReleases.length,1,'actual provider unmount still releases its document lease');
 }finally{if(instance){await act(async()=>instance.unmount());assert.equal(dialogListeners.size,0);assert.equal(dialogClosed,true);}for(const key of names){const descriptor=saved.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});


test('UI: a superseded connect response cannot release the current document lease',async()=>{
 const names=['window','navigator','screen','WebSocket','fetch','IS_REACT_ACT_ENVIRONMENT','fixtureWindowId'];const saved=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 let resolveOld,session,instance,connectCount=0;const beacons=[],listeners=new Map();
 const globals={window:{location:{href:'https://fixture.example/',pathname:'/',reload(){}},matchMedia:()=>({matches:false}),addEventListener(type,listener){listeners.set(type,listener);},removeEventListener(type){listeners.delete(type);},dispatchEvent(){}},navigator:{userAgent:'Fixture desktop',sendBeacon:(...args)=>{beacons.push(args);return true;}},screen:{width:1400,height:900},WebSocket:class {static OPEN=1;constructor(){this.readyState=0;}close(){}},IS_REACT_ACT_ENVIRONMENT:true};
 const response=()=>Response.json({active:true,kind:'desktop',desktopConnected:true,leaseUntil:'2099-01-01T00:00:00.000Z',releaseToken:'fixture-lease-current'});
 globals.fetch=async(url)=>{if(url.endsWith('/connect')&&++connectCount===1)return new Promise(resolve=>{resolveOld=resolve;});return response();};
 function Probe(){session=useBrowserSession();return null;}
 for(const [key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 try{
  await act(async()=>{instance=create(React.createElement(BrowserSessionProvider,null,React.createElement(Probe)));});
  const windowId=session.windowId;
  await act(async()=>session.takeover());assert.equal(session.state.active,true);
  await act(async()=>resolveOld(response()));
  assert.equal(session.windowId,windowId);assert.equal(session.state.active,true);
  assert.equal(beacons.length,0,'stale response cannot send a release for a live replacement attempt');
  listeners.get('pagehide')();assert.equal(beacons.length,1,'leaving the document still releases the lease');
 }finally{if(instance)await act(async()=>instance.unmount());for(const key of names){const descriptor=saved.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
