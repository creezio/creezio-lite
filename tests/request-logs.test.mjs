import './register-native-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {app,alice,bob,eve,client,boot,localDb} from './helpers.mjs';
const {dispatchRequest}=await import('../runtime/modules/sites-adapter/src/dispatch.ts');
const {operationCatalog}=await import('../runtime/modules/sites-adapter/src/catalog.ts');
const {projectRequestLog,buildDiagnostic,errorCode,jsonrpcLabel,newRequestTrace,persistRequestLog,CAPACITY,RETENTION_DAYS,UNKNOWN_ROUTE,UNKNOWN_TOOL,REQUEST_ID_HEADER,KNOWN_ERROR_CODES,GENERIC_ERROR_CODE}=await import('../runtime/core/observability.ts');
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {root} from './helpers.mjs';

// Fictitious personal markers: none of them may appear in a stored row or in the admin listing.
const markers={name:'ZZMARK Jean Dupont',email:'zzmark.jean.dupont@example.test',phone:'ZZMARK+33600000000',note:'ZZMARK note confidentielle',query:'ZZMARK recherche libre',token:'ZZMARK_TOKEN_'+'b'.repeat(40),cookie:'zzmark_cookie=ZZMARK_COOKIE_VALUE',tool:'lite_zzmark_jean_dupont',method:'ZZMARK/method',segment:'zzmark-jean-dupont@example.test'};
const markerValues=Object.values(markers);
const rpc=(name,args={})=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function caller(db,identity,org,definition=app,token){return async(path,{method='GET',body,headers={},rawBody}={})=>{
  const url=new URL(path.startsWith('/api/')?path:'/api/v1/'+path,'https://test.example');if(org&&!url.searchParams.has('workspace'))url.searchParams.set('workspace',org);
  const response=await dispatchRequest(new Request(url,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{origin:url.origin}),...(body!==undefined||rawBody!==undefined?{'content-type':'application/json'}:{}),accept:'application/json',...headers},body:rawBody??(body!==undefined?JSON.stringify(body):undefined)}),{app:definition,env:{DB:db},identity});
  const text=await response.text();let parsed=null;try{parsed=JSON.parse(text);}catch{}
  return {status:response.status,body:parsed,text,headers:response.headers};
};}
const rows=db=>db.raw.prepare('SELECT * FROM lite_request_logs ORDER BY created_at,rowid').all();
const stored=db=>JSON.stringify(rows(db));
function assertNoMarkers(text,label){for(const marker of markerValues)assert.equal(text.includes(marker),false,`${label} contient le marqueur ${marker}`);}
async function setup(){
  const db=await localDb();
  const org=await boot(client(db,alice)),other=await boot(client(db,bob));await boot(client(db,eve));
  db.raw.prepare('INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,?)').run(org,eve.userId,'viewer');
  return {db,org,other,a:caller(db,alice,org),b:caller(db,bob,other),viewer:caller(db,eve,org)};
}

