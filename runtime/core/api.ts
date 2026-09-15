import type { D1Database } from "@cloudflare/workers-types";
import type { ApiContext, BeforeWrite, Identity, Module, Role, Workspace } from './types.ts';
import { ApiError, boundedInteger, fail, requireModuleRole, requireRole, roles, validateData } from './validation.ts';
import { checkOrigin, hash, inviteToken, json, readBytes, readJson } from './http.ts';
import { searchRoute, searchSelection } from './search.ts';
import { businessModule } from './registry.ts';
import { accessTokenRoute } from './access-tokens.ts';
import { coreOperations, matchOperation, assertOperationAllowed, canReadModule } from './operations.ts';

type Row = { id: string; module_id: string; data: string; version: number; created_at: string; updated_at: string };
const unpack = (row: Row) => ({ ...row, data: JSON.parse(row.data) as Record<string, unknown> });
const timestamp = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
function label(value: unknown, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, 'invalid_label', 'Un libellé valide est requis.');
  return value.trim();
}
function version(value: unknown) { if (!Number.isInteger(value) || Number(value) < 1) fail(400, 'version_required', 'La version du document est obligatoire.'); return Number(value); }
function audit(db: D1Database, org: string, user: string, action: string, resource: string, details: unknown = {}, condition = '') {
  return db.prepare(`INSERT INTO lite_audit (id, org_id, user_id, action, resource_id, details, created_at) SELECT ?,?,?,?,?,?,? ${condition}`)
    .bind(uuid(), org, user, action, resource, JSON.stringify(details), timestamp());
}
export async function workspace(db: D1Database, user: Identity, id: string | null): Promise<Workspace> {
  const selection=`SELECT o.id,o.name,m.role,COALESCE((SELECT json_group_array(json_object('operationId',p.operation_id,'effect',p.effect)) FROM lite_api_policies p WHERE p.org_id=o.id AND (p.group_id='role:'||m.role OR p.group_id IN (SELECT g.id FROM lite_access_groups g WHERE g.org_id=o.id AND EXISTS(SELECT 1 FROM json_each(g.members_json) j WHERE j.value=m.user_id)))),'[]') AS policies_json FROM lite_orgs o JOIN lite_members m ON m.org_id=o.id WHERE m.user_id=?`;
  const row = id
    ? await db.prepare(selection+' AND o.id=?').bind(user.userId,id).first<Workspace&{policies_json:string}>()
    : await db.prepare(selection+' ORDER BY o.created_at,o.id LIMIT 1').bind(user.userId).first<Workspace&{policies_json:string}>();
  if (!row) fail(id ? 404 : 409, id ? 'workspace_not_found' : 'setup_required', id ? 'Espace introuvable.' : 'Initialisez votre espace.');
  return {id:row.id,name:row.name,role:row.role,operationPolicies:JSON.parse(row.policies_json)};
}
async function getRecord(db: D1Database, org: string, mod: string, id: string) {
  const row = await db.prepare('SELECT id,module_id,data,version,created_at,updated_at FROM lite_records WHERE id=? AND org_id=? AND module_id=? AND deleted_at IS NULL').bind(id,org,mod).first<Row>();
  if (!row) fail(404,'record_not_found','Document introuvable.');
  return unpack(row);
}

/** Identity MUST come from the trusted Sites dispatcher via getChatGPTUser().
 * This function deliberately never authenticates caller-provided headers itself. */
