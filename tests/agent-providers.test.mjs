import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderFailure, providerFailureMessages, agentProviderCapabilities, createCursorProvider, createXaiProvider,
} from '../runtime/core/agent-providers/index.ts';
import * as publicApi from '../runtime/core/agent-providers/index.ts';

// Fetch simulé : aucun réseau. Chaque appel est enregistré pour vérifier URL, méthode, en-têtes et corps.
const KEY_CURSOR='fixture-cursor-key-3f9a', KEY_XAI='fixture-xai-key-7c1d', LEAK='LEAK-MARKER-body-text';
const AGENT='bc-00000000-0000-0000-0000-000000000001', RUN='run-00000000-0000-0000-0000-000000000001';
const credentialFor=(provider,over={})=>async()=>({provider,key:provider==='cursor'?KEY_CURSOR:KEY_XAI,enabled:true,...over});
function fakeFetch(handler){
  const calls=[];
  const fetch=async(url,init={})=>{const call={url,method:init.method,headers:init.headers,body:init.body,redirect:init.redirect,signal:init.signal};calls.push(call);return handler(call,calls.length);};
  return {calls,fetch};
}
const jsonResponse=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json',...headers}});
const agentBody={id:AGENT,name:'Fixture agent',status:'ACTIVE',env:{type:'cloud'},repos:[{url:'https://github.com/org/repo',startingRef:'main'}],workOnCurrentBranch:false,autoCreatePR:true,url:`https://cursor.com/agents/${AGENT}`,createdAt:'2026-09-16T00:00:00.000Z',updatedAt:'2026-09-16T00:00:00.000Z',latestRunId:RUN};
const runBody={id:RUN,agentId:AGENT,status:'CREATING',createdAt:'2026-09-16T00:00:00.000Z',updatedAt:'2026-09-16T00:00:00.000Z'};
const createInput={agentId:AGENT,prompt:{text:'Ajouter un README'},model:{id:'composer-2',params:[{id:'fast',value:'true'}]},repos:[{url:'https://github.com/org/repo',startingRef:'main'}],autoCreatePR:true};
const xaiResponseBody={object:'response',id:'resp_fixture_1',status:'completed',model:'grok-fixture',store:false,previous_response_id:null,output:[
  {type:'reasoning',id:'rs_1',summary:[{type:'summary_text',text:'Réflexion'}],status:'completed'},
  {type:'message',id:'msg_1',role:'assistant',status:'completed',content:[{type:'output_text',text:'Bonjour',annotations:[],logprobs:null}]},
  {type:'function_call',id:'fc_1',call_id:'call_1',name:'get_temperature',arguments:'{"location":"Paris"}',status:'completed'},
  {type:'web_search_call',id:'ws_1',status:'completed'},
],usage:{input_tokens:12,output_tokens:5,total_tokens:17,input_tokens_details:{cached_tokens:2},output_tokens_details:{reasoning_tokens:3},num_sources_used:0}};
async function failure(promise){try{await promise;}catch(e){assert.ok(e instanceof ProviderFailure,`ProviderFailure attendue, reçu ${e?.constructor?.name}: ${e?.message}`);return e;}assert.fail('Un échec typé était attendu.');}
function assertClean(error){
  const serialized=JSON.stringify(error)+error.message+String(error.stack);
  for(const secret of [KEY_CURSOR,KEY_XAI,LEAK,'Ajouter un README','Bearer'])assert.equal(serialized.includes(secret),false,`fuite de « ${secret} » dans l’échec`);
  assert.equal(error.message,providerFailureMessages[error.code]);
  assert.ok(['not_sent','unknown','responded'].includes(error.delivery));
}

