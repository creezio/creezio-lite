import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { CredentialContext, Identity, Principal, Role, Workspace } from './types.ts';
import { evaluateAccessDecision, validateAccessDeclaration, NATIVE_ROLE_GROUP, type AccessDeclaration, type AccessAdoptionReceipt, type AccessDecision, type AccessQuery, type AccessSnapshot, type AccessCatalogEntry, type EvaluateAccessInput, type DelegationMutation } from './access-profiles-engine.ts';
import { fail } from './validation.ts';
import { readJson } from './http.ts';

export type AccessGroup = Readonly<{id:string;version:number;memberIds:readonly string[];builtin:boolean}>;
export type RequestAccessContext = Readonly<{
  snapshot:AccessSnapshot;
  evaluateAccess:(query:AccessQuery)=>AccessDecision;
  authorizeDelegation:(mutation:DelegationMutation,group:AccessGroup|null)=>AccessDecision;
}>;
type Member={user_id:string;role:Role};
type State={epoch:number;receipt:AccessAdoptionReceipt|null;receiptVersion:number;groups:AccessGroup[];members:Member[];denials:{operationId:string;effect:'deny'}[]};
type Lease={request:Request;requestId:string;workspaceId:string;actorUserId:string;active:boolean;state:State;input:EvaluateAccessInput;db:D1Database};
const leases=new WeakMap<RequestAccessContext,Lease>();
const denied=(reason:AccessDecision['reason']='denied_delegation'):AccessDecision=>Object.freeze({allowed:false,reason,capabilityIds:Object.freeze([])});
const granted=():AccessDecision=>Object.freeze({allowed:true,reason:'allowed',capabilityIds:Object.freeze([])});
const immutable=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const child of Object.values(value))immutable(child);Object.freeze(value);}return value;};
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const validTime=(v:unknown)=>{
 if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))return false;
 const year=Number(v.slice(0,4)),month=Number(v.slice(5,7)),day=Number(v.slice(8,10));const days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
 return month>=1&&month<=12&&day>=1&&day<=days[month-1]&&Number(v.slice(11,13))<24&&Number(v.slice(14,16))<60&&Number(v.slice(17,19))<60;
};

/** Receipt JSON is native storage, never an authority supplied by the client. */
export function validateNativeReceipt(value:unknown,declaration:AccessDeclaration,groups:readonly AccessGroup[],now=Date.now(),allowExpired=false):AccessAdoptionReceipt{
  if(!isObject(value)||value.catalogRevision!==declaration.catalogRevision||!Array.isArray(value.bindings)||value.bindings.length>1000)fail(400,'invalid_arguments','Invalid access receipt.');
  if(value.validUntil!==undefined&&(!validTime(value.validUntil)||(!allowExpired&&Date.parse(String(value.validUntil))<=now)))fail(400,'invalid_arguments','Invalid receipt expiry.');
  const seen=new Set<string>();
  const bindings=value.bindings.map(raw=>{
    if(!isObject(raw)||typeof raw.groupId!=='string'||NATIVE_ROLE_GROUP.test(raw.groupId)||typeof raw.profileId!=='string')fail(400,'invalid_arguments','Invalid binding.');
    const group=groups.find(g=>g.id===raw.groupId&&!g.builtin),profile=declaration.profiles.find(p=>p.id===raw.profileId),key=JSON.stringify([raw.groupId,raw.profileId]);
    if(!group||!profile||profile.revision!==raw.profileRevision||seen.has(key))fail(400,'invalid_arguments','Unknown, duplicate or stale binding.');
    seen.add(key);return {groupId:raw.groupId,profileId:raw.profileId,profileRevision:profile.revision};
  });
  return immutable({catalogRevision:declaration.catalogRevision,bindings,...(value.validUntil!==undefined?{validUntil:String(value.validUntil)}:{})});
}

