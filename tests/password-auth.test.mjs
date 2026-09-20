import test from 'node:test';
import assert from 'node:assert/strict';
import {localDb} from './helpers.mjs';
import {handlePasswordAuth,preparePasswordAccount,resolvePasswordIdentity} from '../runtime/core/password-auth.ts';

const identity={userId:'password-alice',email:'alice.password@example.test',displayName:'Alice Password'};
const call=async(env,path,body,{cookie,origin='https://test.example'}={})=>{
 const headers={'content-type':'application/json',origin,'sec-fetch-site':'same-origin',...(cookie?{cookie}:{})};
 const response=await handlePasswordAuth(new Request('https://test.example/api/v1/auth/'+path,{method:'POST',headers,body:JSON.stringify(body??{})}),env);
 return {response,status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};
};
const cookieValue=value=>value.match(/__Host-lite_password_session=([a-f0-9]{64})/)?.[1];

test('explicit account activation creates a secure one-use password session and logout revokes it',async()=>{
 const db=await localDb(),env={DB:db};try{
  const prepared=await preparePasswordAccount({db,identity,username:'Alice.Login'});await db.batch(prepared.statements);
  const stored=db.raw.prepare('SELECT username_norm,email_norm,password_hash FROM lite_password_accounts WHERE user_id=?').get(identity.userId);
  assert.deepEqual({...stored},{username_norm:'alice.login',email_norm:identity.email,password_hash:null});
  assert.equal(JSON.stringify(stored).includes(prepared.activationToken),false);
  assert.equal((await call(env,'login',{identifier:'alice.login',password:'correct horse battery'})).status,401);
  assert.equal((await call(env,'activate',{token:prepared.activationToken,password:'correct horse battery'},{origin:'https://evil.example'})).status,403);
  const activated=await call(env,'activate',{token:prepared.activationToken,password:'correct horse battery'});assert.equal(activated.status,200);assert.deepEqual(activated.body,{ok:true});
  assert.equal((await call(env,'activate',{token:prepared.activationToken,password:'another secure password'})).status,400);
  assert.equal((await call(env,'login',{identifier:'alice.login',password:'short'})).status,401);
  const login=await call(env,'login',{identifier:identity.email.toUpperCase(),password:'correct horse battery'});assert.equal(login.status,200);assert.match(login.cookie,/Path=\/;.*HttpOnly;.*Secure;.*SameSite=Lax/);
  const token=cookieValue(login.cookie),request=new Request('https://test.example/api/v1/session',{headers:{cookie:`__Host-lite_password_session=${token}`}});
  assert.deepEqual(await resolvePasswordIdentity(request,env),identity);
  const logout=await call(env,'logout',{}, {cookie:`__Host-lite_password_session=${token}`});assert.equal(logout.status,200);assert.match(logout.cookie,/Max-Age=0/);assert.equal(await resolvePasswordIdentity(request,env),null);
  assert.ok(db.raw.prepare('SELECT revoked_at FROM lite_password_sessions').get().revoked_at);
 }finally{db.close();}
});

test('expired accounts cannot authenticate or retain a session',async()=>{
 const db=await localDb(),env={DB:db};try{
  await assert.rejects(preparePasswordAccount({db,identity,username:'alice-invalid-expiry',accountExpiresAt:'not-a-date'}),/Expiration du compte invalide/);
  const prepared=await preparePasswordAccount({db,identity,username:'alice-expiring',accountExpiresAt:new Date(Date.now()+60000).toISOString()});await db.batch(prepared.statements);await call(env,'activate',{token:prepared.activationToken,password:'expiring secure password'});
  const login=await call(env,'login',{identifier:'alice-expiring',password:'expiring secure password'}),token=cookieValue(login.cookie);assert.equal(login.status,200);
  db.raw.prepare('UPDATE lite_password_accounts SET expires_at=? WHERE user_id=?').run(new Date(Date.now()-1000).toISOString(),identity.userId);
  assert.equal(await resolvePasswordIdentity(new Request('https://test.example/api/v1/session',{headers:{cookie:`__Host-lite_password_session=${token}`}}),env),null);
  assert.equal((await call(env,'login',{identifier:'alice-expiring',password:'expiring secure password'})).status,401);
 }finally{db.close();}
});

