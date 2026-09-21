import test from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {join} from 'node:path';
import {defineApp,defineExtensions,createBrandModuleRegistry,relationalEntityMigration,prepareEntityWrite,runAfterCommit,moduleDataSchema,commitWithEffects,validateStoredData,validateStoredPatch,entityStorage} from '../runtime/core/index.ts';
import {coreOperations} from '../runtime/core/operations.ts';
import {localDb,client,boot,alice,bob,root,migrationSql} from './helpers.mjs';
const schema={serverFields:[{key:'active',label:'Active',type:'boolean'}],id:'inventory',name:'Inventory',singular:'Item',description:'Inventory',titleField:'name',fields:[
 {key:'name',label:'Name',type:'text',required:true},{key:'quantity',label:'Quantity',type:'number',integer:true,min:0},
 {key:'approved',label:'Approved',type:'boolean',editable:false},{key:'tags',label:'Tags',type:'textarea',encoding:'json'},
 {key:'display',label:'Display',type:'text',storage:'computed'},
]};
const app=defineApp({id:'warehouse',name:'Warehouse',description:'Test',modules:[schema]});
function configuration(storage,hooks={},beforeWrite){const spec={schema,storage,hooks};return {spec,options:defineExtensions(app,{registry:createBrandModuleRegistry(app,[{id:'inventory',tables:storage.kind==='relational'?[storage.table]:[],entitySpecs:{inventory:spec},beforeWrite}])})};}
const data={name:'Box',quantity:2,tags:'["one"]'};
async function exercise(db){
 const events=[];const {spec,options}=configuration({kind:'relational',table:'inventory_items',columns:{name:'label'}},{
  beforeCreate({data}){data.approved=true;},beforeUpdate({data}){if(data.name==='bad-hook')data.quantity=-1;},
  afterRead({record}){return {...record.data,display:`${record.data.name}: ${record.data.quantity}`};},
  async afterCreate({record,workspace}){assert.ok(await db.prepare('SELECT id FROM inventory_items WHERE id=? AND org_id=?').bind(record.id,workspace.id).first());events.push('create');},
  afterUpdate(){events.push('update');},afterArchive(){events.push('archive');},
 });
 for(const sql of relationalEntityMigration(spec))await db.prepare(sql).run();
 const a=client(db,alice,undefined,app,options),b=client(db,bob,undefined,app,options),org=await boot(a);await boot(b);
 for(const invalid of [{...data,approved:true},{...data,display:'forged'},{...data,quantity:-1},{...data,unknown:'x'}])assert.equal((await a('modules/inventory/records',{method:'POST',body:{data:invalid}})).status,400);
 const made=await a('modules/inventory/records',{method:'POST',body:{data}});assert.equal(made.status,201,JSON.stringify(made.body));const record=made.body.record;
 assert.equal(Object.hasOwn(record.data,'active'),false);assert.equal(record.data.approved,true);assert.deepEqual(record.data.tags,['one']);assert.equal(record.data.display,'Box: 2');assert.deepEqual(events,['create']);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM lite_records WHERE org_id=?').bind(org).first()).n,0);
 const physical=await db.prepare('SELECT label,quantity,approved,tags FROM inventory_items WHERE id=?').bind(record.id).first();assert.equal(physical.label,'Box');assert.equal(physical.approved,1);
 assert.equal((await b('modules/inventory/records/'+record.id)).status,404);assert.equal((await b('modules/inventory/records')).body.total,0);
 assert.equal((await a('modules/inventory/records?field=approved&value=1')).body.total,1);
 assert.equal((await a('modules/inventory/records?sort=display')).status,400);
 assert.equal((await a('modules/inventory/records?q=Box')).body.total,1);
 assert.equal((await a('search?q=Box')).body.total,1);assert.equal((await b('search?q=Box')).body.total,0);
 assert.equal((await a('admin/search/reindex',{method:'POST',body:{reset:true}})).status,200);assert.equal((await a('search?q=Box')).body.total,1);
 assert.equal((await a('modules/inventory/records/'+record.id,{method:'PATCH',body:{version:1,data:{...data,name:'bad-hook'}}})).status,400);
 assert.deepEqual(events,['create']);assert.equal((await a('modules/inventory/records/'+record.id)).body.record.version,1);
 const updated=await a('modules/inventory/records/'+record.id,{method:'PATCH',body:{version:1,data:{...data,name:'Crate'}}});assert.equal(updated.status,200,JSON.stringify(updated.body));assert.equal(updated.body.record.data.approved,true);assert.equal(Object.hasOwn(updated.body.record.data,'active'),false);assert.equal((await db.prepare('SELECT active FROM inventory_items WHERE id=?').bind(record.id).first()).active,null);
 assert.equal((await a('search?q=Box')).body.total,0);assert.equal((await a('search?q=Crate')).body.total,1);
 assert.equal((await a('modules/inventory/records/'+record.id,{method:'PATCH',body:{version:1,data}})).status,409);assert.deepEqual(events,['create','update']);
 assert.equal((await b('modules/inventory/records/'+record.id,{method:'DELETE',body:{version:2}})).status,404);
 assert.equal((await a('modules/inventory/records/'+record.id,{method:'DELETE',body:{version:2}})).status,200);assert.deepEqual(events,['create','update','archive']);assert.equal((await a('search?q=Crate')).body.total,0);
 const wide={...schema,id:'wide',serverFields:Array.from({length:80},(_,i)=>({key:'snapshot_'+i,label:'Snapshot '+i,type:'text'}))};
 const wideSpec={schema:wide,storage:{kind:'relational',table:'wide_items'}};
 for(const sql of relationalEntityMigration(wideSpec))await db.prepare(sql).run();
 const adapter=entityStorage(wide,wideSpec),wideData={...data,...Object.fromEntries(wide.serverFields.map(f=>[f.key,'value']))};
 await adapter.insert(db,{id:'wide',orgId:org,data:wideData,userId:alice.userId,now:new Date().toISOString()}).run();
 const hydrated=await db.prepare(`SELECT data FROM ${adapter.source} WHERE id=?`).bind('wide').first();assert.equal(JSON.parse(hydrated.data).snapshot_79,'value');
}
test('relational D1 adapter: physical columns, field semantics, scope, search/reindex, CAS and commit hooks',async t=>{const db=await localDb();t.after(()=>db.close());await exercise(db);});
test('real Cloudflare D1 runs the same relational contract',async()=>{
 const wr=createRequire(createRequire(join(root,'template/package.json')).resolve('wrangler/package.json'));const {Miniflare}=await import(pathToFileURL(wr.resolve('miniflare')).href);
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],cf:false});
 try{const db=await mf.getD1Database('DB');for(const sql of (await migrationSql()).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();await exercise(db);}finally{await mf.dispose();}
});
test('server commands validate post-transformation values and share read-only exclusions with HTTP/MCP',async()=>{
 const context={module:schema,data,previous:null,workspace:{id:'org',role:'owner',name:'Org'},identity:alice};
 await assert.rejects(()=>prepareEntityWrite(context,{beforeWrite({data}){data.quantity=-4;}}),e=>e.code==='invalid_number');
 await assert.rejects(()=>prepareEntityWrite({...context,data:{...data,display:'forged'}},{source:'server'}),e=>e.code==='unknown_field');
 const result=await prepareEntityWrite({...context,data:{...data,approved:true}},{source:'server'});assert.equal(result.approved,true);
 for(const shape of [moduleDataSchema(schema),coreOperations(app).find(op=>op.id==='module.inventory.create').bodySchema.properties.data]){assert.ok(!shape.properties.approved);assert.ok(!shape.properties.display);assert.ok(shape.properties.name);}
});
test('rollback emits no hook; post-commit failure does not pretend the transaction failed',async t=>{
 const db=await localDb();t.after(()=>db.close());let effects=0;
 const {options}=configuration({kind:'records'},{afterCreate(){effects++;throw new Error('private failure');}});
 const a=client(db,alice,undefined,app,options);const org=await boot(a);
 const made=await a('modules/inventory/records',{method:'POST',body:{data}});assert.equal(made.status,201);assert.equal(made.body.effects[0].status,'failed');assert.equal(effects,1);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM lite_records WHERE org_id=?').bind(org).first()).n,1);
 await db.prepare("CREATE TRIGGER fail_entity BEFORE INSERT ON lite_records BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
 assert.equal((await a('modules/inventory/records',{method:'POST',body:{data}})).status,503);assert.equal(effects,1);
 assert.deepEqual(await runAfterCommit([{id:'a',run(){throw Error();}},{id:'b',run(){effects++;}}]),[{id:'a',status:'failed'},{id:'b',status:'done'}]);
});
test('relational declarations reject unsafe tables, duplicated/reserved columns and undeclared mappings',()=>{
 for(const storage of [{kind:'relational',table:'lite_users'},{kind:'relational',table:'items; DROP TABLE x'},{kind:'relational',table:'items',columns:{name:'org_id'}},{kind:'relational',table:'items',columns:{missing:'a'}},{kind:'relational',table:'items',columns:{name:'quantity'}}])assert.throws(()=>configuration(storage));
});

test('partial updates preserve stored server values; echoed values cannot change authority',async()=>{
 const context={module:schema,data:{quantity:4,approved:true},previous:{name:'Legacy',quantity:1,approved:true,tags:[]},workspace:{id:'org',role:'owner',name:'Org'},identity:alice};
 const next=await prepareEntityWrite(context);assert.equal(next.name,'Legacy');assert.equal(next.approved,true);assert.equal(next.quantity,4);
 await assert.rejects(()=>prepareEntityWrite({...context,data:{approved:false}}),e=>e.code==='readonly_field');
 const legacy={...schema,serverFields:[{key:'evidence',label:'Evidence',type:'text',required:true}]};
 assert.throws(()=>validateStoredData(legacy,{...data,approved:true}),e=>e.code==='required_field');
 assert.equal(validateStoredData(legacy,{...data,approved:true},{previous:{...data,approved:true}}).evidence,null);
 assert.throws(()=>validateStoredData(legacy,{...data,approved:true},{previous:{...data,approved:true,evidence:'Proof'}}),e=>e.code==='required_field');
});
test('custom transaction boundary runs effects only on success and preserves the original batch result',async()=>{
 let effects=0;const callbacks=[{id:'notification',run(){effects++;}}];
 await assert.rejects(()=>commitWithEffects(async()=>{throw Error('rollback');},callbacks));assert.equal(effects,0);
 const result={committed:true};assert.equal(await commitWithEffects(async()=>result,callbacks),result);assert.equal(effects,1);
});
test('relational row scope precedes pagination/counts; write denial cannot invoke hooks',async t=>{
 const db=await localDb();t.after(()=>db.close());let updates=0;
 const config=configuration({kind:'relational',table:'scoped_items'},{afterUpdate(){updates++;}});
 for(const sql of relationalEntityMigration(config.spec))await db.prepare(sql).run();
 const a=client(db,alice,undefined,app,config.options);await boot(a);
 const first=(await a('modules/inventory/records',{method:'POST',body:{data}})).body.record;
 await a('modules/inventory/records',{method:'POST',body:{data:{...data,name:'Hidden'}}});
 const scope={recordFilter(_p,ref,action){return {sql:action==='write'?'0=1':`${ref.alias}.${ref.idColumn}=?`,bindings:action==='write'?[]:[first.id]};},fileFilter(){return {sql:'0=1',bindings:[]};}};
 const limited=client(db,alice,undefined,app,{...config.options,scope});
 const page=await limited('modules/inventory/records?limit=1');assert.equal(page.body.total,1);assert.equal(page.body.items[0].id,first.id);
 assert.equal((await limited('search?q=Hidden')).body.total,0);
 assert.equal((await limited('modules/inventory/records/'+first.id,{method:'PATCH',body:{version:1,data:{name:'Forged'}}})).status,404);assert.equal(updates,0);
});

test('command patches validate all changed fields without rewriting untouched legacy values',()=>{
 const previous={name:'Legacy',quantity:2,approved:true,tags:[],old_snapshot:{kept:true}};
 const result=validateStoredPatch(schema,{quantity:3},previous);assert.equal(result.quantity,3);assert.deepEqual(result.old_snapshot,{kept:true});
 assert.throws(()=>validateStoredPatch(schema,{quantity:-1},previous),e=>e.code==='invalid_number');
 assert.throws(()=>validateStoredPatch(schema,{old_snapshot:{kept:false}},previous),e=>e.code==='unknown_field');
 assert.throws(()=>validateStoredPatch(schema,{name:null},previous),e=>e.code==='required_field');
 assert.throws(()=>validateStoredPatch(schema,{display:'not stored'},previous),e=>e.code==='unknown_field');
});
