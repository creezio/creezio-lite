import type {D1Database,D1PreparedStatement} from '@cloudflare/workers-types';
import type {Identity} from './types.ts';
import {ApiError,errorBody} from './validation.ts';
import {checkOrigin,readJson} from './http.ts';

const COOKIE='__Host-lite_password_session';
const PBKDF2_ITERATIONS=100000;
const ACTIVATION_TTL_MS=24*60*60*1000;
const RESET_TTL_MS=60*60*1000;
const SESSION_TTL_MS=8*60*60*1000;
const LOGIN_WINDOW_MS=15*60*1000;

export type PasswordAuthEnvironment={DB:D1Database};
export type PasswordAuthCallbacks={
 onPasswordResetRequested?:(input:{identity:Identity;token:string;expiresAt:string;purpose:'activation'|'reset'})=>Promise<void>|void;
 onAccountActivated?:(input:{identity:Identity})=>Promise<void>|void;
 onPasswordReset?:(input:{identity:Identity})=>Promise<void>|void;
};
export type PreparedPasswordAccount={accountId:string;activationToken:string;expiresAt:string;statements:D1PreparedStatement[]};

const encoder=new TextEncoder();
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const randomToken=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const sha256=async(value:string)=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));
const nowIso=()=>new Date().toISOString();
const addMs=(iso:string,ms:number)=>new Date(Date.parse(iso)+ms).toISOString();
const normalizeEmail=(value:string)=>value.normalize('NFKC').trim().toLowerCase();
const normalizeUsername=(value:string)=>value.normalize('NFKC').trim().toLowerCase();
const validUsername=(value:string)=>/^[a-z0-9][a-z0-9._-]{2,63}$/.test(value);
const validEmail=(value:string)=>value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const identityOf=(row:{user_id:string;email:string;name:string}):Identity=>({userId:row.user_id,email:row.email,displayName:row.name});
const timingSafeEqual=(a:string,b:string)=>{let mismatch=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)mismatch|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return mismatch===0;};

async function passwordDigest(password:string,saltHex:string,iterations=PBKDF2_ITERATIONS){
 const bytes=encoder.encode(password);if(bytes.length<12||bytes.length>1024)throw new ApiError(422,'password_invalid','Le mot de passe doit contenir entre 12 et 1024 octets.');
 const salt=new Uint8Array(saltHex.match(/../g)?.map(value=>Number.parseInt(value,16))??[]);
 const key=await crypto.subtle.importKey('raw',bytes,'PBKDF2',false,['deriveBits']);
 return hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations},key,256)));
}
async function passwordRecord(password:string){const salt=hex(crypto.getRandomValues(new Uint8Array(16)));return{salt,hash:await passwordDigest(password,salt),iterations:PBKDF2_ITERATIONS};}
function cookieToken(request:Request){const header=request.headers.get('cookie')??'';for(const part of header.split(';')){const [name,...rest]=part.trim().split('=');if(name===COOKIE){const value=rest.join('=');return /^[a-f0-9]{64}$/.test(value)?value:null;}}return null;}
function response(body:unknown,status=200,cookie?:string){const headers=new Headers({'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie'});if(cookie)headers.set('Set-Cookie',cookie);return new Response(JSON.stringify(body),{status,headers});}
function sessionCookie(token:string,expiresAt:string){return `${COOKIE}=${token}; Path=/; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; Secure; SameSite=Lax`;}
function clearCookie(){return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;}
function changes(result:unknown){return Number((result as {meta?:{changes?:number}})?.meta?.changes??0);}