test('le port public n’a aucun effet à l’import et le catalogue reste statique',()=>{
  assert.deepEqual(Object.keys(publicApi).sort(),['ProviderFailure','agentProviderCapabilities','createCursorProvider','createXaiProvider','cursorAgentIdPattern','cursorAgentStatuses','cursorLimits','cursorRunIdPattern','cursorRunStatuses','providerFailureMessages','xaiLimits','xaiResponseStatuses']);
  assert.ok(Object.isFrozen(agentProviderCapabilities));
  assert.equal(new Set(agentProviderCapabilities.map(c=>c.id)).size,agentProviderCapabilities.length);
  for(const capability of agentProviderCapabilities){
    assert.ok(Object.isFrozen(capability));assert.ok(['cursor','xai'].includes(capability.provider));
    assert.ok(['implemented','deferred'].includes(capability.transport));assert.equal(capability.requiresApplicationModule,true);
    assert.match(capability.documentedOn,/^\d{4}-\d{2}-\d{2}$/);assert.match(capability.source,/^https:\/\/(cursor\.com|docs\.x\.ai)\//);
    assert.equal(JSON.stringify(capability).includes('active'),false);
  }
  assert.ok(agentProviderCapabilities.some(c=>c.id==='cursor.webhooks'&&c.transport==='deferred'));
  assert.ok(agentProviderCapabilities.some(c=>c.id==='xai.grok-bot'&&c.transport==='deferred'));
});

test('les options du client sont bornées et validées avant tout appel',()=>{
  for(const options of [{},{resolveCredential:'x'},{resolveCredential:credentialFor('cursor'),timeoutMs:10},{resolveCredential:credentialFor('cursor'),timeoutMs:10_000_000},{resolveCredential:credentialFor('cursor'),maxResponseBytes:1},{resolveCredential:credentialFor('cursor'),timeoutMs:1500.5},{resolveCredential:credentialFor('cursor'),fetch:'nope'}]){
    assert.throws(()=>createCursorProvider(options),e=>e instanceof ProviderFailure&&e.code==='invalid_request'&&e.delivery==='not_sent');
  }
  assert.throws(()=>createXaiProvider({resolveCredential:credentialFor('xai'),maxResponseBytes:64_000_000}),e=>e.code==='invalid_request');
  const provider=createCursorProvider({resolveCredential:credentialFor('cursor'),timeoutMs:1000,maxResponseBytes:1024});
  assert.ok(Object.isFrozen(provider));assert.equal(provider.provider,'cursor');
});

test('racines fixes et en-têtes : Cursor et xAI reçoivent Bearer, JSON et redirect manual',async()=>{
  const cursorFetch=fakeFetch(()=>jsonResponse({items:[{id:'composer-2',displayName:'Composer 2',aliases:['composer'],parameters:[{id:'fast',displayName:'Fast',values:[{value:'true',displayName:'Fast'},{value:'false'}]}],variants:[{params:[{id:'fast',value:'true'}],displayName:'Composer 2',isDefault:true}]},{id:'claude',displayName:'Claude',extra:'ignored'}]}));
  const cursor=createCursorProvider({resolveCredential:credentialFor('cursor'),fetch:cursorFetch.fetch});
  const models=await cursor.listModels();
  assert.deepEqual(models.models.map(m=>m.id),['composer-2','claude']);assert.equal(models.models[0].variants[0].isDefault,true);assert.equal('extra' in models.models[1],false);
  const call=cursorFetch.calls[0];
  assert.equal(call.url,'https://api.cursor.com/v1/models');assert.equal(call.method,'GET');assert.equal(call.redirect,'manual');assert.equal(call.body,undefined);
  assert.deepEqual(call.headers,{authorization:`Bearer ${KEY_CURSOR}`,accept:'application/json'});assert.ok(call.signal instanceof AbortSignal);
  const xaiFetch=fakeFetch(()=>jsonResponse({object:'list',data:[{id:'grok-fixture',aliases:['grok-latest'],context_length:131072,created:1776556800,object:'model',owned_by:'xai',prompt_text_token_price:12500}]}));
  const xai=createXaiProvider({resolveCredential:credentialFor('xai'),fetch:xaiFetch.fetch});
  assert.deepEqual(await xai.listModels(),{models:[{id:'grok-fixture',aliases:['grok-latest'],contextLength:131072,created:1776556800}]});
  assert.equal(xaiFetch.calls[0].url,'https://api.x.ai/v1/models');assert.equal(xaiFetch.calls[0].headers.authorization,`Bearer ${KEY_XAI}`);
});

test('credential absent, désactivé, incompatible ou révoqué : refus avant réseau et relecture à chaque appel',async()=>{
  const {calls,fetch}=fakeFetch(()=>jsonResponse({items:[]}));
  const cases=[
    [credentialFor('cursor',{enabled:false}),'credential_disabled'],
    [credentialFor('xai'),'credential_mismatch'],
    [credentialFor('cursor',{key:''}),'credential_malformed'],
    [credentialFor('cursor',{key:'clé avec espace'}),'credential_malformed'],
    [credentialFor('cursor',{key:'k'.repeat(5000)}),'credential_malformed'],
    [async()=>null,'credential_missing'],
    [async()=>{throw new Error(`coffre indisponible ${KEY_CURSOR}`);},'credential_missing'],
  ];
  for(const [resolveCredential,reason] of cases){
    const error=await failure(createCursorProvider({resolveCredential,fetch}).listModels());
    assert.equal(error.code,'credential_unavailable');assert.equal(error.delivery,'not_sent');assert.equal(error.reason,reason);assertClean(error);
  }
  assert.equal(calls.length,0);
  let enabled=true,reads=0;
  const live=createCursorProvider({resolveCredential:async()=>{reads++;return {provider:'cursor',key:KEY_CURSOR,enabled};},fetch});
  await live.listModels();assert.equal(reads,1);assert.equal(calls.length,1);
  enabled=false;
  const revoked=await failure(live.listModels());assert.equal(revoked.code,'credential_unavailable');assert.equal(reads,2);assert.equal(calls.length,1);
});

test('createAgent refuse les identifiants, payloads et champs non documentés sans émettre d’appel',async()=>{
  const {calls,fetch}=fakeFetch(()=>jsonResponse({agent:agentBody,run:runBody}));
  const cursor=createCursorProvider({resolveCredential:credentialFor('cursor'),fetch});
  const invalid=[
    [{...createInput,agentId:undefined},'agentId'],[{...createInput,agentId:'agent-1'},'agentId'],[{...createInput,agentId:'bc-not-a-uuid'},'agentId'],[{...createInput,agentId:`${AGENT}/../other`},'agentId'],
    [{...createInput,envVars:{TOKEN:'x'}},'envVars'],[{...createInput,mcpServers:[{name:'x',url:'https://mcp.example'}]},'mcpServers'],[{...createInput,customSubagents:[]},'customSubagents'],
    [{...createInput,prompt:{text:'x',images:[]}},'prompt.images'],[{...createInput,prompt:{text:'   '}},'prompt.text'],[{...createInput,prompt:'texte'},'prompt'],
    [{...createInput,unknownField:true},'input.unknownField'],[{...createInput,name:'n'.repeat(101)},'name'],[{...createInput,mode:'yolo'},'mode'],
    [{...createInput,repos:[{url:'http://github.com/org/repo'}]},'repos[0].url'],[{...createInput,repos:[{url:'https://gitlab.com/org/repo'}]},'repos[0].url'],
    [{...createInput,repos:[{url:'https://user:pw@github.com/org/repo'}]},'repos[0].url'],[{...createInput,repos:[{url:'https://github.com/org/repo?x=1'}]},'repos[0].url'],
    [{...createInput,repos:[{url:'https://github.com/org/repo',startingRef:'../evil'}]},'repos[0].startingRef'],[{...createInput,repos:[{url:'https://github.com/org/repo',prUrl:'https://github.com/org/repo/issues/1'}]},'repos[0].prUrl'],
    [{...createInput,repos:Array.from({length:21},()=>({url:'https://github.com/org/repo'}))},'repos'],
    [{...createInput,env:{type:'cloud',name:'named-env'}},'env'],[{...createInput,env:{type:'lambda'}},'env.type'],
    [{...createInput,model:{id:'../x'}},'model.id'],[{...createInput,model:{id:'m',params:[{id:'fast'}]}},'model.params[0].value'],[{...createInput,autoCreatePR:'yes'},'autoCreatePR'],
  ];
  for(const [input,field] of invalid){
    const error=await failure(cursor.createAgent(input));
    assert.equal(error.code,'invalid_request',field);assert.equal(error.delivery,'not_sent');assert.equal(error.field,field);assertClean(error);
  }
  for(const [agentId,runId] of [['nope',RUN],[AGENT,'run-nope'],[AGENT,`${RUN}/cancel`]]){
    assert.equal((await failure(cursor.getRun(agentId,runId))).code,'invalid_request');
    assert.equal((await failure(cursor.cancelRun(agentId,runId))).code,'invalid_request');
  }
  assert.equal((await failure(cursor.getAgent('bc-'))).code,'invalid_request');
  assert.equal(calls.length,0);
});

test('createAgent envoie uniquement le payload documenté et valide la réponse contre l’agentId demandé',async()=>{
  const {calls,fetch}=fakeFetch(()=>jsonResponse({agent:agentBody,run:runBody,extra:'ignored'}));
  const cursor=createCursorProvider({resolveCredential:credentialFor('cursor'),fetch});
  const result=await cursor.createAgent({...createInput,name:'Fixture agent',env:{type:'pool',name:'sandbox'},repos:undefined,workOnCurrentBranch:false,skipReviewerRequest:true,mode:'plan'});
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.cursor.com/v1/agents');assert.equal(calls[0].method,'POST');assert.equal(calls[0].headers['content-type'],'application/json');
  assert.deepEqual(JSON.parse(calls[0].body),{agentId:AGENT,prompt:{text:'Ajouter un README'},model:{id:'composer-2',params:[{id:'fast',value:'true'}]},name:'Fixture agent',env:{type:'pool',name:'sandbox'},workOnCurrentBranch:false,autoCreatePR:true,skipReviewerRequest:true,mode:'plan'});
  assert.deepEqual(result,{agent:{agentId:AGENT,status:'ACTIVE',name:'Fixture agent',url:`https://cursor.com/agents/${AGENT}`,latestRunId:RUN,createdAt:'2026-09-16T00:00:00.000Z',updatedAt:'2026-09-16T00:00:00.000Z',repos:[{url:'https://github.com/org/repo',startingRef:'main'}],workOnCurrentBranch:false,autoCreatePR:true},run:{runId:RUN,agentId:AGENT,status:'CREATING',createdAt:'2026-09-16T00:00:00.000Z',updatedAt:'2026-09-16T00:00:00.000Z'}});
  const minimal=fakeFetch(()=>jsonResponse({agent:agentBody,run:runBody}));
  await createCursorProvider({resolveCredential:credentialFor('cursor'),fetch:minimal.fetch}).createAgent({agentId:AGENT,prompt:{text:'Ajouter un README'}});
  assert.deepEqual(JSON.parse(minimal.calls[0].body),{agentId:AGENT,prompt:{text:'Ajouter un README'}});
  const responses=[
    [{agent:{...agentBody,id:'bc-00000000-0000-0000-0000-00000000dead'},run:runBody},'identity_mismatch'],
    [{agent:agentBody,run:{...runBody,agentId:'bc-00000000-0000-0000-0000-00000000dead'}},'identity_mismatch'],
    [{agent:{...agentBody,status:'PENDING'},run:runBody},'unknown_status'],
    [{agent:agentBody,run:{...runBody,status:'QUEUED'}},'unknown_status'],
    [{agent:agentBody,run:{...runBody,id:'42'}},'schema'],
    [{agent:agentBody},'schema'],
    [[],'schema'],
    ['"texte"','schema'],
  ];
  for(const [body,reason] of responses){
    const {calls:c,fetch:f}=fakeFetch(()=>jsonResponse(body));
    const error=await failure(createCursorProvider({resolveCredential:credentialFor('cursor'),fetch:f}).createAgent(createInput));
    assert.equal(error.code,'provider_response');assert.equal(error.delivery,'responded');assert.equal(error.reason,reason);assert.equal(c.length,1);assertClean(error);
  }
});

test('409 agent_id_conflict est un fait explicite : un seul envoi, aucun nouvel identifiant',async()=>{
  const {calls,fetch}=fakeFetch(()=>jsonResponse({error:{code:'agent_id_conflict',message:`Agent already exists ${LEAK}`}},409));
  const cursor=createCursorProvider({resolveCredential:credentialFor('cursor'),fetch});
  const error=await failure(cursor.createAgent(createInput));
  assert.equal(error.code,'provider_rejected');assert.equal(error.status,409);assert.equal(error.providerCode,'agent_id_conflict');assert.equal(error.delivery,'responded');assertClean(error);
  assert.equal(calls.length,1);assert.equal(JSON.parse(calls[0].body).agentId,AGENT);
  const busy=await failure(cursor.createAgent(createInput));assert.equal(busy.providerCode,'agent_id_conflict');assert.equal(calls.length,2);
  assert.ok(calls.every(c=>JSON.parse(c.body).agentId===AGENT));
});

test('401/403/429/5xx : codes fermés, statut, Retry-After borné, code fournisseur filtré, aucune fuite',async()=>{
  const cases=[
    [401,{error:{code:'unauthorized',message:LEAK}},{},{code:'provider_auth',providerCode:'unauthorized'}],
    [403,{error:{code:'role_forbidden',message:LEAK}},{},{code:'provider_auth',providerCode:'role_forbidden'}],
    [401,{error:{error:LEAK}},{},{code:'provider_auth',providerCode:undefined}],
    [429,{code:'rate_limit_exceeded',message:LEAK},{'retry-after':'30'},{code:'provider_quota',providerCode:'rate_limit_exceeded',retryAfterMs:30_000}],
    [429,{error:{code:'usage_limit_exceeded'}},{'retry-after':'9999999'},{code:'provider_quota',providerCode:'usage_limit_exceeded',retryAfterMs:3_600_000}],
    [429,LEAK,{'retry-after':'soon'},{code:'provider_quota',providerCode:undefined,retryAfterMs:undefined}],
    [400,{error:{code:'made_up_code',message:LEAK}},{},{code:'provider_rejected',providerCode:undefined}],
    [404,{error:{code:'agent_not_found'}},{},{code:'provider_rejected',providerCode:'agent_not_found'}],
    [409,{error:{code:'run_not_cancellable'}},{},{code:'provider_rejected',providerCode:'run_not_cancellable'}],
    [500,{error:{code:'internal_error',message:LEAK}},{},{code:'provider_unreachable',providerCode:'internal_error'}],
    [502,LEAK,{},{code:'provider_unreachable',providerCode:undefined}],
    [503,'',{'retry-after':'120'},{code:'provider_unreachable',retryAfterMs:120_000}],
  ];
  for(const [status,body,headers,expected] of cases){
    const {calls,fetch}=fakeFetch(()=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':typeof body==='string'?'text/plain':'application/json',...headers}}));
    const cursor=createCursorProvider({resolveCredential:credentialFor('cursor'),fetch});
    const error=await failure(status===409?cursor.cancelRun(AGENT,RUN):cursor.getAgent(AGENT));
    assert.equal(error.code,expected.code,`HTTP ${status}`);assert.equal(error.status,status);assert.equal(error.delivery,'responded');assert.equal(error.providerCode,expected.providerCode);
    if('retryAfterMs' in expected)assert.equal(error.retryAfterMs,expected.retryAfterMs);
    assertClean(error);assert.equal(calls.length,1);
  }
});

test('redirections 301/302/307/308 refusées sans transfert de clé ni second appel',async()=>{
  for(const status of [301,302,303,307,308]){
    const {calls,fetch}=fakeFetch(()=>new Response(LEAK,{status,headers:{location:'https://redirect.example.net/steal'}}));
    const error=await failure(createCursorProvider({resolveCredential:credentialFor('cursor'),fetch}).getRun(AGENT,RUN));
    assert.equal(error.code,'provider_redirect');assert.equal(error.status,status);assert.equal(error.delivery,'responded');assertClean(error);
    assert.equal(calls.length,1);assert.equal(calls[0].redirect,'manual');assert.equal(calls[0].url,`https://api.cursor.com/v1/agents/${AGENT}/runs/${RUN}`);
  }
});

test('délai et annulation de l’appelant sont combinés ; l’envoi reste « unknown » après fetch',async()=>{
  const hang=({signal})=>new Promise((_,reject)=>{if(signal.aborted)reject(new DOMException('aborted','AbortError'));signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});});
  const started=Date.now();
  const timeout=fakeFetch(hang);
  const timedOut=await failure(createCursorProvider({resolveCredential:credentialFor('cursor'),fetch:timeout.fetch,timeoutMs:1000}).listModels());
  assert.equal(timedOut.code,'provider_timeout');assert.equal(timedOut.reason,'timeout');assert.equal(timedOut.delivery,'unknown');assert.ok(Date.now()-started>=900);assert.ok(timeout.calls[0].signal.aborted);assertClean(timedOut);
  const controller=new AbortController();
  const aborted=fakeFetch(call=>{setTimeout(()=>controller.abort(),20);return hang(call);});
  const cancelled=await failure(createCursorProvider({resolveCredential:credentialFor('cursor'),fetch:aborted.fetch}).cancelRun(AGENT,RUN,{signal:controller.signal}));
  assert.equal(cancelled.code,'provider_timeout');assert.equal(cancelled.reason,'caller_abort');assert.equal(cancelled.delivery,'unknown');assert.equal(aborted.calls.length,1);
  const pre=new AbortController();pre.abort();
  const before=fakeFetch(hang);
  const notSent=await failure(createCursorProvider({resolveCredential:credentialFor('cursor'),fetch:before.fetch}).listModels({signal:pre.signal}));
  assert.equal(notSent.code,'provider_timeout');assert.equal(notSent.reason,'caller_abort');assert.equal(notSent.delivery,'not_sent');assert.equal(before.calls.length,0);
  const network=fakeFetch(()=>{throw new TypeError(`fetch failed ${LEAK}`);});
  const unreachable=await failure(createXaiProvider({resolveCredential:credentialFor('xai'),fetch:network.fetch}).listModels());
  assert.equal(unreachable.code,'provider_unreachable');assert.equal(unreachable.reason,'network');assert.equal(unreachable.delivery,'unknown');assertClean(unreachable);
});

