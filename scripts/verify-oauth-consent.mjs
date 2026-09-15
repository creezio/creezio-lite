// HTTP integration against the compiled Worker, not a browser simulation.
// Identity headers are fixture values at the local Sites dispatch boundary only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {root,migrationSql,alice,client,boot} from '../tests/helpers.mjs';

const project=resolve(process.argv[2]??join(root,'template'));
const require=createRequire(join(project,'package.json')),wrangler=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=await import(pathToFileURL(wrangler.resolve('miniflare')).href);
const config=JSON.parse(await readFile(join(project,'dist/server/wrangler.json'),'utf8'));
const server=join(project,'dist/server'),files=(await readdir(server,{recursive:true})).filter(p=>/\.m?js$/.test(p)&&p!==config.main);
const mf=new Miniflare({modules:[config.main,...files].map(path=>({type:'ESModule',path:join(server,path)})),modulesRoot:server,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,d1Databases:['DB'],r2Buckets:['BUCKET'],cf:false});
try{
  const db=await mf.getD1Database('DB');for(const sql of (await migrationSql()).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
  const org=await boot(client(db,alice)),origin='https://oauth-fixture.example',resource=origin+'/api/mcp',redirect='https://client-fixture.example/callback';
  const identity={'oai-authenticated-user-id':alice.userId,'oai-authenticated-user-email':alice.email};
  const call=(path,body,headers={})=>mf.dispatchFetch(origin+path,{redirect:'manual',method:body?'POST':'GET',headers:{...(body instanceof URLSearchParams?{'content-type':'application/x-www-form-urlencoded'}:body?{'content-type':'application/json'}:{}),...headers},body:body instanceof URLSearchParams?body.toString():body?JSON.stringify(body):undefined});
  const registered=await(await call('/oauth/register',{client_name:'Consent fixture',redirect_uris:[redirect],token_endpoint_auth_method:'none'})).json();assert.ok(registered.client_id);
  const verifier='fixture-'.repeat(8),challenge=createHash('sha256').update(verifier).digest('base64url');
  const start=await call('/oauth/authorize?'+new URLSearchParams({client_id:registered.client_id,redirect_uri:redirect,response_type:'code',scope:'crm:read',resource,state:'fixture-state',code_challenge:challenge,code_challenge_method:'S256'}));assert.equal(start.status,303);
  const consentPath=start.headers.get('location');
  const login=await call(consentPath);assert.equal(login.status,307);assert.ok(login.headers.get('location').startsWith('/signin-with-chatgpt?return_to='));
  const page=await call(consentPath,null,identity);assert.equal(page.status,200);
  const html=await page.text(),policies=[...html.matchAll(/<meta\b[^>]*name="referrer"[^>]*>/g)].map(m=>m[0].match(/content="([^"]+)"/)?.[1]);
  // This fails on 0.8.0: the rendered page inherited no-referrer, causing
  // Chromium's native navigation POST to send Origin: null in production.
  assert.deepEqual(policies,['same-origin'],'The actual rendered consent must override the root no-referrer policy.');
  const value=name=>{const input=[...html.matchAll(/<input\b[^>]*>/g)].map(m=>m[0]).find(input=>input.includes(`name="${name}"`));return input?.match(/value="([^"]*)"/)?.[1];};
  const fields={request:value('request'),csrf:value('csrf'),decision:'approve',workspace:org,scope:'crm:read'};assert.ok(fields.request&&fields.csrf);
  for(const foreign of ['null','https://foreign.example']){
    const refused=await call('/oauth/decision',new URLSearchParams(fields),{...identity,origin:foreign,'sec-fetch-site':'same-origin','sec-fetch-mode':'navigate'});assert.equal(refused.status,403);assert.equal((await refused.json()).error,'invalid_origin');
  }
  const approved=await call('/oauth/decision',new URLSearchParams(fields),{...identity,origin,'sec-fetch-site':'same-origin','sec-fetch-mode':'navigate'});assert.equal(approved.status,303);
  const callback=new URL(approved.headers.get('location'));assert.equal(callback.origin,new URL(redirect).origin);assert.equal(callback.searchParams.get('iss'),origin);assert.equal(approved.headers.get('referrer-policy'),'no-referrer');
  const tokenResponse=await call('/oauth/token',new URLSearchParams({client_id:registered.client_id,grant_type:'authorization_code',code:callback.searchParams.get('code'),code_verifier:verifier,redirect_uri:redirect,resource}));assert.equal(tokenResponse.status,200);
  const tokens=await tokenResponse.json(),mcp=await call('/api/mcp',{jsonrpc:'2.0',id:1,method:'tools/list'},{authorization:'Bearer '+tokens.access_token,accept:'application/json'});assert.equal(mcp.status,200);assert.ok((await mcp.json()).result.tools.length>0);
  console.log('Compiled Worker verified: consent metadata, login, form, origin refusals, callback, token exchange and MCP tools. Fixture identity only.');
}finally{await mf.dispose();}