/** Pure delegation check. Storage supplies complete group/member observations, not body fields. */
export function authorizeDelegationDecision(input:EvaluateAccessInput&{mutation:DelegationMutation;group:AccessGroup|null;actorUserId:string;groups?:readonly AccessGroup[];members?:readonly Member[]}):AccessDecision{
  if(!isObject(input)||!isObject(input.mutation)||!['bind','unbind','groupMembers','memberRole','memberRemove','groupDelete','inviteCreate','adopt','rebind'].includes(input.mutation.kind))return denied('denied_unknown');
  const {mutation,principal,declaration,group}=input;
  if(input.actorUserId!==principal.userId||input.credential.kind!=='session'||principal.credential!=='session')return denied();
  if(!['owner','admin'].includes(principal.role))return denied();
  if(!declaration)return granted();
  if(group?.builtin||group&&NATIVE_ROLE_GROUP.test(group.id))return denied();
  const groups=input.groups??(group?[group]:[]),members=input.members??[];
  if(!members.some(m=>m.user_id===principal.userId&&m.role===principal.role))return denied('denied_conflict');
  if((mutation.kind==='memberRole'||mutation.kind==='memberRemove')&&members.some(m=>m.user_id===mutation.userId&&m.role==='owner'))return denied();
  if(mutation.kind==='memberRole'&&mutation.role==='owner')return denied();
  if(input.receipt?.bindings.some(b=>NATIVE_ROLE_GROUP.test(b.groupId)))return denied();
  if(mutation.kind==='inviteCreate')return mutation.role==='owner'||(principal.role!=='owner'&&mutation.role==='admin')?denied():granted();
  let affected:readonly {groupId:string;profileId:string;profileRevision:number}[]=[];
  if(mutation.kind==='adopt'||mutation.kind==='rebind'){
    try{validateNativeReceipt(mutation.receipt,declaration,groups,0,true);}catch{return denied();}
    // Both added and removed grants require delegation permission.
    affected=[...(input.receipt?.bindings??[]),...mutation.receipt.bindings];
  }else if(mutation.kind==='bind'||mutation.kind==='unbind'){
    const profile=declaration.profiles.find(p=>p.id===mutation.profileId);
    if(!profile||!group||group.id!==mutation.groupId||NATIVE_ROLE_GROUP.test(mutation.groupId))return denied();
    if(mutation.kind==='bind'&&mutation.profileRevision!==profile.revision)return denied('denied_conflict');
    affected=[{groupId:group.id,profileId:profile.id,profileRevision:profile.revision}];
  }else if(mutation.kind==='groupMembers'||mutation.kind==='groupDelete'){
    if(!group||group.id!==mutation.groupId)return denied();
    affected=(input.receipt?.bindings??[]).filter(b=>b.groupId===group.id);
  }else if(mutation.kind==='memberRole'||mutation.kind==='memberRemove'){
    const target=members.find(m=>m.user_id===mutation.userId);if(!target)return denied('denied_conflict');
    affected=(input.receipt?.bindings??[]).filter(b=>groups.some(g=>g.id===b.groupId&&g.memberIds.includes(mutation.userId)));
  }
  for(const binding of affected){
    const profile=declaration.profiles.find(p=>p.id===binding.profileId),target=groups.find(g=>g.id===binding.groupId);
    if(!profile||!target||target.builtin||NATIVE_ROLE_GROUP.test(target.id)){
      // An owner may repair an obsolete receipt, but never invent a valid binding.
      if(principal.role==='owner'&&(mutation.kind==='adopt'||mutation.kind==='rebind'))continue;
      return denied();
    }
    if(!profile.assignableBy.includes(principal.role))return denied();
    const recipients=mutation.kind==='groupMembers'&&mutation.groupId===target.id?mutation.userIds:target.memberIds;
    // Removed bindings still require assignableBy, but cannot grant anything to stale members.
    const addsGrant=mutation.kind==='adopt'||mutation.kind==='rebind'
      ?mutation.receipt.bindings.some(b=>b.groupId===binding.groupId&&b.profileId===binding.profileId)
      :mutation.kind==='bind'||mutation.kind==='groupMembers'||mutation.kind==='memberRole';
    if(addsGrant){
      if(recipients.includes(principal.userId)&&principal.role!=='owner')return denied();
      for(const id of recipients){
        const member=members.find(m=>m.user_id===id);if(!member)return denied('denied_conflict');
        const role=mutation.kind==='memberRole'&&mutation.userId===id?mutation.role:member.role;
        if(!profile.receivableBy.includes(role))return denied();
      }
    }
  }
  return granted();
}