test('REST rows keep catalogue operation, status, duration and correlation but no body, query, header or path value',async()=>{
  const {db,a,viewer}=await setup();try{
    const created=await a('modules/clients/records',{method:'POST',body:{data:{name:markers.name,email:markers.email,company:markers.phone,status:'Actif',notes:markers.note}},headers:{cookie:markers.cookie}});
    assert.equal(created.status,201,created.text);const record=created.body.record;assert.match(created.headers.get(REQUEST_ID_HEADER),uuid);
    assert.equal((await a(`modules/clients/records/${record.id}`,{method:'PATCH',body:{data:{...record.data,notes:markers.note+' modifiée'},version:record.version}})).status,200);
    assert.equal((await viewer('modules/clients/records',{method:'POST',body:{data:{name:markers.name}}})).status,403);
    assert.equal((await a(`search?q=${encodeURIComponent(markers.query)}&token=${encodeURIComponent(markers.token)}`)).status,200);
    assert.equal((await a(`modules/clients/records/${encodeURIComponent(markers.segment)}`)).status,404);
    assert.equal((await a(`${encodeURIComponent(markers.segment)}?secret=${encodeURIComponent(markers.token)}`)).status,404);
    assert.equal((await a('modules/clients/records',{method:'POST',rawBody:'{"data":{"name":"'+markers.name+'"'})).status,400);
    const all=rows(db);assert.equal(all.length,7);assertNoMarkers(stored(db),'lite_request_logs');
    const details=all.map(r=>JSON.parse(r.detail_json));
    for(const detail of details){assert.deepEqual(Object.keys(detail).filter(k=>!['ok','error','operation','tool','jsonrpcMethod','calls','correlationId','credential'].includes(k)),[]);assert.match(detail.correlationId,uuid);assert.equal(detail.credential,'session');}
    assert.equal(all[0].path,'/api/v1/modules/clients/records');assert.equal(all[0].method,'POST');assert.equal(all[0].status,201);assert.equal(details[0].operation,'module.clients.create');assert.equal(details[0].ok,true);assert.equal(details[0].correlationId,created.headers.get(REQUEST_ID_HEADER));assert.ok(Number.isInteger(all[0].duration_ms)&&all[0].duration_ms>=0);
    assert.equal(all[1].path,'/api/v1/modules/clients/records/:id');assert.equal(details[1].operation,'module.clients.update');
    assert.equal(all[2].status,403);assert.equal(details[2].ok,false);assert.equal(details[2].error,'operation_forbidden');assert.equal(details[2].operation,'module.clients.create');
    assert.equal(all[3].path,'/api/v1/search');assert.equal(details[3].operation,'search.query');
    assert.equal(all[4].path,'/api/v1/modules/clients/records/:id');assert.equal(all[4].status,404);assert.equal(details[4].error,'record_not_found');
    assert.equal(all[5].path,UNKNOWN_ROUTE);assert.equal(all[5].status,404);assert.equal(details[5].operation,undefined);
    assert.equal(all[6].status,400);assert.equal(details[6].error,'invalid_json');
    const listing=await a('admin/request-logs');assert.equal(listing.status,200);assert.equal(listing.body.total,7);assert.equal(listing.body.capacity,CAPACITY);assert.equal(listing.body.retentionDays,RETENTION_DAYS);
    assertNoMarkers(listing.text,'admin/request-logs');
    const first=listing.body.logs.at(-1);assert.equal(first.path,'/api/v1/modules/clients/records');assert.equal(first.detail.operation,'module.clients.create');assert.equal(first.detail.correlationId,created.headers.get(REQUEST_ID_HEADER));
    const errors=await a('admin/request-logs?errorsOnly=1');assert.equal(errors.body.total,4);
    const byCorrelation=await a(`admin/request-logs?q=${created.headers.get(REQUEST_ID_HEADER)}`);assert.equal(byCorrelation.body.total,1);assert.equal(byCorrelation.body.logs[0].detail.operation,'module.clients.create');
    assert.equal((await a('admin/request-logs?q=module.clients')).body.total,5);
    assert.equal((await a(`admin/request-logs?q=${encodeURIComponent('ZZMARK')}`)).body.total,0);
    assert.equal((await viewer('admin/request-logs')).status,403);
  }finally{db.close();}
});

