import { testMailConnection } from './mail.ts';
import type { ApiContext, Workspace } from './types.ts';
import { ApiError, fail, requireRole } from './validation.ts';
import { json, readJson, readBytes } from './http.ts';

export const integrationProviders = [
  {id:'openai',label:'OpenAI',secretPlaceholder:'sk-…'},
  {id:'hermes',label:'Hermes',secretPlaceholder:'Clé du serveur Hermes'},
  {id:'anthropic',label:'Anthropic',secretPlaceholder:'sk-ant-…'},
  {id:'notion',label:'Notion',secretPlaceholder:'ntn_…'},
  {id:'resend',label:'Resend (mail)',secretPlaceholder:'re_…'},
  {id:'cloudflare',label:'Cloudflare Email',secretPlaceholder:'Jeton API Cloudflare'},
  {id:'smtp',label:'SMTP',secretPlaceholder:'Mot de passe SMTP'},
  {id:'imap',label:'IMAP',secretPlaceholder:'Mot de passe IMAP'},
  {id:'custom',label:'Autre',secretPlaceholder:'Clé / secret'},
];
function integrationSlug(value:unknown){
  const slug=textField(value,'référence',80);if(!/^[a-z][a-z0-9_-]{0,79}$/.test(slug)||integrationProviders.some(p=>p.id!=='custom'&&p.id===slug))fail(400,'invalid_slug','Référence invalide ou réservée à un service natif.');return slug;
}
export const mailProviders=['smtp','imap','resend','cloudflare'];
export type IntegrationRow={id:string;org_id:string;slug:string;provider:string;label:string;secret_box:string;meta_json:string;enabled:number;version:number;created_at:string;updated_at:string};
const enc=new TextEncoder(),dec=new TextDecoder();
const base64=(value:Uint8Array)=>btoa(String.fromCharCode(...value));
const unbase64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function cipher(c:ApiContext){
  if(!c.env.LITE_INTEGRATION_SECRET)fail(503,'vault_unavailable','Le coffre des intégrations n’est pas configuré.');
  return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',enc.encode(c.env.LITE_INTEGRATION_SECRET)),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function sealSecret(c:ApiContext,org:string,id:string,secret:string){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(`${org}:${id}`)},await cipher(c),enc.encode(secret));
  return `enc:v1:${base64(iv)}:${base64(new Uint8Array(encrypted))}`;
}
export async function resolveIntegration(c:ApiContext,row:IntegrationRow){
  try{const [prefix,version,iv,data]=row.secret_box.split(':');if(prefix!=='enc'||version!=='v1')throw Error();
    return dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(iv),additionalData:enc.encode(`${row.org_id}:${row.id}`)},await cipher(c),unbase64(data)));
  }catch(e){if(e instanceof ApiError&&e.status===503)throw e;fail(409,'unreadable','Clé illisible : saisissez-la de nouveau dans Intégrations.');}
}
export function textField(value:unknown,name:string,max=300,optional=false){
  if(optional&&(value===undefined||value===null))return '';
  if(typeof value!=='string'||(!optional&&!value.trim())||value.length>max)fail(400,'invalid_field',`Champ ${name} invalide.`);
  return value.trim();
}
// Only a public HTTPS endpoint is meaningful from Sites. Never forward keys on redirects.
export function hermesUrl(value:unknown){
  const raw=textField(value,'URL Hermes',1000);let url:URL;
  try{url=new URL(raw);}catch{fail(400,'invalid_endpoint','URL HTTPS Hermes invalide.');}
  const host=url!.hostname.toLowerCase();
  if(url!.protocol!=='https:'||url!.username||url!.password||url!.search||url!.hash||!host.includes('.')||host.includes(':')||/^\d+(\.\d+){3}$/.test(host)||/(^|\.)(localhost|local|internal|test|invalid)$/.test(host)||host==='metadata.google.internal')fail(400,'invalid_endpoint','Indiquez le domaine HTTPS public de votre serveur Hermes, sans identifiants ni paramètres.');
  return url!.toString().replace(/\/$/,'').replace(/\/v1$/,'');
}
export function mailAddress(value:unknown){const address=textField(value,'adresse e-mail',254);if(!/^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/.test(address))fail(400,'invalid_email','Adresse e-mail invalide.');return address;}
export function mailHost(value:unknown){const host=textField(value,'serveur',253).toLowerCase();if(!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(host)||!host.includes('.')||/(^|\.)(localhost|local|internal|test|invalid)$/.test(host)||/^\d+(\.\d+){3}$/.test(host))fail(400,'invalid_host','Indiquez le nom public du serveur de messagerie.');return host;}
function metadata(provider:string,input:unknown){
  const v=input&&typeof input==='object'&&!Array.isArray(input)?input as Record<string,unknown>:{};
  const out:Record<string,unknown>={};
  if(provider==='hermes')out.baseUrl=hermesUrl(v.baseUrl);
  if(provider==='custom')out.headerName=textField(v.headerName??'Authorization','header',80);
  if(['smtp','imap'].includes(provider)){
    out.host=mailHost(v.host);out.user=textField(v.user,'identifiant',250);out.port=Number(v.port??(provider==='smtp'?465:993));
    if(!Number.isInteger(out.port)||Number(out.port)<1||Number(out.port)>65535)fail(400,'invalid_port','Port invalide.');
    out.security=v.security??(v.secure===false?'starttls':'tls');if(!['tls','starttls'].includes(String(out.security)))fail(400,'invalid_tls','Choisissez SSL/TLS ou STARTTLS.');out.secure=out.security==='tls';
    if(v.gatewayUrl)out.gatewayUrl=hermesUrl(v.gatewayUrl);
    if(provider==='imap')out.folder=textField(v.folder??'INBOX','dossier IMAP',200);
  }
  if(['smtp','resend','cloudflare'].includes(provider)){if(v.from)out.from=mailAddress(v.from);if(v.fromName){out.fromName=textField(v.fromName,'nom expéditeur',150);if(/[\r\n\0]/.test(out.fromName as string))fail(400,'invalid_sender','Nom d’expéditeur invalide.');}}
  if(provider==='cloudflare'){const accountId=textField(v.accountId,'identifiant du compte Cloudflare',32);if(!/^[a-f0-9]{32}$/i.test(accountId))fail(400,'invalid_account','Identifiant du compte Cloudflare invalide.');out.accountId=accountId;}
  return out;
}
export async function resolveMailCredentials(c:ApiContext,row:IntegrationRow){
  const value=await resolveIntegration(c,row);if(value.startsWith('mail:v1:')){try{return JSON.parse(value.slice(8)) as {password:string;gatewayToken:string};}catch{fail(409,'unreadable','Identifiants de messagerie illisibles.');}}
  return {password:value,gatewayToken:''};
}
async function mailSecret(c:ApiContext,org:string,id:string,body:Record<string,unknown>,previous?:IntegrationRow){
  const old=previous?await resolveMailCredentials(c,previous):{password:'',gatewayToken:''};
  const password=body.secret===undefined?old.password:textField(body.secret,'mot de passe',8192);
  if(!password)fail(400,'password_required','Mot de passe requis.');
  const gatewayToken=body.gatewayToken===undefined?old.gatewayToken:textField(body.gatewayToken,'clé de la passerelle',8192,true);
  return sealSecret(c,org,id,'mail:v1:'+JSON.stringify({password,gatewayToken}));
}
export async function publicIntegration(c:ApiContext,row:IntegrationRow){
  let readable=false;try{await resolveIntegration(c,row);readable=true;}catch{}
  const meta=JSON.parse(row.meta_json);delete meta.model;
  let gatewayConfigured=false;if(['smtp','imap'].includes(row.provider)&&readable)gatewayConfigured=Boolean((await resolveMailCredentials(c,row)).gatewayToken);
  return {id:row.id,slug:row.slug,reference:`integration://${row.slug}`,provider:row.provider,label:row.provider==='custom'?row.label:integrationProviders.find(p=>p.id===row.provider)?.label??row.label,secretHint:'••••••••',readable,gatewayConfigured,meta,enabled:Boolean(row.enabled),version:row.version,createdAt:row.created_at,updatedAt:row.updated_at};
}
export async function integrationRows(c:ApiContext,org:Workspace,provider?:string){
  return (await c.env.DB.prepare(`SELECT * FROM lite_integrations WHERE org_id=?${provider?' AND provider=?':''} ORDER BY created_at,id`).bind(org.id,...(provider?[provider]:[])).all<IntegrationRow>()).results;
}
export async function getIntegration(c:ApiContext,org:Workspace,id:string){
  const row=await c.env.DB.prepare('SELECT * FROM lite_integrations WHERE org_id=? AND id=?').bind(org.id,id).first<IntegrationRow>();
  if(!row)fail(404,'integration_missing','Intégration introuvable.');return row;
}
export function upstreamFailure(status:number,provider:string):never{
  if(status===401||status===403)fail(502,'provider_auth',`${provider} refuse cette clé. Vérifiez l’intégration et les accès de la clé.`);
  if(status===429)fail(429,'provider_quota',`${provider} a atteint une limite de quota ou de débit.`);
  if(status===400||status===404)fail(502,'provider_model',`${provider} refuse ce modèle ou cette URL. Choisissez un modèle disponible dans le chat et vérifiez l’URL du serveur.`);
  fail(502,'provider_unavailable',`${provider} ne répond pas correctement (HTTP ${status}).`);
}
export async function providerRequest(row:IntegrationRow,key:string,path:string,init:RequestInit={}){
  const root=row.provider==='openai'?'https://api.openai.com':hermesUrl(JSON.parse(row.meta_json).baseUrl);
  // workerd supports manual/follow, not redirect:error. Never forward a secret to a redirect target.
  let response:Response;
  try{response=await fetch(root+path,{...init,redirect:'manual',signal:init.signal??AbortSignal.timeout(15000),headers:{...Object.fromEntries(new Headers(init.headers)),Authorization:`Bearer ${key}`}});}
  catch(e){
    if(init.signal?.aborted)throw e;
    if(e instanceof Error&&e.name==='TimeoutError')fail(504,'provider_timeout',`${row.provider==='openai'?'OpenAI':'Hermes'} n’a pas répondu dans le délai prévu. Réessayez.`);
    fail(502,'provider_unreachable',row.provider==='openai'?'Connexion à OpenAI impossible depuis le serveur. Réessayez dans un instant.':'Hermes est injoignable. Vérifiez l’URL publique et la disponibilité du serveur.');
  }
  if(response.status>=300&&response.status<400){await response.body?.cancel();fail(502,'provider_redirect',row.provider==='openai'?'OpenAI a renvoyé une redirection inattendue. Réessayez dans un instant.':'Le serveur Hermes redirige la connexion. Renseignez son adresse HTTPS finale dans Intégrations.');}
  return response;
}
export async function boundedProviderJson(response:Response){
  try{return JSON.parse(dec.decode(await readBytes(response as unknown as Request,2_000_000)));}
  catch(e){if(e instanceof ApiError)throw e;fail(502,'provider_response','Réponse du fournisseur invalide.');}
}
export async function integrationsRoute(request:Request,c:ApiContext,org:Workspace):Promise<Response|null>{
  const path=new URL(request.url).pathname.replace(/^\/api\/v1\/platform\/integrations\/?/,'');
  if(!new URL(request.url).pathname.startsWith('/api/v1/platform/integrations'))return null;
  requireRole(org.role,['owner','admin']);
  if(path==='catalog')return json({providers:integrationProviders});
  if(!path&&request.method==='GET')return json({integrations:await Promise.all((await integrationRows(c,org)).map(r=>publicIntegration(c,r)))});
  const [id,action]=path.split('/');
  if(id){
    const row=await getIntegration(c,org,id);
    if(action==='test'&&request.method==='POST'){
      if(mailProviders.includes(row.provider))return json(await testMailConnection(c,row));
      if(!['hermes','openai'].includes(row.provider))fail(400,'unsupported_test','Le test de connexion est disponible pour Hermes et OpenAI.');
      const response=await providerRequest(row,await resolveIntegration(c,row),row.provider==='hermes'?'/health':'/v1/models');
      if(!response.ok)upstreamFailure(response.status,row.provider);await response.body?.cancel();
      return json({ok:true,message:row.provider==='hermes'?'Serveur Hermes accessible.':'Clé OpenAI acceptée.'});
    }
    if(!action&&request.method==='GET')return json({integration:await publicIntegration(c,row)});
    if(!action&&request.method==='DELETE'){
      const version=Number(new URL(request.url).searchParams.get('version'));if(!Number.isInteger(version)||version<1)fail(400,'version_required','Version requise.');
      const result=await c.env.DB.prepare('DELETE FROM lite_integrations WHERE org_id=? AND id=? AND version=?').bind(org.id,id,version).run();
      if(!result.meta.changes)fail(409,'conflict','L’intégration a changé. Actualisez avant de réessayer.');return json({ok:true});
    }
    if(!action&&request.method==='PATCH'){
      const body=await readJson(request);if(body.version!==row.version)fail(409,'conflict','L’intégration a changé. Actualisez avant de réessayer.');
      if(body.enabled!==undefined&&typeof body.enabled!=='boolean')fail(400,'invalid_enabled','Activation invalide.');
      const box=['smtp','imap'].includes(row.provider)&&(body.secret!==undefined||body.gatewayToken!==undefined)?await mailSecret(c,org.id,id,body,row):body.secret!==undefined?await sealSecret(c,org.id,id,textField(body.secret,'clé',8192)):row.secret_box;
      const label=row.provider==='custom'?(body.label!==undefined?textField(body.label,'libellé',160):row.label):integrationProviders.find(p=>p.id===row.provider)!.label;
      const slug=row.provider==='custom'&&body.slug!==undefined&&body.slug!==row.slug?integrationSlug(body.slug):row.slug;
      if(slug!==row.slug&&await c.env.DB.prepare('SELECT id FROM lite_integrations WHERE org_id=? AND slug=?').bind(org.id,slug).first())fail(409,'slug_exists','Cette référence existe déjà.');
      const meta=JSON.stringify(metadata(row.provider,{...JSON.parse(row.meta_json),...(body.meta&&typeof body.meta==='object'?body.meta:{})}));
      const result=await c.env.DB.prepare('UPDATE lite_integrations SET label=?,slug=?,secret_box=?,meta_json=?,enabled=?,version=version+1,updated_at=? WHERE org_id=? AND id=? AND version=? AND NOT EXISTS(SELECT 1 FROM lite_integrations WHERE org_id=? AND slug=? AND id<>?)').bind(label,slug,box,meta,body.enabled===undefined?row.enabled:Number(body.enabled),new Date().toISOString(),org.id,id,row.version,org.id,slug,id).run();
      if(!result.meta.changes)fail(409,'conflict','L’intégration a changé. Actualisez avant de réessayer.');
      return json({integration:await publicIntegration(c,await getIntegration(c,org,id))});
    }
  }else if(request.method==='POST'){
    const body=await readJson(request),provider=textField(body.provider,'service');if(!integrationProviders.some(p=>p.id===provider))fail(400,'provider_unknown','Service inconnu.');
    const slug=provider==='custom'?integrationSlug(body.slug):provider;
    const label=provider==='custom'?textField(body.label,'libellé',160):integrationProviders.find(p=>p.id===provider)!.label,meta=JSON.stringify(metadata(provider,body.meta)),key=textField(body.secret,'clé',8192),id=crypto.randomUUID(),now=new Date().toISOString();
    const result=await c.env.DB.prepare('INSERT INTO lite_integrations(id,org_id,slug,provider,label,secret_box,meta_json,enabled,version,created_at,updated_at) SELECT ?,?,?,?,?,?,?,1,1,?,? WHERE ?=\'custom\' OR NOT EXISTS(SELECT 1 FROM lite_integrations WHERE org_id=? AND provider=?) ON CONFLICT(org_id,slug) DO NOTHING').bind(id,org.id,slug,provider,label,(['smtp','imap'].includes(provider)?await mailSecret(c,org.id,id,body):await sealSecret(c,org.id,id,key)),meta,now,now,provider,org.id,provider).run();
    if(!result.meta.changes)fail(409,'slug_exists',provider==='custom'?'Cette référence existe déjà. Choisissez une autre référence.':'Ce service est déjà configuré. Modifiez la clé existante.');
    return json({integration:await publicIntegration(c,await getIntegration(c,org,id))},201);
  }
  fail(404,'not_found','Route introuvable.');
}
