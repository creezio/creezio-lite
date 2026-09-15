import './register-native-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {app,alice,bob,client,boot,localDb} from './helpers.mjs';
const {dispatchRequest}=await import('../runtime/modules/sites-adapter/src/dispatch.ts');
const {dispatchUiAction}=await import('../runtime/core/assistant-ui.ts');

function caller(db,identity,org){return (path,{method='POST',body,signal,origin='https://test.example'}={})=>{
  const url=new URL('/api/v1/'+path,'https://test.example');url.searchParams.set('workspace',org);
  return dispatchRequest(new Request(url,{method,headers:{origin,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal}),{app,env:{DB:db,LITE_INTEGRATION_SECRET:'fixture-vault'},identity});
};}
const response=message=>Response.json({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]});
const callTool=(name,args)=>response({tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
async function consume(stream,onAction){
  const reader=stream.body.getReader(),decoder=new TextDecoder();let buffer='',events=[];
  while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let cut;
    while((cut=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,cut);buffer=buffer.slice(cut+2);const event=frame.split('\n')[0].slice(7),data=JSON.parse(frame.split('\n').find(x=>x.startsWith('data: ')).slice(6));events.push({event,data});if(event==='ui_action')await onAction(data);}
  }return events;
}

for(const provider of ['openai','hermes'])test(`${provider}: chat waits for browser target discovery and confirmed click; callbacks are private and single use`,async()=>{
  const db=await localDb(),oldFetch=globalThis.fetch;
  try{
    const org=await boot(client(db,alice)),other=await boot(client(db,bob)),a=caller(db,alice,org),b=caller(db,bob,org),wrongSpace=caller(db,alice,other);
    db.raw.prepare('INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,?)').run(org,bob.userId,'admin');
    db.raw.prepare('INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,?)').run(other,alice.userId,'admin');
    const integration=await (await a('platform/integrations',{body:{provider,secret:'fixture-key',...(provider==='hermes'?{meta:{baseUrl:'https://hermes.example'}}:{})}})).json();
    let rounds=0;
    globalThis.fetch=async(url,init)=>{
      const payload=JSON.parse(init.body);rounds++;
      assert.ok(payload.tools.some(t=>t.function.name==='ui_click'));assert.ok(payload.tools.some(t=>t.function.name==='lite_tasks_create'));
      assert.match(payload.messages[0].content,/curseur IA visible/);
      if(rounds===1)return callTool('ui_list_targets',{q:'Mail'});
      if(rounds===2){assert.match(payload.messages.at(-1).content,/t1-1/);return callTool('ui_click',{ref:'t1-1'});}
      assert.equal(JSON.parse(payload.messages.at(-1).content).clicked,'Mail');return response({content:'La rubrique Mail est ouverte.'});
    };
    const stream=await a('assistant/chat',{body:{messages:[{role:'user',content:'Clique sur Mail'}],model:`${integration.integration.id}::gpt-fixture`,mode:provider==='hermes'?'work':'chat',uiDriver:true}});
    let actions=0;
    const events=await consume(stream,async action=>{
      actions++;assert.equal(rounds,actions,'provider must wait for the browser');
      const base=`assistant/ui-actions/${action.actionId}`;
      assert.equal((await a(base+'/result',{body:{ok:true}})).status,409,'unclaimed results rejected');
      assert.equal((await b(base+'/claim')).status,409,'another admin cannot claim');
      assert.equal((await wrongSpace(base+'/claim')).status,409,'another workspace cannot claim');
      assert.equal((await a(base+'/claim',{origin:'https://evil.example'})).status,403);
      const claims=await Promise.all([a(base+'/claim'),a(base+'/claim')]);assert.deepEqual(claims.map(r=>r.status).sort(),[200,409]);
      assert.equal((await b(base+'/result',{body:{ok:true}})).status,409);
      const result=action.type==='list_targets'?{ok:true,targets:[{ref:'t1-1',label:'Mail',kind:'link'}]}:{ok:true,clicked:'Mail',page:{path:'/mails'}};
      assert.equal((await a(base+'/result',{body:result})).status,200);
      assert.equal((await a(base+'/result',{body:result})).status,409,'no replay');
    });
    assert.equal(actions,2);assert.equal(rounds,3);assert.ok(events.some(e=>e.event==='done'));
    assert.deepEqual(events.filter(e=>e.event==='tool_result').map(e=>e.data.summary),['Éléments repérés','Clic effectué']);
    assert.equal(db.raw.prepare('SELECT count(*) n FROM lite_assistant_ui_actions').get().n,0);
    const tools=await (await a('mcp/tools',{method:'GET'})).json();assert.equal(tools.tools.some(t=>t.name.startsWith('ui_')||t.name.includes('assistant_ui')),false);
  }finally{globalThis.fetch=oldFetch;db.close();}
});

test('browser failure is reported as failure; an ordinary API chat has no browser tools',async()=>{
  const db=await localDb(),oldFetch=globalThis.fetch;
  try{
    const org=await boot(client(db,alice)),a=caller(db,alice,org);
    const integration=await (await a('platform/integrations',{body:{provider:'openai',secret:'fixture'}})).json();let rounds=0;
    globalThis.fetch=async(url,init)=>{const p=JSON.parse(init.body);rounds++;
      if(rounds===1)return callTool('ui_click',{ref:'stale'});
      if(rounds===2){assert.equal(JSON.parse(p.messages.at(-1).content).ok,false);return response({content:'La cible n’est plus visible.'});}
      assert.equal(p.tools.some(t=>t.function.name.startsWith('ui_')),false);return response({content:'Bonjour.'});
    };
    const body={messages:[{role:'user',content:'Clique sur Mail'}],model:`${integration.integration.id}::gpt-fixture`,uiDriver:true};
    const events=await consume(await a('assistant/chat',{body}),async action=>{
      const base=`assistant/ui-actions/${action.actionId}`;await a(base+'/claim');await a(base+'/result',{body:{ok:false,error:'Cible introuvable'}});
    });
    const done=events.find(e=>e.event==='tool_result');assert.equal(done.data.ok,false);assert.equal(done.data.summary,'Cible introuvable');
    const trace=JSON.parse(db.raw.prepare('SELECT trace_json FROM lite_assistant_runs').get().trace_json);assert.equal(trace.toolCalls[0].resultOk,false);
    await (await a('assistant/chat',{body:{...body,uiDriver:false}})).text();
  }finally{globalThis.fetch=oldFetch;db.close();}
});

test('cancelled, expired and revoked browser actions cannot be claimed or acknowledged',async()=>{
  const db=await localDb();try{
    const orgId=await boot(client(db,alice)),org={id:orgId,name:'Fixture',role:'owner'},a=caller(db,alice,orgId),id=crypto.randomUUID(),run='fixture-run';
    db.raw.prepare('INSERT INTO lite_assistant_conversations(id,org_id,user_id,title,mode,model,active_run,locked_until,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,orgId,alice.userId,'Fixture','chat','fixture',run,new Date(Date.now()+60000).toISOString(),new Date().toISOString(),new Date().toISOString());
    const controller=new AbortController();let emitted;const ready=new Promise(resolve=>{emitted=resolve;});
    const pending=dispatchUiAction({env:{DB:db},identity:alice},org,id,run,(event,data)=>emitted(data),'click',{ref:'t1-1'},controller.signal);
    const action=await ready;controller.abort();await assert.rejects(pending,{name:'AbortError'});
    assert.equal((await a(`assistant/ui-actions/${action.actionId}/claim`)).status,409);
    for(const [expiry,active] of [[new Date(Date.now()-1000).toISOString(),run],[new Date(Date.now()+30000).toISOString(),'different-run']]){
      const key=crypto.randomUUID();db.raw.prepare('INSERT INTO lite_assistant_ui_actions(id,conversation_id,org_id,user_id,run_id,status,expires_at) VALUES(?,?,?,?,?,?,?)').run(key,id,orgId,alice.userId,active,'pending',expiry);
      assert.equal((await a(`assistant/ui-actions/${key}/claim`)).status,409);
    }
  }finally{db.close();}
});