test('MCP HTTP, WebMCP proxy and assistant rows keep tool, operation, JSON-RPC method and error semantics without arguments',async()=>{
  const {db,org,a}=await setup();try{
    const created=await a('/api/mcp',{method:'POST',body:rpc('lite_clients_create',{data:{name:markers.name,email:markers.email,status:'Actif',notes:markers.note}})});
    assert.equal(created.status,200);assert.equal(created.body.result.isError,undefined,created.text);const id=created.body.result.structuredContent.record.id;
    const failed=await a('/api/mcp',{method:'POST',body:rpc('lite_clients_get',{recordId:markers.segment})});assert.equal(failed.body.result.isError,true,failed.text);
    const unknown=await a('/api/mcp',{method:'POST',body:rpc(markers.tool,{token:markers.token})});assert.ok(unknown.body.error);
    const malicious=await a('/api/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:markers.method,params:{name:markers.tool}}});assert.ok(malicious.body.error);
    assert.equal((await a('/api/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'}})).status,200);
    assert.equal((await a('/api/mcp',{method:'POST',rawBody:'{"jsonrpc":"2.0","id":1,"method":"'+markers.method})).status,400);
    const proxied=await a('mcp/call',{method:'POST',body:{name:'lite_clients_update',arguments:{recordId:id,data:{name:markers.name+' proxy',email:markers.email,status:'Actif',notes:markers.note},version:1}}});assert.equal(proxied.status,200,proxied.text);
    assert.equal((await a('mcp/call',{method:'POST',body:{name:markers.tool,arguments:{secret:markers.token}}})).status,403);
    assertNoMarkers(stored(db),'lite_request_logs');
    const all=rows(db),details=all.map(r=>JSON.parse(r.detail_json));
    assert.equal(all.length,8);assert.ok(all.slice(0,6).every(r=>r.source==='mcp'&&r.path==='/api/mcp'&&r.method==='POST'));
    assert.deepEqual([details[0].jsonrpcMethod,details[0].tool,details[0].operation,details[0].ok,details[0].calls],['tools/call','lite_clients_create','module.clients.create',true,undefined]);
    assert.deepEqual([details[1].tool,details[1].operation,details[1].ok,details[1].error],['lite_clients_get','module.clients.get',false,'tool_error']);assert.equal(all[1].status,200);
    assert.deepEqual([details[2].tool,details[2].ok,details[2].error,details[2].operation],[UNKNOWN_TOOL,false,'-32602',undefined]);
    assert.deepEqual([details[3].jsonrpcMethod,details[3].tool,details[3].ok,details[3].error],['unknown',UNKNOWN_TOOL,false,'-32601']);
    assert.deepEqual([details[4].jsonrpcMethod,details[4].ok,details[4].tool],['tools/list',true,undefined]);
    assert.deepEqual([details[5].jsonrpcMethod,details[5].ok,details[5].error],['unknown',false,'-32700']);
    assert.equal(all[6].path,'/api/v1/mcp/call');assert.deepEqual([details[6].operation,details[6].tool,details[6].ok,details[6].calls],['mcp.tools.call','lite_clients_update',true,[{operation:'module.clients.update',status:200}]]);
    assert.deepEqual([details[7].operation,details[7].tool,details[7].ok,details[7].error],['mcp.tools.call',UNKNOWN_TOOL,false,'tool_forbidden']);
    const listing=await a('admin/request-logs?source=mcp');assert.equal(listing.body.total,6);assertNoMarkers(listing.text,'admin/request-logs');
    assert.equal((await a('admin/request-logs?source=mcp&errorsOnly=1')).body.total,4);
    assert.equal((await a('admin/request-logs?q=lite_clients_update')).body.total,1);
    assert.equal((await a('admin/request-logs?q=module.clients.update')).body.total,1);
    const metrics=await a('admin/mcp/metrics');assert.equal(metrics.body.requests,6);assert.equal(metrics.body.errors,4);
    // Assistant turns are logged by their catalogue operation only; the conversation trace keeps the tool history.
    const chat=await a('assistant/chat',{method:'POST',body:{messages:[{role:'user',content:markers.note}],model:'missing::model'}});assert.ok(chat.status>=400);
    const last=rows(db).at(-1),detail=JSON.parse(last.detail_json);assert.equal(last.path,'/api/v1/assistant/chat');assert.equal(detail.operation,'assistant.chat');assert.equal(detail.ok,false);assertNoMarkers(stored(db),'lite_request_logs');
    assert.equal(operationCatalog({db,user:alice,workspace:{id:org,name:'',role:'owner'}},app).some(o=>o.id===detail.operation),true);
  }finally{db.close();}
});