test('réponses trop grandes, non JSON ou inconnues sont refusées pendant la lecture',async()=>{
  let cancelled=false,pulls=0;
  const stream=()=>new ReadableStream({pull(controller){pulls++;controller.enqueue(new TextEncoder().encode('{"items":['+'"x",'.repeat(200)));},cancel(){cancelled=true;}});
  const big=fakeFetch(()=>new Response(stream(),{status:200,headers:{'content-type':'application/json'}}));
  const tooLarge=await failure(createCursorProvider({resolveCredential:credentialFor('cursor'),fetch:big.fetch,maxResponseBytes:4096}).listModels());
  assert.equal(tooLarge.code,'provider_response');assert.equal(tooLarge.reason,'too_large');assert.equal(tooLarge.delivery,'responded');assert.ok(cancelled);assert.ok(pulls<=8,`lecture arrêtée après ${pulls} blocs`);assertClean(tooLarge);
  const declared=fakeFetch(()=>new Response('{}',{status:200,headers:{'content-type':'application/json','content-length':'5000000'}}));
  assert.equal((await failure(createCursorProvider({resolveCredential:credentialFor('cursor'),fetch:declared.fetch}).listModels())).reason,'too_large');
  const html=fakeFetch(()=>new Response(`<html>${LEAK}</html>`,{status:200,headers:{'content-type':'text/html'}}));
  const notJson=await failure(createCursorProvider({resolveCredential:credentialFor('cursor'),fetch:html.fetch}).listModels());
  assert.equal(notJson.code,'provider_response');assert.equal(notJson.reason,'not_json');assertClean(notJson);
  const broken=fakeFetch(()=>new Response('{"items":[',{status:200,headers:{'content-type':'application/json'}}));
  assert.equal((await failure(createCursorProvider({resolveCredential:credentialFor('cursor'),fetch:broken.fetch}).listModels())).reason,'not_json');
  const wrongShape=fakeFetch(()=>jsonResponse({items:[{id:'m'}]}));
  assert.equal((await failure(createCursorProvider({resolveCredential:credentialFor('cursor'),fetch:wrongShape.fetch}).listModels())).reason,'schema');
  const noContent=fakeFetch(()=>new Response(null,{status:204}));
  assert.equal((await failure(createCursorProvider({resolveCredential:credentialFor('cursor'),fetch:noContent.fetch}).listModels())).reason,'not_json');
});

