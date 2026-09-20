import './register-native-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {app,alice,bob,client,boot,localDb} from './helpers.mjs';
const {dispatchRequest}=await import('../runtime/modules/sites-adapter/src/dispatch.ts');
const {dispatchUiAction}=await import('../runtime/core/assistant-ui.ts');

test('one desktop and one phone per user/workspace; queued delivery survives unread SSE and takeover never replays a click',async()=>{
 const db=await localDb();try{
  const org=await boot(client(db,alice)),other=await boot(client(db,bob));
  const desktop='fixture-desktop-one',phone='fixture-phone-one',second='fixture-desktop-two';
  const request=(path,{id=desktop,body,identity=alice,space=org,origin='https://test.example',method='POST'}={})=>dispatchRequest(new Request(`https://test.example/api/v1/assistant/${path}?workspace=${space}`,{method,headers:{origin,'content-type':'application/json','x-lite-window':id},body:body===undefined?undefined:JSON.stringify(body)}),{app,env:{DB:db},identity});
  const connect=(id,kind,takeover=false)=>request('browser/connect',{body:{windowId:id,kind,takeover}}).then(r=>r.json());
  const poll=id=>request('browser/poll',{id,body:{windowId:id,path:'/dashboard'}}).then(r=>r.json());
  assert.equal((await connect(desktop,'desktop')).active,true);
  assert.equal((await connect(phone,'controller')).desktopConnected,true);
  assert.equal((await connect(second,'desktop')).active,false);
  const conv='fixture-conversation',run='fixture-run',time=new Date().toISOString();
  db.raw.prepare('INSERT INTO lite_assistant_conversations(id,org_id,user_id,title,mode,model,active_run,locked_until,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(conv,org,alice.userId,'Fixture','chat','fixture',run,new Date(Date.now()+60000).toISOString(),time,time);
  const controller=new AbortController();let queued;
  const created=new Promise(r=>queued=r);
  const pending=dispatchUiAction({app,env:{DB:db},identity:alice},{id:org,role:'owner'},conv,run,()=>queued(),'click',{ref:'t1-1'},controller.signal);
  await created; // SSE deliberately carries no command to the consumer.
  const delivered=await poll(desktop),action=delivered.actions[0];assert.equal(action.type,'click');assert.equal(action.params.ref,'t1-1');assert.ok(action.remainingMs>0);
  assert.deepEqual((await poll(phone)).actions,[]);
  assert.deepEqual((await poll(second)).actions,[]);
  const base=`ui-actions/${action.actionId}`;
  assert.equal((await request(base+'/claim',{id:phone})).status,409);
  assert.equal((await request(base+'/claim',{origin:'https://foreign.example'})).status,403);
  assert.equal((await request(base+'/claim')).status,200);
  assert.equal((await request(base+'/claim')).status,409);
  assert.equal((await request(base+'/check')).status,200);
  assert.equal((await connect(second,'desktop',true)).active,true);
  assert.equal((await poll(desktop)).active,false);
  assert.equal((await request(base+'/check')).status,409,'old window cannot execute after takeover');
  assert.equal((await request(base+'/result',{body:{ok:true}})).status,409);
  assert.deepEqual((await poll(second)).actions,[],'replacement never receives old commands');
  assert.equal((await pending).ok,false);
  const logs=await(await request('browser/diagnostics',{method:'GET'})).json();
  for(const event of ['action.queued','action.claimed','action.rejected','action.failed','window.taken_over'])assert.ok(logs.events.some(e=>e.event===event),event);
  assert.equal((await request('browser/diagnostics',{method:'GET',identity:bob})).status,404);
  const isolated=await(await request('browser/diagnostics',{method:'GET',identity:bob,space:other})).json();assert.deepEqual(isolated.events,[]);
  await request('browser/events',{id:second,body:{windowId:second,event:'driver.error',code:'TypeError',secret:'never-log-this',text:'private form'}});
  assert.doesNotMatch(JSON.stringify(db.raw.prepare('SELECT detail_json FROM lite_browser_events').all()),/never-log-this|private form/);
  db.raw.prepare('UPDATE lite_browser_sessions SET lease_until=? WHERE kind=?').run(new Date(Date.now()-1000).toISOString(),'desktop');
  assert.equal((await poll(second)).active,false,'expired sessions cannot revive themselves by heartbeat');
  const noDesktop=await dispatchUiAction({app,env:{DB:db},identity:alice},{id:org,role:'owner'},conv,run,()=>{},'click',{ref:'t1-1'},controller.signal);assert.equal(noDesktop.code,'desktop_offline');
 }finally{db.close();}
});


test('reload lease: stale release cannot delete a renewed tab and closing frees the slot',async()=>{
 const db=await localDb();try{
  const org=await boot(client(db,alice));
  const desktop='fixture-reload-window',other='fixture-other-window';
  const request=async(path,body)=>({body:await dispatchRequest(new Request(`https://test.example/api/v1/assistant/${path}?workspace=${org}`,{method:'POST',headers:{origin:'https://test.example','content-type':'application/json','x-lite-window':body.windowId},body:JSON.stringify(body)}),{app,env:{DB:db},identity:alice}).then(r=>r.json())});
  const first=(await request('browser/connect',{windowId:desktop,kind:'desktop'})).body;
  const renewed=(await request('browser/connect',{windowId:desktop,kind:'desktop'})).body;
  assert.equal(first.active,true);assert.equal(renewed.active,true);
  assert.notEqual(renewed.releaseToken,first.releaseToken,'each renewal has an unambiguous release token');
  const stale=(await request('browser/release',{windowId:desktop,releaseToken:first.releaseToken})).body;
  assert.equal(stale.released,false,'the old document cannot release its replacement');
  const alive=(await request('browser/poll',{windowId:desktop,path:'/commandes'})).body;
  assert.equal(alive.active,true,'normal navigation keeps the renewed tab active');
  assert.equal((await request('browser/connect',{windowId:other,kind:'desktop'})).body.active,false,'a real second window remains blocked');
  const closed=(await request('browser/release',{windowId:desktop,releaseToken:alive.releaseToken})).body;
  assert.equal(closed.released,true);
  assert.equal((await request('browser/connect',{windowId:other,kind:'desktop'})).body.active,true,'closing the active tab frees the slot');
 }finally{db.close();}
});
