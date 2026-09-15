import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {root,migrationSql,alice,client,boot} from '../tests/helpers.mjs';
const project=resolve(process.argv[2]??join(root,'template'));
const require=createRequire(join(project,'package.json')),wrangler=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=await import(pathToFileURL(wrangler.resolve('miniflare')).href);
const config=JSON.parse(await readFile(join(project,'dist/server/wrangler.json'),'utf8')),server=join(project,'dist/server');
const files=(await readdir(server,{recursive:true})).filter(p=>/\.m?js$/.test(p)&&p!==config.main);
let rounds=0;
const mf=new Miniflare({modules:[config.main,...files].map(path=>({type:'ESModule',path:join(server,path)})),modulesRoot:server,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{LITE_INTEGRATION_SECRET:'only-a-local-test-secret-for-the-fixture'},cf:false,
 outboundService:async request=>{
  assert.equal(new URL(request.url).hostname,'api.openai.com');const payload=await request.json();rounds++;
  const tool=rounds===1?{name:'ui_list_targets',arguments:'{"q":"Mail"}'}:rounds===2?{name:'ui_click',arguments:'{"ref":"t1-1"}'}:null;
  if(rounds===3)assert.equal(JSON.parse(payload.messages.at(-1).content).clicked,'Mail');
  return Response.json({choices:[{finish_reason:tool?'tool_calls':'stop',message:tool?{tool_calls:[{id:'fixture-call-'+rounds,type:'function',function:tool}]}:{content:'Mail est ouvert.'}}]});
 }});
try{
 const db=await mf.getD1Database('DB');for(const sql of(await migrationSql()).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 const org=await boot(client(db,alice)),origin='https://relay-fixture.example',desktop='fixture-desktop-window',phone='fixture-phone-window';
 const identity={'oai-authenticated-user-id':alice.userId,'oai-authenticated-user-email':alice.email};
 const call=(path,body,id=desktop,extra={})=>mf.dispatchFetch(origin+'/api/v1/'+path+(path.includes('?')?'&':'?')+'workspace='+org,{method:body===undefined?'GET':'POST',headers:{...identity,origin,'x-lite-window':id,...(body===undefined?{}:{'content-type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
 for(const [id,kind]of[[desktop,'desktop'],[phone,'controller']])assert.equal((await(await call('assistant/browser/connect',{windowId:id,kind},id)).json()).active,true);
 const integration=await(await call('platform/integrations',{provider:'openai',secret:'fixture-provider-key'})).json();assert.ok(integration.integration.id);
 const connection=await call('assistant/browser/socket?windowId='+desktop,undefined,desktop,{upgrade:'websocket'});assert.equal(connection.status,101);const socket=connection.webSocket;assert.ok(socket);socket.accept();
 const message=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('WebSocket state timed out')),5000);socket.addEventListener('message',event=>{clearTimeout(timer);resolve(JSON.parse(event.data));},{once:true});});socket.send(JSON.stringify({type:'pulse',path:'/dashboard'}));assert.equal((await message).active,true);socket.close(1000);
 const denied=await call('assistant/browser/socket?windowId='+desktop,undefined,desktop,{upgrade:'websocket',origin:'https://foreign.example'});assert.equal(denied.status,403);
 // Start on the phone. Intentionally do NOT read the SSE stream until the desktop has completed both actions.
 const responsePromise=call('assistant/chat',{messages:[{role:'user',content:'Clique sur Mail'}],model:integration.integration.id+'::gpt-fixture',uiDriver:true},phone);
 const until=Date.now()+15000;let executed=0;
 while(executed<2&&Date.now()<until){
  const state=await(await call('assistant/browser/poll',{windowId:desktop,path:'/dashboard'})).json();
  for(const action of state.actions??[]){
   const base='assistant/ui-actions/'+action.actionId;assert.equal((await call(base+'/claim',{})).status,200);assert.equal((await call(base+'/claim',{})).status,409);assert.equal((await call(base+'/check',{})).status,200);
   const result=action.type==='list_targets'?{ok:true,targets:[{ref:'t1-1',label:'Mail'}]}:{ok:true,clicked:'Mail',page:{path:'/mail'}};
   assert.equal((await call(base+'/result',result)).status,200);executed++;
  }
  if(executed<2)await new Promise(r=>setTimeout(r,100));
 }
 assert.equal(executed,2,'Durable delivery must work without reading the chat stream');
 const response=await responsePromise;assert.equal(response.status,200);const text=await response.text();assert.match(text,/event: done/);assert.equal(rounds,3);
 const run=await db.prepare('SELECT conversation_id,trace_json FROM lite_assistant_runs').first();assert.equal(JSON.parse(run.trace_json).runs[0].status,'completed');
 const trace=await(await call('assistant/conversations/'+run.conversation_id+'/trace')).json();assert.ok(trace.uiEvents.some(e=>e.event==='action.claimed'));assert.ok(trace.uiEvents.some(e=>e.event==='action.completed'));
 assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM lite_assistant_ui_actions WHERE payload_json IS NOT NULL').first('n'),0,'Form payloads are cleared after execution');
 console.log('Compiled Worker: WebSocket upgrade, cross-origin rejection, phone → desktop delivery with unread SSE, claims, acknowledgements and durable traces passed.');
}finally{await mf.dispose();}
