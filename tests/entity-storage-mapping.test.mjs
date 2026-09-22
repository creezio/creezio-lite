import test from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {pathToFileURL,fileURLToPath} from 'node:url';import {join} from 'node:path';
import {mkdtemp,mkdir,readFile,readdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';
import {defineApp,entityStorage,relationalEntityMigration,createBrandModuleRegistry,defineExtensions} from '../runtime/core/index.ts';
import {assertEntityStorage} from '../runtime/core/entity-storage.ts';
import {localDb,client,boot,alice,bob,root,migrationSql} from './helpers.mjs';
import {createApp} from '../bin/lite.mjs';import {scaffoldModuleStorage} from '../bin/module-storage.mjs';
const schema={id:'mapped',name:'Mapped',singular:'Mapped',description:'Preserve public keys',titleField:'displayName',fields:[{key:'displayName',label:'Name',type:'text',required:true},{key:'orderId',label:'Order',type:'text'},{key:'rowCount',label:'Count',type:'number',integer:true}],serverFields:[{key:'createdAt',label:'Source date',type:'text'},{key:'isReady',label:'Ready',type:'boolean'},{key:'frozenDocument',label:'Snapshot',type:'textarea',encoding:'json'}]};
const columns={displayName:'display_name',orderId:'order_id',rowCount:'row_count',createdAt:'source_created_at',isReady:'is_ready',frozenDocument:'frozen_document'};
const spec={schema,storage:{kind:'relational',table:'mapped_items',columns}};
const app=defineApp({id:'mapped-app',name:'Mapped app',description:'Mapping',modules:[schema]});
async function exercise(db){
 for(const sql of relationalEntityMigration(spec))await db.prepare(sql).run();
 const options=defineExtensions(app,{registry:createBrandModuleRegistry(app,[{id:'mapped',tables:['mapped_items'],entitySpecs:{mapped:spec}}])});
 const a=client(db,alice,undefined,app,options),b=client(db,bob,undefined,app,options),org=await boot(a);await boot(b);
 const result=await a('modules/mapped/records',{method:'POST',body:{data:{displayName:'Uniqueinvoice',orderId:'legacy-order',rowCount:2}}});assert.equal(result.status,201,JSON.stringify(result.body));const record=result.body.record,adapter=entityStorage(schema,spec);
 assert.equal(Object.hasOwn(record.data,'frozenDocument'),false);
 assert.equal(record.data.displayName,'Uniqueinvoice');assert.equal(record.data.orderId,'legacy-order');assert.equal((await b('modules/mapped/records/'+record.id)).status,404);
 const patch=adapter.patchStatement({id:record.id,orgId:org,version:1,now:'2026-09-21',filter:{sql:'1=1',bindings:[]},patch:{createdAt:'old-exact-instant',isReady:false,frozenDocument:{lines:[{keep:true}]}}});
 await assert.rejects(()=>db.batch([db.prepare(patch.sql).bind(...patch.bindings),db.prepare('SELECT * FROM no_such_target')]));
 assert.equal((await a('modules/mapped/records/'+record.id)).body.record.version,1);
 await db.prepare(patch.sql).bind(...patch.bindings).run();
 const physical=await db.prepare('SELECT display_name,order_id,row_count,source_created_at,is_ready,frozen_document FROM mapped_items WHERE id=?').bind(record.id).first();assert.equal(physical.source_created_at,'old-exact-instant');assert.equal(physical.is_ready,0);assert.deepEqual(JSON.parse(physical.frozen_document),{lines:[{keep:true}]});
 const dto=(await a('modules/mapped/records/'+record.id)).body.record;assert.equal(dto.data.createdAt,'old-exact-instant');assert.equal(dto.data.isReady,false);assert.deepEqual(dto.data.frozenDocument,{lines:[{keep:true}]});assert.equal(Object.hasOwn(dto.data,'source_created_at'),false);
 assert.equal((await a('modules/mapped/records?field=orderId&value=legacy-order&sort=rowCount')).body.total,1);
 assert.equal((await a('search?q=Uniqueinvoice')).body.total,1);assert.equal((await b('search?q=Uniqueinvoice')).body.total,0);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM lite_records WHERE module_id='mapped'").first()).n,0);
 assert.equal((await a('modules/mapped/records/'+record.id,{method:'PATCH',body:{version:2,data:{createdAt:'forged'}}})).status,400);
 const clear=adapter.patchStatement({id:record.id,orgId:org,version:2,now:'2026-09-22',filter:{sql:'1=1',bindings:[]},patch:{frozenDocument:null}});
 await assert.rejects(()=>db.batch([db.prepare(clear.sql).bind(...clear.bindings),db.prepare('SELECT * FROM no_such_target')]));
 assert.deepEqual((await a('modules/mapped/records/'+record.id)).body.record.data.frozenDocument,{lines:[{keep:true}]});
 await db.prepare(clear.sql).bind(...clear.bindings).run();
 assert.equal((await db.prepare('SELECT frozen_document FROM mapped_items WHERE id=?').bind(record.id).first()).frozen_document,'null');
 assert.equal((await a('modules/mapped/records/'+record.id)).body.record.data.frozenDocument,null);
 assert.equal(JSON.parse((await db.prepare('SELECT data FROM lite_search_documents WHERE record_id=?').bind(record.id).first()).data).frozenDocument,null);
 const nullId=crypto.randomUUID();await adapter.insert(db,{id:nullId,orgId:org,userId:alice.userId,now:'2026-09-22',data:{displayName:'Explicit null',frozenDocument:null}}).run();
 assert.equal((await a('modules/mapped/records/'+nullId)).body.record.data.frozenDocument,null);
 const replace=adapter.updateStatement({id:nullId,orgId:org,version:1,now:'2026-09-22',filter:{sql:'1=1',bindings:[]},data:{displayName:'Still null',frozenDocument:null}});await db.prepare(replace.sql).bind(...replace.bindings).run();
 assert.equal((await a('modules/mapped/records/'+nullId)).body.record.data.frozenDocument,null);

}
test('mapped logical camelCase keys retain their DTO on SQLite with snake_case columns',async t=>{const db=await localDb();t.after(()=>db.close());await exercise(db);});
test('mapped logical camelCase keys retain their DTO on actual D1',async()=>{const wr=createRequire(createRequire(join(root,'template/package.json')).resolve('wrangler/package.json'));const {Miniflare}=await import(pathToFileURL(wr.resolve('miniflare')).href);const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],cf:false});try{const db=await mf.getD1Database('DB');for(const sql of (await migrationSql()).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();await exercise(db);}finally{await mf.dispose();}});
test('logical key compatibility never relaxes physical identifiers or collision checks',()=>{
 for(const mapping of [{...columns,createdAt:'created_at'},{...columns,orderId:'display_name'},{...columns,orderId:'orderId'},{...columns,orderId:'order_id;DROP TABLE mapped_items'},{}])assert.throws(()=>assertEntityStorage({...spec,storage:{...spec.storage,columns:mapping}}));
 for(const key of ['order.id',"key'",'constructor','prototype','__proto__'])assert.throws(()=>defineApp({...app,modules:[{...schema,serverFields:[{key,label:'Invalid',type:'text'}]}]}));
});
test('explicit column mappings are identical in generated SQL, Drizzle and new snapshot',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'lite-mapped-storage-')),dir=join(parent,'app');
 try{await createApp({out:dir,spec:fileURLToPath(new URL('../examples/services.json',import.meta.url))});await mkdir(join(dir,'app/modules/mapped'),{recursive:true});const result=await scaffoldModuleStorage(dir,schema,{table:'mapped_items',columns});assert.deepEqual(result.columns,columns);
 const source=await readFile(join(dir,'app/modules/mapped/db-schema.ts'),'utf8'),sql=await readFile(join(dir,result.migration.file),'utf8'),snapshots=(await readdir(join(dir,'drizzle/meta'))).filter(f=>f.endsWith('_snapshot.json')).sort(),snapshot=JSON.parse(await readFile(join(dir,'drizzle/meta',snapshots.at(-1)),'utf8'));
 for(const name of Object.values(columns)){assert.ok(snapshot.tables.mapped_items.columns[name]);assert.ok(source.includes('"'+name+'"'));assert.ok(sql.includes('"'+name+'"'));}
 const before=await readFile(join(dir,'drizzle/meta/_journal.json'),'utf8');await assert.rejects(scaffoldModuleStorage(dir,{...schema,id:'invalid'},{table:'invalid',columns:{...columns,createdAt:'created_at'}}));assert.equal(await readFile(join(dir,'drizzle/meta/_journal.json'),'utf8'),before);
 }finally{await rm(parent,{recursive:true,force:true});}
});
