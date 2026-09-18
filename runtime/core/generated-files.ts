import type { AppOperationContext } from './types.ts';
import { commitRequestAccessBatch, requestAccessCommitGuard, scopeAccessMatches } from './access-profiles-store.ts';
import { fail } from './validation.ts';

export type GeneratedFileStatement={sql:string;bindings:(string|number|null)[]};
export type GeneratedFileIntent={id:string;ownerId:string;generation:string;digest:string;name:string;contentType:string;bytes:Uint8Array;requiredCapabilities:string[]};
export type StagedGeneratedFile={intentId:string;generation:string;digest:string;fileId:string};
export type GeneratedFilePublicationPort={readonly implementation:string;stage(ctx:AppOperationContext,intent:GeneratedFileIntent):Promise<StagedGeneratedFile>;publicationProof(ctx:AppOperationContext,staged:StagedGeneratedFile):Promise<GeneratedFileStatement[]>;abandon(ctx:AppOperationContext,staged:StagedGeneratedFile):Promise<'cleaned'|'cleanup_pending'>};
type Row={file_id:string;intent_id:string;generation:string;digest:string;owner_id:string;actor_id:string;name:string;content_type:string;size:number;capabilities_json:string;object_key:string;state:string};
function requireContext(ctx:AppOperationContext){
 if(!ctx.access||!scopeAccessMatches(ctx.access,ctx.principal)||ctx.workspace.id!==ctx.principal.workspaceId||ctx.db!==ctx.env.DB)fail(403,'operation_forbidden','Generated files require native request access.');
 if(!ctx.access.evaluateAccess({kind:'operation',operationId:ctx.operation.id}).allowed)fail(403,'operation_forbidden','Operation refused.');
 return ctx.access;
}
function assertion(sql:string,bindings:(string|number|null)[]):GeneratedFileStatement{return {sql:`SELECT CASE WHEN (${sql}) THEN 1 ELSE json('lite_generated_file_conflict') END AS valid`,bindings};}
function match(ctx:AppOperationContext,staged:StagedGeneratedFile){return [ctx.workspace.id,staged.intentId,staged.generation,staged.digest,staged.fileId];}
const exact='org_id=? AND intent_id=? AND generation=? AND digest=? AND file_id=?';
async function load(ctx:AppOperationContext,staged:StagedGeneratedFile){return ctx.db.prepare(`SELECT * FROM lite_generated_files WHERE ${exact}`).bind(...match(ctx,staged)).first<Row>();}
function capabilities(ctx:AppOperationContext,required:string[]){for(const capabilityId of required)if(!ctx.access!.evaluateAccess({kind:'capability',capabilityId}).allowed)fail(403,'operation_forbidden','File capability refused.');}
async function sha(value:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(value))),v=>v.toString(16).padStart(2,'0')).join('');}

/** Durable native D1/R2 port. Publication statements MUST join the application's job/fence
 * CAS and resource proofs in one batch. Download continues to use its current native fileFilter.
 * Pending bytes never have a lite_files row. Repeated staging reconciles the durable intent.
 */
