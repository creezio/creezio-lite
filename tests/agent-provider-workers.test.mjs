import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {root} from './helpers.mjs';

// Le transport tourne dans workerd (Miniflare) avec le fetch réel du runtime cible.
// Le seul réseau est le service simulé `outboundService` ; aucun appel payant.
const KEY='fixture-agent-key-91ab', LEAK='LEAK-MARKER-upstream-body';
const AGENT='bc-00000000-0000-0000-0000-000000000001', RUN='run-00000000-0000-0000-0000-000000000001';
const agentBody={id:AGENT,name:'Fixture',status:'ACTIVE',env:{type:'cloud'},url:`https://cursor.com/agents/${AGENT}`,createdAt:'2026-09-16T00:00:00.000Z',updatedAt:'2026-09-16T00:00:00.000Z',latestRunId:RUN};
const runBody={id:RUN,agentId:AGENT,status:'CREATING',createdAt:'2026-09-16T00:00:00.000Z',updatedAt:'2026-09-16T00:00:00.000Z'};
const xaiBody={object:'response',id:'resp_1',status:'completed',model:'grok-fixture',store:false,output:[{type:'function_call',id:'fc_1',call_id:'call_1',name:'lookup',arguments:'{"q":"x"}',status:'completed'}],usage:{input_tokens:1,output_tokens:2,total_tokens:3}};

