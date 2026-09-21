import './register-ui-loader.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
const {createElement:h}=await import('react');const {create,act}=await import('react-test-renderer');
const {useLoad}=await import('../runtime/ui/client.ts');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
test('refresh retains current data; identity switch clears immediately and ignores late results',async()=>{
 const pending=[];const load=()=>new Promise((resolve,reject)=>pending.push({resolve,reject}));
 function View({id,revision}){const state=useLoad(load,[id,revision],[id]);return h('output',null,JSON.stringify(state));}
 let tree;await act(()=>{tree=create(h(View,{id:'A',revision:0}));});
 const state=()=>JSON.parse(tree.toJSON().children[0]);
 try{
  await act(async()=>{pending[0].resolve({id:'A'});});assert.deepEqual(state().data,{id:'A'});
  await act(()=>tree.update(h(View,{id:'A',revision:1})));assert.deepEqual(state().data,{id:'A'});assert.equal(state().loading,true);
  await act(()=>tree.update(h(View,{id:'B',revision:1})));assert.equal(state().data,null);
  await act(async()=>{pending[1].resolve({id:'obsolete A'});});assert.equal(state().data,null);
  await act(async()=>{pending[2].resolve({id:'B'});});assert.deepEqual(state().data,{id:'B'});
  await act(()=>tree.update(h(View,{id:'B',revision:2})));await act(async()=>{pending[3].reject(new Error('Forbidden'));});assert.equal(state().data,null);
 }finally{await act(()=>tree.unmount());}
});