export async function handleApi(request: Request, context: ApiContext, options: { beforeWrite?: BeforeWrite } = {}): Promise<Response> {
  const requestId = uuid(),started=performance.now();
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/v1\/?/, '').replace(/\/$/,'');
    if (!url.pathname.startsWith('/api/v1/')) fail(404,'not_found','Route introuvable.');
    if (path === 'health' && request.method === 'GET') {
      if (!context.env.DB) fail(503,'database_unavailable','Base de données indisponible.');
      await context.env.DB.prepare('SELECT id FROM lite_orgs LIMIT 1').first();
      return json({ok:true,kit:'lite',version:'0.5.0',database:'ready'});
    }
    const user = context.identity;
    if (!user?.userId || !user.email) fail(401,'authentication_required','Connectez-vous pour continuer.');
    checkOrigin(request);
    const db = context.env.DB;
    if (!db) fail(503,'database_unavailable','Base de données indisponible.');

    if (path === 'bootstrap' && request.method === 'POST') {
      const id = `ws_${(await hash(user.userId)).slice(0,32)}`;
      const now = timestamp();
      await db.batch([
        db.prepare('INSERT INTO lite_users(id,email,name) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name').bind(user.userId,user.email.toLowerCase(),user.displayName),
        db.prepare('INSERT OR IGNORE INTO lite_orgs(id,name,created_at) VALUES(?,?,?)').bind(id,'Mon espace',now),
        db.prepare('INSERT OR IGNORE INTO lite_members(org_id,user_id,role) VALUES(?,?,?)').bind(id,user.userId,'owner'),
      ]);
      return json({workspaceId:id});
    }
    if (path === 'session' && request.method === 'GET') {
      const list = await db.prepare('SELECT o.id,o.name,m.role FROM lite_orgs o JOIN lite_members m ON o.id=m.org_id WHERE m.user_id=? ORDER BY o.created_at,o.id').bind(user.userId).all<Workspace>();
      return json({user,workspaces:list.results,app:{id:context.app.id,name:context.app.name}});
    }
    if (path === 'invites/accept' && request.method === 'POST') {
      const body = await readJson(request); const token = label(body.token,64);
      if (!/^[a-f0-9]{64}$/.test(token)) fail(400,'invalid_invite','Invitation invalide.');
      const tokenHash = await hash(token); const now=timestamp();
      const invitation = await db.prepare('SELECT org_id,role FROM lite_invites WHERE token_hash=? AND email=? AND expires_at>? AND accepted_at IS NULL AND revoked_at IS NULL').bind(tokenHash,user.email.toLowerCase(),now).first<{org_id:string;role:Role}>();
      if (!invitation) fail(404,'invite_not_found','Invitation expirée, déjà utilisée ou destinée à une autre adresse.');
      const results = await db.batch([
        db.prepare('INSERT OR IGNORE INTO lite_members(org_id,user_id,role) SELECT org_id,?,role FROM lite_invites WHERE token_hash=? AND email=? AND expires_at>? AND accepted_at IS NULL AND revoked_at IS NULL').bind(user.userId,tokenHash,user.email.toLowerCase(),now),
        db.prepare('UPDATE lite_invites SET accepted_at=? WHERE token_hash=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM lite_members WHERE org_id=lite_invites.org_id AND user_id=?)').bind(now,tokenHash,now,user.userId),
        audit(db,invitation.org_id,user.userId,'member.join',user.userId,{},'WHERE changes()=1'),
      ]);
      if (!results[1].meta.changes) fail(409,'invite_used','Invitation déjà utilisée.');
      return json({workspaceId:invitation.org_id});
    }
    if (path === 'workspaces' && request.method === 'POST') {
      const body = await readJson(request); const name=label(body.name);
      const count=await db.prepare("SELECT COUNT(*) AS n FROM lite_members WHERE user_id=? AND role='owner'").bind(user.userId).first<{n:number}>();
      if ((count?.n ?? 0)>=20) fail(409,'workspace_limit','La limite de 20 espaces créés est atteinte.');
      const id=uuid(); await db.batch([
        db.prepare('INSERT INTO lite_orgs(id,name,created_at) VALUES(?,?,?)').bind(id,name,timestamp()),
        db.prepare('INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,?)').bind(id,user.userId,'owner'),
        audit(db,id,user.userId,'workspace.create',id),
      ]); return json({workspaceId:id},201);
    }

    const org = context.workspace??await workspace(db,user,url.searchParams.get('workspace'));
    const declared=matchOperation(context.operations??coreOperations(context.app),request.method,url.pathname);
    if(declared)assertOperationAllowed(declared,org);
    const searchResponse=await searchRoute(request,db,context.app,org,user);if(searchResponse){searchResponse.headers.set('Server-Timing',`app;dur=${(performance.now()-started).toFixed(1)}`);return searchResponse;}
    const tokenResponse=await accessTokenRoute(request,context,org);if(tokenResponse)return tokenResponse;
    if (path === 'workspaces/current' && request.method === 'PATCH') {
      requireRole(org.role,['owner','admin']); const body=await readJson(request); const name=label(body.name);
      await db.batch([db.prepare('UPDATE lite_orgs SET name=? WHERE id=?').bind(name,org.id),audit(db,org.id,user.userId,'workspace.rename',org.id)]);
      return json({...org,name});
    }
    if (path === 'modules' && request.method === 'GET') return json({modules:context.app.modules.filter(m=>(m.readRoles??roles).includes(org.role)&&canReadModule(org,m.id)),workspace:org});
    if (path === 'dashboard' && request.method === 'GET') {
      const visible=context.app.modules.filter(m=>(m.readRoles??roles).includes(org.role)&&canReadModule(org,m.id));
      const counts=await Promise.all(visible.map(async m=>({id:m.id,name:m.name,count:(await db.prepare('SELECT COUNT(*) AS n FROM lite_records WHERE org_id=? AND module_id=? AND deleted_at IS NULL').bind(org.id,m.id).first<{n:number}>())?.n??0})));
      return json({modules:counts,workspace:org});
    }
    const systemRecord=path.match(/^(members|audit)\/([^/]+)$/);
    if(systemRecord&&request.method==='GET'){
      requireRole(org.role,['owner','admin']);
      const record=systemRecord[1]==='members'
        ?await db.prepare('SELECT m.user_id,m.role,u.email,u.name FROM lite_members m JOIN lite_users u ON m.user_id=u.id WHERE m.org_id=? AND m.user_id=?').bind(org.id,systemRecord[2]).first()
        :await db.prepare('SELECT a.id,a.action,a.resource_id,a.created_at,u.name AS user_name FROM lite_audit a LEFT JOIN lite_users u ON u.id=a.user_id WHERE a.org_id=? AND a.id=?').bind(org.id,systemRecord[2]).first();
      if(!record)fail(404,'record_not_found','Élément introuvable.');return json({record});
    }
    if (path === 'audit' && request.method === 'GET') {
      requireRole(org.role,['owner','admin']);
      const offset=boundedInteger(url.searchParams.get('offset'),0,100000);
      const data=await db.prepare('SELECT a.id,a.action,a.resource_id,a.created_at,u.name AS user_name FROM lite_audit a LEFT JOIN lite_users u ON u.id=a.user_id WHERE org_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT 50 OFFSET ?').bind(org.id,offset).all();
      return json({items:data.results,offset});
    }
    if (path === 'members' && request.method === 'GET') {
      requireRole(org.role,['owner','admin']);
      const result=await db.prepare('SELECT m.user_id,m.role,u.email,u.name FROM lite_members m JOIN lite_users u ON m.user_id=u.id WHERE m.org_id=? ORDER BY u.name').bind(org.id).all();
      return json({items:result.results});
    }
    if (path === 'invites' && request.method === 'GET') {
      requireRole(org.role,['owner','admin']);
      const result=await db.prepare('SELECT id,email,role,expires_at,accepted_at,revoked_at FROM lite_invites WHERE org_id=? ORDER BY created_at DESC LIMIT 100').bind(org.id).all();
      return json({items:result.results});
    }
    if (path === 'invites' && request.method === 'POST') {
      requireRole(org.role,['owner','admin']); const body=await readJson(request);
      const email=label(body.email,254).toLowerCase(); const role=body.role as Role;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !(org.role==='owner'?['admin','member','viewer']:['member','viewer']).includes(role)) fail(400,'invalid_invite','Adresse ou rôle invalide.');
      const id=uuid(), token=inviteToken(), now=timestamp(), expiry=new Date(Date.now()+7*86400000).toISOString();
      await db.batch([db.prepare('INSERT INTO lite_invites(id,org_id,email,role,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,org.id,email,role,await hash(token),expiry,now),audit(db,org.id,user.userId,'invite.create',id,{role})]);
      return json({id,email,role,token,expiresAt:expiry},201);
    }
    const invitationMatch=path.match(/^invites\/([^/]+)$/);
    if(invitationMatch && request.method==='DELETE') {
      requireRole(org.role,['owner','admin']);
      await db.batch([db.prepare('UPDATE lite_invites SET revoked_at=? WHERE id=? AND org_id=? AND accepted_at IS NULL').bind(timestamp(),invitationMatch[1],org.id),audit(db,org.id,user.userId,'invite.revoke',invitationMatch[1],{},'WHERE changes()=1')]);
      return json({ok:true});
    }
    const memberMatch=path.match(/^members\/([^/]+)$/);
    if (memberMatch && ['PATCH','DELETE'].includes(request.method)) {
      requireRole(org.role,['owner']);
      const target=await db.prepare('SELECT role FROM lite_members WHERE org_id=? AND user_id=?').bind(org.id,memberMatch[1]).first<{role:Role}>();
      if (!target) fail(404,'member_not_found','Membre introuvable.');
      if (target.role==='owner') fail(403,'owner_protected','Le propriétaire ne peut pas être retiré ni rétrogradé.');
      if (request.method==='DELETE') await db.batch([db.prepare("DELETE FROM lite_members WHERE org_id=? AND user_id=? AND role!='owner'").bind(org.id,memberMatch[1]),audit(db,org.id,user.userId,'member.remove',memberMatch[1],{},'WHERE changes()=1')]);
      else {const body=await readJson(request); if(!['admin','member','viewer'].includes(String(body.role))) fail(400,'invalid_role','Rôle invalide.'); await db.batch([db.prepare("UPDATE lite_members SET role=? WHERE org_id=? AND user_id=? AND role!='owner'").bind(body.role,org.id,memberMatch[1]),audit(db,org.id,user.userId,'member.role',memberMatch[1],{role:body.role},'WHERE changes()=1')]);}
      return json({ok:true});
    }

    const recordMatch=path.match(/^modules\/([a-z][a-z0-9-]*)\/records(?:\/([^/]+))?$/);
    if (recordMatch) {
      const mod=businessModule(context.app,recordMatch[1]); if(!mod) fail(404,'module_not_found','Module introuvable.');
      requireModuleRole(mod,org.role,request.method!=='GET');
      const id=recordMatch[2];
      if(request.method==='GET' && id) return json({record:await getRecord(db,org.id,mod.id,id)});
      if(request.method==='GET') {
        const limit=boundedInteger(url.searchParams.get('limit'),30,100); if(!limit) fail(400,'invalid_pagination','La limite doit être positive.');
        const offset=boundedInteger(url.searchParams.get('offset'),0,100000);
        const q=url.searchParams.get('q')??''; if(q.length>120) fail(400,'query_too_long','Recherche trop longue.');
        const terms:unknown[]=[org.id,mod.id]; let where='org_id=? AND module_id=? AND deleted_at IS NULL';
        let indexing=false;
        if(q){const selection=await searchSelection(db,context.app,org,q,{moduleId:mod.id});indexing=selection.indexing;
          where+=` AND id IN (${selection.cte} SELECT d.record_id FROM ranked r JOIN lite_search_documents d ON d.id=r.id)`;
          terms.push(...selection.bindings);
        }
        const filterField=url.searchParams.get('field'),filterValue=url.searchParams.get('value');
        if(filterField){if(!mod.fields.some(f=>f.key===filterField) || filterValue===null || filterValue.length>300) fail(400,'invalid_filter','Filtre invalide.'); where+=' AND CAST(json_extract(data,?) AS TEXT)=?';terms.push('$.'+filterField,filterValue);}
        const [items,count]=await db.batch([
          db.prepare(`SELECT id,module_id,data,version,created_at,updated_at FROM lite_records WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`).bind(...terms,limit,offset),
          db.prepare(`SELECT COUNT(*) AS total FROM lite_records WHERE ${where}`).bind(...terms),
        ]);
        return json({items:(items.results as Row[]).map(unpack),total:(count.results[0] as {total:number}|undefined)?.total??0,limit,offset,searchEngine:'d1-fts5',indexing});
      }
      if(request.method==='POST' && !id) {
        const body=await readJson(request),data=validateData(mod,body.data);
        await options.beforeWrite?.({module:mod,data,previous:null,workspace:org,identity:user});
        const recordId=uuid(),now=timestamp();
        await db.batch([
          db.prepare('INSERT INTO lite_records(id,org_id,module_id,data,search_text,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)').bind(recordId,org.id,mod.id,JSON.stringify(data),Object.values(data).join(' ').toLowerCase(),user.userId,now,now),
          audit(db,org.id,user.userId,`${mod.id}.create`,recordId),
        ]);return json({record:await getRecord(db,org.id,mod.id,recordId)},201);
      }
      if(request.method==='PATCH' && id) {
        const body=await readJson(request),expected=version(body.version),previous=await getRecord(db,org.id,mod.id,id);
        if(previous.version!==expected) fail(409,'version_conflict','Ce document a été modifié. Rechargez-le avant d’enregistrer.');
        const data=validateData(mod,body.data);
        await options.beforeWrite?.({module:mod,data,previous:previous.data,workspace:org,identity:user});
        const result=await db.batch([
          db.prepare('UPDATE lite_records SET data=?,search_text=?,version=version+1,updated_at=? WHERE id=? AND org_id=? AND module_id=? AND version=? AND deleted_at IS NULL').bind(JSON.stringify(data),Object.values(data).join(' ').toLowerCase(),timestamp(),id,org.id,mod.id,expected),
          audit(db,org.id,user.userId,`${mod.id}.update`,id,{},'WHERE changes()=1'),
        ]);
        if(!result[0].meta.changes) fail(409,'version_conflict','Ce document a été modifié. Rechargez-le.');
        return json({record:await getRecord(db,org.id,mod.id,id)});
      }
      if(request.method==='DELETE' && id) {
        const body=await readJson(request),expected=version(body.version);
        await getRecord(db,org.id,mod.id,id);
        const result=await db.batch([
          db.prepare('UPDATE lite_records SET deleted_at=?,version=version+1 WHERE id=? AND org_id=? AND module_id=? AND version=? AND deleted_at IS NULL').bind(timestamp(),id,org.id,mod.id,expected),
          audit(db,org.id,user.userId,`${mod.id}.archive`,id,{},'WHERE changes()=1'),
        ]);if(!result[0].meta.changes) fail(409,'version_conflict','Ce document a été modifié. Rechargez-le.');
        return json({ok:true});
      }
      fail(405,'method_not_allowed','Méthode non autorisée.');
    }

    if (path==='files' && request.method==='GET') {
      const offset=boundedInteger(url.searchParams.get('offset'),0,100000);
      const rows=await db.prepare('SELECT id,name,size,content_type,created_at FROM lite_files WHERE org_id=? AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?').bind(org.id,offset).all();
      return json({items:rows.results,offset});
    }
    if(path==='files' && request.method==='POST') {
      requireRole(org.role,['owner','admin','member']);
      const bucket=context.env.BUCKET; if(!bucket) fail(503,'files_unavailable','Le stockage de fichiers est indisponible.');
      let name:string; try{name=decodeURIComponent(request.headers.get('x-file-name')??'');}catch{fail(400,'invalid_name','Nom de fichier invalide.');}
      name=label(name,200).replace(/[\/\\\x00-\x1f\x7f]/g,'_');
      const bytes=await readBytes(request,10*1024*1024);if(!bytes.length) fail(400,'empty_file','Le fichier est vide.');
      const id=uuid(),key=`${org.id}/${id}`,type=(request.headers.get('content-type')??'application/octet-stream').split(';')[0].slice(0,100);
      await bucket.put(key,bytes,{httpMetadata:{contentType:'application/octet-stream'}});
      try{await db.batch([db.prepare('INSERT INTO lite_files(id,org_id,name,object_key,size,content_type,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,org.id,name,key,bytes.length,type,user.userId,timestamp()),audit(db,org.id,user.userId,'file.upload',id)]);}catch(error){await bucket.delete(key).catch(()=>{});throw error;}
      return json({id,name,size:bytes.length},201);
    }
    const metadataMatch=path.match(/^files\/([^/]+)\/metadata$/);
    if(metadataMatch&&request.method==='GET'){
      const item=await db.prepare('SELECT id,name,size,content_type,created_at FROM lite_files WHERE id=? AND org_id=? AND deleted_at IS NULL').bind(metadataMatch[1],org.id).first();
      if(!item)fail(404,'file_not_found','Fichier introuvable.');return json({file:item});
    }
    const fileMatch=path.match(/^files\/([^/]+)$/);
    if(fileMatch && ['GET','DELETE'].includes(request.method)) {
      // Keep tombstoned metadata addressable only for DELETE so failed R2 cleanup can be retried.
      const file=await db.prepare('SELECT id,name,object_key,size,content_type FROM lite_files WHERE id=? AND org_id=?'+(request.method==='GET'?' AND deleted_at IS NULL':'')).bind(fileMatch[1],org.id).first<{id:string;name:string;object_key:string;size:number;content_type:string}>();
      if(!file)fail(404,'file_not_found','Fichier introuvable.');
      const bucket=context.env.BUCKET;if(!bucket)fail(503,'files_unavailable','Le stockage de fichiers est indisponible.');
      if(request.method==='DELETE'){
        requireRole(org.role,['owner','admin','member']);
        await db.batch([db.prepare('UPDATE lite_files SET deleted_at=? WHERE id=? AND org_id=? AND deleted_at IS NULL').bind(timestamp(),file.id,org.id),audit(db,org.id,user.userId,'file.delete',file.id,{},'WHERE changes()=1')]);
        // D1/R2 do not share a transaction. Metadata is revoked first; an orphan is never downloadable.
        await bucket.delete(file.object_key);return json({ok:true});
      }
      const object=await bucket.get(file.object_key);if(!object)fail(404,'file_not_found','Le contenu du fichier est indisponible.');
      return new Response(object.body as BodyInit,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,'Content-Length':String(file.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
    }
    fail(404,'not_found','Route introuvable.');
  } catch(error) {
    if(error instanceof ApiError) return json({error:{code:error.code,message:error.message,requestId}},error.status);
    // Do not log user payloads, invitation tokens, credentials or SQL bindings.
    console.error(JSON.stringify({event:'lite.api-error',requestId,type:error instanceof Error?error.name:'UnknownError'}));
    return json({error:{code:'service_unavailable',message:'Le service est momentanément indisponible. Vos modifications n’ont pas été confirmées.',requestId}},503);
  }
}