test('getAgent, getRun et cancelRun encodent les identifiants et n’inventent jamais une réussite',async()=>{
  const {calls,fetch}=fakeFetch(({url})=>{
    if(url.endsWith('/cancel'))return jsonResponse({id:RUN});
    if(url.includes('/runs/'))return jsonResponse({...runBody,status:'FINISHED',durationMs:12357,result:'Terminé.',git:{branches:[{repoUrl:'github.com/org/repo',branch:'cursor/readme',prUrl:'https://github.com/org/repo/pull/1'}]}});
    return jsonResponse(agentBody);
  });
  const cursor=createCursorProvider({resolveCredential:credentialFor('cursor'),fetch});
  const agent=await cursor.getAgent(AGENT);assert.equal(agent.agentId,AGENT);assert.equal(agent.latestRunId,RUN);
  const run=await cursor.getRun(AGENT,RUN);assert.equal(run.status,'FINISHED');assert.equal(run.durationMs,12357);assert.deepEqual(run.git.branches[0],{repoUrl:'github.com/org/repo',branch:'cursor/readme',prUrl:'https://github.com/org/repo/pull/1'});
  assert.deepEqual(await cursor.cancelRun(AGENT,RUN),{runId:RUN});
  assert.deepEqual(calls.map(c=>[c.method,c.url]),[['GET',`https://api.cursor.com/v1/agents/${AGENT}`],['GET',`https://api.cursor.com/v1/agents/${AGENT}/runs/${RUN}`],['POST',`https://api.cursor.com/v1/agents/${AGENT}/runs/${RUN}/cancel`]]);
  assert.equal(calls[2].body,undefined);
  const otherAgent=fakeFetch(()=>jsonResponse({...agentBody,id:'bc-00000000-0000-0000-0000-00000000dead'}));
  assert.equal((await failure(createCursorProvider({resolveCredential:credentialFor('cursor'),fetch:otherAgent.fetch}).getAgent(AGENT))).reason,'identity_mismatch');
  const otherRun=fakeFetch(()=>jsonResponse({id:'run-00000000-0000-0000-0000-00000000dead'}));
  assert.equal((await failure(createCursorProvider({resolveCredential:credentialFor('cursor'),fetch:otherRun.fetch}).cancelRun(AGENT,RUN))).reason,'identity_mismatch');
  const notCancellable=fakeFetch(()=>jsonResponse({error:{code:'run_not_cancellable',message:LEAK}},409));
  const rejected=await failure(createCursorProvider({resolveCredential:credentialFor('cursor'),fetch:notCancellable.fetch}).cancelRun(AGENT,RUN));
  assert.equal(rejected.code,'provider_rejected');assert.equal(rejected.providerCode,'run_not_cancellable');assert.equal(notCancellable.calls.length,1);assertClean(rejected);
});