/** Explicitly provisions one identity. Email is data, never a lookup used to attach an existing user. */
export async function preparePasswordAccount(input:{db:D1Database;identity:Identity;username:string;now?:string;accountExpiresAt?:string|null}):Promise<PreparedPasswordAccount>{
 const username=normalizeUsername(input.username),email=normalizeEmail(input.identity.email),now=input.now??nowIso();
 if(!input.identity.userId||!input.identity.displayName.trim()||!validUsername(username)||!validEmail(email))throw new ApiError(422,'account_invalid','Compte autonome invalide.');
 const expiryTime=input.accountExpiresAt==null?null:Date.parse(input.accountExpiresAt);if(expiryTime!==null&&(!Number.isFinite(expiryTime)||expiryTime<=Date.parse(now)))throw new ApiError(422,'account_invalid','Expiration du compte invalide.');
 const accountExpiresAt=expiryTime===null?null:new Date(expiryTime).toISOString();
 const activationToken=randomToken(),tokenHash=await sha256(activationToken),expiresAt=addMs(now,ACTIVATION_TTL_MS);
 return {accountId:input.identity.userId,activationToken,expiresAt,statements:[
  input.db.prepare('INSERT INTO lite_users(id,email,name) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').bind(input.identity.userId,input.identity.email,input.identity.displayName),
  input.db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM lite_users WHERE id=? AND email=? AND name=?) THEN 1 ELSE json('password auth identity mismatch') END").bind(input.identity.userId,input.identity.email,input.identity.displayName),
  input.db.prepare('INSERT INTO lite_password_accounts(user_id,username_norm,email_norm,password_salt,password_hash,password_iterations,activated_at,disabled_at,expires_at,auth_version,created_at,updated_at) VALUES(?,?,?,NULL,NULL,NULL,NULL,NULL,?,1,?,?)').bind(input.identity.userId,username,email,accountExpiresAt,now,now),
  input.db.prepare("INSERT INTO lite_password_tokens(token_hash,user_id,purpose,expires_at,created_at,consumed_at) VALUES(?,?,'activation',?,?,NULL)").bind(tokenHash,input.identity.userId,expiresAt,now),
 ]};
}

export async function resolvePasswordIdentity(request:Request,env:PasswordAuthEnvironment):Promise<Identity|null>{
 const token=cookieToken(request);if(!token)return null;const digest=await sha256(token),now=nowIso();
 const row=await env.DB.prepare(`SELECT a.user_id,u.email,u.name FROM lite_password_sessions s JOIN lite_password_accounts a ON a.user_id=s.user_id JOIN lite_users u ON u.id=a.user_id WHERE s.session_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.auth_version=a.auth_version AND a.activated_at IS NOT NULL AND a.disabled_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>?)`).bind(digest,now,now).first<{user_id:string;email:string;name:string}>();
 return row?identityOf(row):null;
}

async function throttle(db:D1Database,key:string,limit:number,now:string){
 const bucket=await sha256(key),windowExpiresAt=addMs(now,LOGIN_WINDOW_MS);
 const row=await db.prepare(`INSERT INTO lite_password_throttles(bucket_hash,attempts,window_expires_at) VALUES(?,1,?) ON CONFLICT(bucket_hash) DO UPDATE SET attempts=CASE WHEN window_expires_at<=? THEN 1 ELSE attempts+1 END,window_expires_at=CASE WHEN window_expires_at<=? THEN excluded.window_expires_at ELSE window_expires_at END RETURNING attempts`).bind(bucket,windowExpiresAt,now,now).first<{attempts:number}>();
 if(!row||row.attempts>limit)throw new ApiError(429,'auth_rate_limited','Trop de tentatives. Réessayez plus tard.');return bucket;
}
async function readBody(request:Request){return readJson(request);}
async function tokenAccount(db:D1Database,token:string,purpose:'activation'|'reset',now:string){
 if(!/^[a-f0-9]{64}$/.test(token))return null;const digest=await sha256(token);
 const row=await db.prepare(`SELECT t.user_id,u.email,u.name FROM lite_password_tokens t JOIN lite_password_accounts a ON a.user_id=t.user_id JOIN lite_users u ON u.id=t.user_id WHERE t.token_hash=? AND t.purpose=? AND t.consumed_at IS NULL AND t.expires_at>? AND a.disabled_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>?)`).bind(digest,purpose,now,now).first<{user_id:string;email:string;name:string}>();
 return row?{row,digest}:null;
}
async function safeCallback(callback:(()=>Promise<void>|void)|undefined){if(callback)try{await callback();}catch{/* Account state is authoritative; delivery can be retried by the application. */}}