test('API keys are logged by credential kind and workspaces never see each other\'s rows or counts',async()=>{
  const {db,org,other,a,b}=await setup();try{
    const issued=await a('access-tokens',{method:'POST',body:{name:'Clé de test',mode:'write',days:7}});assert.equal(issued.status,201);
    const machine=caller(db,null,org,app,issued.body.token);
    assert.equal((await machine('modules/clients/records',{method:'POST',body:{data:{name:markers.name,email:markers.email,status:'Actif'}}})).status,201);
    assert.equal((await b('modules/clients/records',{method:'POST',body:{data:{name:'Autre espace '+markers.name,email:markers.email,status:'Actif'}}})).status,201);
    assertNoMarkers(stored(db),'lite_request_logs');
    const keyRow=rows(db).find(r=>JSON.parse(r.detail_json).credential==='api_key');assert.ok(keyRow);assert.equal(keyRow.org_id,org);assert.equal(keyRow.user_id,alice.userId);
    const mine=await a('admin/request-logs'),theirs=await b('admin/request-logs');
    assert.ok(mine.body.logs.every(l=>l.detail.operation!==undefined));assert.equal(mine.body.logs.some(l=>l.detail.credential==='api_key'),true);
    assert.equal(theirs.body.total,1);assert.equal(theirs.body.logs[0].detail.credential,'session');
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM lite_request_logs WHERE org_id=?').get(other).n,1);
    assert.equal((await b('admin/request-logs?q=module.clients.create')).body.total,1);assert.equal((await a('admin/request-logs?q=module.clients.create')).body.total,1);
    assert.equal((await a('admin/request-logs?q='+issued.body.token)).body.total,0);
  }finally{db.close();}
});