export function createGeneratedFilePublicationPort():GeneratedFilePublicationPort{return {
 implementation:'lite-native-d1-r2-v1',
 async stage(ctx,intent){
  const access=requireContext(ctx),bucket=ctx.env.BUCKET;if(!bucket)fail(503,'files_unavailable','File storage unavailable.');
  if(![intent.id,intent.ownerId,intent.generation].every(v=>typeof v==='string'&&v.length>0&&v.length<=200)||!Array.isArray(intent.requiredCapabilities)||intent.requiredCapabilities.some(v=>typeof v!=='string')||!intent.name||intent.name.length>200||!intent.contentType||intent.contentType.length>200||!intent.bytes.length||intent.bytes.length>10*1024*1024)fail(400,'invalid_arguments','Invalid generated file.');
  capabilities(ctx,intent.requiredCapabilities);
  if(!/^[a-f0-9]{64}$/.test(intent.digest)||await sha(intent.bytes)!==intent.digest)fail(400,'invalid_arguments','Generated file digest mismatch.');
  const fileId='generated-'+await sha(new TextEncoder().encode(JSON.stringify([ctx.workspace.id,intent.id,intent.generation]))),key=`${ctx.workspace.id}/${fileId}`,now=new Date().toISOString();
  const staged={intentId:intent.id,generation:intent.generation,digest:intent.digest,fileId};
  const name=intent.name.replace(/[\/\\\x00-\x1f\x7f]/g,'_'),required=JSON.stringify([...new Set(intent.requiredCapabilities)].sort());
  await commitRequestAccessBatch(ctx.db,access,[ctx.db.prepare(`INSERT INTO lite_generated_files(org_id,intent_id,generation,file_id,digest,owner_id,actor_id,name,content_type,size,capabilities_json,object_key,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'staging',?,?) ON CONFLICT(org_id,intent_id,generation) DO NOTHING`).bind(ctx.workspace.id,intent.id,intent.generation,fileId,intent.digest,intent.ownerId,ctx.principal.userId,name,intent.contentType,intent.bytes.length,required,key,now,now)]);
  const row=await load(ctx,staged);
  if(!row||row.owner_id!==intent.ownerId||row.name!==name||row.content_type!==intent.contentType||row.size!==intent.bytes.length||row.capabilities_json!==required||!['staging','staged','published'].includes(row.state))fail(409,'version_conflict','Generated intent changed.');
  if(row.state==='published')return staged;
  await bucket.put(key,intent.bytes,{httpMetadata:{contentType:'application/octet-stream'}});
  try{
   const results=await commitRequestAccessBatch(ctx.db,access,[ctx.db.prepare(`UPDATE lite_generated_files SET state='staged',updated_at=? WHERE ${exact} AND state IN ('staging','staged')`).bind(now,...match(ctx,staged))]);
   if(!results[0].meta.changes){const current=await load(ctx,staged);if(current?.state==='published')return staged;await bucket.delete(key);fail(409,'version_conflict','Generated intent abandoned.');}
  }catch(error){
   // Persisted staging row retains the exact object key for an authorized retry/cleanup.
   throw error;
  }
  return staged;
 },
 async publicationProof(ctx,staged){
  const access=requireContext(ctx),row=await load(ctx,staged);if(!row||!['staged','published'].includes(row.state))fail(409,'version_conflict','Generated file not staged.');
  capabilities(ctx,JSON.parse(row.capabilities_json));
  const values=match(ctx,staged);
  return [requestAccessCommitGuard(access),assertion(`EXISTS(SELECT 1 FROM lite_generated_files WHERE ${exact} AND state IN ('staged','published')) AND NOT EXISTS(SELECT 1 FROM lite_files WHERE id=? AND (org_id<>? OR deleted_at IS NOT NULL)) AND NOT EXISTS(SELECT 1 FROM lite_generated_files WHERE org_id=? AND intent_id=? AND state='published' AND file_id<>?)`,[...values,staged.fileId,ctx.workspace.id,ctx.workspace.id,staged.intentId,staged.fileId]),
   {sql:`INSERT INTO lite_files(id,org_id,name,object_key,size,content_type,created_by,created_at) SELECT file_id,org_id,name,object_key,size,content_type,actor_id,? FROM lite_generated_files WHERE ${exact} AND state='staged' ON CONFLICT(id) DO NOTHING`,bindings:[new Date().toISOString(),...values]},
   {sql:`UPDATE lite_generated_files SET state='published',updated_at=? WHERE ${exact} AND state='staged'`,bindings:[new Date().toISOString(),...values]}];
 },
 async abandon(ctx,staged){
  const access=requireContext(ctx),bucket=ctx.env.BUCKET;if(!bucket)return 'cleanup_pending';
  await commitRequestAccessBatch(ctx.db,access,[ctx.db.prepare(`UPDATE lite_generated_files SET state='abandoned',updated_at=? WHERE ${exact} AND state IN ('staging','staged')`).bind(new Date().toISOString(),...match(ctx,staged))]);
  const row=await load(ctx,staged);if(!row||row.state==='published')return 'cleaned';
  if(row.state!=='abandoned')return 'cleanup_pending';
  try{await bucket.delete(row.object_key);return 'cleaned';}catch{return 'cleanup_pending';}
 }
};}