async function readState(db:D1Database,workspaceId:string,actorUserId:string):Promise<State>{
  // A D1 batch is a consistent transaction: no mixed epoch/receipt/membership snapshot.
  const rows=await db.batch<Record<string,any>>([
    db.prepare('SELECT revision FROM lite_access_epochs WHERE org_id=?').bind(workspaceId),
    db.prepare('SELECT receipt_json,version FROM lite_access_receipts WHERE org_id=?').bind(workspaceId),
    db.prepare('SELECT id,version,members_json FROM lite_access_groups WHERE org_id=?').bind(workspaceId),
    db.prepare('SELECT user_id,role FROM lite_members WHERE org_id=?').bind(workspaceId),
    db.prepare("SELECT p.operation_id FROM lite_api_policies p WHERE p.org_id=? AND p.effect='deny' AND (p.group_id='role:'||(SELECT role FROM lite_members WHERE org_id=? AND user_id=?) OR EXISTS(SELECT 1 FROM lite_access_groups g,json_each(g.members_json) j WHERE g.org_id=p.org_id AND g.id=p.group_id AND j.value=?))").bind(workspaceId,workspaceId,actorUserId,actorUserId),
  ]);
  if(!rows[0].results.length)fail(409,'version_conflict','Access state is unavailable.');
  let receipt:AccessAdoptionReceipt|null=null;
  if(rows[1].results.length){try{receipt=JSON.parse(rows[1].results[0].receipt_json);}catch{fail(403,'operation_forbidden','Invalid stored receipt.');}}
  return {epoch:Number(rows[0].results[0].revision),receipt,receiptVersion:Number(rows[1].results[0]?.version??0),groups:rows[2].results.map(g=>({id:g.id,version:g.version,memberIds:JSON.parse(g.members_json),builtin:NATIVE_ROLE_GROUP.test(g.id)})),members:rows[3].results as Member[],denials:rows[4].results.map(p=>({operationId:p.operation_id,effect:'deny'}))};
}

