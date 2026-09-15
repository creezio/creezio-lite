import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {root,migrationSql,app,alice,client,boot} from './helpers.mjs';

test('workerd/D1: OAuth consent, atomic code exchange, refresh rotation and bearer verification cross HTTP requests',async()=>{
  const require=createRequire(join(root,'template/package.json')),wrangler=createRequire(require.resolve('wrangler/package.json'));
  const {Miniflare}=await import(pathToFileURL(wrangler.resolve('miniflare')).href),{build}=await import(pathToFileURL(wrangler.resolve('esbuild')).href);
  const bundle=await build({absWorkingDir:root,bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',stdin:{resolveDir:root,loader:'ts',contents:`
    import {oauthRoute,prepareOAuthConsent,resolveOAuthToken} from './runtime/core/mcp-oauth.ts';
    // Fixture identity simulates only the already-authenticated Sites boundary.
    // Production uses getChatGPTUser and never accepts a user header from clients.
    export default {async fetch(request,env){
      const c={app:${JSON.stringify(app)},env,identity:${JSON.stringify(alice)}};
      const url=new URL(request.url);
      try{
        if(url.pathname==='/fixture/consent')return Response.json(await prepareOAuthConsent(c,url.searchParams.get('request')));
        if(url.pathname==='/api/mcp')return Response.json(await resolveOAuthToken(request,{...c,identity:null}));
        return await oauthRoute(request,c);
      }catch(e){return Response.json({error:e.code},{status:e.status||500});}
    }};
  `}});
  const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',d1Databases:['DB'],cf:false});
  try{
    const db=await mf.getD1Database('DB');for(const sql of (await migrationSql()).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
    const org=await boot(client(db,alice)),origin='https://test.example',resource=origin+'/api/mcp',redirect='https://chatgpt.com/connector_platform_oauth_redirect';
    const call=(path,body,headers={})=>mf.dispatchFetch(origin+path,{redirect:'manual',method:body?'POST':'GET',headers:{...(body instanceof URLSearchParams?{'content-type':'application/x-www-form-urlencoded'}:body?{'content-type':'application/json'}:{}),...headers},body:body instanceof URLSearchParams?body.toString():body?JSON.stringify(body):undefined});
    const registered=await(await call('/oauth/register',{client_name:'Worker client',redirect_uris:[redirect],token_endpoint_auth_method:'none'})).json();assert.ok(registered.client_id);
    const verifier='v'.repeat(60),challenge=createHash('sha256').update(verifier).digest('base64url');
    const auth=await call('/oauth/authorize?'+new URLSearchParams({client_id:registered.client_id,redirect_uri:redirect,response_type:'code',scope:'crm:read',state:'original-state',resource,code_challenge:challenge,code_challenge_method:'S256'}));assert.equal(auth.status,303,await auth.clone().text());
    const requestId=new URL(auth.headers.get('location'),origin).searchParams.get('request'),consent=await(await call('/fixture/consent?request='+requestId)).json();
    const approval=await call('/oauth/decision',new URLSearchParams({request:requestId,csrf:consent.csrf,decision:'approve',workspace:org,scope:'crm:read'}),{origin});assert.equal(approval.status,303,await approval.clone().text());
    const code=new URL(approval.headers.get('location')).searchParams.get('code');
    const params={client_id:registered.client_id,code,code_verifier:verifier,redirect_uri:redirect,resource,grant_type:'authorization_code'};
    const race=await Promise.all([call('/oauth/token',new URLSearchParams(params)),call('/oauth/token',new URLSearchParams(params))]);assert.deepEqual(race.map(r=>r.status).sort(),[200,400]);
    const tokens=await race.find(r=>r.status===200).json();
    const identity=await(await call('/api/mcp',null,{authorization:'Bearer '+tokens.access_token})).json();assert.equal(identity.identity.userId,alice.userId);assert.equal(identity.access.workspaceId,org);assert.equal(identity.access.mode,'read');
    const refreshParams={client_id:registered.client_id,grant_type:'refresh_token',refresh_token:tokens.refresh_token,resource};
    const refreshed=await call('/oauth/token',new URLSearchParams(refreshParams));assert.equal(refreshed.status,200,await refreshed.clone().text());const next=await refreshed.json();assert.notEqual(next.refresh_token,tokens.refresh_token);
    assert.equal((await call('/oauth/token',new URLSearchParams(refreshParams))).status,400);
    assert.equal((await call('/api/mcp',null,{authorization:'Bearer '+next.access_token})).status,401);
  }finally{await mf.dispose();}
});
