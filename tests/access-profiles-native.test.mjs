import test from 'node:test';
import assert from 'node:assert/strict';
import {app,alice,bob,eve,client,boot,localDb,fakeBucket} from './helpers.mjs';
import {coreOperations} from '../runtime/core/operations.ts';
import {defineExtensions} from '../runtime/core/commands.ts';
import {createRequestAccessContext,assertRequestAccessContext,disposeRequestAccessContext,updateAccessReceipt,commitAccessMutation,accessReceiptState} from '../runtime/core/access-profiles-store.ts';
const declaration={catalogRevision:'catalog-v1',capabilities:[{id:'read',operations:['module.clients.list']}],profiles:[{id:'reader',revision:1,capabilities:['read'],receivableBy:['owner','admin','member','viewer'],assignableBy:['owner','admin'],assignmentApproval:'owner'}]};
const catalog=coreOperations(app);
function grantedFixture(db,org,operationIds){
 const access={...declaration,capabilities:[...declaration.capabilities,{id:'fixture',operations:operationIds}],profiles:[...declaration.profiles,{...declaration.profiles[0],id:'fixture',capabilities:['fixture'],receivableBy:['owner']}]};
 db.raw.prepare('INSERT INTO lite_access_receipts(org_id,receipt_json,version,updated_at) VALUES(?,?,1,?)').run(org,JSON.stringify({catalogRevision:access.catalogRevision,bindings:[{groupId:'owners',profileId:'fixture',profileRevision:1}]}),new Date().toISOString());
 return access;
}
async function fixture(fn){const db=await localDb();try{const org=await boot(client(db,alice));await boot(client(db,bob));await boot(client(db,eve));db.raw.prepare('INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,?)').run(org,'bob','admin');db.raw.prepare('INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,?)').run(org,'eve','member');for(const [id,ids]of [['readers',['eve']],['admins',['bob']],['owners',['alice']]])db.raw.prepare('INSERT INTO lite_access_groups(org_id,id,name,members_json,version,created_at) VALUES(?,?,?,?,1,?)').run(org,id,id,JSON.stringify(ids),new Date().toISOString());await fn({db,org});}finally{db.close();}}
const receipt=(bindings=[{groupId:'readers',profileId:'reader',profileRevision:1}],extra={})=>({catalogRevision:'catalog-v1',bindings,...extra});
async function lease(db,org,identity=alice,extra={}){const request=extra.request??new Request('https://test.example/api/v1/access/receipt'),requestId=crypto.randomUUID();const workspace={id:org,name:'Test',role:identity===alice?'owner':identity===bob?'admin':'member'};const access=await createRequestAccessContext({db,request,requestId,workspace,identity,credential:{kind:'session'},declaration,catalog,...extra});return{access,request,requestId,workspace};}
async function adopt(db,org,value=receipt()){const {access}=await lease(db,org);return updateAccessReceipt(access,{kind:'adopt',receipt:value},0);}
const count=(db,table)=>db.raw.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
function groupWrite(db,org,ids){return guard=>[db.prepare(`UPDATE lite_access_groups SET members_json=?,version=version+1 WHERE org_id=? AND id='readers' AND ${guard.sql}`).bind(JSON.stringify(ids),org,...guard.bindings)];}

