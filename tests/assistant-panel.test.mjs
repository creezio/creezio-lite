import './register-ui-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const {createElement:h,useState}=await import('react');
const {act,create}=await import('react-test-renderer');
const {assistantPresentation}=await import('../runtime/modules/assistant/ui/panel-policy.ts');
const {AssistantProvider,useAssistantUi}=await import('../runtime/modules/assistant/ui/assistant-provider.tsx');

test('shared policy keeps 640 CSS pixels after actual sidebar and panel, including scrollbar and zoom',()=>{
 for(const [viewportWidth,workspaceWidth,sidebarWidth,expected] of [[320,305,0,'fullscreen'],[390,375,0,'fullscreen'],[767,752,0,'fullscreen'],[768,753,256,'overlay'],[1024,1009,256,'overlay'],[1024,1009,64,'overlay'],[1440,1425,256,'docked'],[1440,1425,64,'docked'],[1200,1185,256,'overlay'],[1200,1185,64,'docked'],[1295,1295,256,'overlay'],[1296,1296,256,'docked'],[720,705,0,'fullscreen']])assert.equal(assistantPresentation({viewportWidth,workspaceWidth,sidebarWidth}),expected,JSON.stringify({viewportWidth,workspaceWidth,sidebarWidth}));
 assert.equal(assistantPresentation({viewportWidth:1440,workspaceWidth:1000,sidebarWidth:256}),'overlay','embedded shell narrower than viewport');
 assert.equal(assistantPresentation({viewportWidth:1296,workspaceWidth:1296,sidebarWidth:256,minMainWidth:641}),'overlay','configurable main threshold');
});

test('resize and sidebar changes keep conversation, open preference and draft; geometry is not persisted',async t=>{
 const oldWindow=globalThis.window,oldDocument=globalThis.document,oldStorage=globalThis.localStorage,oldAct=globalThis.IS_REACT_ACT_ENVIRONMENT;
 const storage=new Map(),window=new EventTarget();window.innerWidth=1440;window.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
 globalThis.window=window;globalThis.document={documentElement:{clientWidth:1425}};globalThis.localStorage=window.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let latest,tree;function Probe(){latest=useAssistantUi();const [draft,setDraft]=useState('');return h('input',{value:draft,onChange:e=>setDraft(e.target.value)});}
 t.after(async()=>{if(tree)await act(()=>tree.unmount());globalThis.window=oldWindow;globalThis.document=oldDocument;globalThis.localStorage=oldStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct;});
 await act(()=>{tree=create(h(AssistantProvider,null,h(Probe)));});
 await act(()=>{latest.setWorkspaceGeometry({width:1425,sidebarWidth:256});latest.setOpen(true);latest.setActiveConversationId('conversation-fixture');tree.root.findByType('input').props.onChange({target:{value:'Message non envoyé'}});});
 assert.equal(latest.presentation,'docked');
 for(const [width,sidebarWidth,mode]of [[768,256,'overlay'],[390,0,'fullscreen'],[1200,256,'overlay'],[1200,64,'docked']]){
   await act(()=>{window.innerWidth=width;document.documentElement.clientWidth=width-15;window.dispatchEvent(new Event('resize'));latest.setWorkspaceGeometry({width:width-15,sidebarWidth});});
   assert.equal(latest.presentation,mode);assert.equal(latest.open,true);assert.equal(latest.activeConversationId,'conversation-fixture');assert.equal(tree.root.findByType('input').props.value,'Message non envoyé');
 }
 await act(()=>latest.setOpen(false));assert.equal(latest.open,false);assert.ok(storage.size);for(const value of storage.values())assert.deepEqual(Object.keys(JSON.parse(value)).sort(),['activeConversationId','open']);
});