export async function createRequestAccessContext(input:{db:D1Database;request:Request;requestId:string;workspace:Workspace;identity:Identity;credential:CredentialContext;declaration:AccessDeclaration;catalog:readonly AccessCatalogEntry[]}):Promise<RequestAccessContext>{
  const forbidden=['access','observedProfileIds','evaluateAccess','authorizeDelegation','principal','credential','snapshot'];
  const url=new URL(input.request.url);if(forbidden.some(k=>url.searchParams.has(k)))fail(400,'invalid_arguments','Server access context cannot be supplied.');
  // Only inspect the native access-mutation envelopes, whose existing parser is 64 KiB.
  // Other handlers own their body limits (mail attachments, file uploads, etc.); no body
  // from any route participates in constructing this server-owned access context.
  const accessMutation=/^\/api\/v1\/(?:access(?:\/|$)|members(?:\/|$)|invites(?:\/|$))/.test(url.pathname);
  if(accessMutation&&input.request.headers.get('content-type')?.includes('application/json')&&input.request.body){const body=await readJson(input.request.clone());if(forbidden.some(k=>Object.hasOwn(body,k)))fail(400,'invalid_arguments','Server access context cannot be supplied.');}
  const declaration=validateAccessDeclaration(input.declaration,input.catalog),state=await readState(input.db,input.workspace.id,input.identity.userId);
  const member=state.members.find(m=>m.user_id===input.identity.userId);
  if(!member||member.role!==input.workspace.role)fail(403,'operation_forbidden','Membership changed.');
  if(input.credential.kind!=='session'&&input.credential.workspaceId!==input.workspace.id)fail(403,'operation_forbidden','Credential workspace mismatch.');
  let valid=false;
  try{if(state.receipt){validateNativeReceipt(state.receipt,declaration,state.groups);valid=true;}}catch{}
  const observed=valid?declaration.profiles.filter(p=>state.receipt!.bindings.some(b=>b.profileId===p.id&&b.profileRevision===p.revision&&state.groups.some(g=>g.id===b.groupId&&!g.builtin&&g.memberIds.includes(member.user_id)))).map(p=>p.id):[];
  const snapshot:AccessSnapshot=immutable({state:valid?'adopted':'incomplete',catalogRevision:declaration.catalogRevision,receiptRevision:state.receipt?.catalogRevision??null,observedProfileIds:observed});
  const principal:Principal={userId:member.user_id,role:member.role,workspaceId:input.workspace.id,credential:input.credential.kind};
  // Clone server observations to prevent mutation through extension-owned references.
  const evaluated:EvaluateAccessInput=immutable({snapshot,declaration,receipt:valid?state.receipt:null,principal,credential:structuredClone(input.credential),denials:state.denials,catalog:structuredClone(input.catalog),query:{kind:'operation',operationId:'access.catalog'}});
  const lease:Lease={request:input.request,requestId:input.requestId,workspaceId:input.workspace.id,actorUserId:member.user_id,active:true,state,input:evaluated,db:input.db};
  const context:RequestAccessContext=Object.freeze({snapshot,evaluateAccess:(query:AccessQuery)=>{
    if(!lease.active)return denied('denied_conflict');
    const expired=evaluated.receipt?.validUntil&&Date.parse(evaluated.receipt.validUntil)<=Date.now();
    return evaluateAccessDecision({...evaluated,...(expired?{snapshot:{...snapshot,state:'incomplete' as const}}:{}),query});
  },authorizeDelegation:(mutation:DelegationMutation,group:AccessGroup|null)=>lease.active?authorizeDelegationDecision({...evaluated,receipt:state.receipt,mutation,group,actorUserId:member.user_id,groups:state.groups,members:state.members}):denied('denied_conflict')});
  leases.set(context,lease);return context;
}
export function assertRequestAccessContext(context:RequestAccessContext,request:Request,requestId:string,workspaceId:string,actorUserId:string):void{
  const lease=leases.get(context);if(!lease?.active||lease.request!==request||lease.requestId!==requestId||lease.workspaceId!==workspaceId||lease.actorUserId!==actorUserId)fail(403,'operation_forbidden','Invalid request access context.');
}
export function disposeRequestAccessContext(context:RequestAccessContext|undefined):void{if(context){const lease=leases.get(context);if(lease)lease.active=false;}}
export function accessReceiptState(context:RequestAccessContext):Readonly<{version:number;receipt:AccessAdoptionReceipt|null}>{const lease=leases.get(context);if(!lease?.active)fail(403,'operation_forbidden','Invalid access context.');return immutable(structuredClone({version:lease.state.receiptVersion,receipt:lease.state.receipt}));}

