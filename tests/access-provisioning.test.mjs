import test from 'node:test';
import assert from 'node:assert/strict';
import {app,alice,eve,client,boot,localDb} from './helpers.mjs';
import {coreOperations} from '../runtime/core/operations.ts';
import {createRequestAccessContext,updateAccessReceipt,commitProvisionedMember} from '../runtime/core/access-profiles-store.ts';

const catalog=coreOperations(app);
const declaration={
 catalogRevision:'catalog-v1',
 capabilities:[
  {id:'read',operations:['module.clients.list']},
  {id:'approve',operations:['access.groups.update']},
 ],
 profiles:[
  {id:'reader',revision:1,capabilities:['read'],receivableBy:['member'],assignableBy:['owner'],assignmentApproval:'owner'},
  {id:'approver',revision:1,capabilities:['approve'],receivableBy:['owner'],assignableBy:['owner'],assignmentApproval:'owner'},
 ],
 provisioningPolicies:[{id:'pos.member',capabilityId:'approve',targetProfileId:'reader',role:'member'}],
};
const adopted={catalogRevision:'catalog-v1',bindings:[
 {groupId:'readers',profileId:'reader',profileRevision:1},
 {groupId:'owners',profileId:'approver',profileRevision:1},
]};
const identity=(id='new-pos-user')=>({userId:id,email:alice.email,displayName:'POS member'});

async function fixture(fn){
 const db=await localDb();
 try{
  const org=await boot(client(db,alice));await boot(client(db,eve));
  db.raw.prepare("INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,'member')").run(org,eve.userId);
  db.raw.prepare('INSERT INTO lite_access_groups(org_id,id,name,members_json,version,created_at) VALUES(?,?,?,?,1,?)').run(org,'readers','readers',JSON.stringify([eve.userId]),new Date().toISOString());
  db.raw.prepare('INSERT INTO lite_access_groups(org_id,id,name,members_json,version,created_at) VALUES(?,?,?,?,1,?)').run(org,'owners','owners',JSON.stringify([alice.userId]),new Date().toISOString());
  const makeLease=async(who=alice)=>createRequestAccessContext({db,request:new Request('https://test.example/api/v1/access/receipt'),requestId:crypto.randomUUID(),workspace:{id:org,name:'Test',role:who===alice?'owner':'member'},identity:who,credential:{kind:'session'},declaration,catalog});
  const initial=await makeLease();await updateAccessReceipt(initial,{kind:'adopt',receipt:adopted},0);
  await fn({db,org,makeLease});
 }finally{db.close();}
}

test('authorized provisioning commits account, membership, app statements, group and audit atomically',()=>fixture(async({db,org,makeLease})=>{
 db.raw.exec('CREATE TABLE provisioning_effect(id TEXT PRIMARY KEY,user_id TEXT NOT NULL)');
 const subject=identity(),access=await makeLease();
 await commitProvisionedMember(access,{policyId:'pos.member',identity:subject,groupId:'readers',expectedGroupVersion:1,statements:[
  db.prepare("INSERT INTO provisioning_effect(id,user_id) SELECT 'effect',? WHERE EXISTS(SELECT 1 FROM lite_members WHERE org_id=? AND user_id=? AND role='member')").bind(subject.userId,org,subject.userId),
 ]});
 assert.equal(db.raw.prepare('SELECT role FROM lite_members WHERE org_id=? AND user_id=?').get(org,subject.userId).role,'member');
 assert.equal(db.raw.prepare("SELECT user_id FROM provisioning_effect WHERE id='effect'").get().user_id,subject.userId);
 assert.deepEqual(JSON.parse(db.raw.prepare("SELECT members_json FROM lite_access_groups WHERE org_id=? AND id='readers'").get(org).members_json),[eve.userId,subject.userId]);
 assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM lite_audit WHERE org_id=? AND action='access.member.provision' AND resource_id=?").get(org,subject.userId).n,1);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM lite_users WHERE email=?').get(subject.email).n,2,'email equality never links the existing id');
}));

test('a group with mixed profile bindings is refused',()=>fixture(async({db,org,makeLease})=>{
 const mixed={...adopted,bindings:[...adopted.bindings,{groupId:'readers',profileId:'approver',profileRevision:1}]};
 db.raw.prepare('UPDATE lite_access_receipts SET receipt_json=?,version=version+1 WHERE org_id=?').run(JSON.stringify(mixed),org);
 const access=await makeLease();
 await assert.rejects(commitProvisionedMember(access,{policyId:'pos.member',identity:identity('mixed'),groupId:'readers',expectedGroupVersion:1,statements:[]}),error=>error.status===403);
}));

test('an actor without the declared capability is refused',()=>fixture(async({makeLease})=>{
 const access=await makeLease(eve);
 await assert.rejects(commitProvisionedMember(access,{policyId:'pos.member',identity:identity('denied'),groupId:'readers',expectedGroupVersion:1,statements:[]}),error=>error.status===403);
}));

test('a stale group or epoch aborts before any account write',()=>fixture(async({db,org,makeLease})=>{
 const access=await makeLease();db.raw.prepare("UPDATE lite_access_groups SET version=version+1 WHERE org_id=? AND id='readers'").run(org);
 const subject=identity('stale');
 await assert.rejects(commitProvisionedMember(access,{policyId:'pos.member',identity:subject,groupId:'readers',expectedGroupVersion:1,statements:[]}),error=>error.status===409);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM lite_users WHERE id=?').get(subject.userId).n,0);
}));

test('an existing identity id is refused without email-based fallback',()=>fixture(async({makeLease})=>{
 const access=await makeLease();
 await assert.rejects(commitProvisionedMember(access,{policyId:'pos.member',identity:{...eve,email:'different@example.test'},groupId:'readers',expectedGroupVersion:1,statements:[]}),error=>error.status===409);
}));

test('a failing injected statement rolls account, member, group and audit back',()=>fixture(async({db,org,makeLease})=>{
 const subject=identity('rollback'),before=db.raw.prepare('SELECT COUNT(*) n FROM lite_audit').get().n,access=await makeLease();
 await assert.rejects(commitProvisionedMember(access,{policyId:'pos.member',identity:subject,groupId:'readers',expectedGroupVersion:1,statements:[db.prepare('INSERT INTO missing_provisioning_table VALUES(1)')]}));
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM lite_users WHERE id=?').get(subject.userId).n,0);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM lite_members WHERE org_id=? AND user_id=?').get(org,subject.userId).n,0);
 assert.equal(db.raw.prepare("SELECT members_json FROM lite_access_groups WHERE org_id=? AND id='readers'").get(org).members_json,JSON.stringify([eve.userId]));
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM lite_audit').get().n,before);
}));

test('an opaque or forged context is refused',async()=>{
 await assert.rejects(commitProvisionedMember({}, {policyId:'pos.member',identity:identity('opaque'),groupId:'readers',expectedGroupVersion:1,statements:[]}),error=>error.status===403);
});