test('access opt-in validation is additive and does not accept malformed or forged declarations',()=>{
 assert.deepEqual(defineExtensions(app),{});assert.equal(defineExtensions(app,{access:declaration}).access,declaration);
 for(const access of [null,{}, {...declaration,catalogRevision:''},{...declaration,profiles:[]},{...declaration,profiles:[{...declaration.profiles[0],assignmentApproval:'workspace-rule'}]}])assert.throws(()=>defineExtensions(app,{access}));
});
test('native receipt reconstructs only current workspace/group observations; absent is incomplete',async()=>fixture(async({db,org})=>{
 const first=await lease(db,org);assert.equal(first.access.snapshot.state,'incomplete');assert.equal(first.access.evaluateAccess({kind:'operation',operationId:'module.clients.list'}).allowed,false);
 assert.equal(await updateAccessReceipt(first.access,{kind:'adopt',receipt:receipt()},0),1);
 const member=await lease(db,org,eve);assert.equal(member.access.snapshot.state,'adopted');assert.deepEqual(member.access.snapshot.observedProfileIds,['reader']);assert.equal(member.access.evaluateAccess({kind:'capability',capabilityId:'read'}).allowed,true);
 const owner=await lease(db,org);assert.equal(owner.access.evaluateAccess({kind:'operation',operationId:'module.clients.list'}).allowed,false);
 const other=await boot(client(db,bob)),otherLease=await lease(db,other,bob,{workspace:{id:other,name:'Other',role:'owner'}});assert.equal(otherLease.access.snapshot.state,'incomplete');
}));
test('leases are branded, exact request/actor/space scoped and disposed after use',async()=>fixture(async({db,org})=>{
 const a=await lease(db,org);assert.equal(a.access.authorizeDelegation({kind:'unknown'},null).allowed,false);assertRequestAccessContext(a.access,a.request,a.requestId,org,'alice');
 for(const args of [[{},a.request,a.requestId,org,'alice'],[a.access,new Request(a.request),a.requestId,org,'alice'],[a.access,a.request,'other',org,'alice'],[a.access,a.request,a.requestId,'other','alice'],[a.access,a.request,a.requestId,org,'bob']])assert.throws(()=>assertRequestAccessContext(...args),e=>e.status===403);
 disposeRequestAccessContext(a.access);assert.equal(a.access.evaluateAccess({kind:'operation',operationId:'access.catalog'}).allowed,false);assert.throws(()=>accessReceiptState(a.access));
}));
test('invalid binding, duplicate pair, role groups and stale catalog are refused without mutation',async()=>fixture(async({db,org})=>{
 for(const value of [receipt([{groupId:'role:owner',profileId:'reader',profileRevision:1}]),receipt([{groupId:'missing',profileId:'reader',profileRevision:1}]),receipt([{groupId:'readers',profileId:'unknown',profileRevision:1}]),receipt([{groupId:'readers',profileId:'reader',profileRevision:2}]),receipt([...receipt().bindings,...receipt().bindings]),receipt(undefined,{catalogRevision:'stale'})]){const {access}=await lease(db,org);await assert.rejects(updateAccessReceipt(access,{kind:'adopt',receipt:value},0),e=>e.status===400);}
 assert.equal(count(db,'lite_access_receipts'),0);
}));
test('expired or revision-mismatched receipts stay incomplete and owner can rebind',async()=>fixture(async({db,org})=>{
 await adopt(db,org);db.raw.prepare('UPDATE lite_access_receipts SET receipt_json=? WHERE org_id=?').run(JSON.stringify(receipt(undefined,{validUntil:'2000-01-01T00:00:00Z'})),org);
 const stale=await lease(db,org);assert.equal(stale.access.snapshot.state,'incomplete');assert.equal(await updateAccessReceipt(stale.access,{kind:'rebind',receipt:receipt()},1),2);
 db.raw.prepare('UPDATE lite_access_receipts SET receipt_json=? WHERE org_id=?').run(JSON.stringify(receipt(undefined,{catalogRevision:'old'})),org);const next=await lease(db,org);assert.equal(next.access.snapshot.state,'incomplete');assert.equal(await updateAccessReceipt(next.access,{kind:'rebind',receipt:receipt()},2),3);
}));
test('native routes adopt, bind and unbind, preserve legacy and public errors',async()=>fixture(async({db,org})=>{
 const call=client(db,alice,undefined,app,{access:declaration}),path=p=>p+'?workspace='+org;
 assert.equal((await call(path('access/catalog'))).body.access.state,'incomplete');
 let r=await call(path('access/receipt'),{method:'PUT',body:{receipt:receipt(),version:0}});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.version,1);
 r=await call(path('access/bind'),{method:'POST',body:{groupId:'owners',profileId:'reader',profileRevision:1,version:1}});assert.equal(r.status,200,JSON.stringify(r.body));
 r=await call(path('access/unbind'),{method:'POST',body:{groupId:'owners',profileId:'reader',version:2}});assert.equal(r.status,200);
 r=await call(path('access/receipt'),{method:'PUT',body:{receipt:receipt(),version:0}});assert.equal(r.status,409);assert.equal(r.body.error.code,'version_conflict');
 const legacy=await client(db,alice)(path('access/catalog'));assert.equal(legacy.status,200);assert.equal(legacy.body.access,undefined);
}));
test('admin self-grant through binding and group membership is denied; owner is protected',async()=>fixture(async({db,org})=>{
 await adopt(db,org);const admin=client(db,bob,undefined,app,{access:declaration}),owner=client(db,alice,undefined,app,{access:declaration});
 let r=await admin('access/bind?workspace='+org,{method:'POST',body:{groupId:'admins',profileId:'reader',profileRevision:1,version:1}});assert.equal(r.status,403,JSON.stringify(r.body));
 r=await admin('access/groups/readers?workspace='+org,{method:'PUT',body:{name:'readers',userIds:['eve','bob'],version:1}});assert.equal(r.status,403);
 r=await owner('members/alice?workspace='+org,{method:'DELETE'});assert.equal(r.status,403);assert.equal(r.body.error.code,'owner_protected');
 assert.deepEqual(JSON.parse(db.raw.prepare("SELECT members_json FROM lite_access_groups WHERE org_id=? AND id='readers'").get(org).members_json),['eve']);
}));
for(const [name,change]of [
 ['actor role',(db,org)=>db.raw.prepare("UPDATE lite_members SET role='member' WHERE org_id=? AND user_id='bob'").run(org)],
 ['actor membership',(db,org)=>db.raw.prepare("DELETE FROM lite_members WHERE org_id=? AND user_id='bob'").run(org)],
 ['group membership',(db,org)=>db.raw.prepare("UPDATE lite_access_groups SET members_json='[]' WHERE org_id=? AND id='readers'").run(org)],
 ['receipt',(db,org)=>db.raw.prepare('DELETE FROM lite_access_receipts WHERE org_id=?').run(org)],
 ['policy',(db,org)=>db.raw.prepare("INSERT INTO lite_api_policies(org_id,group_id,operation_id,effect) VALUES(?,'readers','module.clients.list','deny')").run(org)],
])test('CAS observes concurrent '+name+' change and emits no mutation/audit',async()=>fixture(async({db,org})=>{
 await adopt(db,org);const {access}=await lease(db,org,bob);change(db,org);const before=count(db,'lite_audit');
 await assert.rejects(commitAccessMutation(access,{kind:'groupMembers',groupId:'readers',userIds:['eve']},undefined,groupWrite(db,org,['eve']),{action:'fixture.mutation',resourceId:'readers'}),e=>e.status===409);
 assert.equal(count(db,'lite_audit'),before);assert.equal(db.raw.prepare("SELECT version FROM lite_access_groups WHERE org_id=? AND id='readers'").get(org).version,1);assert.equal(db.raw.prepare('SELECT write_token FROM lite_access_epochs WHERE org_id=?').get(org).write_token,null);
}));
test('only one concurrent receipt update wins; stale request produces no audit',async()=>fixture(async({db,org})=>{
 const a=await lease(db,org),b=await lease(db,org);await updateAccessReceipt(a.access,{kind:'adopt',receipt:receipt()},0);const n=count(db,'lite_audit');await assert.rejects(updateAccessReceipt(b.access,{kind:'adopt',receipt:receipt()},0),e=>e.status===409);assert.equal(count(db,'lite_audit'),n);assert.equal(count(db,'lite_access_receipts'),1);
}));
test('SQL failure rolls the entire guarded mutation and audit back',async()=>fixture(async({db,org})=>{
 await adopt(db,org);const {access}=await lease(db,org),before=count(db,'lite_audit');
 await assert.rejects(commitAccessMutation(access,{kind:'groupMembers',groupId:'readers',userIds:[]},undefined,guard=>[...groupWrite(db,org,[])(guard),db.prepare('INSERT INTO missing_access_fixture VALUES(1)')],{action:'fixture.rollback',resourceId:'readers'}));
 assert.equal(db.raw.prepare("SELECT members_json FROM lite_access_groups WHERE org_id=? AND id='readers'").get(org).members_json,'["eve"]');assert.equal(count(db,'lite_audit'),before);assert.equal(db.raw.prepare('SELECT write_token FROM lite_access_epochs WHERE org_id=?').get(org).write_token,null);
}));
test('expiry during the batch wait prevents effects but owner recovery remains available',async()=>fixture(async({db,org})=>{
 const expires=new Date(Date.now()+2000).toISOString();await adopt(db,org,receipt(undefined,{validUntil:expires}));const {access}=await lease(db,org);const before=count(db,'lite_audit');
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(expires)-Date.now())+50));await assert.rejects(commitAccessMutation(access,{kind:'groupMembers',groupId:'readers',userIds:[]},undefined,groupWrite(db,org,[]),{action:'fixture.expired',resourceId:'readers'}),e=>e.status===409);assert.equal(count(db,'lite_audit'),before);
 const recovery=await lease(db,org);assert.equal(await updateAccessReceipt(recovery.access,{kind:'rebind',receipt:receipt()},1),2);
}));
test('body/query cannot provide server context; matching token workspace still cannot delegate',async()=>fixture(async({db,org})=>{
 for(const request of [new Request('https://test.example/api/v1/access/catalog?observedProfileIds=reader'),new Request('https://test.example/api/v1/access/bind',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({access:{state:'adopted'}})})])await assert.rejects(lease(db,org,alice,{request}),e=>e.status===400);
 const {access}=await lease(db,org,alice,{credential:{kind:'token',workspaceId:org,tokenId:'test',mode:'write'}});await assert.rejects(updateAccessReceipt(access,{kind:'adopt',receipt:receipt()},0),e=>e.status===403);
}));
test('native group delete removes bindings atomically and member/invite mutations retain compatibility',async()=>fixture(async({db,org})=>{
 await adopt(db,org);const call=client(db,alice,undefined,app,{access:declaration});
 let r=await call('members/eve?workspace='+org,{method:'PATCH',body:{role:'viewer'}});assert.equal(r.status,200,JSON.stringify(r.body));
 r=await call('invites?workspace='+org,{method:'POST',body:{email:'new@example.test',role:'member'}});assert.equal(r.status,201,JSON.stringify(r.body));
 r=await call('access/groups/readers?workspace='+org,{method:'DELETE'});assert.equal(r.status,200,JSON.stringify(r.body));
 const stored=JSON.parse(db.raw.prepare('SELECT receipt_json FROM lite_access_receipts WHERE org_id=?').get(org).receipt_json);assert.deepEqual(stored.bindings,[]);assert.equal(db.raw.prepare('SELECT write_token FROM lite_access_epochs WHERE org_id=?').get(org).write_token,null);
}));