/** Trusted native statements only. Epoch guards every effect and audit in one atomic batch. */
export async function commitAccessMutation(context:RequestAccessContext,mutation:DelegationMutation,expectedVersion:number|undefined,write:(guard:{sql:string;bindings:unknown[]},state:Readonly<State>)=>D1PreparedStatement[],audit:{action:string;resourceId:string}):Promise<void>{
  const lease=leases.get(context);if(!lease?.active)fail(403,'operation_forbidden','Invalid access context.');
  const group='groupId'in mutation?lease.state.groups.find(g=>g.id===mutation.groupId)??null:null;
  const decision=context.authorizeDelegation(mutation,group);if(!decision.allowed)fail(decision.reason==='denied_conflict'?409:403,decision.reason==='denied_conflict'?'version_conflict':'operation_forbidden','Access delegation refused.');
  if(expectedVersion!==undefined&&expectedVersion!==lease.state.receiptVersion)fail(409,'version_conflict','Receipt changed.');
  const token=crypto.randomUUID(),db=lease.db,org=lease.workspaceId;
  // Recovery may replace an expired receipt. All other mutations require its lifetime,
  // and the replacement itself must still be live at the SQL commit boundary.
  const validUntil=(mutation.kind==='adopt'||mutation.kind==='rebind'?mutation.receipt:lease.state.receipt)?.validUntil??null;
  const guard={sql:'EXISTS(SELECT 1 FROM lite_access_epochs WHERE org_id=? AND write_token=?)',bindings:[org,token]};
  const statements=write(guard,lease.state);
  const results=await db.batch([
    db.prepare(`UPDATE lite_access_epochs SET write_token=? WHERE org_id=? AND revision=? AND EXISTS(SELECT 1 FROM lite_members WHERE org_id=? AND user_id=? AND role=?) AND (? IS NULL OR julianday(?)>julianday('now'))`).bind(token,org,lease.state.epoch,org,lease.actorUserId,lease.input.principal.role,validUntil,validUntil),
    ...statements,
    db.prepare(`INSERT INTO lite_audit(id,org_id,user_id,action,resource_id,details,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard.sql}`).bind(crypto.randomUUID(),org,lease.actorUserId,audit.action,audit.resourceId,'{}',new Date().toISOString(),...guard.bindings),
    db.prepare('UPDATE lite_access_epochs SET write_token=NULL WHERE org_id=? AND write_token=?').bind(org,token),
  ]);
  if(!results[0].meta.changes)fail(409,'version_conflict','Access state changed.');
  // A request may read its original snapshot; it cannot authorize another mutation from it.
  lease.active=false;
}

export async function updateAccessReceipt(context:RequestAccessContext,mutation:Extract<DelegationMutation,{kind:'adopt'|'rebind'|'bind'|'unbind'}>,expectedVersion:number):Promise<number>{
  const lease=leases.get(context);if(!lease?.active||!lease.input.declaration)fail(403,'operation_forbidden','Access adoption is unavailable.');
  const declaration=lease.input.declaration;let receipt:AccessAdoptionReceipt;
  if('receipt'in mutation)receipt=validateNativeReceipt(mutation.receipt,declaration,lease.state.groups);
  else{
    if(!lease.state.receipt)fail(409,'version_conflict','Adopt access before binding groups.');
    const bindings=lease.state.receipt.bindings.filter(b=>b.groupId!==mutation.groupId||b.profileId!==mutation.profileId);
    if(mutation.kind==='bind')bindings.push({groupId:mutation.groupId,profileId:mutation.profileId,profileRevision:mutation.profileRevision!});
    receipt=validateNativeReceipt({...lease.state.receipt,bindings},declaration,lease.state.groups);
  }
  await commitAccessMutation(context,mutation,expectedVersion,guard=>[
    lease.db.prepare(`INSERT INTO lite_access_receipts(org_id,receipt_json,version,updated_at) SELECT ?,?,?,? WHERE ${guard.sql} ON CONFLICT(org_id) DO UPDATE SET receipt_json=excluded.receipt_json,version=excluded.version,updated_at=excluded.updated_at`).bind(lease.workspaceId,JSON.stringify(receipt),lease.state.receiptVersion+1,new Date().toISOString(),...guard.bindings),
  ],{action:'access.'+mutation.kind,resourceId:lease.workspaceId});
  return lease.state.receiptVersion+1;
}

