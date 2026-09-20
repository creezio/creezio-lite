import './register-native-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {app,alice,bob,eve,client,boot,localDb,clientData} from './helpers.mjs';
import {oauthRoute,prepareOAuthConsent} from '../runtime/core/mcp-oauth.ts';
const {dispatchRequest}=await import('../runtime/modules/sites-adapter/src/dispatch.ts');
const base='https://test.example',resource=base+'/api/mcp',redirect='https://chatgpt.com/connector_platform_oauth_redirect';
const verifier='test-pkce-verifier-'.repeat(4),challenge=createHash('sha256').update(verifier).digest('base64url');

async function setup(){
  const db=await localDb(),org=await boot(client(db,alice)),other=await boot(client(db,bob));
  const context=identity=>({app,env:{DB:db},identity});
  const oauth=(path,{method='GET',body,identity=null,headers={}}={})=>oauthRoute(new Request(base+path,{method,headers:{...(body instanceof URLSearchParams?{'content-type':'application/x-www-form-urlencoded'}:body?{'content-type':'application/json'}:{}),...headers},body:body instanceof URLSearchParams?body:body?JSON.stringify(body):undefined}),context(identity));
  const api=(path,{method='GET',body,identity=alice,token,workspace=org}={})=>dispatchRequest(new Request(base+'/api/v1/'+path+'?workspace='+workspace,{method,headers:{origin:base,...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),context(identity));
  const rpc=(token,method='tools/list',params={},options={})=>dispatchRequest(new Request(resource+(options.query||''),{method:'POST',headers:{accept:'application/json, text/event-stream','content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),context(null));
  const register=async(method='none')=>{
    const r=await oauth('/oauth/register',{method:'POST',body:{client_name:'ChatGPT fixture',redirect_uris:[redirect],token_endpoint_auth_method:method}});assert.equal(r.status,201,await r.clone().text());return r.json();
  };
  const authorize=async(registered,overrides={})=>oauth('/oauth/authorize?'+new URLSearchParams({client_id:registered.client_id,redirect_uri:redirect,response_type:'code',scope:'crm:read crm:write',state:'state+with/characters',code_challenge:challenge,code_challenge_method:'S256',resource,...overrides}));
  const pending=async(registered,identity=alice)=>{
    const response=await authorize(registered);assert.equal(response.status,303,await response.clone().text());
    const id=new URL(response.headers.get('location'),base).searchParams.get('request');
    return prepareOAuthConsent(context(identity),id);
  };
  const decision=(consent,{identity=alice,workspace=org,scope='crm:read crm:write',...overrides}={})=>oauth('/oauth/decision',{method:'POST',identity,headers:{origin:base},body:new URLSearchParams({request:consent.requestId,csrf:consent.csrf,decision:'approve',workspace,scope,...overrides})});
  const exchange=(registered,code,overrides={},headers={})=>oauth('/oauth/token',{method:'POST',headers,body:new URLSearchParams({grant_type:'authorization_code',client_id:registered.client_id,...(registered.client_secret?{client_secret:registered.client_secret}:{}),code,code_verifier:verifier,redirect_uri:redirect,resource,...overrides})});
  const refresh=(registered,token,overrides={})=>oauth('/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:registered.client_id,...(registered.client_secret?{client_secret:registered.client_secret}:{}),refresh_token:token,resource,...overrides})});
  const connect=async({registered,scope='crm:read crm:write',identity=alice,workspace=org}={})=>{
    registered??=await register();const consent=await pending(registered,identity),approved=await decision(consent,{scope,identity,workspace});assert.equal(approved.status,303,await approved.clone().text());
    const callback=new URL(approved.headers.get('location'));assert.equal(callback.searchParams.get('iss'),base);assert.equal(callback.searchParams.get('state'),'state+with/characters');
    const response=await exchange(registered,callback.searchParams.get('code'));assert.equal(response.status,200,await response.clone().text());return {registered,tokens:await response.json(),code:callback.searchParams.get('code')};
  };
  return {db,org,other,context,oauth,api,rpc,register,authorize,pending,decision,exchange,refresh,connect};
}

test('OAuth discovery, issuer identification, PKCE and MCP share the existing module registry',async()=>{
  const h=await setup();try{
    const unauthorized=await h.rpc();assert.equal(unauthorized.status,401);assert.match(unauthorized.headers.get('www-authenticate'),/oauth-protected-resource\/api\/mcp/);
    const metadata=await(await h.oauth('/.well-known/oauth-protected-resource/api/mcp')).json();assert.equal(metadata.resource,resource);assert.deepEqual(metadata.authorization_servers,[base]);
    const discovery=await(await h.oauth('/.well-known/oauth-authorization-server')).json();assert.deepEqual(discovery.code_challenge_methods_supported,['S256']);assert.equal(discovery.authorization_response_iss_parameter_supported,true);
    const {tokens,registered}=await h.connect();
    const init=await(await h.rpc(tokens.access_token,'initialize',{protocolVersion:'2025-11-25'})).json();assert.equal(init.result.serverInfo.version,'0.15.13');
    const list=await(await h.rpc(tokens.access_token)).json();assert.ok(list.result.tools.some(t=>t.name==='lite_clients_list'));assert.ok(list.result.tools.some(t=>t.name==='lite_tasks_create'));
    assert.equal(list.result.tools.some(t=>t.name.includes('integrations')),false);
    const created=await(await h.rpc(tokens.access_token,'tools/call',{name:'lite_clients_create',arguments:{data:clientData}})).json();assert.equal(created.result.structuredContent.record.data.name,clientData.name);
    assert.equal((await h.api('integrations',{token:tokens.access_token,identity:null})).status,401);
    const clients=await(await h.api('admin/mcp/clients')).json();assert.equal(clients.clients[0].kind,'oauth');assert.equal(clients.clients[0].owner_name,alice.displayName);
    const status=await(await h.api('admin/mcp/status')).json();assert.equal(status.oauthReady,true);assert.equal(status.enabledClientCount,1);
    const stored=JSON.stringify({requests:h.db.raw.prepare('SELECT * FROM lite_oauth_requests').all(),tokens:h.db.raw.prepare('SELECT * FROM lite_oauth_tokens').all(),clients:h.db.raw.prepare('SELECT * FROM lite_oauth_clients').all(),logs:h.db.raw.prepare('SELECT * FROM lite_request_logs').all()});
    for(const secret of [tokens.access_token,tokens.refresh_token,verifier])assert.equal(stored.includes(secret),false);
    const revoke=await h.oauth('/oauth/revoke',{method:'POST',body:new URLSearchParams({client_id:registered.client_id,token:tokens.refresh_token})});assert.equal(revoke.status,200);assert.equal((await h.rpc(tokens.access_token)).status,401);
  }finally{h.db.close();}
});

test('OAuth refuses forged redirects, missing PKCE, invalid audience, CSRF and foreign workspaces',async()=>{
  const h=await setup();try{
    assert.equal((await h.oauth('/oauth/register',{method:'POST',body:{redirect_uris:['http://attacker.example/callback']}})).status,400);
    const registered=await h.register();
    const forged=await h.authorize(registered,{redirect_uri:'https://evil.example/steal'});assert.equal(forged.status,400);assert.equal(forged.headers.get('location'),null);
    for(const overrides of [{code_challenge_method:'plain'},{resource:'https://evil.example/api/mcp'},{scope:'admin'},{response_type:'token'}]){const r=await h.authorize(registered,overrides),u=new URL(r.headers.get('location'));assert.ok(u.searchParams.get('error'));assert.equal(u.searchParams.get('iss'),base);}
    const consent=await h.pending(registered);assert.deepEqual(consent.workspaces.map(w=>w.id),[h.org]);
    for(const overrides of [{csrf:'forged'},{identity:bob},{identity:null},{workspace:h.other}])assert.ok((await h.decision(consent,overrides)).status>=400);
    const cross=await h.oauth('/oauth/decision',{method:'POST',identity:alice,headers:{origin:'https://evil.example'},body:new URLSearchParams({request:consent.requestId,csrf:consent.csrf,decision:'approve',workspace:h.org,scope:'crm:read'})});assert.equal(cross.status,403);
    const denied=await h.decision(consent,{decision:'deny'});assert.equal(new URL(denied.headers.get('location')).searchParams.get('error'),'access_denied');assert.equal((await h.decision(consent)).status,400);
    await assert.rejects(()=>prepareOAuthConsent(h.context(null),consent.requestId),e=>e.status===401);
  }finally{h.db.close();}
});

test('authorization codes are bound to client, redirect, resource, verifier and single use',async()=>{
  const h=await setup();try{
    const registered=await h.register(),other=await h.register(),consent=await h.pending(registered);
    const approved=await h.decision(consent),code=new URL(approved.headers.get('location')).searchParams.get('code');
    for(const overrides of [{client_id:other.client_id},{redirect_uri:'https://evil.example'},{resource:'https://evil.example/api/mcp'},{code_verifier:'wrong'.repeat(15)}])assert.equal((await h.exchange(registered,code,overrides)).status,400);
    const responses=await Promise.all([h.exchange(registered,code),h.exchange(registered,code)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);assert.equal(h.db.raw.prepare('SELECT COUNT(*) n FROM lite_oauth_grants').get().n,1);
  }finally{h.db.close();}
});

test('DCR public, secret-post and secret-basic clients persist and authenticate with their registered method',async()=>{
  const h=await setup();try{
    const post=await h.register('client_secret_post'),p=await h.connect({registered:post});assert.equal((await h.refresh(post,p.tokens.refresh_token,{client_secret:'wrong'})).status,401);assert.equal((await h.refresh(post,p.tokens.refresh_token)).status,200);
    assert.equal(h.db.raw.prepare('SELECT secret_hash FROM lite_oauth_clients WHERE id=?').get(post.client_id).secret_hash,createHash('sha256').update(post.client_secret).digest('hex'));
    const basic=await h.register('client_secret_basic'),consent=await h.pending(basic),response=await h.decision(consent),code=new URL(response.headers.get('location')).searchParams.get('code');
    assert.equal((await h.exchange(basic,code)).status,401);
    const exchanged=await h.exchange({client_id:basic.client_id},code,{}, {authorization:'Basic '+Buffer.from(basic.client_id+':'+basic.client_secret).toString('base64')});assert.equal(exchanged.status,200,await exchanged.clone().text());
    assert.ok(await h.pending(post)); // Registration remains valid after an exchange.
  }finally{h.db.close();}
});

test('refresh rotation refuses audience changes, scope escalation, reuse, expiration and revocation',async()=>{
  const h=await setup();try{
    const {registered,tokens}=await h.connect({scope:'crm:read'});
    assert.equal((await h.refresh(registered,tokens.refresh_token,{scope:'crm:read crm:write'})).status,400);
    assert.equal((await h.refresh(registered,tokens.refresh_token,{resource:'https://other.example/api/mcp'})).status,400);
    const refreshed=await(await h.refresh(registered,tokens.refresh_token)).json();assert.notEqual(refreshed.refresh_token,tokens.refresh_token);assert.equal((await h.rpc(refreshed.access_token)).status,200);
    assert.equal((await h.refresh(registered,tokens.refresh_token)).status,400);assert.equal((await h.rpc(refreshed.access_token)).status,401);
    const fresh=await h.connect();h.db.raw.prepare("UPDATE lite_oauth_tokens SET access_expires_at='2000-01-01'").run();assert.equal((await h.rpc(fresh.tokens.access_token)).status,401);
    const renewed=await(await h.refresh(fresh.registered,fresh.tokens.refresh_token)).json();assert.equal((await h.rpc(renewed.access_token)).status,200);
    const grants=await(await h.api('admin/mcp/clients')).json(),grant=grants.clients.find(g=>!g.revoked_at);assert.equal((await h.api('admin/mcp/clients/'+grant.id,{method:'DELETE',workspace:h.other,identity:bob})).status,404);assert.equal((await h.api('admin/mcp/clients/'+grant.id,{method:'DELETE'})).status,200);
    assert.equal((await h.rpc(renewed.access_token)).status,401);assert.equal((await h.refresh(fresh.registered,renewed.refresh_token)).status,400);
  }finally{h.db.close();}
});

test('OAuth respects current roles, policies and MCP switches, and prevents workspace overrides',async()=>{
  const h=await setup();try{
    h.db.raw.prepare('INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,?)').run(h.org,bob.userId,'admin');
    const {registered,tokens}=await h.connect({identity:bob});
    assert.equal((await h.rpc(tokens.access_token,'tools/call',{name:'lite_tasks_create',arguments:{body:{title:'Allowed'}}})).status,200);
    await h.api('admin/mcp/policies/lite_tasks_list',{method:'PATCH',body:{enabled:false,version:0}});
    let list=await(await h.rpc(tokens.access_token)).json();assert.equal(list.result.tools.some(t=>t.name==='lite_tasks_list'),false);
    const group=await(await h.api('access/groups',{method:'POST',body:{name:'Restricted'}})).json();await h.api('access/groups/'+group.id,{method:'PUT',body:{name:'Restricted',userIds:[bob.userId],version:1}});await h.api('access/policies/'+group.id,{method:'PUT',body:{version:0,changes:[{operationId:'module.clients.list',effect:'deny'}]}});
    list=await(await h.rpc(tokens.access_token)).json();assert.equal(list.result.tools.some(t=>t.name==='lite_clients_list'),false);
    const override=await h.rpc(tokens.access_token,'tools/call',{name:'lite_clients_create',arguments:{data:clientData}},{query:'?workspace='+h.other});assert.equal(override.status,403);
    h.db.raw.prepare("UPDATE lite_members SET role='viewer' WHERE org_id=? AND user_id=?").run(h.org,bob.userId);
    list=await(await h.rpc(tokens.access_token)).json();assert.equal(list.result.tools.some(t=>t.name==='lite_tasks_create'),false);
    const consent=await h.pending(registered,bob);assert.equal((await h.decision(consent,{identity:bob})).status,403);
    h.db.raw.prepare('DELETE FROM lite_members WHERE org_id=? AND user_id=?').run(h.org,bob.userId);assert.equal((await h.rpc(tokens.access_token)).status,401);assert.equal((await h.refresh(registered,tokens.refresh_token)).status,400);
  }finally{h.db.close();}
});
