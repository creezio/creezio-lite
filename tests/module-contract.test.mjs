import test from 'node:test';import assert from 'node:assert/strict';
import {defineApp,createBrandModuleRegistry,defineExtensions,read} from '../runtime/core/index.ts';
import {client,boot,localDb,alice,bob} from './helpers.mjs';
const schema={id:'items',name:'Items',singular:'Item',description:'Inventory',titleField:'name',fields:[{key:'name',label:'Name',type:'text',required:true},{key:'quantity',label:'Quantity',type:'number',integer:true,min:0}]};
const app=defineApp({id:'inventory',name:'Inventory',description:'Fixture',modules:[schema]});
const module=extra=>({id:'inventory',entitySpecs:{items:{schema,storage:{kind:'records'}}},...extra});
test('module registry rejects schema drift, missing/duplicate owners and cross-module operations or migrations',()=>{
 assert.throws(()=>createBrandModuleRegistry(app,[]),/no owning module/);
 assert.throws(()=>createBrandModuleRegistry(app,[module(),{...module(),id:'second'}]),/two modules/);
 assert.throws(()=>createBrandModuleRegistry(app,[module({entitySpecs:{items:{schema:{...schema,name:'drift'},storage:{kind:'records'}}}})]),/schema differs/);
 const operation=read({moduleId:'other',name:'report',target:'module',description:'Report',async handle(){return {body:{}};}});
 assert.throws(()=>createBrandModuleRegistry(app,[module({operations:[operation]})]),/outside owning module/);
 assert.throws(()=>createBrandModuleRegistry(app,[module({tables:['own_table'],migrations:[{id:'mod_inventory_001',file:'drizzle/0015_example.sql',tables:['foreign_table']}]})]),/Cross-module/);
});
test('module CRUD hooks run behind scope checks, preserve envelopes and revalidate changes before committing',async t=>{
 const db=await localDb();t.after(()=>db.close());let reads=0,archives=0;
 const registry=createBrandModuleRegistry(app,[module({entitySpecs:{items:{schema,storage:{kind:'records'},hooks:{
  beforeCreate({data}){if(data.name==='invalid')data.quantity=-1;else data.name=String(data.name).toUpperCase();},
  beforeUpdate({data}){data.quantity=Number(data.quantity)+1;},
  afterRead({record}){reads++;record.id='forged';return {...record.data,display:`${record.data.name} (${record.data.quantity})`};},
  beforeArchive(){archives++;},
 }}}})]);
 const options=defineExtensions(app,{registry}),a=client(db,alice,undefined,app,options),b=client(db,bob,undefined,app,options);await boot(a);await boot(b);
 assert.equal((await a('modules/items/records',{method:'POST',body:{data:{name:'invalid',quantity:1}}})).status,400);
 const made=await a('modules/items/records',{method:'POST',body:{data:{name:'box',quantity:2}}});assert.equal(made.status,201);const rec=made.body.record;assert.notEqual(rec.id,'forged');assert.equal(rec.data.display,'BOX (2)');
 const stored=await db.prepare('SELECT data FROM lite_records WHERE id=?').bind(rec.id).first();assert.equal(JSON.parse(stored.data).display,undefined);
 const before=reads;assert.equal((await b('modules/items/records/'+rec.id)).status,404);assert.equal(reads,before);
 assert.equal((await b('modules/items/records')).body.items.length,0);
 const update=await a('modules/items/records/'+rec.id,{method:'PATCH',body:{version:1,data:{name:'BOX',quantity:4}}});assert.equal(update.body.record.data.display,'BOX (5)');
 assert.equal((await a('modules/items/records')).body.items[0].data.display,'BOX (5)');
 assert.equal((await a('modules/items/records/'+rec.id,{method:'DELETE',body:{version:1}})).status,409);assert.equal(archives,0);
 assert.equal((await a('modules/items/records/'+rec.id,{method:'DELETE',body:{version:2}})).status,200);assert.equal(archives,1);
});
test('module operations join the existing HTTP/MCP catalogue and collisions fail at declaration',()=>{
 const operation=read({moduleId:'items',name:'report',target:'module',description:'Report',async handle(){return {body:{count:3}};}});
 const registry=createBrandModuleRegistry(app,[module({operations:[operation]})]);
 assert.equal(defineExtensions(app,{registry}).operations[0],operation);
 assert.throws(()=>defineExtensions(app,{registry,operations:[operation]}),/duplicate|collision|double|dupliqu/i);
});

test('entity projections and post-commit hooks receive the request database behind workspace authorization',async t=>{
 const db=await localDb();t.after(()=>db.close());let projected=0,committed=0,archived=0;
 const count=async(ctx,live=true)=>Number((await ctx.db.prepare('SELECT COUNT(*) n FROM lite_records WHERE org_id=? AND module_id=?'+(live?' AND deleted_at IS NULL':'')).bind(ctx.workspace.id,ctx.module.id).first()).n);
 const registry=createBrandModuleRegistry(app,[module({entitySpecs:{items:{schema,storage:{kind:'records'},hooks:{
  async afterRead(ctx){assert.equal(ctx.db,db);projected++;return {...ctx.record.data,workspaceCount:await count(ctx)};},
  async afterList(ctx){assert.equal(ctx.db,db);const total=await count(ctx);return ctx.records.map(record=>({...record.data,workspaceCount:total}));},
  async afterCreate(ctx){assert.equal(ctx.db,db);assert.ok(await count(ctx));committed++;},
  async beforeArchive(ctx){assert.equal(ctx.db,db);assert.ok(await count(ctx));},
  async afterArchive(ctx){assert.equal(ctx.db,db);assert.equal(await count(ctx),0);archived++;},
 }}}})]);
 const options=defineExtensions(app,{registry}),a=client(db,alice,undefined,app,options),b=client(db,bob,undefined,app,options);await boot(a);await boot(b);
 const made=await a('modules/items/records',{method:'POST',body:{data:{name:'box',quantity:2}}});assert.equal(made.status,201);assert.equal(made.body.record.data.workspaceCount,1);assert.equal(committed,1);
 const before=projected;assert.equal((await b('modules/items/records/'+made.body.record.id)).status,404);assert.equal(projected,before);
 assert.equal((await b('modules/items/records')).body.items.length,0);assert.equal((await a('modules/items/records')).body.items[0].data.workspaceCount,1);
 assert.equal(JSON.parse((await db.prepare('SELECT data FROM lite_records WHERE id=?').bind(made.body.record.id).first()).data).workspaceCount,undefined);
 const removed=await a('modules/items/records/'+made.body.record.id,{method:'DELETE',body:{version:1}});assert.equal(removed.status,200);assert.equal(archived,1);
});