// The native dispatcher owns the lease lifetime; extension code sees no reusable authority.
test('dispatcher passes a request lease to app commands and disposes it after response',async()=>fixture(async({db,org})=>{
 await import('./register-native-loader.mjs');
 const {dispatchRequest}=await import('../runtime/modules/sites-adapter/src/dispatch.ts');
 const {command}=await import('../runtime/core/commands.ts');let captured;
 const op=command({moduleId:'clients',name:'access-fixture',description:'Inspect request access lease',target:'module',idempotencyKey:'none',handle:async ctx=>{captured=ctx.access;assert.ok(captured);assert.equal(captured.evaluateAccess({kind:'operation',operationId:'access.catalog'}).allowed,true);return{body:{ok:true}};}});
 const allowed=grantedFixture(db,org,[op.operation.id]);
 const response=await dispatchRequest(new Request('https://test.example/api/v1/modules/clients/commands/access-fixture?workspace='+org,{method:'POST',headers:{origin:'https://test.example','content-type':'application/json'},body:'{}'}),{app,env:{DB:db},identity:alice},{access:allowed,operations:[op]});
 assert.equal(response.status,200,await response.text());assert.ok(captured);assert.equal(captured.evaluateAccess({kind:'operation',operationId:'access.catalog'}).allowed,false);
}));

