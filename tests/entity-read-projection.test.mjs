import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {defineApp,defineExtensions,createBrandModuleRegistry,relationalEntityMigration,entityStorage} from '../runtime/core/index.ts';
import {coreOperations} from '../runtime/core/operations.ts';
import {localDb,client,boot,alice,bob,root,migrationSql} from './helpers.mjs';
const schema={id:'parcels',name:'Parcels',singular:'Parcel',description:'Read projection',titleField:'name',fields:[
 {key:'name',label:'Name',type:'text',required:true},
 {key:'tracking',label:'Tracking',type:'text',storage:'computed',queryable:true,searchable:true,editable:false},
 {key:'display',label:'Display',type:'text',storage:'computed'},
],serverFields:[{key:'carrier_note',label:'Note',type:'text',storage:'computed',queryable:true}]};
const app=defineApp({id:'fulfillment',name:'Fulfillment',description:'Test',modules:[schema]});
const spec={schema,storage:{kind:'relational',table:'parcels'},readProjection:base=>`(SELECT b.id,b.org_id,b.module_id,json_set(b.data,'$.tracking',t.tracking,'$.carrier_note',t.note) AS data,b.version,b.created_by,b.created_at,b.updated_at,b.deleted_at FROM ${base} b LEFT JOIN tracking t ON t.record_id=b.id AND t.org_id=b.org_id)`};
const options=defineExtensions(app,{registry:createBrandModuleRegistry(app,[{id:'parcels',entitySpecs:{parcels:spec},tables:['parcels']},{id:'tracking',entitySpecs:{},tables:['tracking']}])});
async function exercise(db){
 await db.prepare('CREATE TABLE tracking(org_id TEXT NOT NULL,record_id TEXT NOT NULL,tracking TEXT,note TEXT,PRIMARY KEY(org_id,record_id))').run();
 for(const sql of relationalEntityMigration(spec))await db.prepare(sql).run();
 const source=entityStorage(schema,spec).source;
 const refresh=ref=>`DELETE FROM lite_search_documents WHERE org_id=${ref}.org_id AND module_id='parcels' AND record_id=${ref}.record_id; INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT org_id,module_id,id,data,updated_at FROM ${source} WHERE org_id=${ref}.org_id AND id=${ref}.record_id AND deleted_at IS NULL;`;
 // The related module owns invalidation when its row changes; no duplicate business column.
 for(const [event,body]of [['INSERT',refresh('NEW')],['UPDATE',refresh('OLD')+refresh('NEW')],['DELETE',refresh('OLD')]])await db.prepare(`CREATE TRIGGER tracking_${event.toLowerCase()} AFTER ${event} ON tracking BEGIN ${body} END`).run();
 const a=client(db,alice,undefined,app,options),b=client(db,bob,undefined,app,options),org=await boot(a),other=await boot(b);
 const create=async name=>{const made=await a('modules/parcels/records',{method:'POST',body:{data:{name}}});assert.equal(made.status,201,JSON.stringify(made.body));return made.body.record;};
 const first=await create('First'),second=await create('Second');
 assert.equal((await a('modules/parcels/records',{method:'POST',body:{data:{name:'Fake',tracking:'forged'}}})).status,400);
 assert.equal((await db.prepare('SELECT count(*) n FROM lite_records WHERE org_id=?').bind(org).first()).n,0);
 const columns=(await db.prepare('PRAGMA table_info(parcels)').all()).results.map(row=>row.name);assert.ok(!columns.includes('tracking'));assert.ok(!columns.includes('carrier_note'));
 await db.prepare('INSERT INTO tracking VALUES(?,?,?,?)').bind(other,first.id,'ConfidentialForeign','foreign secret').run();
 assert.equal((await a('modules/parcels/records/'+first.id)).body.record.data.tracking,null);
 await db.prepare('INSERT INTO tracking VALUES(?,?,?,?)').bind(org,first.id,'ZuluTracking','kept note').run();
 await db.prepare('INSERT INTO tracking VALUES(?,?,?,?)').bind(org,second.id,'AlphaTracking','other note').run();
 assert.equal((await a('modules/parcels/records?field=tracking&value=ZuluTracking')).body.total,1);
 assert.deepEqual((await a('modules/parcels/records?sort=tracking&limit=1')).body.items.map(row=>row.id),[second.id]);
 assert.equal((await a('modules/parcels/records?sort=display')).status,400);
 assert.equal((await b('modules/parcels/records?field=tracking&value=ZuluTracking')).body.total,0);
 assert.equal((await b('modules/parcels/records/'+first.id)).status,404);
 assert.equal((await a('search?q=ZuluTracking')).body.total,1);
 assert.equal((await a('search?q=ConfidentialForeign')).body.total,0);
 const changed=await a('modules/parcels/records/'+first.id,{method:'PATCH',body:{version:1,data:{name:'Renamed'}}});assert.equal(changed.status,200,JSON.stringify(changed.body));assert.equal(changed.body.record.data.tracking,'ZuluTracking');assert.equal(changed.body.record.data.carrier_note,'kept note');
 assert.equal((await a('search?q=ZuluTracking')).body.total,1);
 assert.equal((await a('modules/parcels/records/'+first.id,{method:'PATCH',body:{version:2,data:{tracking:'forged'}}})).status,400);
 await db.prepare('UPDATE tracking SET tracking=? WHERE org_id=? AND record_id=?').bind('ChangedTracking',org,first.id).run();
 assert.equal((await a('search?q=ZuluTracking')).body.total,0);assert.equal((await a('search?q=ChangedTracking')).body.total,1);
 assert.equal((await a('admin/search/reindex',{method:'POST',body:{reset:true}})).status,200);assert.equal((await a('search?q=ChangedTracking')).body.total,1);
 const patch=entityStorage(schema,spec).patchStatement({id:first.id,orgId:org,version:2,now:new Date().toISOString(),patch:{name:'Rollback'},filter:{sql:"json_extract(r.data,'$.tracking')=?",bindings:['ChangedTracking']}});
 await assert.rejects(()=>db.batch([db.prepare(patch.sql).bind(...patch.bindings),db.prepare('UPDATE tracking SET tracking=? WHERE org_id=? AND record_id=?').bind('RolledBack',org,first.id),db.prepare('SELECT * FROM missing_transaction_target')]));
 assert.equal((await a('modules/parcels/records/'+first.id)).body.record.version,2);assert.equal((await a('search?q=ChangedTracking')).body.total,1);assert.equal((await a('search?q=RolledBack')).body.total,0);
 assert.equal((await a('modules/parcels/records/'+first.id,{method:'DELETE',body:{version:2}})).status,200);assert.equal((await a('search?q=ChangedTracking')).body.total,0);
}
test('SQL read projection preserves related filters, counts, pagination, search and transaction isolation',async t=>{const db=await localDb();t.after(()=>db.close());await exercise(db);});
test('real Cloudflare D1 supports the same read projection without stored mirrors',async()=>{
 const wr=createRequire(createRequire(join(root,'template/package.json')).resolve('wrangler/package.json'));const {Miniflare}=await import(pathToFileURL(wr.resolve('miniflare')).href);const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],cf:false});
 try{const db=await mf.getD1Database('DB');for(const sql of (await migrationSql()).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();await exercise(db);}finally{await mf.dispose();}
});
test('SQL query fields require an explicit relational source and keep write and MCP contracts closed',()=>{
 assert.throws(()=>entityStorage(schema,{schema,storage:{kind:'relational',table:'parcels'}}),/require a SQL read projection/);
 assert.throws(()=>entityStorage(schema,{...spec,storage:{kind:'records'}}),/relational/);
 for(const readProjection of [()=>'(DELETE FROM parcels)',()=>'(SELECT ?)',()=>'(SELECT :value)',()=>'(SELECT 1);'])assert.throws(()=>entityStorage(schema,{...spec,readProjection}),/SELECT source/);
 assert.doesNotThrow(()=>entityStorage(schema,{...spec,readProjection:base=>`(SELECT *, 'https://example.test/?code=a;b' AS url FROM ${base})`}));
 const list=coreOperations(app).find(op=>op.id==='module.parcels.list');assert.ok(list.querySchema.properties.sort.enum.includes('tracking'));assert.ok(!list.querySchema.properties.sort.enum.includes('display'));
 const create=coreOperations(app).find(op=>op.id==='module.parcels.create');assert.ok(!Object.hasOwn(create.bodySchema.properties.data.properties,'tracking'));
 assert.throws(()=>defineApp({...app,modules:[{...schema,fields:[schema.fields[0],{...schema.fields[1],editable:true}]}]}),/calculé/);
});