/** Handles only the four standalone auth routes; every other path returns null. */
export async function handlePasswordAuth(request:Request,env:PasswordAuthEnvironment,callbacks:PasswordAuthCallbacks={}):Promise<Response|null>{
 const path=new URL(request.url).pathname;if(!['/api/v1/auth/login','/api/v1/auth/logout','/api/v1/auth/activate','/api/v1/auth/reset'].includes(path))return null;
 if(request.method!=='POST')return response({error:{code:'method_not_allowed',message:'Méthode non autorisée.'}},405);
 try{
  checkOrigin(request);const now=nowIso();
  if(path.endsWith('/logout')){const token=cookieToken(request);if(token)await env.DB.prepare('UPDATE lite_password_sessions SET revoked_at=? WHERE session_hash=? AND revoked_at IS NULL').bind(now,await sha256(token)).run();return response({ok:true},200,clearCookie());}
  const body=await readBody(request);
  if(path.endsWith('/login')){
   const identifier=typeof body.identifier==='string'?body.identifier.normalize('NFKC').trim().toLowerCase():'',password=typeof body.password==='string'?body.password:'';
   if(!identifier||identifier.length>254)throw new ApiError(401,'auth_failed','Identifiant ou mot de passe incorrect.');
   const throttleKeys=[await throttle(env.DB,'login:id:'+identifier,8,now)];const ip=request.headers.get('cf-connecting-ip');if(ip&&/^[0-9a-f:.]{3,64}$/i.test(ip))throttleKeys.push(await throttle(env.DB,'login:ip:'+ip,30,now));
   const row=await env.DB.prepare(`SELECT a.user_id,a.password_salt,a.password_hash,a.password_iterations,a.auth_version,u.email,u.name FROM lite_password_accounts a JOIN lite_users u ON u.id=a.user_id WHERE (a.username_norm=? OR a.email_norm=?) AND a.activated_at IS NOT NULL AND a.disabled_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>?)`).bind(identifier,identifier,now).first<{user_id:string;password_salt:string;password_hash:string;password_iterations:number;auth_version:number;email:string;name:string}>();
   const dummySalt='00000000000000000000000000000000';let candidate='';try{candidate=await passwordDigest(password,row?.password_salt??dummySalt,row?.password_iterations??PBKDF2_ITERATIONS);}catch{await passwordDigest('invalid-password-padding',dummySalt);}
   const valid=Boolean(row?.password_hash&&row.password_salt&&row.password_iterations===PBKDF2_ITERATIONS&&timingSafeEqual(candidate,row.password_hash));
   if(!row||!valid)throw new ApiError(401,'auth_failed','Identifiant ou mot de passe incorrect.');
   const token=randomToken(),expiresAt=addMs(now,SESSION_TTL_MS);await env.DB.batch([env.DB.prepare('INSERT INTO lite_password_sessions(session_hash,user_id,auth_version,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?,NULL)').bind(await sha256(token),row.user_id,row.auth_version,now,expiresAt),...throttleKeys.map(key=>env.DB.prepare('DELETE FROM lite_password_throttles WHERE bucket_hash=?').bind(key))]);
   return response({ok:true},200,sessionCookie(token,expiresAt));
  }
  if(path.endsWith('/activate')){
   const token=typeof body.token==='string'?body.token:'',password=typeof body.password==='string'?body.password:'';const found=await tokenAccount(env.DB,token,'activation',now);if(!found)throw new ApiError(400,'activation_invalid','Lien d’activation invalide ou expiré.');
   const record=await passwordRecord(password),results=await env.DB.batch([env.DB.prepare(`UPDATE lite_password_accounts SET password_salt=?,password_hash=?,password_iterations=?,activated_at=?,auth_version=auth_version+1,updated_at=? WHERE user_id=? AND activated_at IS NULL AND disabled_at IS NULL AND (expires_at IS NULL OR expires_at>?) AND EXISTS(SELECT 1 FROM lite_password_tokens WHERE token_hash=? AND purpose='activation' AND consumed_at IS NULL AND expires_at>?)`).bind(record.salt,record.hash,record.iterations,now,now,found.row.user_id,now,found.digest,now),env.DB.prepare("UPDATE lite_password_tokens SET consumed_at=? WHERE token_hash=? AND purpose='activation' AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM lite_password_accounts WHERE user_id=? AND disabled_at IS NULL AND (expires_at IS NULL OR expires_at>?))").bind(now,found.digest,found.row.user_id,now)]);
   if(changes(results[0])!==1)throw new ApiError(409,'activation_consumed','Ce lien d’activation a déjà été utilisé.');const identity=identityOf(found.row);await safeCallback(callbacks.onAccountActivated?()=>callbacks.onAccountActivated!({identity}):undefined);return response({ok:true});
  }
  const token=typeof body.token==='string'?body.token:'';
  if(token){
   const password=typeof body.password==='string'?body.password:'',found=await tokenAccount(env.DB,token,'reset',now);if(!found)throw new ApiError(400,'reset_invalid','Lien de réinitialisation invalide ou expiré.');const record=await passwordRecord(password);
   const results=await env.DB.batch([env.DB.prepare(`UPDATE lite_password_accounts SET password_salt=?,password_hash=?,password_iterations=?,auth_version=auth_version+1,updated_at=? WHERE user_id=? AND activated_at IS NOT NULL AND disabled_at IS NULL AND (expires_at IS NULL OR expires_at>?) AND EXISTS(SELECT 1 FROM lite_password_tokens WHERE token_hash=? AND purpose='reset' AND consumed_at IS NULL AND expires_at>?)`).bind(record.salt,record.hash,record.iterations,now,found.row.user_id,now,found.digest,now),env.DB.prepare("UPDATE lite_password_tokens SET consumed_at=? WHERE token_hash=? AND purpose='reset' AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM lite_password_accounts WHERE user_id=? AND disabled_at IS NULL AND (expires_at IS NULL OR expires_at>?))").bind(now,found.digest,found.row.user_id,now),env.DB.prepare('UPDATE lite_password_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM lite_password_accounts WHERE user_id=? AND disabled_at IS NULL AND (expires_at IS NULL OR expires_at>?))').bind(now,found.row.user_id,found.row.user_id,now)]);
   if(changes(results[0])!==1)throw new ApiError(409,'reset_consumed','Ce lien de réinitialisation a déjà été utilisé.');const identity=identityOf(found.row);await safeCallback(callbacks.onPasswordReset?()=>callbacks.onPasswordReset!({identity}):undefined);return response({ok:true},200,clearCookie());
  }
  const identifier=typeof body.identifier==='string'?body.identifier.normalize('NFKC').trim().toLowerCase():'';if(!identifier||identifier.length>254)throw new ApiError(422,'identifier_invalid','Identifiant invalide.');await throttle(env.DB,'reset:'+identifier,5,now);
  const row=await env.DB.prepare(`SELECT a.user_id,a.activated_at,u.email,u.name FROM lite_password_accounts a JOIN lite_users u ON u.id=a.user_id WHERE (a.username_norm=? OR a.email_norm=?) AND a.disabled_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>?)`).bind(identifier,identifier,now).first<{user_id:string;activated_at:string|null;email:string;name:string}>();
  if(row){const purpose=row.activated_at?'reset':'activation',resetToken=randomToken(),expiresAt=addMs(now,purpose==='activation'?ACTIVATION_TTL_MS:RESET_TTL_MS);await env.DB.batch([env.DB.prepare('UPDATE lite_password_tokens SET consumed_at=? WHERE user_id=? AND purpose=? AND consumed_at IS NULL').bind(now,row.user_id,purpose),env.DB.prepare('INSERT INTO lite_password_tokens(token_hash,user_id,purpose,expires_at,created_at,consumed_at) VALUES(?,?,?,?,?,NULL)').bind(await sha256(resetToken),row.user_id,purpose,expiresAt,now)]);const identity=identityOf(row);await safeCallback(callbacks.onPasswordResetRequested?()=>callbacks.onPasswordResetRequested!({identity,token:resetToken,expiresAt,purpose}):undefined);}
  return response({ok:true});
 }catch(error){if(error instanceof ApiError)return response(errorBody(error),error.status);return response({error:{code:'auth_unavailable',message:'Authentification momentanément indisponible.'}},503);}
}
