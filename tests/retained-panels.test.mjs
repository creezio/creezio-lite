import './register-ui-loader.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
const {createElement:h,useState,useEffect}=await import('react');const {create,act}=await import('react-test-renderer');
const {RetainedPanels}=await import('../runtime/ui/retained-panels.tsx');
const {usePaneActive,PaneActivityBoundary}=await import('../runtime/modules/shell-ui/ui/workspace/keep-alive.tsx');
test('nested panels retain drafts, close inactive portals and unmount revoked views',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const mounts={a:0,b:0},unmounts={a:0,b:0};let tree;
 function Probe({id}){const [draft,setDraft]=useState('');const active=usePaneActive();useEffect(()=>{mounts[id]++;return()=>{unmounts[id]++;};},[]);return h('input',{'data-probe':id,'data-portal-open':active,value:draft,onChange:e=>setDraft(e.target.value)});}
 const view=(active,ids=['a','b'],parent=true)=>h(PaneActivityBoundary,{active:parent},h(RetainedPanels,{active,views:ids.map(id=>({id,content:h(Probe,{id})}))}));
 try{
  await act(()=>{tree=create(view('a'));});assert.deepEqual(mounts,{a:1,b:0});
  await act(()=>tree.root.findByProps({'data-probe':'a'}).props.onChange({target:{value:'Draft A'}}));
  await act(()=>tree.update(view('b')));assert.deepEqual(mounts,{a:1,b:1});assert.equal(tree.root.findByProps({'data-probe':'a'}).props['data-portal-open'],false);
  await act(()=>tree.update(view('a')));assert.equal(tree.root.findByProps({'data-probe':'a'}).props.value,'Draft A');assert.equal(unmounts.a,0);
  await act(()=>tree.update(view('a',['a','b'],false)));assert.equal(tree.root.findAllByType('input').some(n=>n.props['data-portal-open']),false);
  await act(()=>tree.update(view('b',['b'])));assert.equal(unmounts.a,1);assert.equal(tree.root.findAllByProps({'data-probe':'a'}).length,0);
  await act(()=>tree.update(view('a')));assert.equal(tree.root.findByProps({'data-probe':'a'}).props.value,'');
 }finally{if(tree)await act(()=>tree.unmount());delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});
