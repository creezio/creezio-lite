import type { ApiContext, Identity, Workspace } from './types.ts';
import { fail, requireRole } from './validation.ts';
import { hash, inviteToken, json, readJson } from './http.ts';

export type TokenAccess = {id:string;workspaceId:string;mode:'read'|'write'};
export async function resolveToken(request:Request,context:ApiContext):Promise<{identity:Identity;access:TokenAccess}|null>{
  const authorization=request.headers.get('authorization');if(!authorization)return null;
  if(!/^Bearer lite_[a-f0-9]{64}$/.test(authorization))fail(401,'invalid_token','Clé API invalide.');
  const origin=request.headers.get('origin');
  if((origin&&origin!==new URL(request.url).origin)||request.headers.get('sec-fetch-site')==='cross-site')fail(403,'invalid_origin','Origine non autorisée.');
  const token=await context.env.DB.prepare(`SELECT t.id,t.org_id,t.mode,u.id AS user_id,u.email,u.name
    FROM lite_access_tokens t JOIN lite_users u ON u.id=t.user_id JOIN lite_members m ON m.org_id=t.org_id AND m.user_id=t.user_id
    WHERE t.token_hash=? AND t.revoked_at IS NULL AND t.expires_at>?`).bind(await hash(authorization.slice(7)),new Date().toISOString()).first<{id:string;org_id:string;mode:'read'|'write';user_id:string;email:string;name:string}>();
  if(!token)fail(401,'invalid_token','Clé expirée, révoquée ou sans accès à cet espace.');
  return {identity:{userId:token.user_id,email:token.email,displayName:token.name},access:{id:token.id,workspaceId:token.org_id,mode:token.mode}};
}

/** Machine credentials grant only the data API, never account/admin operations. */
export function authorizeTokenRequest(request:Request,access:TokenAccess):Request {
  const url=new URL(request.url),path=url.pathname.replace(/^\/api\/v1\//,'');
  if(/^members(?:\/|$)/.test(path)&&!['GET','HEAD'].includes(request.method))fail(403,'token_scope','La gestion des accès nécessite une session administrateur.');
  if(!/^(?:search|registry|modules|dashboard|members|audit)(?:\?.*)?$/.test(path)&&!/^(?:members|audit)\/[^/]+$/.test(path)&&!/^modules\/[a-z][a-z0-9-]*\/records(?:\/[^/]+)?$/.test(path)&&!/^files(?:\/[^/]+(?:\/metadata)?)?$/.test(path)&&!/^tasks(?:\/[^/]+)?$/.test(path)&&!/^platform\/platform-support(?:\/[^/]+(?:\/messages)?)?$/.test(path))fail(403,'token_scope','Cette clé ne donne pas accès à cette opération.');
  if(access.mode==='read'&&!['GET','HEAD'].includes(request.method))fail(403,'read_only_token','Cette clé autorise uniquement la lecture.');
  if(url.searchParams.has('workspace')&&url.searchParams.get('workspace')!==access.workspaceId)fail(403,'token_workspace','Cette clé appartient à un autre espace.');
  url.searchParams.set('workspace',access.workspaceId);
  // Origin was checked at the external boundary. Internal dispatch now carries
  // the verified identity; browser requests cannot manufacture TokenAccess.
  const headers=new Headers(request.headers);headers.set('origin',url.origin);
  return new Request(url,{method:request.method,headers,body:request.body,duplex:'half'} as RequestInit);
}

export async function accessTokenRoute(request:Request,context:ApiContext,org:Workspace):Promise<Response|null>{
  const path=new URL(request.url).pathname.replace(/^\/api\/v1\//,'');
  if(!/^access-tokens(?:\/[^/]+)?$/.test(path))return null;
  requireRole(org.role,['owner','admin']);const db=context.env.DB,user=context.identity!;
  if(path==='access-tokens'&&request.method==='GET')return json({items:(await db.prepare('SELECT id,name,mode,created_at,expires_at,revoked_at FROM lite_access_tokens WHERE org_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100').bind(org.id,user.userId).all()).results});
  if(path==='access-tokens'&&request.method==='POST'){
    const body=await readJson(request);
    if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100||!['read','write'].includes(String(body.mode))||![7,30,90].includes(Number(body.days)))fail(400,'invalid_token_settings','Nom, droits ou durée invalides.');
    const id=crypto.randomUUID(),token=`lite_${inviteToken()}`,now=new Date().toISOString(),expires=new Date(Date.now()+Number(body.days)*86400000).toISOString();
    await db.batch([
      db.prepare('INSERT INTO lite_access_tokens(id,org_id,user_id,name,mode,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,org.id,user.userId,body.name.trim(),body.mode,await hash(token),now,expires),
      db.prepare('INSERT INTO lite_audit(id,org_id,user_id,action,resource_id,details,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),org.id,user.userId,'api-key.create',id,'{}',now),
    ]);
    return json({id,token,expiresAt:expires},201);
  }
  if(path.startsWith('access-tokens/')&&request.method==='DELETE'){
    const id=path.slice('access-tokens/'.length);
    await db.prepare('UPDATE lite_access_tokens SET revoked_at=? WHERE id=? AND org_id=? AND user_id=?').bind(new Date().toISOString(),id,org.id,user.userId).run();
    return json({ok:true});
  }
  fail(405,'method_not_allowed','Opération non prise en charge.');
}