test('real D1 preserves additive migration, CAS winner and zero-effect stale invite',async()=>{
 const {localDatabase,migrate}=await import('../template/scripts/migrate-local.mjs');
 const {fileURLToPath}=await import('node:url');const local=await localDatabase();
 try{
  const directory=fileURLToPath(new URL('../template/drizzle',import.meta.url));assert.equal(await migrate(local.db,directory),15);assert.equal(await migrate(local.db,directory),0);
  const db=local.db,org=await boot(client(db,alice));await boot(client(db,bob));await db.prepare('INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,?)').bind(org,'bob','admin').run();
  await db.prepare('INSERT INTO lite_access_groups(org_id,id,name,members_json,version,created_at) VALUES(?,?,?,?,1,?)').bind(org,'readers','readers','[]',new Date().toISOString()).run();
  const first=await lease(db,org),second=await lease(db,org);const results=await Promise.allSettled([updateAccessReceipt(first.access,{kind:'adopt',receipt:receipt()},0),updateAccessReceipt(second.access,{kind:'adopt',receipt:receipt()},0)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.status===409).length,1);
  const before=(await db.prepare('SELECT COUNT(*) AS n FROM lite_audit').first()).n;
  const stale=await lease(db,org,bob);await db.prepare("UPDATE lite_members SET role='member' WHERE org_id=? AND user_id='bob'").bind(org).run();
  await assert.rejects(commitAccessMutation(stale.access,{kind:'inviteCreate',role:'member'},undefined,guard=>[
   db.prepare(`INSERT INTO lite_invites(id,org_id,email,role,token_hash,expires_at,created_at) SELECT 'blocked',?,'target@example.test','member','fixturehash','2099-01-01T00:00:00Z','2026-01-01T00:00:00Z' WHERE ${guard.sql}`).bind(org,...guard.bindings)
  ],{action:'invite.create',resourceId:'blocked'}),e=>e.status===409);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM lite_invites WHERE id='blocked'").first()).n,0);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM lite_audit').first()).n,before);assert.equal((await db.prepare('SELECT write_token FROM lite_access_epochs WHERE org_id=?').bind(org).first()).write_token,null);
 }finally{await local.dispose();}
});


