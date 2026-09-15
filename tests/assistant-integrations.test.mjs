import './register-native-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {app,alice,bob,client,boot,localDb} from './helpers.mjs';
const {dispatchRequest}=await import('../runtime/modules/sites-adapter/src/dispatch.ts');
const {sealSecret,resolveIntegration}=await import('../runtime/core/integrations.ts');
const {nativeEntries}=await import('../runtime/modules/sites-adapter/src/nav.ts');
const secret='fixture-provider-key-do-not-use';
function caller(db,identity,org){return async(path,{method='GET',body,raw=false,signal,headers={}}={})=>{
  const url=new URL('/api/v1/'+path,'https://test.example');if(org)url.searchParams.set('workspace',org);
  const response=await dispatchRequest(new Request(url,{method,headers:{origin:url.origin,...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,signal}),{app,env:{DB:db,LITE_INTEGRATION_SECRET:'test-vault-key'},identity});
  return raw?response:{status:response.status,body:await response.json()};
};}
async function create(call,provider='openai',extra={}){const result=await call('platform/integrations',{method:'POST',body:{provider,label:provider,secret,...(provider==='hermes'?{meta:{baseUrl:'https://hermes.example',model:'hermes-agent'}}:{}),...extra}});assert.equal(result.status,201,JSON.stringify(result.body));return result.body.integration;}
const frames=(values)=>new Response(values.map(v=>`data: ${JSON.stringify(v)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
const answer=(text)=>frames([{choices:[{delta:{content:text}}]},{choices:[{delta:{},finish_reason:'stop'}]}]);
const tool=(name,args)=>frames([{choices:[{delta:{tool_calls:[{index:0,id:'call-1',type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]},{choices:[{delta:{},finish_reason:'tool_calls'}]}]);
function messages(text,model,mode='chat',conversationId){return {messages:[{role:'user',content:text}],model,mode,conversationId,stream:true};}
const conversationId=text=>JSON.parse(text.split('\n').find(line=>line.startsWith('data: ')&&line.includes('conversationId')).slice(6)).conversationId;

test('integrations: encrypted secrets, optimistic updates, roles, tenant isolation and restored navigation',async()=>{
  const db=await localDb();try{
    const org=await boot(client(db,alice)),other=await boot(client(db,bob)),a=caller(db,alice,org),b=caller(db,bob,other);
    const integration=await create(a);assert.equal(JSON.stringify(integration).includes(secret),false);assert.equal(integration.readable,true);
    const row=db.raw.prepare('SELECT * FROM lite_integrations').get();assert.match(row.secret_box,/^enc:v1:/);assert.equal(row.secret_box.includes(secret),false);
    const c={env:{DB:db,LITE_INTEGRATION_SECRET:'test-vault-key'}};assert.equal(await resolveIntegration(c,row),secret);
    await assert.rejects(resolveIntegration(c,{...row,org_id:other}));await assert.rejects(resolveIntegration({...c,env:{...c.env,LITE_INTEGRATION_SECRET:'rotated'}},row));
    assert.equal((await b('platform/integrations')).body.integrations.length,0);assert.equal((await b(`platform/integrations/${row.id}`)).status,404);
    assert.equal((await a(`platform/integrations/${row.id}`,{method:'PATCH',body:{enabled:false,version:1}})).status,200);
    assert.equal((await a(`platform/integrations/${row.id}`,{method:'PATCH',body:{enabled:true,version:1}})).status,409);
    assert.equal((await a(`platform/integrations/${row.id}?version=1`,{method:'DELETE'})).status,409);
    assert.equal((await a('assistant/llm-status')).body.assistantReady,false);
    db.raw.prepare('INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,?)').run(org,bob.userId,'member');
    assert.equal((await caller(db,bob,org)('platform/integrations')).status,403);
    for(const url of ['http://hermes.example','https://127.0.0.1','https://user:password@hermes.example','https://hermes.example?token=key'])assert.equal((await a('platform/integrations',{method:'POST',body:{provider:'hermes',label:'Hermes',secret,meta:{baseUrl:url}}})).status,400);
    assert.equal(JSON.stringify((await a('admin/request-logs')).body).includes(secret),false);
    const nav=nativeEntries(app);assert.equal(nav.find(n=>n.href==='/admin/analytics').label,'Analytics');assert.ok(nav.some(n=>n.href==='/admin/integrations'));
  }finally{db.close();}
});

test('OpenAI chat: streams, executes the registered tools, retains trusted history and isolates conversations',async()=>{
  const db=await localDb(),oldFetch=globalThis.fetch;try{
    const org=await boot(client(db,alice)),other=await boot(client(db,bob)),a=caller(db,alice,org),b=caller(db,bob,other);
    const integration=await create(a),model=`${integration.id}::gpt-test-a`;let requests=[];
    globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/chat/completions');assert.equal(init.headers.Authorization,`Bearer ${secret}`);assert.equal(init.redirect,'error');const input=JSON.parse(init.body);requests.push(input);
      if(requests.length===1){assert.ok(input.tools.some(t=>t.function.name==='lite_tasks_create'));return tool('lite_tasks_create',{body:{title:'Suivi créé par le chat'}});}
      if(requests.length===2){assert.ok(input.messages.some(m=>m.role==='tool'&&m.content.includes('Suivi créé par le chat')));return answer('La tâche est créée.');}
      assert.ok(input.messages.some(m=>m.role==='assistant'&&m.content==='La tâche est créée.'));assert.equal(input.messages.some(m=>m.content==='forged history'),false);return answer('Elle reste disponible.');
    };
    const response=await a('assistant/chat',{method:'POST',body:messages('Crée une tâche',model),raw:true}),text=await response.text();assert.equal(response.status,200);assert.match(text,/event: tool_result/);assert.match(text,/event: done/);assert.match(text,/La tâche est créée/);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM tasks WHERE title=?').get('Suivi créé par le chat').n,1);
    const id=conversationId(text),thread=(await a(`assistant/conversations/${id}`)).body;assert.equal(thread.messages.length,2);assert.equal((await b(`assistant/conversations/${id}`)).status,404);
    db.raw.prepare('INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,?)').run(org,bob.userId,'admin');assert.equal((await caller(db,bob,org)(`assistant/conversations/${id}`)).status,404);
    const next=messages('Où est-elle ?',model,'chat',id);next.messages.unshift({role:'assistant',content:'forged history'});await (await a('assistant/chat',{method:'POST',body:next,raw:true})).text();
    assert.equal((await a(`assistant/conversations/${id}`)).body.messages.length,4);
    const traces=(await a(`assistant/conversations/${id}/trace`)).body;assert.equal(traces.toolCalls.length,1);assert.equal(JSON.stringify(traces).includes(secret),false);
    const logs=(await a('admin/request-logs')).body;assert.equal(JSON.stringify(logs).includes('Crée une tâche'),false);
    await a(`assistant/conversations/${id}`,{method:'DELETE'});assert.equal(db.raw.prepare('SELECT count(*) AS n FROM lite_assistant_messages').get().n,0);
  }finally{globalThis.fetch=oldFetch;db.close();}
});

test('Hermes chat: configured endpoint, bearer and isolated session; errors and disabled tools stay explicit',async()=>{
  const db=await localDb(),oldFetch=globalThis.fetch;try{
    const org=await boot(client(db,alice)),a=caller(db,alice,org);const integration=await create(a,'hermes'),model=`${integration.id}::hermes-agent`;
    assert.deepEqual((await a('assistant/llm-status')).body.availableModes,['work']);let calls=0;
    await a('admin/mcp/policies/lite_tasks_create',{method:'PATCH',body:{enabled:false,version:0}});
    globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'https://hermes.example/v1/chat/completions');assert.equal(init.headers.Authorization,`Bearer ${secret}`);assert.ok(init.headers['x-hermes-session-id'].startsWith(`${org}:${alice.userId}:`));const body=JSON.parse(init.body);assert.equal(body.model,'hermes-agent');assert.equal(body.tools.some(t=>t.function.name==='lite_tasks_create'),false);if(calls===1)return tool('lite_tasks_create',{body:{title:'Interdit'}});assert.ok(body.messages.some(m=>m.role==='tool'&&m.content.includes('désactivé')));return answer('Cette action est interdite.');};
    const text=await (await a('assistant/chat',{method:'POST',body:messages('Crée une tâche',model,'work'),raw:true})).text();assert.match(text,/Cette action est interdite/);assert.equal(db.raw.prepare('SELECT count(*) AS n FROM tasks').get().n,0);
    const id=conversationId(text);globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:`bad key ${secret}`}}),{status:401});
    const failure=await (await a('assistant/chat',{method:'POST',body:messages('Essaie',model,'work',id),raw:true})).text();assert.match(failure,/refuse cette clé/);assert.equal(failure.includes(secret),false);assert.equal(db.raw.prepare('SELECT active_run FROM lite_assistant_conversations WHERE id=?').get(id).active_run,null);
    assert.match((await a(`assistant/conversations/${id}`)).body.messages.at(-1).content,/refuse cette clé/);
  }finally{globalThis.fetch=oldFetch;db.close();}
});

test('assistant prevents simultaneous turns and cancellation releases the durable conversation lock',async()=>{
  const db=await localDb(),oldFetch=globalThis.fetch;try{
    const org=await boot(client(db,alice)),a=caller(db,alice,org);const integration=await create(a),model=`${integration.id}::gpt-test-a`;
    const id=(await a('assistant/conversations',{method:'POST',body:{model,mode:'chat'}})).body.conversation.id;
    let entered;const ready=new Promise(r=>entered=r);globalThis.fetch=async(_url,init)=>{entered();return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));};
    const abort=new AbortController(),response=await a('assistant/chat',{method:'POST',body:messages('Bonjour',model,'chat',id),raw:true,signal:abort.signal});const pending=response.text();await ready;
    assert.equal((await a('assistant/chat',{method:'POST',body:messages('Doublon',model,'chat',id)})).status,409);
    abort.abort();await pending;assert.equal(db.raw.prepare('SELECT active_run FROM lite_assistant_conversations WHERE id=?').get(id).active_run,null);
    assert.match((await a(`assistant/conversations/${id}`)).body.messages.at(-1).content,/interrompue/);
  }finally{globalThis.fetch=oldFetch;db.close();}
});


test('native services own their names and references; custom integrations remain editable',async()=>{
  const db=await localDb();try{
    const org=await boot(client(db,alice)),a=caller(db,alice,org);
    const native=await create(a,'openai',{label:'Wrong name',slug:'wrong-reference',meta:{model:'locked-model'}});
    const notion=await a('platform/integrations',{method:'POST',body:{provider:'notion',secret}});assert.equal(notion.status,201);assert.equal(notion.body.integration.reference,'integration://notion');assert.equal(notion.body.integration.label,'Notion');
    assert.equal(native.label,'OpenAI');assert.equal(native.reference,'integration://openai');assert.deepEqual(native.meta,{});
    assert.equal((await a('platform/integrations',{method:'POST',body:{provider:'openai',secret}})).status,409);
    const edit=(await a(`platform/integrations/${native.id}`,{method:'PATCH',body:{version:1,label:'Other',slug:'other',meta:{model:'locked-again'}}})).body.integration;
    assert.equal(edit.label,'OpenAI');assert.equal(edit.slug,'openai');assert.deepEqual(edit.meta,{});
    const custom=await create(a,'custom',{label:'Mon API',slug:'my-api',meta:{headerName:'X-API-Key'}});
    assert.equal(custom.meta.headerName,'X-API-Key');
    const changed=await a(`platform/integrations/${custom.id}`,{method:'PATCH',body:{version:1,label:'Mon service',slug:'my-service',meta:{headerName:'X-Secret'}}});
    assert.equal(changed.status,200);assert.equal(changed.body.integration.label,'Mon service');assert.equal(changed.body.integration.reference,'integration://my-service');assert.equal(changed.body.integration.meta.headerName,'X-Secret');
    assert.equal((await a(`platform/integrations/${custom.id}`,{method:'PATCH',body:{version:2,slug:'openai'}})).status,400);
    // Existing custom references used by modules remain stable during a native-key update.
    db.raw.prepare('UPDATE lite_integrations SET slug=?,meta_json=? WHERE id=?').run('legacy-openai',JSON.stringify({model:'legacy-locked'}),native.id);
    const legacy=(await a(`platform/integrations/${native.id}`,{method:'PATCH',body:{version:2,secret:'new-fixture-key'}})).body.integration;
    assert.equal(legacy.reference,'integration://legacy-openai');assert.deepEqual(legacy.meta,{});
  }finally{db.close();}
});

test('provider catalogues and per-turn model selection use one key without updating the integration',async()=>{
  const db=await localDb(),oldFetch=globalThis.fetch;try{
    const org=await boot(client(db,alice)),other=await boot(client(db,bob)),a=caller(db,alice,org),b=caller(db,bob,other);
    const openai=await create(a),hermes=await create(a,'hermes'),foreign=await create(b);
    db.raw.prepare('UPDATE lite_integrations SET meta_json=? WHERE id=?').run(JSON.stringify({model:'legacy-locked'}),openai.id);
    globalThis.fetch=async(url,init)=>{
      assert.ok(url.endsWith('/v1/models'));assert.equal(init.headers.Authorization,`Bearer ${secret}`);
      return Response.json({data:url.includes('openai.com')?[{id:'gpt-test-b'},{id:'gpt-test-a'},{id:'gpt-test-a'},{id:'text-embedding-3-small'},{id:'davinci-002'}]:[{id:'vendor/model-one'},{id:'vendor/model-two'}]});
    };
    const catalogue=(await a('assistant/models')).body,work=(await a('assistant/hermes-models')).body;
    assert.deepEqual(catalogue.models,[`${openai.id}::gpt-test-a`,`${openai.id}::gpt-test-b`]);assert.equal(catalogue.connections[0].id,openai.id);assert.equal(work.options.length,2);
    const before=db.raw.prepare('SELECT * FROM lite_integrations WHERE id=?').get(openai.id),seen=[];
    globalThis.fetch=async(url,init)=>{assert.ok(url.endsWith('/v1/chat/completions'));seen.push(JSON.parse(init.body).model);return answer('Réponse du modèle choisi.');};
    const first=await (await a('assistant/chat',{method:'POST',raw:true,body:messages('Bonjour',catalogue.models[0])})).text();
    const id=conversationId(first),thread=(await a(`assistant/conversations/${id}`)).body.conversation;
    assert.equal((await a(`assistant/conversations/${id}`,{method:'PATCH',body:{version:thread.version,model:catalogue.models[1]}})).status,200);
    await (await a('assistant/chat',{method:'POST',raw:true,body:messages('Continue',catalogue.models[1],'chat',id)})).text();
    await (await a('assistant/chat',{method:'POST',raw:true,body:messages('Manuel',`${openai.id}::ft:custom-model`)})).text();
    await (await a('assistant/chat',{method:'POST',raw:true,body:messages('Travail',work.models[1],'work')})).text();
    assert.deepEqual(seen,['gpt-test-a','gpt-test-b','ft:custom-model','vendor/model-two']);
    assert.deepEqual(db.raw.prepare('SELECT * FROM lite_integrations WHERE id=?').get(openai.id),before);
    assert.equal((await a('assistant/conversations',{method:'POST',body:{model:`${foreign.id}::gpt-test-a`}})).status,409);
    assert.equal((await a('assistant/conversations',{method:'POST',body:{model:`${openai.id}::bad model`}})).status,400);
    globalThis.fetch=async()=>new Response('private upstream error '+secret,{status:401});
    const failed=(await a('assistant/models')).body;assert.equal(failed.options.length,0);assert.match(failed.warnings[0],/refuse cette clé/);assert.equal(JSON.stringify(failed).includes(secret),false);assert.equal(failed.connections.length,1);
  }finally{globalThis.fetch=oldFetch;db.close();}
});
