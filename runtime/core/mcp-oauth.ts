import type {ApiContext, Identity} from './types.ts';
import type {TokenAccess} from './access-tokens.ts';
import {hash, inviteToken, readBytes, readJson, checkOrigin} from './http.ts';
import {ApiError, fail} from './validation.ts';

// The original facade's OAuth contract, adapted to durable D1 storage and Sites
// identity. This delegates the existing MCP registry; it is not a second MCP server.
export const MCP_SCOPES=['crm:read','crm:write'] as const;
const CODE_SECONDS=600, ACCESS_SECONDS=3600, REFRESH_SECONDS=30*86400;
type Client={id:string;name:string;redirects_json:string;secret_hash:string|null;auth_method:string};
type Pending={id:string;client_id:string;redirect_uri:string;scope:string;resource:string;challenge:string;state:string;expires_at:string;status:string;user_id:string|null;csrf_hash:string|null;org_id:string|null;grant_id:string|null};
export type OAuthConsent={requestId:string;csrf:string;clientName:string;redirectOrigin:string;scope:string;email:string;workspaces:Array<{id:string;name:string;role:string}>};
const expiry=(seconds:number)=>new Date(Date.now()+seconds*1000).toISOString();
export const mcpResource=(request:Request)=>new URL('/api/mcp',request.url).href;
const issuer=(request:Request)=>new URL(request.url).origin;
function oauthJson(body:unknown,status=200){return Response.json(body,{status,headers:{'Cache-Control':'no-store','Pragma':'no-cache','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'}});}
function redirectTo(location:string){return new Response(null,{status:303,headers:{Location:location,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
function normalizedScope(value:string,defaultScope=MCP_SCOPES.join(' ')){
  const scopes=[...new Set((value||defaultScope).trim().split(/\s+/))];
  if(!scopes.length||scopes.some(s=>!MCP_SCOPES.includes(s as any))||!scopes.includes('crm:read'))fail(400,'invalid_scope','Portée MCP invalide.');
  return MCP_SCOPES.filter(s=>scopes.includes(s)).join(' ');
}
function validRedirect(value:unknown):value is string{
  if(typeof value!=='string'||value.length>2048)return false;
  try{const u=new URL(value);return !u.hash&&!u.username&&!u.password&&(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)));}catch{return false;}
}
async function getClient(c:ApiContext,id:string){return c.env.DB.prepare('SELECT id,name,redirects_json,secret_hash,auth_method FROM lite_oauth_clients WHERE id=? AND revoked_at IS NULL').bind(id).first<Client>();}
async function form(request:Request){
  if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))fail(415,'invalid_request','Formulaire OAuth attendu.');
  const p=new URLSearchParams(new TextDecoder().decode(await readBytes(request,16384)));
  for(const key of p.keys())if(p.getAll(key).length!==1)fail(400,'invalid_request','Paramètre OAuth répété.');
  return p;
}
async function rateLimit(request:Request,c:ApiContext,kind:string,limit:number,seconds=3600){
  const now=new Date().toISOString(),bucket=Math.floor(Date.now()/(seconds*1000));
  // CF-Connecting-IP is supplied by the edge. No raw IP or credentials persist.
  const key=await hash(`${kind}:${request.headers.get('cf-connecting-ip')||'unknown'}:${bucket}`);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM lite_oauth_limits WHERE expires_at<?').bind(now),
    c.env.DB.prepare('INSERT INTO lite_oauth_limits(id,count,expires_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1').bind(key,expiry(seconds)),
  ]);
  const row=await c.env.DB.prepare('SELECT count FROM lite_oauth_limits WHERE id=?').bind(key).first<{count:number}>();
  if((row?.count??0)>limit)fail(429,'temporarily_unavailable','Trop de tentatives. Réessayez plus tard.');
}
async function authenticateClient(request:Request,c:ApiContext,p:URLSearchParams){
  let id=p.get('client_id')||'',secret=p.get('client_secret')||'',method=secret?'client_secret_post':'none';
  const authorization=request.headers.get('authorization');
  if(authorization){
    if(p.has('client_secret')||!/^Basic /i.test(authorization))fail(401,'invalid_client','Authentification du client invalide.');
    try{const decoded=atob(authorization.slice(6)),colon=decoded.indexOf(':');if(colon<1)throw new Error();
      const basicId=decodeURIComponent(decoded.slice(0,colon));if(id&&id!==basicId)throw new Error();id=basicId;secret=decodeURIComponent(decoded.slice(colon+1));method='client_secret_basic';
    }catch{fail(401,'invalid_client','Authentification du client invalide.');}
  }
  const client=await getClient(c,id);
  if(!client||client.auth_method!==method||(client.secret_hash&&client.secret_hash!==await hash(secret)))fail(401,'invalid_client','Identifiants du client invalides.');
  return client;
}
function authorizationRedirect(p:Pick<Pending,'redirect_uri'|'state'>,base:string,values:Record<string,string>){
  const url=new URL(p.redirect_uri);for(const [key,value]of Object.entries({...values,iss:base}))url.searchParams.set(key,value);
  if(p.state)url.searchParams.set('state',p.state);return redirectTo(url.href);
}