test('owner can remove a stale binding after member removal without weakening retained grants',async()=>fixture(async({db,org})=>{
 await adopt(db,org);const call=client(db,alice,undefined,app,{access:declaration});
 const removed=await call('members/eve?workspace='+org,{method:'DELETE'});assert.equal(removed.status,200,JSON.stringify(removed.body));
 const retained=await call('access/receipt?workspace='+org,{method:'PUT',body:{receipt:receipt(),version:1}});assert.equal(retained.status,409,JSON.stringify(retained.body));
 const cleaned=await call('access/receipt?workspace='+org,{method:'PUT',body:{receipt:receipt([]),version:1}});assert.equal(cleaned.status,200,JSON.stringify(cleaned.body));
 assert.equal(count(db,'lite_access_groups'),3);assert.deepEqual(JSON.parse(db.raw.prepare('SELECT receipt_json FROM lite_access_receipts WHERE org_id=?').get(org).receipt_json).bindings,[]);
 assert.equal(db.raw.prepare("SELECT members_json FROM lite_access_groups WHERE org_id=? AND id='readers'").get(org).members_json,'["eve"]');
}));

test('access opt-in preserves the mail endpoint attachment size limit',async()=>fixture(async({db,org})=>{
 await import('./register-native-loader.mjs');const {dispatchRequest}=await import('../runtime/modules/sites-adapter/src/dispatch.ts');const bucket=fakeBucket();
 const allowed=grantedFixture(db,org,['mail.draft.create']);
 const body={idempotencyKey:crypto.randomUUID(),to:['target@example.test'],subject:'Fixture',text:'Mail body',attachments:[{filename:'fixture.bin',content_type:'application/octet-stream',content_base64:Buffer.alloc(70*1024,42).toString('base64')}],access:{snapshot:{state:'adopted'}}};
 const response=await dispatchRequest(new Request('https://test.example/api/v1/email/drafts?workspace='+org,{method:'POST',headers:{origin:'https://test.example','content-type':'application/json'},body:JSON.stringify(body)}),{app,env:{DB:db,BUCKET:bucket},identity:alice},{access:allowed});
 const data=await response.json();assert.equal(response.status,201,JSON.stringify(data));assert.equal(data.mail.attachments[0].size_bytes,70*1024);assert.equal(bucket.store.size,1);
 // The ignored mail field cannot upgrade the server receipt.
 assert.equal(count(db,'lite_access_receipts'),1);assert.equal(db.raw.prepare('SELECT version FROM lite_access_receipts WHERE org_id=?').get(org).version,1);
}));
