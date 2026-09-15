import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {root} from './helpers.mjs';

// A small DOM fixture exercises the original driver and its real cursor code.
// Layout rectangles and animation completion are simulated, not browser QA.
test('native cursor moves, shows its halo and clicks Mail; stopping prevents a pending click',async()=>{
  const deps=createRequire(join(root,'template/package.json')),wrangler=createRequire(deps.resolve('wrangler/package.json'));
  const {build}=await import(pathToFileURL(wrangler.resolve('esbuild')).href);
  const built=await build({absWorkingDir:root,bundle:true,write:false,format:'esm',platform:'node',entryPoints:['runtime/modules/assistant/ui/ui-driver.tsx'],plugins:[{name:'isolated-ui-imports',setup(b){
    b.onResolve({filter:/^react$|^@lite\/shell-ui\/ui$|^\.\/browser-session$/},a=>({path:a.path,namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='./browser-session'?'export const useBrowserSession=()=>globalThis.fixtureBrowser??null;':a.path==='react'?'export function useEffect(fn){globalThis.fixtureEffect=fn;}':'export const resolveAidAttr=()=>"data-aid";',loader:'js'}));
  }}]});
  const names=['window','document','Element','HTMLElement','HTMLAnchorElement','HTMLInputElement','HTMLTextAreaElement','PointerEvent','MouseEvent','fetch','fixtureEffect','fixtureBrowser'];
  const previous=Object.fromEntries(names.map(n=>[n,globalThis[n]]));let order=[],onMove;
  class FixtureElement extends EventTarget {
    constructor(tag='div',label=''){super();this.tagName=tag.toUpperCase();this.textContent=label;this.style={};this.children=[];this.attrs={};this.isConnected=true;}
    getAttribute(name){return this.attrs[name]??null;}
    closest(){return null;}
    getBoundingClientRect(){return {left:20,top:120,right:260,bottom:160,width:240,height:40};}
    appendChild(el){this.children.push(el);return el;}
    contains(el){return this===el||this.children.some(c=>c.contains(el));}
    remove(){this.isConnected=false;}
    focus(){}
    animate(){const kind=this.id==='lite-fake-cursor'?'move':'halo';order.push(kind);if(kind==='move')onMove?.();const animation={cancel(){this.oncancel?.();}};queueMicrotask(()=>animation.onfinish?.());return animation;}
  }
  class Anchor extends FixtureElement {constructor(label,href){super('a',label);this.attrs.href=href;this.href='https://fixture.example'+href;}}
  class Input extends FixtureElement {constructor(){super('input');this.type='password';this.name='secret';}}
  class Textarea extends FixtureElement {}
  class Pointer extends Event {constructor(type,options){super(type,options);}}
  const mail=new Anchor('Mail','/mails'),secret=new Input(),body=new FixtureElement(),heading=new FixtureElement('h1','Accueil');
  const doc={body,title:'Atelier',contains:el=>el.isConnected,createElement:tag=>new FixtureElement(tag),querySelector:selector=>selector==='h1'?heading:null,
    querySelectorAll:selector=>selector==='[data-sonner-toast]'?[]:[mail,secret]};
  Object.assign(globalThis,{window:{innerWidth:1200,innerHeight:800,location:{origin:'https://fixture.example',href:'https://fixture.example/',pathname:'/',search:''},getComputedStyle:()=>({visibility:'visible',display:'block'})},document:doc,Element:FixtureElement,HTMLElement:FixtureElement,HTMLAnchorElement:Anchor,HTMLInputElement:Input,HTMLTextAreaElement:Textarea,PointerEvent:Pointer,MouseEvent:Pointer});
  mail.addEventListener('click',()=>{order.push('click');window.location.pathname='/mails';heading.textContent='Mail';});
  try{
    const {runUiAction,UiDriver}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
    const scan=await runUiAction({type:'list_targets',params:{q:'Mail'}});assert.equal(scan.targets.length,1);assert.equal(scan.targets[0].label,'Mail');
    const result=await runUiAction({type:'click',params:{ref:scan.targets[0].ref}});
    assert.equal(result.ok,true);assert.deepEqual(order,['move','halo','click']);assert.equal(result.page.path,'/mails');
    const cursor=body.children.find(e=>e.id==='lite-fake-cursor');assert.ok(cursor);assert.equal(cursor.style.opacity,'1');assert.match(cursor.style.transform,/translate\(140px, 140px\)/);assert.equal(cursor.children[0].textContent,'IA');
    order=[];const stop=new AbortController();onMove=()=>stop.abort();
    const interrupted=await runUiAction({type:'click',params:{ref:scan.targets[0].ref},signal:stop.signal});assert.equal(interrupted.ok,false);assert.equal(order.includes('click'),false);
    mail.isConnected=false;const stale=await runUiAction({type:'click',params:{ref:scan.targets[0].ref,label:'Mail'}});assert.equal(stale.ok,false,'stale reference must not silently click a replacement');
    // Mount the real event listener: delivery uses relative server time, claims once,
    // animates the existing cursor, and sends the result to the server.
    mail.isConnected=true;onMove=undefined;order=[];
    const events=new EventTarget();window.addEventListener=events.addEventListener.bind(events);window.removeEventListener=events.removeEventListener.bind(events);window.dispatchEvent=events.dispatchEvent.bind(events);
    let claimCount=0,ack;const acknowledged=new Promise(resolve=>ack=resolve),protocol=[];
    globalThis.fixtureBrowser={windowId:'fixture-desktop-window',state:{active:true},mobile:false,report:async(event)=>protocol.push(event)};
    globalThis.fetch=async(url,init)=>{assert.equal(init.headers['x-lite-window'],'fixture-desktop-window');if(url.endsWith('/claim'))claimCount++;if(url.endsWith('/result'))ack(JSON.parse(init.body));return Response.json({ok:true});};
    UiDriver();const cleanup=globalThis.fixtureEffect();
    const action={actionId:'fixture-action',windowId:'fixture-desktop-window',type:'click',params:{ref:scan.targets[0].ref},expiresAt:'2000-01-01T00:00:00Z',remainingMs:10000};
    window.dispatchEvent(new CustomEvent('lite-assistant-ui-action',{detail:action}));window.dispatchEvent(new CustomEvent('lite-assistant-ui-action',{detail:action}));
    assert.equal((await acknowledged).ok,true);assert.equal(claimCount,1);assert.deepEqual(order,['move','halo','click']);assert.ok(protocol.includes('driver.received'));assert.ok(protocol.includes('driver.executed'));cleanup();
    for(const state of [{mobile:true,active:true},{mobile:false,active:false}]){globalThis.fixtureBrowser={...globalThis.fixtureBrowser,mobile:state.mobile,state:{active:state.active}};UiDriver();assert.equal(globalThis.fixtureEffect(),undefined,'mobile and blocked windows never mount a driver');}

  }finally{for(const n of names){if(previous[n]===undefined)delete globalThis[n];else globalThis[n]=previous[n];}}
});
