import './register-native-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const {assistantProviderTools}=await import('../runtime/core/assistant.ts');
const schema={type:'object',properties:{},additionalProperties:false};
test('overflow remains discoverable and cannot execute after revocation',async()=>{
 let enabled=true,calls=0;
 const catalogue=Array.from({length:181},(_,i)=>({name:`lite_fixture_${i}`,description:`Fixture action ${i}`,inputSchema:schema,execute:async()=>({index:i})}));
 const target={name:'lite_fixture_inventory',description:'Réconcilier inventaire physique',inputSchema:{type:'object',properties:{qty:{type:'integer'}},required:['qty'],additionalProperties:false},execute:async()=>{calls++;return {ok:true};}};
 const services={tools:async()=>enabled?[...catalogue,target]:catalogue};
 const tools=assistantProviderTools(services,await services.tools(),'catalogue');
 assert.ok(tools.length<=128);const search=tools.find(t=>t.name==='lite_tools_search'),call=tools.find(t=>t.name==='lite_tools_call');
 assert.equal((await search.execute({query:'inventaire'})).tools[0].name,target.name);
 assert.deepEqual(await call.execute({name:target.name,arguments:{qty:1}}),{ok:true});
 await assert.rejects(call.execute({name:target.name,arguments:{qty:'1'}}),e=>e.code==='invalid_arguments');
 enabled=false;assert.deepEqual((await search.execute({query:'inventaire'})).tools,[]);
 await assert.rejects(call.execute({name:target.name,arguments:{qty:1}}),e=>e.code==='tool_forbidden');
 await assert.rejects(call.execute({name:'lite_tools_call',arguments:{}}),e=>e.code==='tool_forbidden');assert.equal(calls,1);
});
test('curated direct tools intersect current authorization and preserve discovery',async()=>{
 const allowed=[{name:'read',description:'Read',inputSchema:schema,execute:async()=>({ok:true})}];
 const tools=assistantProviderTools({tools:async()=>allowed},allowed,'read',['read','forbidden']);
 assert.deepEqual(tools.map(t=>t.name),['lite_tools_search','lite_tools_call','read']);
});