/** Validate an existing server lease; this helper never constructs authority. */
export function requestAccessMatches(context:RequestAccessContext|null,workspaceId:string,role:Role,userId?:string,credential?:Principal['credential']):boolean{
 const lease=context?leases.get(context):undefined;
 return !!lease?.active&&lease.workspaceId===workspaceId&&lease.input.principal.role===role&&(userId===undefined||lease.actorUserId===userId)&&(credential===undefined||lease.input.principal.credential===credential);
}
export function scopeAccessMatches(context:RequestAccessContext|null,principal:Principal):boolean{
 if(!requestAccessMatches(context,principal.workspaceId,principal.role,principal.userId,principal.credential))return false;
 const lease=leases.get(context!)!;
 return lease.input.snapshot.state==='adopted'&&(!lease.input.receipt?.validUntil||Date.parse(lease.input.receipt.validUntil)>Date.now());
}
export function accessModuleReadable(context:RequestAccessContext,moduleId:string):boolean{
 const lease=leases.get(context);if(!lease?.active)return false;
 const ids=['module.'+moduleId+'.list',moduleId+'.list','module.'+moduleId+'.get',moduleId+'.get',moduleId+'.detail'];
 const operationId=ids.find(id=>lease.input.catalog.some(op=>op.id===id));
 return !!operationId&&context.evaluateAccess({kind:'operation',operationId}).allowed;
}

/** A native SQL assertion, to include in the SAME D1 batch as every business effect.
 * A stale epoch/credential/receipt aborts the transaction (including earlier statements).
 * This does not grant an operation; callers must first authorize their operation/capabilities.
 */
export function requestAccessCommitGuard(context:RequestAccessContext):{sql:string;bindings:(string|number|null)[]}{
 const lease=leases.get(context);if(!lease?.active||lease.input.snapshot.state!=='adopted')fail(403,'operation_forbidden','Invalid access context.');
 const until=lease.input.receipt?.validUntil??null;
 let predicate=`EXISTS(SELECT 1 FROM lite_access_epochs WHERE org_id=? AND revision=?) AND EXISTS(SELECT 1 FROM lite_members WHERE org_id=? AND user_id=? AND role=?) AND (? IS NULL OR julianday(?)>julianday('now'))`;
 const bindings:(string|number|null)[]=[lease.workspaceId,lease.state.epoch,lease.workspaceId,lease.actorUserId,lease.input.principal.role,until,until];
 const credential=lease.input.credential;
 if(credential.kind==='token'){
  predicate+=` AND EXISTS(SELECT 1 FROM lite_access_tokens WHERE id=? AND org_id=? AND user_id=? AND mode=? AND revoked_at IS NULL AND julianday(expires_at)>julianday('now'))`;
  bindings.push(credential.tokenId,lease.workspaceId,lease.actorUserId,credential.mode);
 }else if(credential.kind==='oauth'){
  predicate+=` AND EXISTS(SELECT 1 FROM lite_oauth_tokens t JOIN lite_oauth_grants g ON g.id=t.grant_id JOIN lite_oauth_clients c ON c.id=g.client_id WHERE t.id=? AND g.id=? AND c.id=? AND g.org_id=? AND g.user_id=? AND t.rotated_to IS NULL AND g.revoked_at IS NULL AND c.revoked_at IS NULL AND julianday(t.access_expires_at)>julianday('now') AND julianday(g.expires_at)>julianday('now'))`;
  bindings.push(credential.tokenId,credential.grantId,credential.clientId,lease.workspaceId,lease.actorUserId);
 }
 // Deliberately malformed JSON is a SQLite statement error, not a zero-row write.
 return {sql:`SELECT CASE WHEN (${predicate}) THEN 1 ELSE json('lite_access_revoked') END AS authorized`,bindings};
}
export async function commitRequestAccessBatch(db:D1Database,context:RequestAccessContext|undefined,statements:D1PreparedStatement[]){
 if(!context)return db.batch(statements);
 const lease=leases.get(context);if(!lease?.active||lease.db!==db)fail(403,'operation_forbidden','Invalid access database.');
 const guard=requestAccessCommitGuard(context);
 try{return (await db.batch([db.prepare(guard.sql).bind(...guard.bindings),...statements])).slice(1);}
 catch(error){if(String(error).includes('malformed JSON'))fail(409,'version_conflict','Access or resource state changed.');throw error;}
}
export async function assertRequestAccessCurrent(db:D1Database,context:RequestAccessContext|undefined):Promise<void>{
 if(context)await commitRequestAccessBatch(db,context,[]);
}