test('retention of 30 days and the 1000-row ceiling are enforced on read and on every write',async()=>{
  const {db,org,other,a}=await setup();try{
    const insert=db.raw.prepare('INSERT INTO lite_request_logs(id,org_id,user_id,source,method,path,status,duration_ms,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
    const fresh=JSON.stringify({ok:true,operation:'tasks.list',correlationId:crypto.randomUUID(),credential:'session'});
    const old=new Date(Date.now()-(RETENTION_DAYS+1)*86400000).toISOString(),recent=new Date(Date.now()-(RETENTION_DAYS-1)*86400000).toISOString();
    insert.run('expired-row',org,alice.userId,'api','GET','/api/v1/tasks',200,3,fresh,old);
    insert.run('recent-row',org,alice.userId,'api','GET','/api/v1/tasks',200,3,fresh,recent);
    insert.run('foreign-expired',other,bob.userId,'api','GET','/api/v1/tasks',200,3,fresh,old);
    const before=await a('admin/request-logs');assert.equal(before.body.total,1);assert.equal(before.body.logs[0].id,'recent-row');
    assert.equal((await a('tasks')).status,200);
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM lite_request_logs WHERE id=?').get('expired-row').n,0,'expired rows are removed by the next write');
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM lite_request_logs WHERE id=?').get('foreign-expired').n,1,'other workspaces are untouched by this write');
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM lite_request_logs WHERE id=?').get('recent-row').n,1);
    const base=Date.now()-3600000;
    db.raw.exec('BEGIN');for(let i=0;i<CAPACITY+20;i++)insert.run(`bulk-${String(i).padStart(5,'0')}`,org,alice.userId,'api','GET','/api/v1/tasks',200,1,fresh,new Date(base+i*1000).toISOString());db.raw.exec('COMMIT');
    assert.equal((await a('tasks')).status,200);
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM lite_request_logs WHERE org_id=?').get(org).n,CAPACITY);
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM lite_request_logs WHERE id IN (?,?)').get('recent-row','bulk-00000').n,0,'the oldest rows leave first');
    assert.equal((await a('admin/request-logs?limit=1000')).body.total,CAPACITY);
  }finally{db.close();}
});

test('rows written before the minimisation never expose their stored payloads through the listing or its search',async()=>{
  const {db,org,a}=await setup();try{
    const insert=db.raw.prepare('INSERT INTO lite_request_logs(id,org_id,user_id,source,method,path,status,duration_ms,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
    const legacy=JSON.stringify({query:{q:markers.query},body:{data:{name:markers.name,email:markers.email,notes:markers.note}},ok:true,userId:alice.userId,nested:{deep:{cookie:markers.cookie}}});
    insert.run('legacy-api',org,alice.userId,'api','POST','/api/v1/modules/clients/records',201,7,legacy,new Date().toISOString());
    insert.run('legacy-mcp',org,alice.userId,'mcp','POST','/api/mcp',200,7,JSON.stringify({jsonrpcMethod:'tools/call',tool:markers.tool,args:{token:markers.token,name:markers.name},ok:false,error:markers.name}),new Date().toISOString());
    insert.run('legacy-path',org,alice.userId,'api','GET','/api/v1/'+markers.segment,404,7,JSON.stringify({query:{},ok:false,error:'not_found',jsonrpcMethod:markers.method}),new Date().toISOString());
    insert.run('legacy-empty',org,alice.userId,'api','ZZMARK',UNKNOWN_ROUTE,500,7,'{}',new Date().toISOString());
    const listing=await a('admin/request-logs');assert.equal(listing.status,200);assert.equal(listing.body.total,4);
    assertNoMarkers(listing.text,'admin/request-logs');
    const byId=Object.fromEntries(listing.body.logs.map(l=>[l.id,l]));
    assert.deepEqual(byId['legacy-api'].detail,{ok:true,legacy:true});assert.equal(byId['legacy-api'].path,'/api/v1/modules/clients/records');
    assert.deepEqual(byId['legacy-mcp'].detail,{ok:false,error:'error',jsonrpcMethod:'tools/call',legacy:true});assert.equal(byId['legacy-mcp'].path,'/api/mcp');
    assert.deepEqual(byId['legacy-path'].detail,{ok:false,error:'not_found',jsonrpcMethod:'unknown',legacy:true});assert.equal(byId['legacy-path'].path,UNKNOWN_ROUTE);
    assert.deepEqual(byId['legacy-empty'].detail,{ok:false,legacy:true});assert.equal(byId['legacy-empty'].method,'OTHER');
    for(const q of [markers.name,markers.query,markers.tool,'zzmark','records','tools/call','not_found'])assert.equal((await a('admin/request-logs?q='+encodeURIComponent(q))).body.total,0,q);
    assert.equal((await a('admin/request-logs?errorsOnly=1')).body.total,3);
    assert.ok(db.raw.prepare('SELECT detail_json FROM lite_request_logs WHERE id=?').get('legacy-api').detail_json.includes(markers.name),'business data and stored rows are not rewritten by a read');
  }finally{db.close();}
});

// Values that look like identifiers but are personal data: a phone number, a name, a token. None of them is a runtime code.
const forbiddenCodes=['0612345678','AliceDupont','PrivateToken_Abc123'];
const validCodes=['record_not_found','operation_forbidden','permission_denied','not_found','tool_error','-32602','http_405'];

test('error codes are taken from the closed runtime list when a row is written; anything else becomes the generic code',async()=>{
  const {db,org}=await setup();try{
    for(const code of forbiddenCodes)assert.equal(errorCode(code),GENERIC_ERROR_CODE,code);
    for(const code of validCodes)assert.equal(errorCode(code),code,code);
    assert.equal(errorCode(-32602),'-32602');assert.equal(errorCode(-1),GENERIC_ERROR_CODE);assert.equal(errorCode('http_999'),GENERIC_ERROR_CODE);assert.equal(errorCode('Error'),GENERIC_ERROR_CODE);assert.equal(errorCode(''),GENERIC_ERROR_CODE);assert.equal(errorCode(undefined),GENERIC_ERROR_CODE);
    const operations=operationCatalog({db,user:alice,workspace:{id:org,name:'',role:'owner'}},app),c={app,env:{DB:db},identity:alice,operations},workspace={id:org,name:'',role:'owner'};
    const write=async(source,response,jsonrpcMethod)=>{const trace={...newRequestTrace(),operation:source==='api'?'tasks.list':undefined,...(jsonrpcMethod?{jsonrpcMethod}:{})};
      await persistRequestLog(new Request(source==='mcp'?'https://test.example/api/mcp':'https://test.example/api/v1/tasks',{method:'POST'}),response,c,workspace,source,performance.now(),trace);return JSON.parse(rows(db).at(-1).detail_json);};
    // The three response shapes the runtime produces, each carrying a forbidden value where a code is expected.
    const shapes=[
      code=>['api',Response.json({error:{code,message:'Refusé.'}},{status:400})],
      code=>['api',Response.json({ok:false,error:'Refusé.',code},{status:403})],
      code=>['api',Response.json({ok:false,error:code},{status:404})],
      code=>['mcp',Response.json({jsonrpc:'2.0',id:1,error:{code,message:'Refusé.'}}),'tools/call'],
    ];
    for(const code of forbiddenCodes)for(const shape of shapes){const detail=await write(...shape(code));assert.equal(detail.ok,false);assert.equal(detail.error,GENERIC_ERROR_CODE,code);}
    for(const code of forbiddenCodes)assert.equal(stored(db).includes(code),false,`${code} persisted`);
    assert.equal((await write('api',Response.json({error:{code:'record_not_found',message:'Introuvable.'}},{status:404}))).error,'record_not_found');
    assert.equal((await write('api',Response.json({ok:false,error:'Refusé.',code:'permission_denied'},{status:403}))).error,'permission_denied');
    assert.equal((await write('api',Response.json({ok:false,error:'not_found'},{status:404}))).error,'not_found');
    assert.equal((await write('mcp',Response.json({jsonrpc:'2.0',id:1,error:{code:-32602,message:'Outil inconnu.'}}),'tools/call')).error,'-32602');
    assert.equal((await write('mcp',Response.json({jsonrpc:'2.0',id:1,result:{isError:true,content:[{type:'text',text:markers.name}]}}),'tools/call')).error,'tool_error');
    assert.equal((await write('mcp',new Response(null,{status:405,headers:{Allow:'POST'}}))).error,'http_405');
    assert.equal((await write('api',new Response(markers.name,{status:500,headers:{'content-type':'text/plain'}}))).error,'http_500');
    assert.equal((await write('api',Response.json({error:{code:'record_not_found'}},{status:404}))).ok,false);
    const listing=await caller(db,alice,org)('admin/request-logs?errorsOnly=1');assert.equal(listing.status,200);assert.equal(listing.body.total,rows(db).length);
    for(const code of forbiddenCodes)assert.equal(listing.text.includes(code),false,code);
    assertNoMarkers(listing.text,'admin/request-logs');
    assert.deepEqual([...new Set(listing.body.logs.map(l=>l.detail.error))].sort(),[...new Set(['error','record_not_found','permission_denied','not_found','-32602','tool_error','http_405','http_500'])].sort());
  }finally{db.close();}
});

test('error codes stored by earlier versions or forged rows are projected through the same closed list',async()=>{
  const {db,org,a}=await setup();try{
    const insert=db.raw.prepare('INSERT INTO lite_request_logs(id,org_id,user_id,source,method,path,status,duration_ms,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
    let n=0;const now=()=>new Date(Date.now()+ ++n).toISOString();
    forbiddenCodes.forEach((code,i)=>{
      insert.run(`legacy-${i}`,org,alice.userId,'api','POST','/api/v1/tasks',400,5,JSON.stringify({body:{title:code},ok:false,error:code,userId:alice.userId}),now());
      insert.run(`current-${i}`,org,alice.userId,'api','POST','/api/v1/tasks',400,5,JSON.stringify({ok:false,error:code,operation:'tasks.create',correlationId:crypto.randomUUID(),credential:'session'}),now());
    });
    insert.run('legacy-valid',org,alice.userId,'api','GET','/api/v1/tasks/abc',404,5,JSON.stringify({query:{},ok:false,error:'not_found',userId:alice.userId}),now());
    insert.run('legacy-rpc',org,alice.userId,'mcp','POST','/api/mcp',200,5,JSON.stringify({jsonrpcMethod:'tools/call',tool:'lite_tasks_get',args:{recordId:'x'},ok:false,error:'-32601'}),now());
    insert.run('current-valid',org,alice.userId,'api','POST','/api/v1/tasks',403,5,JSON.stringify({ok:false,error:'operation_forbidden',operation:'tasks.create',correlationId:crypto.randomUUID(),credential:'api_key'}),now());
    insert.run('current-forged',org,alice.userId,'api','POST','/api/v1/'+forbiddenCodes[1],400,5,JSON.stringify({ok:false,error:forbiddenCodes[0],operation:forbiddenCodes[0],tool:forbiddenCodes[1],jsonrpcMethod:forbiddenCodes[2],calls:[{operation:forbiddenCodes[2],status:400}],correlationId:crypto.randomUUID(),credential:'session'}),now());
    const catalog=operationCatalog({db,user:alice,workspace:{id:org,name:'',role:'owner'}},app);
    for(const row of db.raw.prepare('SELECT id,created_at AS ts,source,method,path,status,duration_ms AS durationMs,detail_json FROM lite_request_logs').all()){
      const projected=projectRequestLog(row,catalog);
      if(row.id.startsWith('legacy-')||row.id.startsWith('current-'))for(const code of forbiddenCodes)assert.equal(JSON.stringify(projected).includes(code),false,`${row.id} exposes ${code}`);
      if(/^(?:legacy|current)-\d$/.test(row.id))assert.equal(projected.detail.error,GENERIC_ERROR_CODE,row.id);
    }
    const listing=await a('admin/request-logs');assert.equal(listing.status,200);assert.equal(listing.body.total,10);
    for(const code of forbiddenCodes)assert.equal(listing.text.includes(code),false,code);
    const forged=listing.body.logs.find(l=>l.id==='current-forged');assert.equal(forged.path,UNKNOWN_ROUTE);assert.deepEqual(Object.keys(forged.detail).sort(),['correlationId','credential','error','jsonrpcMethod','ok']);assert.equal(forged.detail.error,GENERIC_ERROR_CODE);assert.equal(forged.detail.jsonrpcMethod,'unknown');
    const byId=Object.fromEntries(listing.body.logs.map(l=>[l.id,l]));
    forbiddenCodes.forEach((_,i)=>{assert.deepEqual(byId[`legacy-${i}`].detail,{ok:false,error:GENERIC_ERROR_CODE,legacy:true});assert.equal(byId[`current-${i}`].detail.error,GENERIC_ERROR_CODE);assert.equal(byId[`current-${i}`].detail.operation,'tasks.create');});
    assert.deepEqual(byId['legacy-valid'].detail,{ok:false,error:'not_found',legacy:true});assert.equal(byId['legacy-valid'].path,'/api/v1/modules/tasks/:id');
    assert.deepEqual(byId['legacy-rpc'].detail,{ok:false,error:'-32601',jsonrpcMethod:'tools/call',legacy:true});
    assert.equal(byId['current-valid'].detail.error,'operation_forbidden');assert.equal(byId['current-valid'].detail.credential,'api_key');
    for(const code of [...forbiddenCodes,'alicedupont','0612']){const search=await a('admin/request-logs?q='+encodeURIComponent(code));assert.equal(search.status,200);assert.equal(search.body.total,0,code);}
    assert.equal((await a('admin/request-logs?q=operation_forbidden')).body.total,1);assert.equal((await a('admin/request-logs?q=tasks.create')).body.total,4);assert.equal((await a(`admin/request-logs?q=${GENERIC_ERROR_CODE}`)).body.total,4);
    assert.equal((await a('admin/request-logs?q=tasks.create&limit=2&offset=3')).body.logs.length,1);
  }finally{db.close();}
});

test('every error code raised by the runtime sources belongs to the closed list',async()=>{
  const files=[];async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(['node_modules','dist'].includes(entry.name))continue;const path=join(dir,entry.name);if(entry.isDirectory())await walk(path);else if(/\.(?:ts|tsx|mjs)$/.test(entry.name))files.push(path);}}
  await walk(join(root,'runtime'));
  const found=new Map();
  for(const file of files){const source=await readFile(file,'utf8');
    for(const match of source.matchAll(/(?:\bfail|new ApiError)\(\s*[^,'()]+,\s*(?:[^,'()]{0,40}\?\s*)?'([a-z][a-z0-9_]*)'/g))found.set(match[1],file);
    if(/\/runtime\/modules\/[^/]+\/src\//.test(file))for(const match of source.matchAll(/\bok:\s*false,\s*error:\s*["']([a-z][a-z0-9_]*)["']/g))found.set(match[1],file);
  }
  assert.ok(found.size>150,`only ${found.size} codes found`);
  const missing=[...found].filter(([code])=>!KNOWN_ERROR_CODES.has(code));
  assert.deepEqual(missing,[],'codes raised by the runtime but absent from KNOWN_ERROR_CODES');
  for(const code of forbiddenCodes)assert.equal(KNOWN_ERROR_CODES.has(code),false);
  assert.equal(KNOWN_ERROR_CODES.has(GENERIC_ERROR_CODE),true);assert.equal(KNOWN_ERROR_CODES.has('http_99'),false);assert.equal(KNOWN_ERROR_CODES.has('http_600'),false);
});

test('diagnostic builder and projection collapse anything outside the closed vocabulary',()=>{
  const catalog=operationCatalog({db:null,user:alice,workspace:{id:'w',name:'',role:'owner'}},app);
  assert.equal(errorCode('not_found'),'not_found');assert.equal(errorCode(-32601),'-32601');assert.equal(errorCode(markers.name),'error');assert.equal(errorCode('x'.repeat(65)),'error');assert.equal(errorCode({code:'a'}),'error');assert.equal(errorCode('looks_like_a_code'),'error');
  assert.equal(jsonrpcLabel('tools/call'),'tools/call');assert.equal(jsonrpcLabel(markers.method),'unknown');assert.equal(jsonrpcLabel(undefined),'unknown');
  const trace={...newRequestTrace('oauth'),operation:'module.clients.create',tool:markers.tool,jsonrpcMethod:markers.method,calls:[{operation:'tasks.list',status:200},{operation:markers.name,status:200},{operation:'tasks.create',status:'201'}]};
  const diagnostic=buildDiagnostic(catalog,trace,false,markers.email);
  assert.deepEqual(diagnostic,{ok:false,error:'error',operation:'module.clients.create',tool:markers.tool,jsonrpcMethod:'unknown',calls:[{operation:'tasks.list',status:200}],correlationId:trace.correlationId,credential:'oauth'});
  assert.deepEqual(buildDiagnostic(catalog,{correlationId:'forged',credential:'admin',operation:markers.name,tool:'Jean',calls:[]},true).credential,'session');
  assert.match(buildDiagnostic(catalog,{correlationId:'forged',credential:'session',calls:[]},true).correlationId,uuid);
  assertNoMarkers(JSON.stringify(buildDiagnostic(catalog,{correlationId:markers.token,credential:'session',operation:markers.name,tool:markers.name,jsonrpcMethod:markers.method,calls:[{operation:markers.name,status:200}]},false,markers.name)),'buildDiagnostic');
  const row={id:'r',ts:'2026-01-01T00:00:00.000Z',source:'api',method:'GET',path:'/api/v1/'+markers.segment,status:200,durationMs:1,detail_json:JSON.stringify({ok:true,operation:markers.name,tool:'Jean Dupont',calls:[{operation:markers.name,status:200}],correlationId:crypto.randomUUID(),credential:'session',body:{name:markers.name},error:markers.email})};
  const projected=projectRequestLog(row,catalog);assertNoMarkers(JSON.stringify(projected),'projectRequestLog');
  assert.equal(projected.path,UNKNOWN_ROUTE);assert.deepEqual(Object.keys(projected.detail).sort(),['correlationId','credential','error','ok']);assert.equal(projected.detail.error,'error');
});
