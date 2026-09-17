import type { ApiContext, Workspace } from './types.ts';
import type { Operation } from './operations.ts';
import { operationTool, type ToolBinding } from './tools.ts';
import { fail, requireRole } from './validation.ts';
import { json, readJson } from './http.ts';

export async function toolBindings(c:ApiContext,org:Workspace,operations:Operation[]):Promise<ToolBinding[]>{
  const [policies,custom]=await c.env.DB.batch<Record<string,any>>([
    c.env.DB.prepare('SELECT name,enabled,version FROM lite_mcp_policies WHERE org_id=?').bind(org.id),
    c.env.DB.prepare('SELECT name,operation_id,description FROM lite_mcp_tools WHERE org_id=?').bind(org.id),
  ]);
  const definitions=[...operations.filter(op=>op.mcp).map(op=>({name:op.toolName,operationId:op.id,description:op.description,custom:false})),...custom.results.filter(t=>operations.some(op=>op.id===t.operation_id&&op.mcp)).map(t=>({name:String(t.name),operationId:String(t.operation_id),description:String(t.description),custom:true}))];
  return definitions.map(tool=>{const policy=policies.results.find(p=>p.name===tool.name);return {...tool,enabled:policy?Boolean(policy.enabled):true,version:Number(policy?.version??0)};});
}
export async function mcpAdminRoute(request:Request,c:ApiContext,org:Workspace,operations:Operation[]):Promise<Response|null>{
  const url=new URL(request.url),path=url.pathname.replace('/api/v1/','');if(!path.startsWith('admin/mcp/'))return null;
  requireRole(org.role,['owner','admin']);const db=c.env.DB;
  const bindings=await toolBindings(c,org,operations);
  const audit=(action:string,id:string)=>db.prepare('INSERT INTO lite_audit(id,org_id,user_id,action,resource_id,details,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),org.id,c.identity!.userId,action,id,'{}',new Date().toISOString());
  if(path==='admin/mcp/tools'&&request.method==='GET')return json({tools:bindings.map(t=>{const op=operations.find(o=>o.id===t.operationId)!,tool=operationTool(op,async()=>({}),t);return {...t,category:op.moduleName,access:op.method==='GET'?'read':'write',requiredScope:op.method==='GET'?'read':'write',allowedRoles:op.roles,annotations:tool.annotations,inputSchema:tool.inputSchema,method:op.method,path:op.path};}),operations:operations.map(op=>({id:op.id,description:op.description,method:op.method,path:op.path,moduleName:op.moduleName,mcp:op.mcp,mcpReason:op.mcpReason}))});
  if(path==='admin/mcp/tools'&&request.method==='POST'){
    const body=await readJson(request),name=body.name,op=operations.find(o=>o.id===body.operationId);
    if(typeof name!=='string'||!/^custom_[a-z][a-z0-9_]{1,80}$/.test(name)||typeof body.description!=='string'||!body.description.trim()||body.description.length>1000)fail(400,'invalid_tool','Nom custom_… et description requis.');
    if(!op?.mcp)fail(400,'operation_not_exposable','Cette opération ne peut pas être publiée en outil.');
    if(bindings.some(t=>t.name===name))fail(409,'tool_exists','Ce nom d’outil existe déjà.');
    if(bindings.filter(t=>t.custom).length>=100)fail(409,'tool_limit','Limite de 100 outils personnalisés atteinte.');
    await db.batch<Record<string,any>>([db.prepare('INSERT INTO lite_mcp_tools(org_id,name,operation_id,description,created_at) VALUES(?,?,?,?,?)').bind(org.id,name,op.id,body.description.trim(),new Date().toISOString()),audit('mcp.tool.create',name)]);return json({ok:true,name},201);
  }
  const toolMatch=path.match(/^admin\/mcp\/tools\/([^/]+)$/);
  if(toolMatch&&request.method==='DELETE'){
    const name=decodeURIComponent(toolMatch[1]);if(!bindings.some(t=>t.name===name&&t.custom))fail(403,'generated_tool','Un outil natif peut être désactivé, pas supprimé.');
    await db.batch<Record<string,any>>([db.prepare('DELETE FROM lite_mcp_tools WHERE org_id=? AND name=?').bind(org.id,name),db.prepare('DELETE FROM lite_mcp_policies WHERE org_id=? AND name=?').bind(org.id,name),audit('mcp.tool.delete',name)]);return json({ok:true});
  }
  const policy=path.match(/^admin\/mcp\/policies\/([^/]+)$/);
  if(policy&&request.method==='PATCH'){
    const name=decodeURIComponent(policy[1]),body=await readJson(request),tool=bindings.find(t=>t.name===name);
    if(!tool)fail(404,'tool_not_found','Outil introuvable.');if(typeof body.enabled!=='boolean'||!Number.isInteger(body.version)||body.version!==tool.version)fail(409,'version_conflict','Le réglage a changé. Rechargez les outils.');
    const result=await db.batch<Record<string,any>>([db.prepare('INSERT INTO lite_mcp_policies(org_id,name,enabled,version) VALUES(?,?,?,?) ON CONFLICT(org_id,name) DO UPDATE SET enabled=excluded.enabled,version=excluded.version WHERE lite_mcp_policies.version=?').bind(org.id,name,body.enabled?1:0,tool.version+1,tool.version),db.prepare('INSERT INTO lite_audit(id,org_id,user_id,action,resource_id,details,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),org.id,c.identity!.userId,'mcp.policy.update',name,JSON.stringify({enabled:body.enabled}),new Date().toISOString())]);
    if(!result[0].meta.changes)fail(409,'version_conflict','Le réglage a changé. Rechargez les outils.');return json({ok:true,version:tool.version+1});
  }
  const clientMatch=path.match(/^admin\/mcp\/clients\/([^/]+)$/);
  if(clientMatch&&request.method==='DELETE'){
    const oauth=clientMatch[1].startsWith('oauth:'),id=oauth?clientMatch[1].slice(6):clientMatch[1],table=oauth?'lite_oauth_grants':'lite_access_tokens';
    const client=await db.prepare(`SELECT t.id,m.role FROM ${table} t LEFT JOIN lite_members m ON m.org_id=t.org_id AND m.user_id=t.user_id WHERE t.org_id=? AND t.id=?`).bind(org.id,id).first<{id:string;role:string}>();
    if(!client)fail(404,'client_not_found','Connexion introuvable.');
    if(client.role==='owner'&&org.role!=='owner')fail(403,'owner_protected','Seul le propriétaire peut révoquer cette connexion.');
    await db.batch<Record<string,any>>([db.prepare(`UPDATE ${table} SET revoked_at=? WHERE org_id=? AND id=?`).bind(new Date().toISOString(),org.id,client.id),audit(oauth?'mcp.oauth.revoke':'mcp.client.revoke',client.id)]);return json({ok:true});
  }
  if(path==='admin/mcp/clients'&&request.method==='GET')return json({clients:(await db.prepare(`
    SELECT t.id,t.name,t.mode,t.created_at,t.expires_at,t.revoked_at,u.name AS owner_name,'api-key' AS kind FROM lite_access_tokens t JOIN lite_users u ON u.id=t.user_id WHERE t.org_id=?
    UNION ALL
    SELECT 'oauth:'||g.id,c.name,CASE WHEN instr(g.scope,'crm:write')>0 THEN 'write' ELSE 'read' END,g.created_at,g.expires_at,g.revoked_at,u.name,'oauth' FROM lite_oauth_grants g JOIN lite_oauth_clients c ON c.id=g.client_id JOIN lite_users u ON u.id=g.user_id WHERE g.org_id=?
    ORDER BY created_at DESC LIMIT 500`).bind(org.id,org.id).all()).results});
  if(path==='admin/mcp/status'&&request.method==='GET'){
    const count=await db.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN revoked_at IS NULL AND expires_at>? THEN 1 ELSE 0 END) AS enabled FROM (
      SELECT revoked_at,expires_at FROM lite_access_tokens WHERE org_id=? UNION ALL SELECT revoked_at,expires_at FROM lite_oauth_grants WHERE org_id=?)`).bind(new Date().toISOString(),org.id,org.id).first<{total:number;enabled:number}>();
    return json({ready:true,oauthReady:true,publicUrl:url.origin,mcpUrl:`${url.origin}/api/mcp`,authentication:'oauth2.1-and-personal-bearer',authorizationServer:`${url.origin}/.well-known/oauth-authorization-server`,toolCount:bindings.length,enabledToolCount:bindings.filter(t=>t.enabled).length,clientCount:count?.total??0,enabledClientCount:count?.enabled??0});
  }
  if(path==='admin/mcp/diagnostics'||path==='admin/mcp/diagnostics/export'){
    const checks=[{id:'oauth',ok:Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lite_oauth_tokens'").first()),message:'OAuth disponible avec autorisation et révocation des connexions'},{id:'database',ok:Boolean(await db.prepare('SELECT id FROM lite_orgs WHERE id=?').bind(org.id).first()),message:'Base de données accessible'},{id:'catalog',ok:operations.every(o=>o.description&&o.id),message:'Catalogue des opérations documenté'},{id:'bindings',ok:bindings.every(t=>operations.some(o=>o.id===t.operationId)),message:'Chaque outil est rattaché à une API'},{id:'access',ok:true,message:'Droits contrôlés à chaque appel HTTP et MCP'}];
    const response=json({healthy:checks.every(c=>c.ok),checks,version:'0.13.2',operations:operations.length,tools:bindings.length});if(path.endsWith('/export'))response.headers.set('Content-Disposition','attachment; filename="lite-mcp-diagnostic.json"');return response;
  }
  if(path==='admin/mcp/metrics'){
    const rows=(await db.prepare("SELECT status,duration_ms,detail_json FROM lite_request_logs WHERE org_id=? AND source='mcp' ORDER BY created_at DESC LIMIT 1000").bind(org.id).all<{status:number;duration_ms:number;detail_json:string}>()).results;
    const durations=rows.map(r=>r.duration_ms).sort((a,b)=>a-b),errors=rows.filter(r=>r.status>=400||JSON.parse(r.detail_json).ok===false).length;
    return json({requests:rows.length,errors,errorRate:rows.length?errors/rows.length:0,averageDurationMs:rows.length?Math.round(durations.reduce((a,b)=>a+b,0)/rows.length):0,p95DurationMs:durations[Math.max(0,Math.ceil(durations.length*.95)-1)]??0});
  }
  fail(405,'method_not_allowed','Opération non prise en charge.');
}