test('xAI createResponse exige model, input, budget borné et store explicite ; refuse stream/background et outils mal formés',async()=>{
  const {calls,fetch}=fakeFetch(()=>jsonResponse(xaiResponseBody));
  const xai=createXaiProvider({resolveCredential:credentialFor('xai'),fetch});
  const base={model:'grok-fixture',input:'Bonjour',maxOutputTokens:512,store:false};
  const tool={type:'function',name:'get_temperature',description:'Température',parameters:{type:'object',properties:{location:{type:'string'}},required:['location']}};
  const invalid=[
    [{...base,store:undefined},'store'],[{...base,store:'false'},'store'],[{...base,maxOutputTokens:undefined},'maxOutputTokens'],[{...base,maxOutputTokens:0},'maxOutputTokens'],[{...base,maxOutputTokens:10_000_000},'maxOutputTokens'],[{...base,maxOutputTokens:12.5},'maxOutputTokens'],
    [{...base,model:''},'model'],[{...base,model:'../models'},'model'],[{...base,input:''},'input'],[{...base,input:[]},'input'],[{...base,input:[{role:'robot',content:'x'}]},'input[0].role'],
    [{...base,input:[{role:'user',content:[{type:'input_image',image_url:'https://x'}]}]},'input[0].content[0].type'],[{...base,input:[{type:'function_call_output',call_id:'c 1',output:'x'}]},'input[0].call_id'],
    [{...base,stream:true},'input.stream'],[{...base,background:true},'input.background'],[{...base,previous_response_id:'x'},'input.previous_response_id'],
    [{...base,instructions:'Sois bref',previousResponseId:'resp_prev'},'instructions'],[{...base,previousResponseId:'resp prev'},'previousResponseId'],
    [{...base,tools:[{...tool,parameters:{type:'string'}}]},'tools[0].parameters'],[{...base,tools:[{...tool,parameters:{anyOf:[{type:'object'},{type:'string'}]}}]},'tools[0].parameters'],
    [{...base,tools:[{...tool,type:'web_search'}]},'tools[0].type'],[{...base,tools:[tool,tool]},'tools[1].name'],[{...base,tools:[{...tool,name:'bad name'}]},'tools[0].name'],[{...base,tools:[{...tool,description:undefined}]},'tools[0].description'],
    [{...base,toolChoice:'always'},'toolChoice'],[{...base,tools:[tool],toolChoice:{type:'function',name:'other'}},'toolChoice.name'],[{...base,toolChoice:{type:'function',name:'get_temperature'}},'toolChoice.name'],
    [{...base,temperature:3},'temperature'],[{...base,topP:-1},'topP'],[{...base,reasoningEffort:'HIGH!'},'reasoningEffort'],[{...base,user:'a b'},'user'],
  ];
  for(const [input,field] of invalid){
    const error=await failure(xai.createResponse(input));
    assert.equal(error.code,'invalid_request',field);assert.equal(error.delivery,'not_sent');assert.equal(error.field,field);assertClean(error);
  }
  assert.equal(calls.length,0);
});

