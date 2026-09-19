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
 .replaceAll("'./browser-session-response'",JSON.stringify(new URL('../runtime/modules/assistant/ui/browser-session-response.ts',import.meta.url).href));
const {BrowserSessionProvider,BrowserWindowGate}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));

test('UI: temporary connection failure retries manually without taking over another window',async()=>{
 const names=['window','navigator','screen','WebSocket','fetch','IS_REACT_ACT_ENVIRONMENT'];const saved=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const globals={window:{location:{href:'https://fixture.example/',pathname:'/',reload(){}},matchMedia:()=>({matches:false}),addEventListener(){},removeEventListener(){},dispatchEvent(){}},navigator:{userAgent:'Fixture desktop',sendBeacon:()=>true},screen:{width:1400,height:900},WebSocket:class {constructor(){throw Error('Fixture HTTP only')}},IS_REACT_ACT_ENVIRONMENT:true};
 const attempts=[];let instance;
 globals.fetch=async(url,options)=>{const body=JSON.parse(options.body);if(url.endsWith('/connect')){attempts.push(body);return attempts.length===1?new Response('Your worker restarted mid-request.',{status:503}):Response.json({active:false,kind:null,desktopConnected:true});}return Response.json({active:false,kind:null,desktopConnected:true});};
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 try{
  await act(async()=>{instance=create(React.createElement(BrowserSessionProvider,null,React.createElement(BrowserWindowGate,null,'Protected content')));});
  const button=()=>instance.root.findByType('button');
  assert.equal(button().children.join(''),'Réessayer la connexion');
  const gate=instance.root.findByProps({'data-lite-assistant-ui':true});
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
 }finally{if(instance)await act(async()=>instance.unmount());for(const key of names){const descriptor=saved.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
