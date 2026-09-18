import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {root} from './helpers.mjs';

test('real workerd fetch connects providers and refuses redirects without forwarding credentials',async t=>{
  const require=createRequire(join(root,'template/package.json'));
  const wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
  const {Miniflare}=await import(pathToFileURL(wranglerRequire.resolve('miniflare')).href);
  const {build}=await import(pathToFileURL(wranglerRequire.resolve('esbuild')).href);
  const bundle=await build({absWorkingDir:root,bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',stdin:{resolveDir:root,loader:'ts',contents:`
    import {providerRequest,sealSecret} from './runtime/core/integrations.ts';
    import {testMailConnection} from './runtime/core/mail.ts';
    export default {async fetch(request){
      const input=await request.json();
      const row={id:'fixture',org_id:'workspace',provider:input.provider,meta_json:JSON.stringify({baseUrl:'https://hermes.example.com',accountId:'a'.repeat(32)})};
      try{
        if(input.mail){const c={env:{LITE_INTEGRATION_SECRET:'fixture-vault'}};row.secret_box=await sealSecret(c,row.org_id,row.id,'fixture-key');return Response.json(await testMailConnection(c,row));}
        return await providerRequest(row,'fixture-key',input.path,{...(input.body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input.body)}:{})});
      }catch(e){return Response.json({code:e.code,message:e.message},{status:e.status||500});}
    }};
  `}});
  const calls=[];let status=200,errorBody;
  const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',cf:false,outboundService:async request=>{
    calls.push({url:request.url,method:request.method,authorization:request.headers.get('authorization'),body:await request.text()});
    if(status!==200)return new Response(errorBody??'fixture upstream failure',{status,headers:status===302?{location:'https://redirect.example.net/steal'}:{}});
    if(request.url.endsWith('/chat/completions'))return new Response('data: {"choices":[{"delta":{"content":"Bonjour"}}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
    if(request.url.endsWith('/tokens/verify'))return Response.json({success:true,result:{status:'active'}});
    return Response.json({data:[{id:'gpt-fixture'}]});
  }});
  const call=body=>mf.dispatchFetch('http://localhost/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  try{
    const models=await call({provider:'openai',path:'/v1/models'});assert.equal(models.status,200,await models.clone().text());assert.equal((await models.json()).data[0].id,'gpt-fixture');
    const chat=await call({provider:'openai',path:'/v1/chat/completions',body:{model:'gpt-fixture',stream:true,messages:[{role:'user',content:'Bonjour'}]}});assert.equal(chat.status,200);assert.match(await chat.text(),/Bonjour/);assert.equal(JSON.parse(calls.at(-1).body).model,'gpt-fixture');
    assert.equal((await call({provider:'hermes',path:'/health'})).status,200);assert.equal(calls.at(-1).url,'https://hermes.example.com/health');
    assert.equal((await call({provider:'cloudflare',mail:true})).status,200);assert.equal(calls.at(-1).url,'https://api.cloudflare.com/client/v4/user/tokens/verify');
    assert.ok(calls.every(c=>c.authorization==='Bearer fixture-key'));
    await t.test('Resend sending-only diagnostic accepts only its structured restricted-key error and never sends',async()=>{
      const start=calls.length;
      status=200;const full=await call({provider:'resend',mail:true});assert.equal(full.status,200);assert.equal((await full.json()).access,'domains_read');
      status=401;errorBody=JSON.stringify({statusCode:401,name:'restricted_api_key',message:'This API key is restricted to only send emails'});
      const restricted=await call({provider:'resend',mail:true});assert.equal(restricted.status,200);const result=await restricted.json();assert.equal(result.ok,true);assert.equal(result.access,'sending_only');assert.equal(result.domainVerified,false);assert.equal(result.sendingVerified,false);assert.match(result.message,/Aucun e-mail de test/);assert.doesNotMatch(JSON.stringify(result),/fixture-key/);
      for(const failure of [{status:401,body:{name:'invalid_api_key',message:'This API key is restricted to only send emails'}},{status:401,body:{message:'This API key is restricted to only send emails'}},{status:403,body:{name:'restricted_api_key'}},{status:429,body:{name:'restricted_api_key'}},{status:500,body:{name:'restricted_api_key'}}]){
        status=failure.status;errorBody=JSON.stringify(failure.body);assert.equal((await call({provider:'resend',mail:true})).status,502);
      }
      status=401;for(const malformed of ['not-json',JSON.stringify({name:'restricted_api_key',padding:'x'.repeat(17000)})]){errorBody=malformed;assert.equal((await call({provider:'resend',mail:true})).status,502);}
      status=302;errorBody=JSON.stringify({name:'restricted_api_key'});assert.equal((await call({provider:'resend',mail:true})).status,502);
      const probes=calls.slice(start);assert.ok(probes.length>=10);assert.ok(probes.every(c=>c.method==='GET'&&c.url==='https://api.resend.com/domains'&&c.body===''));
      status=401;errorBody=JSON.stringify({name:'restricted_api_key'});assert.equal((await call({provider:'cloudflare',mail:true})).status,502,'The exception does not cover other providers');
      errorBody=undefined;status=200;
    });

    status=401;assert.equal((await call({provider:'openai',path:'/v1/models'})).status,401);
    status=429;assert.equal((await call({provider:'openai',path:'/v1/models'})).status,429);
    status=302;const before=calls.length;
    const redirect=await call({provider:'openai',path:'/v1/models'});assert.equal(redirect.status,502);assert.equal((await redirect.json()).code,'provider_redirect');assert.equal(calls.length,before+1);
    const mailRedirect=await call({provider:'cloudflare',mail:true});assert.equal(mailRedirect.status,502);assert.equal((await mailRedirect.json()).code,'mail_rejected');
    assert.equal(calls.some(c=>c.url.includes('redirect.example.net')),false);
  }finally{await mf.dispose();}
});
