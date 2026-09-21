import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';import vm from 'node:vm';
import {stabilizeVinextSlotContexts} from '../runtime/modules/sites-adapter/build/router-contexts.ts';
test('versioned and unversioned Vinext slot imports share all four contexts',()=>{
 const names=['ElementsContext','ChildrenContext','ParallelSlotsContext','BfcacheIdentityMapContext'];
 const source=names.map(name=>'const '+name+' = React$1.createContext(null);').join('\n');
 let created=0;const scope={React$1:{createContext:()=>({id:++created})},Symbol};
 const evaluate=id=>vm.runInNewContext('(function(){'+stabilizeVinextSlotContexts(source,id)+';return ['+names.join(',')+'];})()',scope);
 const first=evaluate('/node_modules/vinext/dist/shims/slot.js'),second=evaluate('/node_modules/vinext/dist/shims/slot.js?v=hash');
 assert.equal(created,4);names.forEach((name,i)=>assert.equal(first[i],second[i],name));
 assert.equal(stabilizeVinextSlotContexts(source,'/app/slot.js'),null);
 assert.throws(()=>stabilizeVinextSlotContexts('changed source','/vinext/dist/shims/slot.js'),/Review the host adapter/);
});
test('adapter matches the installed Vinext source and is idempotent',()=>{
 const path=fileURLToPath(new URL('../template/node_modules/vinext/dist/shims/slot.js',import.meta.url)),source=readFileSync(path,'utf8');
 const adapted=stabilizeVinextSlotContexts(source,path);assert.notEqual(adapted,source);
 assert.equal(stabilizeVinextSlotContexts(adapted,path),adapted);
});