/** All unauthorized MCP responses advertise actual, public discovery metadata. */
export function mcpAuthHeaders(request:Request,response:Response){
  response.headers.set('Access-Control-Allow-Origin','*');
  response.headers.set('Access-Control-Expose-Headers','WWW-Authenticate, MCP-Protocol-Version');
  if(response.status===401||response.status===403){
    const error=response.status===401?'invalid_token':'insufficient_scope';
    response.headers.set('WWW-Authenticate',`Bearer resource_metadata="${issuer(request)}/.well-known/oauth-protected-resource/api/mcp", scope="${MCP_SCOPES.join(' ')}", error="${error}"`);
  }
  return response;
}
export function mcpOptions(){return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id','Access-Control-Expose-Headers':'WWW-Authenticate','Cache-Control':'no-store'}});}

/** Kept outside API request logging: codes, verifiers and client secrets are private. */
export async function oauthRoute(request:Request,c:ApiContext):Promise<Response>{
  const url=new URL(request.url),path=url.pathname,base=issuer(request),resource=mcpResource(request);
  if(request.method==='OPTIONS')return mcpOptions();
  try{
    if(request.method==='GET'&&['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/api/mcp'].includes(path))return oauthJson({resource,resource_name:c.app.name,authorization_servers:[base],scopes_supported:MCP_SCOPES,bearer_methods_supported:['header']});
    if(request.method==='GET'&&['/.well-known/oauth-authorization-server','/.well-known/oauth-authorization-server/api/mcp'].includes(path))return oauthJson({issuer:base,authorization_response_iss_parameter_supported:true,authorization_endpoint:base+'/oauth/authorize',token_endpoint:base+'/oauth/token',registration_endpoint:base+'/oauth/register',revocation_endpoint:base+'/oauth/revoke',response_types_supported:['code'],response_modes_supported:['query'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none','client_secret_post','client_secret_basic'],revocation_endpoint_auth_methods_supported:['none','client_secret_post','client_secret_basic'],code_challenge_methods_supported:['S256'],scopes_supported:MCP_SCOPES});
    if(path==='/oauth/register'&&request.method==='POST'){
      await rateLimit(request,c,'register',20);
      const body=await readJson(request),redirects=body.redirect_uris;
      if(!Array.isArray(redirects)||!redirects.length||redirects.length>10||!redirects.every(validRedirect))fail(400,'invalid_redirect_uri','Adresse de retour HTTPS requise (HTTP autorisé pour localhost).');
      const method=body.token_endpoint_auth_method??'client_secret_basic';
      if(!['none','client_secret_post','client_secret_basic'].includes(String(method)))fail(400,'invalid_client_metadata','Méthode d’authentification non prise en charge.');
      for(const [field,allowed]of [['grant_types',['authorization_code','refresh_token']],['response_types',['code']]] as const){const value=body[field];if(value!==undefined&&(!Array.isArray(value)||!value.length||value.some(v=>!allowed.includes(v as never))))fail(400,'invalid_client_metadata','Flux OAuth non pris en charge.');}
      if(body.scope!==undefined)normalizedScope(String(body.scope));
      const name=body.client_name??'Client MCP';if(typeof name!=='string'||!name.trim()||name.length>100)fail(400,'invalid_client_metadata','Nom du client invalide.');
      const id='mcp_'+inviteToken(),secret=method==='none'?null:inviteToken(),now=new Date().toISOString();
      await c.env.DB.prepare('INSERT INTO lite_oauth_clients(id,name,redirects_json,auth_method,secret_hash,created_at) VALUES(?,?,?,?,?,?)').bind(id,name.trim(),JSON.stringify(redirects),method,secret?await hash(secret):null,now).run();
      return oauthJson({client_id:id,...(secret?{client_secret:secret,client_secret_expires_at:0}:{}),client_id_issued_at:Math.floor(Date.now()/1000),client_name:name.trim(),redirect_uris:redirects,token_endpoint_auth_method:method,grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:MCP_SCOPES.join(' ')},201);
    }
    if(path==='/oauth/authorize'&&request.method==='GET'){
      await rateLimit(request,c,'authorize',120);
      const p=url.searchParams;for(const key of p.keys())if(p.getAll(key).length!==1)fail(400,'invalid_request','Paramètre OAuth répété.');
      const client=await getClient(c,p.get('client_id')||''),redirect=p.get('redirect_uri')||'';
      // Never redirect an error before validating the exact registered callback.
      if(!client||!JSON.parse(client.redirects_json).includes(redirect))fail(400,'invalid_request','Client ou adresse de retour invalide.');
      const state=p.get('state')||'',target={redirect_uri:redirect,state};
      try{
        if(p.get('response_type')!=='code')fail(400,'unsupported_response_type','Seul le code d’autorisation est accepté.');
        if(p.get('code_challenge_method')!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(p.get('code_challenge')||''))fail(400,'invalid_request','PKCE S256 requis.');
        if(p.get('resource')!==resource)fail(400,'invalid_target','Ressource MCP invalide.');
        if(state.length>2048)fail(400,'invalid_request','État OAuth trop long.');
        const scope=normalizedScope(p.get('scope')||''),id=inviteToken();
        await c.env.DB.batch([
          c.env.DB.prepare('DELETE FROM lite_oauth_requests WHERE expires_at<?').bind(new Date().toISOString()),
          c.env.DB.prepare('INSERT INTO lite_oauth_requests(id,client_id,redirect_uri,scope,resource,challenge,state,expires_at,status) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,client.id,redirect,scope,resource,p.get('code_challenge'),state,expiry(CODE_SECONDS),'pending'),
        ]);
        return redirectTo('/oauth/consent?request='+id);
      }catch(e){if(e instanceof ApiError)return authorizationRedirect(target,base,{error:e.code,error_description:e.message});throw e;}
    }
    if(path==='/oauth/decision'&&request.method==='POST'){
      checkOrigin(request);if(!c.identity)fail(401,'authentication_required','Reconnectez-vous pour autoriser ce client.');
      const p=await form(request),pending=await c.env.DB.prepare("SELECT * FROM lite_oauth_requests WHERE id=? AND status='pending' AND expires_at>?").bind(p.get('request')||'',new Date().toISOString()).first<Pending>();
      if(!pending||pending.user_id!==c.identity.userId||!pending.csrf_hash||pending.csrf_hash!==await hash(p.get('csrf')||''))fail(400,'invalid_request','Autorisation expirée ou invalide. Recommencez la connexion.');
      if(!await getClient(c,pending.client_id))fail(400,'invalid_client','Client révoqué.');
      if(pending.resource!==resource)fail(400,'invalid_target','Ressource MCP invalide.');
      if(p.get('decision')==='deny'){
        await c.env.DB.prepare("UPDATE lite_oauth_requests SET status='denied' WHERE id=? AND status='pending'").bind(pending.id).run();
        return authorizationRedirect(pending,base,{error:'access_denied',error_description:'Accès refusé.'});
      }
      if(p.get('decision')!=='approve')fail(400,'invalid_request','Décision manquante.');
      const member=await c.env.DB.prepare('SELECT role FROM lite_members WHERE org_id=? AND user_id=?').bind(p.get('workspace')||'',c.identity.userId).first<{role:string}>();
      if(!member)fail(403,'access_denied','Vous n’avez pas accès à cet espace.');
      const scope=normalizedScope(p.get('scope')||'crm:read');
      if(scope.split(' ').some(s=>!pending.scope.split(' ').includes(s))||(member.role==='viewer'&&scope.includes('crm:write')))fail(403,'invalid_scope','Ces droits ne sont pas disponibles pour ce compte.');
      const code=inviteToken();
      const result=await c.env.DB.prepare("UPDATE lite_oauth_requests SET status='approved',code_hash=?,org_id=?,scope=? WHERE id=? AND status='pending' AND csrf_hash=? AND user_id=? AND expires_at>?").bind(await hash(code),p.get('workspace'),scope,pending.id,pending.csrf_hash,c.identity.userId,new Date().toISOString()).run();
      if(!result.meta.changes)fail(400,'invalid_request','Autorisation déjà utilisée.');
      return authorizationRedirect(pending,base,{code});
    }
    if((path==='/oauth/token'||path==='/oauth/revoke')&&request.method==='POST'){
      await rateLimit(request,c,'token',240,60);
      const p=await form(request),client=await authenticateClient(request,c,p);
      if(path==='/oauth/revoke'){
        await c.env.DB.prepare('UPDATE lite_oauth_grants SET revoked_at=? WHERE client_id=? AND id IN (SELECT grant_id FROM lite_oauth_tokens WHERE access_hash=? OR refresh_hash=?)').bind(new Date().toISOString(),client.id,await hash(p.get('token')||''),await hash(p.get('token')||'')).run();
        return oauthJson({});
      }
      if(p.get('resource')!==resource)fail(400,'invalid_target','Ressource MCP invalide.');
      return await exchangeToken(request,c,client,p);
    }
    return oauthJson({error:'invalid_request',error_description:'Route OAuth introuvable.'},404);
  }catch(e){
    if(e instanceof ApiError){const response=oauthJson({error:e.code,error_description:e.message},e.status);if(e.code==='invalid_client')response.headers.set('WWW-Authenticate','Basic realm="MCP OAuth"');if(e.status===429)response.headers.set('Retry-After','60');return response;}
    console.error('MCP OAuth request failed',e instanceof Error?e.name:'Error');
    return oauthJson({error:'temporarily_unavailable',error_description:'Connexion indisponible. Réessayez.'},503);
  }
}

/** Called only after the Sites dispatcher has established the browser identity. */
export async function prepareOAuthConsent(c:ApiContext,requestId:string):Promise<OAuthConsent>{
  if(!c.identity)fail(401,'authentication_required','Connexion requise.');
  const pending=await c.env.DB.prepare("SELECT * FROM lite_oauth_requests WHERE id=? AND status='pending' AND expires_at>?").bind(requestId,new Date().toISOString()).first<Pending>();
  if(!pending)fail(400,'invalid_request','Cette demande a expiré. Relancez la connexion depuis votre client MCP.');
  const client=await getClient(c,pending.client_id);if(!client)fail(400,'invalid_client','Client révoqué.');
  const workspaces=(await c.env.DB.prepare('SELECT o.id,o.name,m.role FROM lite_orgs o JOIN lite_members m ON m.org_id=o.id WHERE m.user_id=? ORDER BY o.name').bind(c.identity.userId).all<{id:string;name:string;role:string}>()).results;
  const csrf=inviteToken();
  await c.env.DB.prepare("UPDATE lite_oauth_requests SET user_id=?,csrf_hash=? WHERE id=? AND status='pending'").bind(c.identity.userId,await hash(csrf),requestId).run();
  return {requestId,csrf,clientName:client.name,redirectOrigin:new URL(pending.redirect_uri).origin,scope:pending.scope,email:c.identity.email,workspaces};
}

async function exchangeToken(request:Request,c:ApiContext,client:Client,p:URLSearchParams){
  const db=c.env.DB,now=new Date().toISOString(),resource=mcpResource(request),type=p.get('grant_type');
  const access='mcp_at_'+inviteToken(),refresh='mcp_rt_'+inviteToken(),tokenId=crypto.randomUUID(),accessExpiry=expiry(ACCESS_SECONDS);
  const accessHash=await hash(access),refreshHash=await hash(refresh);
  let scope:string,grantId:string,refreshExpiry:string;
  if(type==='authorization_code'){
    const pending=await db.prepare("SELECT * FROM lite_oauth_requests WHERE code_hash=? AND client_id=? AND status='approved' AND expires_at>?").bind(await hash(p.get('code')||''),client.id,now).first<Pending>();
    const verifier=p.get('code_verifier')||'';
    const challenge=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    if(!pending||!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)||challenge!==pending.challenge||p.get('redirect_uri')!==pending.redirect_uri||pending.resource!==resource)fail(400,'invalid_grant','Code ou preuve PKCE invalide, expiré ou déjà utilisé.');
    if(!await db.prepare('SELECT 1 FROM lite_members WHERE org_id=? AND user_id=?').bind(pending.org_id,pending.user_id).first())fail(400,'invalid_grant','Accès à cet espace retiré.');
    scope=pending.scope;grantId=crypto.randomUUID();refreshExpiry=expiry(REFRESH_SECONDS);
    const result=await db.batch([
      db.prepare("UPDATE lite_oauth_requests SET status='used',grant_id=? WHERE id=? AND status='approved' AND expires_at>?").bind(grantId,pending.id,now),
      db.prepare('INSERT INTO lite_oauth_grants(id,client_id,org_id,user_id,scope,resource,created_at,expires_at) SELECT grant_id,client_id,org_id,user_id,scope,resource,?,? FROM lite_oauth_requests WHERE id=? AND grant_id=?').bind(now,refreshExpiry,pending.id,grantId),
      db.prepare('INSERT INTO lite_oauth_tokens(id,grant_id,scope,access_hash,refresh_hash,access_expires_at,refresh_expires_at) SELECT ?,id,scope,?,?,?,expires_at FROM lite_oauth_grants WHERE id=?').bind(tokenId,accessHash,refreshHash,accessExpiry,grantId),
    ]);
    if(!result[0].meta.changes)fail(400,'invalid_grant','Code déjà utilisé.');
  }else if(type==='refresh_token'){
    const old=await db.prepare(`SELECT t.id,t.grant_id,t.scope,t.rotated_to,t.refresh_expires_at FROM lite_oauth_tokens t JOIN lite_oauth_grants g ON g.id=t.grant_id JOIN lite_members m ON m.org_id=g.org_id AND m.user_id=g.user_id
      WHERE t.refresh_hash=? AND g.client_id=? AND g.resource=? AND g.revoked_at IS NULL AND g.expires_at>? AND t.refresh_expires_at>?`).bind(await hash(p.get('refresh_token')||''),client.id,resource,now,now).first<{id:string;grant_id:string;scope:string;rotated_to:string|null;refresh_expires_at:string}>();
    if(!old)fail(400,'invalid_grant','Jeton de renouvellement invalide, expiré ou révoqué.');
    if(old.rotated_to){await db.prepare('UPDATE lite_oauth_grants SET revoked_at=? WHERE id=?').bind(now,old.grant_id).run();fail(400,'invalid_grant','Jeton déjà utilisé. Reconnectez ce client.');}
    scope=normalizedScope(p.get('scope')||old.scope);if(scope.split(' ').some(s=>!old.scope.split(' ').includes(s)))fail(400,'invalid_scope','Le renouvellement ne peut pas augmenter les droits.');
    grantId=old.grant_id;refreshExpiry=old.refresh_expires_at;
    const result=await db.batch([
      db.prepare('UPDATE lite_oauth_tokens SET rotated_to=? WHERE id=? AND rotated_to IS NULL').bind(tokenId,old.id),
      db.prepare('INSERT INTO lite_oauth_tokens(id,grant_id,scope,access_hash,refresh_hash,access_expires_at,refresh_expires_at) SELECT ?,grant_id,?,?,?,?,refresh_expires_at FROM lite_oauth_tokens WHERE id=? AND rotated_to=?').bind(tokenId,scope,accessHash,refreshHash,accessExpiry,old.id,tokenId),
    ]);
    if(!result[0].meta.changes){await db.prepare('UPDATE lite_oauth_grants SET revoked_at=? WHERE id=?').bind(now,grantId).run();fail(400,'invalid_grant','Renouvellement déjà utilisé. Reconnectez ce client.');}
  }else fail(400,'unsupported_grant_type','Flux OAuth non pris en charge.');
  return oauthJson({access_token:access,token_type:'Bearer',expires_in:ACCESS_SECONDS,refresh_token:refresh,scope,resource});
}

export async function resolveOAuthToken(request:Request,c:ApiContext):Promise<{identity:Identity;access:TokenAccess}|null>{
  const authorization=request.headers.get('authorization');if(!authorization||!/^Bearer mcp_at_/i.test(authorization))return null;
  if(new URL(request.url).pathname!=='/api/mcp'||!/^Bearer mcp_at_[a-f0-9]{64}$/i.test(authorization))fail(401,'invalid_token','Jeton MCP invalide.');
  const now=new Date().toISOString();
  const token=await c.env.DB.prepare(`SELECT g.id,g.org_id,t.scope,u.id AS user_id,u.email,u.name FROM lite_oauth_tokens t
    JOIN lite_oauth_grants g ON g.id=t.grant_id JOIN lite_oauth_clients cl ON cl.id=g.client_id JOIN lite_users u ON u.id=g.user_id JOIN lite_members m ON m.org_id=g.org_id AND m.user_id=g.user_id
    WHERE t.access_hash=? AND t.access_expires_at>? AND g.expires_at>? AND g.resource=? AND g.revoked_at IS NULL AND cl.revoked_at IS NULL`).bind(await hash(authorization.slice(7)),now,now,mcpResource(request)).first<{id:string;org_id:string;scope:string;user_id:string;email:string;name:string}>();
  if(!token||!token.scope.split(' ').includes('crm:read'))fail(401,'invalid_token','Connexion expirée, révoquée ou sans accès à cet espace.');
  return {identity:{userId:token.user_id,email:token.email,displayName:token.name},access:{id:token.id,workspaceId:token.org_id,mode:token.scope.split(' ').includes('crm:write')?'write':'read'}};
}
