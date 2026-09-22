import test from 'node:test';import assert from 'node:assert/strict';
import {localDb,client,boot,alice,bob} from './helpers.mjs';
import {defineApp} from '../runtime/core/index.ts';
const app=defineApp({id:'sorting',name:'Sorting',description:'Sorting fixture',modules:[{id:'items',name:'Items',singular:'Item',description:'Sorted items',titleField:'name',fields:[{key:'name',label:'Name',type:'text',required:true},{key:'amount',label:'Amount',type:'number'}]}]});
test('remote sort precedes pagination across all authorized rows and uses numeric values',async t=>{
 const db=await localDb();t.after(()=>db.close());const call=client(db,alice,undefined,app);await boot(call);
 for(let i=0;i<35;i++){const r=await call('modules/items/records',{method:'POST',body:{data:{name:'N'+String(34-i).padStart(2,'0'),amount:i}}});assert.equal(r.status,201);}
 const other=client(db,bob,undefined,app);await boot(other);await other('modules/items/records',{method:'POST',body:{data:{name:'AAA private',amount:99999}}});
 const get=async query=>{const r=await call('modules/items/records?'+query);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
 const first=await get('sort=name&direction=asc&limit=30'),second=await get('sort=name&direction=asc&limit=30&offset=30');
 assert.equal(first.total,35);assert.deepEqual([...first.items,...second.items].map(r=>r.data.name),Array.from({length:35},(_,i)=>'N'+String(i).padStart(2,'0')));
 assert.deepEqual((await get('sort=amount&direction=desc&limit=3')).items.map(r=>r.data.amount),[34,33,32]);
 assert.equal((await call('modules/items/records?sort=undeclared')).status,400);
 assert.equal((await call('modules/items/records?sort=name&direction=drop')).status,400);
});
