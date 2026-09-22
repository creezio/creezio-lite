import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {entityStorage,relationalEntityMigration,defineApp} from '../runtime/core/index.ts';
import {assertEntityStorage} from '../runtime/core/entity-storage.ts';
import {root,migrationSql,localDb} from './helpers.mjs';
const schema={id:'wide-test',name:'Wide',singular:'Wide',description:'D1 boundary',titleField:'name',fields:[{key:'name',label:'Name',type:'text',required:true},{key:'count',label:'Count',type:'number',integer:true},{key:'ratio',label:'Ratio',type:'number'},{key:'enabled',label:'Enabled',type:'boolean'},{key:'snapshot',label:'Snapshot',type:'textarea',encoding:'json'},{key:'display',label:'Display',type:'text',storage:'computed'}],serverFields:Array.from({length:88},(_,i)=>({key:'server_'+i,label:'Server '+i,type:'text'}))};
const spec={schema,storage:{kind:'relational',table:'wide_test'}};
const scope={sql:'r.org_id=? AND ?=? AND ?=? AND ?=? AND ?=?',bindings:['mine',1,1,2,2,3,3,4,4]};
const now='2026-09-21T00:00:00Z';
const data={name:'wide',count:7,ratio:2.25,enabled:true,snapshot:{a:[1,'é漢字',null,false]},...Object.fromEntries(schema.serverFields.map(f=>[f.key,'  preserved\nvalue  ']))};
async function exercise(db,kind){
 await db.prepare("INSERT INTO lite_users(id,email,name) VALUES('tester','tester@example.test','Tester')").run();
 await db.prepare("INSERT INTO lite_orgs(id,name,created_at) VALUES('mine','Mine',?)").bind(now).run();
 const adapter=entityStorage(schema,{...spec,storage:kind==='relational'?spec.storage:{kind}});
 if(kind==='relational'){
  for(const sql of relationalEntityMigration(spec))await db.prepare(sql).run();
  assert.equal((await db.prepare('PRAGMA table_info(wide_test)').all()).results.length,100);
 }
 const run=s=>{assert.ok(s.bindings.length<=100);return db.prepare(s.sql).bind(...s.bindings).run();};
 const read=async()=>JSON.parse((await db.prepare('SELECT data FROM '+adapter.source+" WHERE id='row'").first()).data);
 await adapter.insert(db,{id:'row',orgId:'mine',userId:'tester',now,data}).run();
 const next={...data,name:'updated',count:8,ratio:3.125,enabled:false,server_0:'',server_1:null};
 const update=(version=1,filter=scope)=>adapter.updateStatement({id:'row',orgId:'mine',now,data:next,version,filter});
 assert.equal((await run(update(1,{...scope,bindings:['foreign',...scope.bindings.slice(1)]}))).meta.changes,0);
 assert.ok((await run(update())).meta.changes>0);
 assert.equal((await run(update())).meta.changes,0);
 let row=await read();assert.equal(row.name,'updated');assert.equal(row.count,8);assert.equal(row.ratio,3.125);assert.equal(row.enabled,false);assert.equal(row.server_0,'');assert.deepEqual(row.snapshot,data.snapshot);assert.equal(row.server_87,data.server_87);
 if(kind==='relational')assert.equal((await db.prepare('SELECT typeof(count) c,typeof(ratio) r,enabled,server_1 FROM wide_test').first()).server_1,null);
 const patch={...next,name:'patched',enabled:true,snapshot:['array',3.75,false,null],server_0:'needle'};
 const statement=adapter.patchStatement({id:'row',orgId:'mine',now,patch,version:2,filter:scope});
 await assert.rejects(()=>db.batch([db.prepare(statement.sql).bind(...statement.bindings),db.prepare('INSERT INTO nonexistent VALUES(1)')]));
 assert.equal((await read()).name,'updated');
 assert.ok((await run(statement)).meta.changes>0);assert.equal((await run(statement)).meta.changes,0);
 assert.equal((await db.prepare('SELECT version FROM '+adapter.source+" WHERE id='row'").first()).version,3);
 row=await read();assert.equal(row.name,'patched');assert.equal(row.enabled,true);assert.deepEqual(row.snapshot,patch.snapshot);assert.equal(row.server_0,'needle');
 if(kind==='relational'){
  const types=await db.prepare('SELECT typeof(count) c,typeof(ratio) r,typeof(snapshot) j,enabled FROM wide_test').first();
  assert.deepEqual({...types},{c:'integer',r:'real',j:'text',enabled:1});
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM lite_records WHERE module_id='wide-test'").first()).n,0);
  assert.match((await db.prepare("SELECT data FROM lite_search_documents WHERE record_id='row'").first()).data,/needle/);
 }
 const archive=adapter.updateStatement({id:'row',orgId:'mine',now,version:3,filter:scope,archive:true});
 assert.ok((await run(archive)).meta.changes>0);assert.equal((await run(archive)).meta.changes,0);
 assert.throws(()=>update(4,{sql:Array(101).fill('?').join(' OR '),bindings:Array(101).fill(1)}),/100 bound parameter/);
}
test('D1 schema width excludes computed fields, includes metadata and rejects impossible contracts before SQL generation',()=>{
 defineApp({id:'boundary',name:'Boundary',description:'Boundary',modules:[schema]});
 assert.doesNotThrow(()=>assertEntityStorage(spec));
 const tooWide={...schema,serverFields:[...schema.serverFields,{key:'extra',label:'Extra',type:'text'}]};
 assert.throws(()=>relationalEntityMigration({...spec,schema:tooWide}),/100 columns/);
 assert.doesNotThrow(()=>assertEntityStorage({schema:tooWide,storage:{kind:'records'}}));
});
for(const kind of ['relational','records']){
 test('SQLite '+kind+': wide writes retain types, scopes, CAS and atomic rollback',async t=>{const db=await localDb();t.after(()=>db.close());await exercise(db,kind);});
 test('D1 '+kind+': writes at the 100-column boundary stay below SQL parameter limits',async t=>{
  const wr=createRequire(createRequire(join(root,'template/package.json')).resolve('wrangler/package.json'));const {Miniflare}=await import(pathToFileURL(wr.resolve('miniflare')).href);
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],cf:false});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
  for(const sql of (await migrationSql()).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
  await exercise(db,kind);
 });
}
