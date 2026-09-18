import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {root,app,alice,bob,client,boot,clientData,migrationSql} from './helpers.mjs';
import {createGeneratedFilePublicationPort} from '../runtime/core/generated-files.ts';
import {createRequestAccessContext,requestAccessCommitGuard} from '../runtime/core/access-profiles-store.ts';
import {coreOperations} from '../runtime/core/operations.ts';
import {openScope} from '../runtime/core/scope.ts';
const catalog=coreOperations(app),operationIds=['module.clients.create','module.clients.update','module.clients.get','module.clients.list','files.download','files.get','files.list'];
const declaration={catalogRevision:'generated-test-v1',capabilities:[{id:'fixture',operations:operationIds}],profiles:[{id:'publisher',revision:1,capabilities:['fixture'],receivableBy:['owner'],assignableBy:['owner'],assignmentApproval:'owner'}]};
async function fixture(fn){
 const req=createRequire(join(root,'template/package.json')),wr=createRequire(req.resolve('wrangler/package.json'));
 const {Miniflare}=await import(pathToFileURL(wr.resolve('miniflare')).href);
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET'],cf:false});
 try{
  const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET');
  for(const sql of (await migrationSql()).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
  const legacy=client(db,alice,bucket),org=await boot(legacy);await boot(client(db,bob,bucket));
  const g=await legacy('access/groups',{method:'POST',body:{name:'publishers'}});assert.equal(g.status,201);
  const groupId=g.body.id;
  assert.equal((await legacy('access/groups/'+groupId,{method:'PUT',body:{name:'publishers',userIds:['alice'],version:1}})).status,200);
  const call=client(db,alice,bucket,app,{access:declaration});
  assert.equal((await call('access/receipt',{method:'PUT',body:{version:0,receipt:{catalogRevision:declaration.catalogRevision,bindings:[{groupId,profileId:'publisher',profileRevision:1}]}}})).status,200);
  const context=async()=>{
   const request=new Request('https://test.example/api/v1/modules/clients/records'),requestId=crypto.randomUUID(),workspace={id:org,name:'Test',role:'owner'},credential={kind:'session'};
   const access=await createRequestAccessContext({db,request,requestId,workspace,identity:alice,credential,declaration,catalog});
   return {db,env:{DB:db,BUCKET:bucket},access,workspace,identity:alice,principal:{userId:'alice',role:'owner',workspaceId:org,credential:'session'},credential,operation:catalog.find(op=>op.id==='module.clients.create'),requestId,now:new Date().toISOString(),scope:openScope,app,params:{},query:{},body:{},defer(){}};
  };
  const revoke=()=>call('access/groups/'+groupId,{method:'PUT',body:{name:'publishers',userIds:[],version:2}});
  await fn({db,bucket,org,call,context,revoke});
 }finally{await mf.dispose();}
}
const bytes=new TextEncoder().encode('Invoice 123; euro €');
const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const intent=(id='job-1',generation='fence-1')=>({id,ownerId:id,generation,digest,name:'invoice.pdf',contentType:'application/pdf',bytes,requiredCapabilities:['fixture']});
const commit=(db,proof,extra=[])=>db.batch([...proof.map(s=>db.prepare(s.sql).bind(...s.bindings)),...extra]);

test('D1/R2 generated publication is durable, hidden until atomic proof, idempotent and tenant scoped',()=>fixture(async({db,bucket,org,call,context})=>{
 const port=createGeneratedFilePublicationPort(),ctx=await context(),staged=await port.stage(ctx,intent());
 assert.equal((await call('files/'+staged.fileId)).status,404);
 assert.deepEqual(await createGeneratedFilePublicationPort().stage(await context(),intent()),staged);
 await assert.rejects(port.stage(ctx,{...intent(),digest:'0'.repeat(64)}),e=>e.status===400);
 const other=await context();other.workspace={...other.workspace,id:'other'};await assert.rejects(port.stage(other,intent()),e=>e.status===403);
 const proof=await port.publicationProof(ctx,staged);
 await assert.rejects(commit(db,proof,[db.prepare("SELECT json('fail_after_publication')")]));
 assert.equal((await call('files/'+staged.fileId)).status,404);
 assert.equal((await db.prepare('SELECT state FROM lite_generated_files WHERE file_id=?').bind(staged.fileId).first()).state,'staged');
 await commit(db,proof);await commit(db,await port.publicationProof(ctx,staged));
 const response=await call('files/'+staged.fileId,{raw:true});assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM lite_files').first()).n,1);
 assert.equal(await port.abandon(ctx,staged),'cleaned');assert.ok(await bucket.get(org+'/'+staged.fileId));
 const competing=await port.stage(ctx,intent('job-1','fence-2'));await assert.rejects(commit(db,await port.publicationProof(ctx,competing)));
 await port.abandon(ctx,competing);
}));

test('D1/R2 orphan retry reconciles interrupted staging; cleanup failure stays durable and cannot publish',()=>fixture(async({db,bucket,org,context})=>{
 const port=createGeneratedFilePublicationPort(),ctx=await context();
 const failing={...ctx,env:{DB:db,BUCKET:{put:async()=>{throw new Error('R2 failed');}}}};
 await assert.rejects(port.stage(failing,intent('orphan')));
 const row=await db.prepare("SELECT * FROM lite_generated_files WHERE intent_id='orphan'").first();assert.equal(row.state,'staging');
 const staged=await port.stage(ctx,intent('orphan'));assert.equal(staged.fileId,row.file_id);
 const failedCleanup={...ctx,env:{DB:db,BUCKET:{delete:async()=>{throw new Error('R2 delete failed');}}}};
 assert.equal(await port.abandon(failedCleanup,staged),'cleanup_pending');
 await assert.rejects(port.publicationProof(ctx,staged));
 assert.equal(await port.abandon(ctx,staged),'cleaned');assert.equal(await bucket.get(org+'/'+staged.fileId),null);
 await assert.rejects(port.stage(ctx,intent('orphan')),e=>e.status===409);
}));

test('D1 native epoch assertion rolls back earlier and later business writes after revocation',()=>fixture(async({db,context,revoke})=>{
 const ctx=await context(),guard=requestAccessCommitGuard(ctx.access);assert.equal((await revoke()).status,200);
 await assert.rejects(db.batch([db.prepare("UPDATE lite_orgs SET name='forbidden-before' WHERE id=?").bind(ctx.workspace.id),db.prepare(guard.sql).bind(...guard.bindings),db.prepare("UPDATE lite_orgs SET name='forbidden-after' WHERE id=?").bind(ctx.workspace.id)]));
 assert.equal((await db.prepare('SELECT name FROM lite_orgs WHERE id=?').bind(ctx.workspace.id).first()).name,'Mon espace');
}));

test('D1 HTTP K02 PATCH suspended in beforeWrite cannot commit after native group revocation',()=>fixture(async({db,bucket,call,revoke})=>{
 const created=await call('modules/clients/records',{method:'POST',body:{data:clientData}});assert.equal(created.status,201,JSON.stringify(created.body));
 let entered,release;const wait=new Promise(r=>entered=r),blocked=new Promise(r=>release=r);
 const patch=client(db,alice,bucket,app,{access:declaration,beforeWrite:async()=>{entered();await blocked;}});
 const pending=patch('modules/clients/records/'+created.body.record.id,{method:'PATCH',body:{version:1,data:{...clientData,name:'forbidden'}}});
 await wait;assert.equal((await revoke()).status,200);release();
 const result=await pending;assert.equal(result.status,409,JSON.stringify(result.body));
 const stored=await db.prepare('SELECT version,data FROM lite_records WHERE id=?').bind(created.body.record.id).first();assert.equal(stored.version,1);assert.equal(JSON.parse(stored.data).name,clientData.name);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM lite_audit WHERE action='clients.update'").first()).n,0);
}));

test('D1/R2 download rechecks native revocation after awaiting bucket bytes',()=>fixture(async({db,bucket,call,context,revoke})=>{
 const port=createGeneratedFilePublicationPort(),ctx=await context(),staged=await port.stage(ctx,intent());await commit(db,await port.publicationProof(ctx,staged));
 const delayedBucket={get:async key=>{const value=await bucket.get(key);assert.equal((await revoke()).status,200);return value;}};
 const result=await client(db,alice,delayedBucket,app,{access:declaration})('files/'+staged.fileId);
 assert.equal(result.status,409,JSON.stringify(result.body));assert.equal((await call('files/'+staged.fileId)).status,403);
}));
