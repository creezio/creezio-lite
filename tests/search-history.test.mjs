import './register-ui-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { configureGlobalSearch } = await import('../runtime/modules/shell-ui/ui/search/global-search-config.ts');
const { loadSearchHistory, pushRecentHit, pushSearchQuery } = await import('../runtime/modules/shell-ui/ui/search/search-history.ts');
test('Workspace search never displays or persists cached data from a previous session',()=>{
  const previousWindow=globalThis.window,previousStorage=globalThis.localStorage;
  let reads=0,writes=0;
  globalThis.window={};globalThis.localStorage={getItem(){reads++;return JSON.stringify({queries:['private'],recent:[{title:'Other workspace'}]});},setItem(){writes++;}};
  try{
    configureGlobalSearch({search:async()=>[],persistHistory:false});
    assert.deepEqual(loadSearchHistory(),{queries:[],recent:[]});
    pushRecentHit({index:'clients',id:'record',title:'Private client',href:'/clients?record=record'});pushSearchQuery('private');
    assert.equal(reads,0);assert.equal(writes,0);
  }finally{globalThis.window=previousWindow;globalThis.localStorage=previousStorage;}
});
