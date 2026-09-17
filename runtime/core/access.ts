import { createRequestAccessContext, assertRequestAccessContext, disposeRequestAccessContext, accessReceiptState, updateAccessReceipt, commitAccessMutation, type RequestAccessContext } from './access-profiles-store.ts';
import { sessionCredential } from './scope.ts';
import { validateSchema } from './tools.ts';
import type { ApiContext, AppExtensions, Workspace } from './types.ts';
import { type Operation, operationAllowed } from './operations.ts';
import { fail, requireRole, roles } from './validation.ts';
import { json, readJson } from './http.ts';

const roleLabels={owner:'Propriétaire',admin:'Administrateurs',member:'Collaborateurs',viewer:'Lecture seule'};
const validId=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9:._-]{1,180}$/.test(value);
const name=(value:unknown)=>{if(typeof value!=='string'||!value.trim()||value.length>100)fail(400,'invalid_name','Nom de groupe invalide.');return value.trim();};
function audit(c:ApiContext,org:Workspace,action:string,id:string){return c.env.DB.prepare('INSERT INTO lite_audit(id,org_id,user_id,action,resource_id,details,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),org.id,c.identity!.userId,action,id,'{}',new Date().toISOString());}

export async function accessRoute(request:Request,c:ApiContext,org:Workspace,operations:Operation[],options:AppExtensions={}):Promise<Response|null>{
  const path=new URL(request.url).pathname.replace('/api/v1/','');if(!path.startsWith('access/'))return null;
  requireRole(org.role,['owner','admin']);const db=c.env.DB;
  const requestId=c.requestId??crypto.randomUUID();
  const access=c.access??(options.access===undefined?undefined:await createRequestAccessContext({db,request,requestId,workspace:org,identity:c.identity!,credential:c.credential??sessionCredential,declaration:options.access,catalog:operations}));
  if(access)assertRequestAccessContext(access,request,requestId,org.id,c.identity!.userId);
  try{
  if(['access/receipt','access/bind','access/unbind'].includes(path)){
    if(!access)fail(403,'operation_forbidden','Access declaration is required.');
    const op=operations.find(o=>o.path==='/api/v1/'+path&&o.method===request.method);if(!op?.bodySchema)fail(405,'method_not_allowed','Method not allowed.');
    const body=await readJson(request);validateSchema(op.bodySchema,body,'body');
    const mutation=path==='access/receipt'?{kind:accessReceiptState(access).version===0?'adopt' as const:'rebind' as const,receipt:body.receipt as any}:path==='access/bind'?{kind:'bind' as const,groupId:String(body.groupId),profileId:String(body.profileId),profileRevision:Number(body.profileRevision)}:{kind:'unbind' as const,groupId:String(body.groupId),profileId:String(body.profileId)};
    const version=await updateAccessReceipt(access,mutation,Number(body.version));return json({ok:true,version});
  }
  if(path==='access/catalog'&&request.method==='GET'){
    const [custom,policies,versions,members]=await db.batch<Record<string,any>>([
      db.prepare('SELECT id,name,members_json,version FROM lite_access_groups WHERE org_id=? ORDER BY name').bind(org.id),
      db.prepare('SELECT group_id,operation_id,effect FROM lite_api_policies WHERE org_id=?').bind(org.id),
      db.prepare('SELECT group_id,version FROM lite_policy_versions WHERE org_id=?').bind(org.id),
      db.prepare('SELECT m.user_id AS id,m.role,u.name,u.email FROM lite_members m JOIN lite_users u ON u.id=m.user_id WHERE m.org_id=? ORDER BY u.name').bind(org.id),
    ]);
    const groups=[...roles.map(role=>({id:`role:${role}`,name:roleLabels[role],builtin:true,locked:role==='owner',version:0,userIds:members.results.filter(m=>m.role===role).map(m=>m.id)})),...custom.results.map(g=>({id:g.id,name:g.name,builtin:false,locked:false,version:g.version,userIds:JSON.parse(String(g.members_json))}))];
    return json({...(access?{access:{state:access.snapshot.state,...accessReceiptState(access)}}:{}),groups:groups.map(g=>({...g,policyVersion:versions.results.find(v=>v.group_id===g.id)?.version??0})),members:members.results,policies:policies.results,operations:operations.map(op=>({...op,locked:Boolean(op.essential),defaultGroups:op.roles.map(r=>`role:${r}`)}))});
  }
  if(path==='access/groups'&&request.method==='POST'){
    const body=await readJson(request),label=name(body.name),id=crypto.randomUUID();
    const count=await db.prepare('SELECT COUNT(*) AS n FROM lite_access_groups WHERE org_id=?').bind(org.id).first<{n:number}>();if((count?.n??0)>=100)fail(409,'group_limit','Limite de 100 groupes atteinte.');
    await db.batch<Record<string,any>>([db.prepare('INSERT INTO lite_access_groups(org_id,id,name,members_json,version,created_at) VALUES(?,?,?,?,1,?)').bind(org.id,id,label,'[]',new Date().toISOString()),audit(c,org,'access.group.create',id)]);return json({id,name:label,version:1},201);
  }
  const groupMatch=path.match(/^access\/groups\/([^/]+)$/);
  if(groupMatch){
    const id=decodeURIComponent(groupMatch[1]);if(id.startsWith('role:'))fail(403,'system_group','Ce groupe système ne peut pas être modifié.');
    const group=await db.prepare('SELECT version FROM lite_access_groups WHERE org_id=? AND id=?').bind(org.id,id).first<{version:number}>();if(!group)fail(404,'group_not_found','Groupe introuvable.');
    if(request.method==='DELETE'){
      if(access){await commitAccessMutation(access,{kind:'groupDelete',groupId:id},undefined,(guard,state)=>[
        db.prepare(`DELETE FROM lite_access_groups WHERE org_id=? AND id=? AND ${guard.sql}`).bind(org.id,id,...guard.bindings),
        db.prepare(`DELETE FROM lite_api_policies WHERE org_id=? AND group_id=? AND ${guard.sql}`).bind(org.id,id,...guard.bindings),
        db.prepare(`DELETE FROM lite_policy_versions WHERE org_id=? AND group_id=? AND ${guard.sql}`).bind(org.id,id,...guard.bindings),
        ...(state.receipt?[db.prepare(`UPDATE lite_access_receipts SET receipt_json=?,version=version+1,updated_at=? WHERE org_id=? AND ${guard.sql}`).bind(JSON.stringify({...state.receipt,bindings:state.receipt.bindings.filter(b=>b.groupId!==id)}),new Date().toISOString(),org.id,...guard.bindings)]:[]),
      ],{action:'access.group.delete',resourceId:id});return json({ok:true});}
      await db.batch<Record<string,any>>([db.prepare('DELETE FROM lite_access_groups WHERE org_id=? AND id=?').bind(org.id,id),db.prepare('DELETE FROM lite_api_policies WHERE org_id=? AND group_id=?').bind(org.id,id),db.prepare('DELETE FROM lite_policy_versions WHERE org_id=? AND group_id=?').bind(org.id,id),audit(c,org,'access.group.delete',id)]);return json({ok:true});
    }
    if(request.method==='PUT'){
      const body=await readJson(request),label=name(body.name),ids=body.userIds;
      if(!Number.isInteger(body.version)||body.version!==group.version)fail(409,'version_conflict','Le groupe a changé. Rechargez-le.');
      if(!Array.isArray(ids)||ids.length>500||ids.some(v=>!validId(v))||new Set(ids).size!==ids.length)fail(400,'invalid_members','Liste de membres invalide.');
      const members=await db.prepare('SELECT user_id FROM lite_members WHERE org_id=?').bind(org.id).all<{user_id:string}>();if(ids.some(id=>!members.results.some(m=>m.user_id===id)))fail(400,'invalid_members','Chaque personne doit appartenir à cet espace.');
      if(access){await commitAccessMutation(access,{kind:'groupMembers',groupId:id,userIds:ids},undefined,guard=>[
        db.prepare(`UPDATE lite_access_groups SET name=?,members_json=?,version=version+1 WHERE org_id=? AND id=? AND version=? AND ${guard.sql}`).bind(label,JSON.stringify(ids),org.id,id,body.version,...guard.bindings),
      ],{action:'access.group.update',resourceId:id});return json({ok:true,version:group.version+1});}
      const result=await db.batch<Record<string,any>>([db.prepare('UPDATE lite_access_groups SET name=?,members_json=?,version=version+1 WHERE org_id=? AND id=? AND version=?').bind(label,JSON.stringify(ids),org.id,id,body.version),db.prepare('INSERT INTO lite_audit(id,org_id,user_id,action,resource_id,details,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),org.id,c.identity!.userId,'access.group.update',id,'{}',new Date().toISOString())]);
      if(!result[0].meta.changes)fail(409,'version_conflict','Le groupe a changé. Rechargez-le.');return json({ok:true,version:group.version+1});
    }
  }
  const policyMatch=path.match(/^access\/policies\/([^/]+)$/);
  if(policyMatch&&request.method==='PUT'){
    const id=decodeURIComponent(policyMatch[1]);if(id==='role:owner')fail(403,'owner_protected','Le propriétaire conserve tous les accès.');
    if(!['role:admin','role:member','role:viewer'].includes(id)&&!await db.prepare('SELECT id FROM lite_access_groups WHERE org_id=? AND id=?').bind(org.id,id).first())fail(404,'group_not_found','Groupe introuvable.');
    const body=await readJson(request),changes=body.changes,version=body.version;
    if(!Number.isInteger(version)||Number(version)<0||!Array.isArray(changes)||!changes.length||changes.length>500)fail(400,'invalid_policy','Réglages invalides.');
    const seen=new Set();for(const change of changes){
      if(!change||typeof change!=='object'||typeof change.operationId!=='string'||!['allow','deny','inherit'].includes(change.effect)||seen.has(change.operationId))fail(400,'invalid_policy','Réglage invalide ou dupliqué.');
      seen.add(change.operationId);const op=operations.find(o=>o.id===change.operationId);
      if(!op)fail(400,'unknown_operation','Opération inconnue.');if(op.essential)fail(403,'essential_operation','Cette fonction indispensable ne peut pas être désactivée.');
    }
    const token=crypto.randomUUID(),guard='EXISTS(SELECT 1 FROM lite_policy_versions WHERE org_id=? AND group_id=? AND write_token=?)';
    const result=await db.batch<Record<string,any>>([
      db.prepare('INSERT INTO lite_policy_versions(org_id,group_id,version,write_token) SELECT ?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM lite_policy_versions WHERE org_id=? AND group_id=?) ON CONFLICT(org_id,group_id) DO UPDATE SET version=excluded.version,write_token=excluded.write_token WHERE lite_policy_versions.version=?').bind(org.id,id,Number(version)+1,token,version,org.id,id,version),
      ...changes.map(change=>change.effect==='inherit'?db.prepare(`DELETE FROM lite_api_policies WHERE org_id=? AND group_id=? AND operation_id=? AND ${guard}`).bind(org.id,id,change.operationId,org.id,id,token):db.prepare(`INSERT INTO lite_api_policies(org_id,group_id,operation_id,effect) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(org_id,group_id,operation_id) DO UPDATE SET effect=excluded.effect`).bind(org.id,id,change.operationId,change.effect,org.id,id,token)),
      db.prepare(`INSERT INTO lite_audit(id,org_id,user_id,action,resource_id,details,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard}`).bind(crypto.randomUUID(),org.id,c.identity!.userId,'access.policy.update',id,JSON.stringify({count:changes.length}),new Date().toISOString(),org.id,id,token),
    ]);
    if(!result[0].meta.changes)fail(409,'version_conflict','Les droits ont changé. Rechargez la matrice.');return json({ok:true,version:Number(version)+1});
  }
  return fail(405,'method_not_allowed','Opération non prise en charge.');
  }finally{if(!c.access)disposeRequestAccessContext(access);}
}

export function openApiDocument(operations:Operation[],app:ApiContext['app'],org:Workspace,access?:RequestAccessContext){
  const paths:Record<string,any>={};for(const op of operations.filter(o=>operationAllowed(o,org,access))){
    const path=op.path.replace(/:([A-Za-z0-9_]+)/g,'{$1}');const parameters=[...op.path.matchAll(/:([A-Za-z0-9_]+)/g)].map(m=>({name:m[1],in:'path',required:true,schema:{type:'string'}}));
    for(const [key,schema] of Object.entries(op.querySchema?.properties??{}))parameters.push({name:key,in:'query',required:op.querySchema?.required?.includes(key)??false,schema:schema as any});
    (paths[path]??={})[op.method.toLowerCase()]={operationId:op.id,summary:op.description,tags:[op.moduleName],parameters,...(op.bodySchema?{requestBody:{required:true,content:{'application/json':{schema:op.bodySchema}}}}:{}),...(op.requestType==='file'?{requestBody:{required:true,content:{'application/octet-stream':{schema:{type:'string',format:'binary'}}}}}:{}),responses:{[op.method==='POST'&&/create|upload$/.test(op.id)?'201':'200']:{description:'Succès'},'400':{description:'Entrée invalide'},'401':{description:'Authentification requise'},'403':{description:'Accès refusé'},'409':{description:'Conflit de version'}},'x-lite-essential':Boolean(op.essential),'x-lite-mcp':op.mcp};
  }
  return {openapi:'3.1.0',info:{title:`${app.name} API`,version:'0.4.0'},paths,components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer'}}},security:[{bearerAuth:[]}]};
}
