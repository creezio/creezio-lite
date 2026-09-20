import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {app,alice,bob,client,boot,clientData} from './helpers.mjs';
import {localDatabase,migrate} from '../template/scripts/migrate-local.mjs';
import {coreOperations} from '../runtime/core/operations.ts';
import {searchData,searchSelection} from '../runtime/core/search.ts';
import {createRequestAccessContext,disposeRequestAccessContext} from '../runtime/core/access-profiles-store.ts';
import {resolveScope} from '../runtime/core/scope.ts';
import {dataTools} from '../runtime/core/tools.ts';

test('D1 materializes deep access predicates without changing visibility, ranking or counts',async t=>{
 const local=await localDatabase();let access;
 try{
  const db=local.db;await migrate(db,fileURLToPath(new URL('../template/drizzle',import.meta.url)));
  const owner=client(db,alice),org=await boot(owner),workspace={id:org,name:'Fixture',role:'owner'};
  const create=async(name)=>{const r=await owner('modules/clients/records?workspace='+org,{method:'POST',body:{data:{...clientData,name,notes:'Alpha shared'}}});assert.equal(r.status,201);return r.body.record.id;};
  const visible=await create('Alpha visible'),hidden=await create('Alpha secret'),other=await create('Other visible');
  for(const [id,action,resource]of [['extra-visible-audit','clients.update',visible],['orphan-audit','removed.update','secret-orphan']])await db.prepare('INSERT INTO lite_audit(id,org_id,user_id,action,resource_id,details,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,org,'alice',action,resource,'{}','2026-01-01T00:00:00Z').run();
  for(const id of ['file-visible','file-hidden'])await db.prepare('INSERT INTO lite_files(id,org_id,name,object_key,size,content_type,created_by,created_at) VALUES(?,?,?,?,1,?,?,?)').bind(id,org,'Alpha '+id,id,'text/plain','alice','2026-01-01T00:00:00Z').run();
  const foreignOwner=client(db,bob),foreignOrg=await boot(foreignOwner);
  const foreign=await foreignOwner('modules/clients/records?workspace='+foreignOrg,{method:'POST',body:{data:{...clientData,name:'Alpha foreign',notes:'Alpha shared'}}});assert.equal(foreign.status,201);
  // Same referenced resource ID in another workspace must not cross the audit fence.
  await db.prepare('INSERT INTO lite_audit(id,org_id,user_id,action,resource_id,details,created_at) VALUES(?,?,?,?,?,?,?)').bind('foreign-audit',foreignOrg,'bob','clients.update',visible,'{}','2026-01-01T00:00:00Z').run();
  const declaration={catalogRevision:'deep-v1',capabilities:[{id:'read',operations:['module.clients.list','files.list','search.query']}],profiles:[{id:'reader',revision:1,capabilities:['read'],receivableBy:['owner'],assignableBy:['owner'],assignmentApproval:'owner'}]};
  await db.prepare('INSERT INTO lite_access_groups(org_id,id,name,members_json,version,created_at) VALUES(?,?,?,?,1,?)').bind(org,'readers','Readers','["alice"]','2026-01-01T00:00:00Z').run();
  await db.prepare('INSERT INTO lite_access_receipts(org_id,receipt_json,version,updated_at) VALUES(?,?,1,?)').bind(org,JSON.stringify({catalogRevision:'deep-v1',bindings:[{groupId:'readers',profileId:'reader',profileRevision:1}]}),'2026-01-01T00:00:00Z').run();
  const principal={userId:'alice',workspaceId:org,role:'owner',credential:'session'};
  const fresh=()=>createRequestAccessContext({db,request:new Request('https://test.example/api/v1/search'),requestId:crypto.randomUUID(),workspace,identity:alice,credential:{kind:'session'},declaration,catalog:coreOperations(app)});
  access=await fresh();
  const provider=deep=>({recordFilter(_p,ref){const column=ref.alias+'.'+ref.idColumn;return {sql:deep?'('+Array(60).fill(column+' IS NULL').join(' OR ')+' OR '+column+'<>?)':column+'<>?',bindings:[hidden]};},fileFilter(_p,ref){const column=ref.alias+'.'+ref.idColumn;return{sql:deep?'('+Array(60).fill(column+' IS NULL').join(' OR ')+' OR '+column+'<>?)':column+'<>?',bindings:['file-hidden']};}});
  const options=deep=>({scope:resolveScope(provider(deep),access),principal,access});
  const deepClient=client(db,alice,undefined,app,{access:declaration,scope:provider(true)});
  const meter={queries:[]};const measured={prepare(sql){const statement=db.prepare(sql);return{bind(...values){meter.queries.push({chars:sql.length,bindings:values.length});return statement.bind(...values);}};},batch:statements=>db.batch(statements)};
  const started=performance.now();
  for(const [query,extra]of [['Alpha',{}],['Alpha shared',{}],['Alpha',{moduleId:'clients'}],['Alpha',{limit:1,offset:1}],[visible,{moduleId:'audit'}],['secret-orphan',{}],['secret',{}]]){
   const expected=await searchData(db,app,workspace,query,{...options(false),...extra});
   const actual=await searchData(measured,app,workspace,query,{...options(true),...extra});
   assert.deepEqual(actual,expected,query+JSON.stringify(extra));assert.equal(JSON.stringify(actual).includes(hidden),false);assert.equal(actual.items.some(x=>x.id==='file-hidden'||x.id==='orphan-audit'||x.id==='foreign-audit'||x.id===foreign.body.record.id),false);
  }
  const records=await searchData(db,app,workspace,'Alpha',{...options(true),moduleId:'clients'});assert.equal(records.total,2);assert.equal(records.items[0].id,visible);assert.ok(records.items.some(x=>x.id===other));
  const apiFound=await deepClient(`modules/clients/records?q=Alpha&workspace=${org}`);assert.equal(apiFound.status,200,JSON.stringify(apiFound.body));assert.equal(apiFound.body.total,2);assert.equal(apiFound.body.items.some(x=>x.id===hidden),false);
  const apiPage=await deepClient(`modules/clients/records?q=Alpha&limit=1&offset=1&workspace=${org}`);assert.equal(apiPage.status,200,JSON.stringify(apiPage.body));assert.equal(apiPage.body.total,2);assert.equal(apiPage.body.items.length,1);assert.notEqual(apiPage.body.items[0].id,hidden);
  const apiEmpty=await deepClient(`modules/clients/records?q=absent&workspace=${org}`);assert.equal(apiEmpty.status,200,JSON.stringify(apiEmpty.body));assert.equal(apiEmpty.body.total,0);
  const apiFiltered=await deepClient(`modules/clients/records?q=Alpha&field=name&value=${encodeURIComponent('Alpha visible')}&workspace=${org}`);assert.equal(apiFiltered.status,200,JSON.stringify(apiFiltered.body));assert.deepEqual(apiFiltered.body.items.map(x=>x.id),[visible]);
  const toolApi=async(path,init={})=>{const result=await deepClient(path+(path.includes('?')?'&':'?')+'workspace='+org,{method:init.method,body:init.body===undefined?undefined:JSON.parse(init.body)});if(result.status>=400)throw new Error(JSON.stringify(result.body));return result.body;};
  const listTool=dataTools(app,'owner',toolApi).find(tool=>tool.name==='lite_clients_list');assert.ok(listTool);
  const mcpFound=await listTool.execute({query:'Alpha'});assert.equal(mcpFound.total,2);assert.equal(mcpFound.items.some(x=>x.id===hidden),false);
  const audits=await searchData(db,app,workspace,visible,{...options(true),moduleId:'audit'});assert.equal(audits.total,2);assert.equal(new Set(audits.items.map(x=>x.id)).size,2);
  const selection=await searchSelection(db,app,workspace,'',{...options(true)});assert.deepEqual(selection.bindings,[]);
  t.diagnostic(JSON.stringify({elapsedMs:Math.round(performance.now()-started),maxSqlChars:Math.max(...meter.queries.map(q=>q.chars)),maxBindings:Math.max(...meter.queries.map(q=>q.bindings)),deepOrTerms:60}));
  disposeRequestAccessContext(access);await db.prepare('DELETE FROM lite_access_receipts WHERE org_id=?').bind(org).run();access=await fresh();
  const incomplete=await searchData(db,app,workspace,'Alpha',options(true));assert.equal(incomplete.items.some(x=>x.index==='clients'||x.index==='files'),false);
 }finally{disposeRequestAccessContext(access);await local.dispose();}
});