test('workerd : racines fixes, auth, redirections, statuts d’erreur, délai, annulation et corps borné avec le fetch réel',async()=>{
  const require=createRequire(join(root,'template/package.json'));
  const wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
  const {Miniflare}=await import(pathToFileURL(wranglerRequire.resolve('miniflare')).href);
  const {build}=await import(pathToFileURL(wranglerRequire.resolve('esbuild')).href);
  const bundle=await build({absWorkingDir:root,bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',stdin:{resolveDir:root,loader:'ts',contents:`
    import {createCursorProvider,createXaiProvider} from './runtime/core/agent-providers/index.ts';
    export default {async fetch(request){
      const input=await request.json();
      let reads=0;
      const credential={provider:input.credentialProvider??input.provider,key:${JSON.stringify(KEY)},enabled:input.enabled??true};
      const options={resolveCredential:async()=>{reads++;if(input.credentialDelayMs)await new Promise(r=>setTimeout(r,input.credentialDelayMs));return credential;},...(input.timeoutMs?{timeoutMs:input.timeoutMs}:{}),...(input.maxResponseBytes?{maxResponseBytes:input.maxResponseBytes}:{})};
      const controller=new AbortController();
      if(input.abortAfterMs!==undefined)setTimeout(()=>controller.abort(),input.abortAfterMs);
      try{
        const provider=input.provider==='xai'?createXaiProvider(options):createCursorProvider(options);
        const result=await provider[input.method](...(input.args??[]),{signal:controller.signal});
        return Response.json({ok:true,reads,result});
      }catch(e){
        if(e&&e.name==='ProviderFailure')return Response.json({ok:false,reads,failure:e.toJSON(),message:e.message},{status:502});
        return Response.json({ok:false,unexpected:String(e&&e.name),detail:String(e&&e.message)},{status:500});
      }
    }};
  `}});
  const calls=[];let mode='ok';
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',cf:false,outboundService:async request=>{
    const url=new URL(request.url);
    calls.push({url:request.url,host:url.host,method:request.method,authorization:request.headers.get('authorization'),accept:request.headers.get('accept'),contentType:request.headers.get('content-type'),body:await request.text()});
    if(mode==='redirect')return new Response(LEAK,{status:302,headers:{location:'https://redirect.example.net/steal'}});
    if(typeof mode==='number')return new Response(JSON.stringify({error:{code:mode===409?'agent_id_conflict':mode===429?'rate_limit_exceeded':'internal_error',message:LEAK}}),{status:mode,headers:{'content-type':'application/json','retry-after':'42'}});
    if(mode==='slow'){await sleep(2500);return Response.json({items:[]});}
    if(mode==='big'){let sent=0;const chunk=new TextEncoder().encode('{"items":['+'"x",'.repeat(256));return new Response(new ReadableStream({pull(controller){if(sent>=64){controller.close();return;}sent++;controller.enqueue(chunk);}}),{headers:{'content-type':'application/json'}});}
    if(mode==='html')return new Response(`<html>${LEAK}</html>`,{headers:{'content-type':'text/html'}});
    if(url.host==='api.x.ai'&&url.pathname==='/v1/responses')return Response.json(xaiBody);
    if(url.host==='api.x.ai')return Response.json({object:'list',data:[{id:'grok-fixture',object:'model',owned_by:'xai'}]});
    if(url.pathname==='/v1/agents'&&request.method==='POST')return Response.json({agent:agentBody,run:runBody});
    if(url.pathname.endsWith('/cancel'))return Response.json({id:RUN});
    if(url.pathname.includes('/runs/'))return Response.json({...runBody,status:'RUNNING'});
    if(url.pathname.startsWith('/v1/agents/'))return Response.json(agentBody);
    return Response.json({items:[{id:'composer-2',displayName:'Composer 2'}]});
  }});
  const call=async body=>{const response=await mf.dispatchFetch('http://localhost/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  const clean=result=>{const text=JSON.stringify(result);assert.equal(text.includes(KEY),false,'fuite de clé');assert.equal(text.includes(LEAK),false,'fuite de corps');assert.equal(result.body.unexpected,undefined,JSON.stringify(result.body));return result;};
  try{
    const models=clean(await call({provider:'cursor',method:'listModels'}));
    assert.equal(models.status,200);assert.deepEqual(models.body.result,{models:[{id:'composer-2',displayName:'Composer 2'}]});assert.equal(models.body.reads,1);
    assert.equal(calls.at(-1).url,'https://api.cursor.com/v1/models');assert.equal(calls.at(-1).authorization,`Bearer ${KEY}`);assert.equal(calls.at(-1).accept,'application/json');
    const created=clean(await call({provider:'cursor',method:'createAgent',args:[{agentId:AGENT,prompt:{text:'Ajouter un README'},autoCreatePR:false}]}));
    assert.equal(created.status,200);assert.equal(created.body.result.agent.agentId,AGENT);assert.equal(created.body.result.run.runId,RUN);
    assert.equal(calls.at(-1).url,'https://api.cursor.com/v1/agents');assert.equal(calls.at(-1).method,'POST');assert.equal(calls.at(-1).contentType,'application/json');
    assert.deepEqual(JSON.parse(calls.at(-1).body),{agentId:AGENT,prompt:{text:'Ajouter un README'},autoCreatePR:false});
    const run=clean(await call({provider:'cursor',method:'getRun',args:[AGENT,RUN]}));assert.equal(run.body.result.status,'RUNNING');assert.equal(calls.at(-1).url,`https://api.cursor.com/v1/agents/${AGENT}/runs/${RUN}`);
    const cancelled=clean(await call({provider:'cursor',method:'cancelRun',args:[AGENT,RUN]}));assert.deepEqual(cancelled.body.result,{runId:RUN});assert.equal(calls.at(-1).method,'POST');assert.equal(calls.at(-1).body,'');
    const xai=clean(await call({provider:'xai',method:'createResponse',args:[{model:'grok-fixture',input:'Bonjour',maxOutputTokens:64,store:false,tools:[{type:'function',name:'lookup',description:'Recherche',parameters:{type:'object',properties:{q:{type:'string'}}}}]}]}));
    assert.equal(xai.status,200);assert.equal(xai.body.result.output[0].type,'function_call');assert.equal(xai.body.result.output[0].callId,'call_1');
    assert.equal(calls.at(-1).url,'https://api.x.ai/v1/responses');const xaiPayload=JSON.parse(calls.at(-1).body);assert.equal(xaiPayload.stream,false);assert.equal(xaiPayload.store,false);assert.equal(xaiPayload.max_output_tokens,64);assert.equal('background' in xaiPayload,false);
    assert.equal(calls.filter(c=>c.host==='api.x.ai').length,1,'aucun second appel après un appel d’outil relayé');
    const xaiModels=clean(await call({provider:'xai',method:'listModels'}));assert.deepEqual(xaiModels.body.result,{models:[{id:'grok-fixture'}]});
    assert.ok(calls.every(c=>c.authorization===`Bearer ${KEY}`&&['api.cursor.com','api.x.ai'].includes(c.host)));

    const before=calls.length;
    const mismatch=clean(await call({provider:'cursor',credentialProvider:'xai',method:'listModels'}));
    assert.equal(mismatch.status,502);assert.equal(mismatch.body.failure.code,'credential_unavailable');assert.equal(mismatch.body.failure.delivery,'not_sent');assert.equal(mismatch.body.failure.reason,'credential_mismatch');
    const disabled=clean(await call({provider:'xai',enabled:false,method:'listModels'}));assert.equal(disabled.body.failure.code,'credential_unavailable');assert.equal(disabled.body.failure.reason,'credential_disabled');
    const invalid=clean(await call({provider:'cursor',method:'createAgent',args:[{agentId:'agent-1',prompt:{text:'x'},envVars:{A:'b'}}]}));
    assert.equal(invalid.body.failure.code,'invalid_request');assert.equal(invalid.body.failure.delivery,'not_sent');
    const MARK='PRIVATE_FAKE_CLIENT_DATA@example.test';
    const nested=clean(await call({provider:'cursor',method:'createAgent',args:[{agentId:AGENT,prompt:{text:'x',[MARK]:1}}]}));
    assert.equal(nested.body.failure.reason,'unknown_field');assert.equal(nested.body.failure.field,'prompt');assert.equal(JSON.stringify(nested).includes(MARK),false);
    assert.equal(calls.length,before,'aucun appel réseau pour un credential ou un payload refusé');
    const blockedStart=Date.now();
    const blocked=clean(await call({provider:'cursor',method:'listModels',timeoutMs:1000,credentialDelayMs:2500}));
    assert.ok(Date.now()-blockedStart<1400,'le délai couvre la résolution du credential');
    assert.equal(blocked.body.failure.code,'credential_unavailable');assert.equal(blocked.body.failure.reason,'timeout');assert.equal(blocked.body.failure.delivery,'not_sent');
    const abortedEarly=clean(await call({provider:'xai',method:'listModels',credentialDelayMs:2500,abortAfterMs:50}));
    assert.equal(abortedEarly.body.failure.code,'provider_timeout');assert.equal(abortedEarly.body.failure.reason,'caller_abort');assert.equal(abortedEarly.body.failure.delivery,'not_sent');
    await sleep(2600);
    assert.equal(calls.length,before,'aucun fetch après une résolution de credential bloquée puis tardive');

    mode='redirect';
    const redirect=clean(await call({provider:'cursor',method:'getAgent',args:[AGENT]}));
    assert.equal(redirect.status,502);assert.equal(redirect.body.failure.code,'provider_redirect');assert.equal(redirect.body.failure.status,302);assert.equal(redirect.body.failure.delivery,'responded');
    assert.equal(calls.length,before+1);assert.equal(calls.some(c=>c.url.includes('redirect.example.net')),false);

    for(const [status,code,providerCode] of [[401,'provider_auth','internal_error'],[403,'provider_auth','internal_error'],[409,'provider_rejected','agent_id_conflict'],[429,'provider_quota','rate_limit_exceeded'],[500,'provider_unreachable','internal_error'],[503,'provider_unreachable','internal_error']]){
      mode=status;const count=calls.length;
      const result=clean(await call({provider:'cursor',method:'createAgent',args:[{agentId:AGENT,prompt:{text:'Ajouter un README'}}]}));
      assert.equal(result.body.failure.code,code,`HTTP ${status}`);assert.equal(result.body.failure.status,status);assert.equal(result.body.failure.providerCode,providerCode);assert.equal(result.body.failure.delivery,'responded');
      if(status===429)assert.equal(result.body.failure.retryAfterMs,42_000);
      assert.equal(calls.length,count+1,'un seul envoi, aucun renvoi automatique');
    }

    mode='slow';
    const timedOut=clean(await call({provider:'cursor',method:'listModels',timeoutMs:1000}));
    assert.equal(timedOut.body.failure.code,'provider_timeout');assert.equal(timedOut.body.failure.reason,'timeout');assert.equal(timedOut.body.failure.delivery,'unknown');
    const aborted=clean(await call({provider:'cursor',method:'cancelRun',args:[AGENT,RUN],abortAfterMs:50}));
    assert.equal(aborted.body.failure.code,'provider_timeout');assert.equal(aborted.body.failure.reason,'caller_abort');assert.equal(aborted.body.failure.delivery,'unknown');
    await sleep(2600);

    mode='big';
    const tooLarge=clean(await call({provider:'cursor',method:'listModels',maxResponseBytes:4096}));
    assert.equal(tooLarge.body.failure.code,'provider_response');assert.equal(tooLarge.body.failure.reason,'too_large');assert.equal(tooLarge.body.failure.delivery,'responded');
    mode='html';
    const notJson=clean(await call({provider:'xai',method:'listModels'}));
    assert.equal(notJson.body.failure.code,'provider_response');assert.equal(notJson.body.failure.reason,'not_json');
    assert.ok(calls.every(c=>c.authorization===`Bearer ${KEY}`&&['api.cursor.com','api.x.ai'].includes(c.host)));
  }finally{await mf.dispose();}
});