test('reset stays enumeration-safe, exposes its token only to callback, and revokes every old session',async()=>{
 const db=await localDb(),env={DB:db};try{
  const prepared=await preparePasswordAccount({db,identity,username:'alice-reset'});await db.batch(prepared.statements);await call(env,'activate',{token:prepared.activationToken,password:'first secure password'});
  const first=await call(env,'login',{identifier:'alice-reset',password:'first secure password'}),session=cookieValue(first.cookie);let delivered;
  const failedDelivery=new Request('https://test.example/api/v1/auth/reset',{method:'POST',headers:{origin:'https://test.example','sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify({identifier:identity.email})});
  const deliveryResponse=await handlePasswordAuth(failedDelivery,env,{onPasswordResetRequested:()=>{throw new Error('mail unavailable');}});assert.equal(deliveryResponse.status,200);assert.deepEqual(await deliveryResponse.json(),{ok:true});
  const request=new Request('https://test.example/api/v1/auth/reset',{method:'POST',headers:{origin:'https://test.example','sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify({identifier:'alice-reset'})});
  const response=await handlePasswordAuth(request,env,{onPasswordResetRequested:value=>{delivered=value;}}),body=await response.json();assert.deepEqual(body,{ok:true});assert.ok(delivered.token);assert.equal(JSON.stringify(body).includes(delivered.token),false);
  const unknown=await call(env,'reset',{identifier:'nobody@example.test'});assert.deepEqual(unknown.body,{ok:true});
  const reset=await call(env,'reset',{token:delivered.token,password:'second secure password'});assert.equal(reset.status,200);
  const oldRequest=new Request('https://test.example/api/v1/session',{headers:{cookie:`__Host-lite_password_session=${session}`}});assert.equal(await resolvePasswordIdentity(oldRequest,env),null);
  assert.equal((await call(env,'reset',{token:delivered.token,password:'third secure password'})).status,400);
  assert.equal((await call(env,'login',{identifier:'alice-reset',password:'first secure password'})).status,401);
  assert.equal((await call(env,'login',{identifier:'alice-reset',password:'second secure password'})).status,200);
 }finally{db.close();}
});

test('expired activation can be renewed without disclosing the token and missing Origin is rejected',async()=>{
 const db=await localDb(),env={DB:db};try{
  const prepared=await preparePasswordAccount({db,identity,username:'alice-renew'});await db.batch(prepared.statements);
  db.raw.prepare("UPDATE lite_password_tokens SET expires_at='2000-01-01T00:00:00.000Z'").run();let delivered;
  const renewal=new Request('https://test.example/api/v1/auth/reset',{method:'POST',headers:{origin:'https://test.example','sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify({identifier:'alice-renew'})});
  const response=await handlePasswordAuth(renewal,env,{onPasswordResetRequested:value=>{delivered=value;}});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});assert.equal(delivered.purpose,'activation');assert.ok(Date.parse(delivered.expiresAt)-Date.now()>23*60*60*1000);
  assert.equal((await call(env,'activate',{token:prepared.activationToken,password:'old activation password'})).status,400);
  assert.equal((await call(env,'activate',{token:delivered.token,password:'renewed secure password'})).status,200);
  const missingOrigin=await handlePasswordAuth(new Request('https://test.example/api/v1/auth/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),env);assert.equal(missingOrigin.status,403);
 }finally{db.close();}
});

test('activation and reset recheck account state inside their transaction',async()=>{
 const db=await localDb();try{
  const prepared=await preparePasswordAccount({db,identity,username:'alice-race'});await db.batch(prepared.statements);let raced=false,race=()=>db.raw.prepare('UPDATE lite_password_accounts SET disabled_at=? WHERE user_id=?').run(new Date().toISOString(),identity.userId);
  const raceDb={prepare:sql=>db.prepare(sql),async batch(statements){if(!raced){raced=true;race();}return db.batch(statements);}};
  const result=await call({DB:raceDb},'activate',{token:prepared.activationToken,password:'race secure password'});assert.equal(result.status,409);
  const account=db.raw.prepare('SELECT activated_at,password_hash FROM lite_password_accounts WHERE user_id=?').get(identity.userId);assert.equal(account.activated_at,null);assert.equal(account.password_hash,null);
  assert.equal(db.raw.prepare("SELECT consumed_at FROM lite_password_tokens WHERE purpose='activation'").get().consumed_at,null);
  db.raw.prepare('UPDATE lite_password_accounts SET disabled_at=NULL WHERE user_id=?').run(identity.userId);assert.equal((await call({DB:db},'activate',{token:prepared.activationToken,password:'race secure password'})).status,200);
  const login=await call({DB:db},'login',{identifier:'alice-race',password:'race secure password'}),session=cookieValue(login.cookie);let delivered;
  const request=new Request('https://test.example/api/v1/auth/reset',{method:'POST',headers:{origin:'https://test.example','sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify({identifier:'alice-race'})});
  await handlePasswordAuth(request,{DB:db},{onPasswordResetRequested:value=>{delivered=value;}});raced=false;
  const reset=await call({DB:raceDb},'reset',{token:delivered.token,password:'replacement secure password'});assert.equal(reset.status,409);
  assert.equal(db.raw.prepare("SELECT consumed_at FROM lite_password_tokens WHERE purpose='reset'").get().consumed_at,null);
  assert.equal(db.raw.prepare('SELECT revoked_at FROM lite_password_sessions WHERE session_hash=?').get(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(session)).then(value=>Buffer.from(value).toString('hex'))).revoked_at,null);
 }finally{db.close();}
});

test('provisioning never links by email and login throttling is durable',async()=>{
 const db=await localDb(),env={DB:db};try{
  const first=await preparePasswordAccount({db,identity,username:'alice-one'});await db.batch(first.statements);
  const other={userId:'password-other',email:identity.email,displayName:'Other'};const duplicate=await preparePasswordAccount({db,identity:other,username:'other-login'});
  await assert.rejects(db.batch(duplicate.statements),/UNIQUE constraint failed/);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM lite_password_accounts').get().n,1);
  for(let i=0;i<8;i++)assert.equal((await call(env,'login',{identifier:'missing-user',password:'irrelevant password'})).status,401);
  assert.equal((await call(env,'login',{identifier:'missing-user',password:'irrelevant password'})).status,429);
  assert.equal(db.raw.prepare('SELECT attempts FROM lite_password_throttles').get().attempts,9);
 }finally{db.close();}
});