test('xAI createResponse reste synchrone, transmet les outils sans les exécuter et valide la sortie',async()=>{
  const {calls,fetch}=fakeFetch(()=>jsonResponse(xaiResponseBody));
  const xai=createXaiProvider({resolveCredential:credentialFor('xai'),fetch});
  const tool={type:'function',name:'get_temperature',description:'Température',parameters:{type:'object',properties:{location:{type:'string'}},required:['location']},strict:true};
  const response=await xai.createResponse({model:'grok-fixture',input:[{role:'system',content:'Tu es concis.'},{role:'user',content:[{type:'input_text',text:'Quelle température à Paris ?'}]},{type:'function_call_output',call_id:'call_0',output:'{"temperature":21}'}],maxOutputTokens:512,store:false,tools:[tool],toolChoice:'auto',parallelToolCalls:false,temperature:0.2,topP:0.9,reasoningEffort:'low',user:'user-42',previousResponseId:'resp_prev'});
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.x.ai/v1/responses');assert.equal(calls[0].method,'POST');
  const payload=JSON.parse(calls[0].body);
  assert.deepEqual(payload,{model:'grok-fixture',input:[{role:'system',content:'Tu es concis.'},{role:'user',content:[{type:'input_text',text:'Quelle température à Paris ?'}]},{type:'function_call_output',call_id:'call_0',output:'{"temperature":21}'}],max_output_tokens:512,store:false,stream:false,previous_response_id:'resp_prev',tools:[tool],tool_choice:'auto',parallel_tool_calls:false,temperature:0.2,top_p:0.9,reasoning:{effort:'low'},user:'user-42'});
  assert.equal('background' in payload,false);
  assert.deepEqual(response,{id:'resp_fixture_1',status:'completed',model:'grok-fixture',store:false,omittedOutputItems:1,output:[
    {type:'reasoning',id:'rs_1',summary:['Réflexion']},
    {type:'message',id:'msg_1',status:'completed',content:[{type:'output_text',text:'Bonjour'}]},
    {type:'function_call',id:'fc_1',callId:'call_1',name:'get_temperature',arguments:'{"location":"Paris"}',status:'completed'},
  ],usage:{inputTokens:12,outputTokens:5,totalTokens:17,reasoningTokens:3,cachedTokens:2}});
  assert.equal(calls.length,1,'aucun second appel : l’appel d’outil est seulement relayé');
  const named=fakeFetch(()=>jsonResponse(xaiResponseBody));
  await createXaiProvider({resolveCredential:credentialFor('xai'),fetch:named.fetch}).createResponse({model:'grok-fixture',input:'Bonjour',maxOutputTokens:64,store:true,tools:[tool],toolChoice:{type:'function',name:'get_temperature'}});
  assert.deepEqual(JSON.parse(named.calls[0].body).tool_choice,{type:'function',name:'get_temperature'});assert.equal(JSON.parse(named.calls[0].body).store,true);
  const incomplete=fakeFetch(()=>jsonResponse({...xaiResponseBody,status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[],usage:undefined,error:{code:'output_limit',message:LEAK}}));
  const partial=await createXaiProvider({resolveCredential:credentialFor('xai'),fetch:incomplete.fetch}).createResponse({model:'grok-fixture',input:'Bonjour',maxOutputTokens:1,store:false});
  assert.equal(partial.status,'incomplete');assert.equal(partial.incompleteReason,'max_output_tokens');assert.equal(partial.errorCode,'output_limit');assert.equal(partial.usage,undefined);assert.equal(JSON.stringify(partial).includes(LEAK),false);
  const bad=[
    [{...xaiResponseBody,status:'failed'},'unknown_status'],[{...xaiResponseBody,status:'queued'},'unknown_status'],[{...xaiResponseBody,object:'chat.completion'},'schema'],[{...xaiResponseBody,store:'true'},'schema'],
    [{...xaiResponseBody,output:[{type:'function_call',id:'fc',name:'x',arguments:'{}'}]},'schema'],[{...xaiResponseBody,output:[{type:'message',role:'assistant',content:[{type:'output_audio',data:'...'}]}]},'schema'],
    [{...xaiResponseBody,usage:{input_tokens:1}},'schema'],[{...xaiResponseBody,id:''},'schema'],[{...xaiResponseBody,output:[42]},'schema'],
  ];
  for(const [body,reason] of bad){
    const {fetch:f}=fakeFetch(()=>jsonResponse(body));
    const error=await failure(createXaiProvider({resolveCredential:credentialFor('xai'),fetch:f}).createResponse({model:'grok-fixture',input:'Bonjour',maxOutputTokens:64,store:false}));
    assert.equal(error.code,'provider_response');assert.equal(error.reason,reason);assert.equal(error.delivery,'responded');assertClean(error);
  }
  const quota=fakeFetch(()=>new Response(JSON.stringify({code:'rate_limit_exceeded',error:LEAK}),{status:429,headers:{'content-type':'application/json','retry-after':'7'}}));
  const limited=await failure(createXaiProvider({resolveCredential:credentialFor('xai'),fetch:quota.fetch}).createResponse({model:'grok-fixture',input:'Bonjour',maxOutputTokens:64,store:false}));
  assert.equal(limited.code,'provider_quota');assert.equal(limited.retryAfterMs,7000);assert.equal(limited.providerCode,'rate_limit_exceeded');assert.equal(quota.calls.length,1);assertClean(limited);
  const listShape=fakeFetch(()=>jsonResponse({object:'list',data:[{id:''}]}));
  assert.equal((await failure(createXaiProvider({resolveCredential:credentialFor('xai'),fetch:listShape.fetch}).listModels())).code,'provider_response');
});

test('ProviderFailure se sérialise sans message brut ni secret',()=>{
  const error=new ProviderFailure({provider:'xai',code:'provider_quota',delivery:'responded',status:429,providerCode:'rate_limit_exceeded',retryAfterMs:1000,reason:'http_status'});
  assert.equal(error.name,'ProviderFailure');assert.ok(error instanceof Error);
  assert.deepEqual(JSON.parse(JSON.stringify(error)),{provider:'xai',code:'provider_quota',delivery:'responded',status:429,providerCode:'rate_limit_exceeded',retryAfterMs:1000,reason:'http_status'});
  assert.deepEqual(Object.keys(providerFailureMessages).sort(),['credential_unavailable','invalid_request','provider_auth','provider_quota','provider_redirect','provider_rejected','provider_response','provider_timeout','provider_unreachable']);
});
