import './register-ui-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(spec,context,next){return next(spec==='next/navigation'?'vinext/shims/navigation':spec,context);}});
const w=new EventTarget();w.location=new URL('http://audit.local/clients?record=A');
w.history={pushState(_s,_t,url){w.location=new URL(url,w.location)},replaceState(_s,_t,url){w.location=new URL(url,w.location)}};
globalThis.window=w;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createElement:h,useEffect,useState}=await import('react');
const {create,act}=await import('react-test-renderer');
const nav=await import('vinext/shims/navigation');
const {KeepAliveOutlet,WorkspacePaneRouterContext}=await import('../runtime/modules/shell-ui/ui/workspace/keep-alive.tsx');
const {usePanePathname,usePaneSearchParams}=await import('../runtime/modules/shell-ui/ui/workspace/pane-location.tsx');
const {SitesPaneRouter}=await import('../template/app/sites-pane-router.tsx');
const {ElementsContext,ChildrenContext,BfcacheIdentityMapContext,Children,Slot}=await import('vinext/shims/slot');
const {sameWorkspacePage,shouldOpenLockedNavigationInNewTab}=await import('../runtime/modules/shell-ui/ui/workspace/types.ts');
const Context=nav.getClientNavigationRenderContext(),loads=[];
function Page(){const path=usePanePathname(),id=usePaneSearchParams().get('record'),[draft,setDraft]=useState('');useEffect(()=>{loads.push({path,id});},[path,id]);return h('article',null,h('output',null,JSON.stringify({path,id})),h('input',{value:draft,onChange:e=>setDraft(e.target.value)}));}
function Tree({href,active=href}){return h(Context.Provider,{value:nav.createClientNavigationRenderSnapshot(href,{})},
 h(ElementsContext.Provider,{value:{'page:/[moduleId]':h(Page)}},
 h(BfcacheIdentityMapContext.Provider,{value:{'page:/[moduleId]':href}},
 h(ChildrenContext.Provider,{value:h(Slot,{id:'page:/[moduleId]'})},
 h(WorkspacePaneRouterContext.Provider,{value:SitesPaneRouter},
 h(KeepAliveOutlet,{routeKey:href,activeHref:active},h(Children)))))));}
test('committed Vinext navigation preserves each pane URL, record, draft and loading identity',async()=>{
 let root;await act(()=>{root=create(h(Tree,{href:'/clients?record=A'}));});
 const pane=href=>root.root.findByProps({'data-workspace-pane':href});
 const read=href=>JSON.parse(pane(href).findByType('output').children[0]);
 try{
  await act(()=>pane('/clients?record=A').findByType('input').props.onChange({target:{value:'unsaved A'}}));
  for(const href of ['/clients?record=B','/support','/clients?record=A','/clients?record=B']){
   await act(()=>{window.history.replaceState(null,'',href);nav.commitClientNavigationState(undefined,{releaseSnapshot:false});root.update(h(Tree,{href}));});
   assert.deepEqual(read('/clients?record=A'),{path:'/clients',id:'A'});
   assert.equal(pane('/clients?record=A').findByType('input').props.value,'unsaved A');
   if(href!=='/clients?record=A')assert.deepEqual(read('/clients?record=B'),{path:'/clients',id:'B'});
  }
  assert.equal(loads.filter(x=>x.id==='A').length,1,'another tab must not reload A');
  assert.equal(loads.filter(x=>x.id==='B').length,1,'another tab must not reload B');
  assert.equal(root.root.findAll(n=>n.props['data-workspace-pane']&&n.props['data-active']==='true').length,1);
 }finally{await act(()=>root.unmount());}
});
test('two records of the same module are separate pages; filters keep the same page identity',()=>{
 assert.equal(sameWorkspacePage('/clients?record=A','/clients?record=B'),false);
 assert.equal(sameWorkspacePage('/clients','/clients?record=A'),false);
 assert.equal(sameWorkspacePage('/clients?record=A&page=1','/clients?page=2&record=A'),true);
 assert.equal(sameWorkspacePage('/clients?q=A','/clients?q=B'),true);
 assert.equal(shouldOpenLockedNavigationInNewTab({id:'a',href:'/clients?record=A',locked:true},'/clients?record=B'),true);
});
