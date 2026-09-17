import test from 'node:test';
import assert from 'node:assert/strict';
import './register-native-loader.mjs';
import {app as originalApp,alice,eve,boot,client,localDb,fakeBucket,clientData} from './helpers.mjs';
const {dispatchRequest}=await import('../runtime/modules/sites-adapter/src/dispatch.ts');
const {operationCatalog}=await import('../runtime/modules/sites-adapter/src/catalog.ts');
import {command} from '../runtime/core/commands.ts';
import {coreOperations,operationAllowed} from '../runtime/core/operations.ts';
import {handleApi} from '../runtime/core/api.ts';
import {createRequestAccessContext,disposeRequestAccessContext} from '../runtime/core/access-profiles-store.ts';
import {resolveScope,recordScope,fileScope} from '../runtime/core/scope.ts';
import {fail} from '../runtime/core/validation.ts';
const app={...originalApp,modules:originalApp.modules.map(m=>m.id==='clients'?{...m,fields:[...m.fields,{key:'discount_percent',label:'Discount',type:'number'}]}:m)};
const checkPrice=({data,previous,access})=>{if(data.discount_percent!==previous?.discount_percent&&!access?.evaluateAccess({kind:'capability',capabilityId:'catalog.price.edit'}).allowed)fail(403,'operation_forbidden','Exact price capability required.');};
const priceCommand=command({moduleId:'clients',name:'price',description:'Set protected price fixture',target:'module',idempotencyKey:'none',fields:{discount_percent:{type:'number'}},required:['discount_percent'],handle:async ctx=>{checkPrice({data:ctx.body,previous:{discount_percent:0},access:ctx.access});return {body:{ok:true}};}});
const operationIds=['module.clients.list','module.clients.get','module.clients.create','module.clients.update','module.clients.archive','files.list','files.get','files.download','files.delete','dashboard.get','search.query','mail.meta','assistant.chat','assistant.browser.socket',priceCommand.operation.id];
const declaration={catalogRevision:'surfaces-v1',capabilities:[{id:'ordinary',operations:operationIds},{id:'catalog.price.edit',operations:['module.clients.update',priceCommand.operation.id]}],profiles:[{id:'ordinary',revision:1,capabilities:['ordinary'],receivableBy:['owner','admin','member'],assignableBy:['owner'],assignmentApproval:'owner'},{id:'price',revision:1,capabilities:['catalog.price.edit'],receivableBy:['owner','admin','member'],assignableBy:['owner'],assignmentApproval:'owner'}]};
const rec=(price=false)=>({catalogRevision:declaration.catalogRevision,bindings:[{groupId:'fixture',profileId:'ordinary',profileRevision:1},...(price?[{groupId:'fixture',profileId:'price',profileRevision:1}]:[])]});
async function fixture(fn){const db=await localDb(),bucket=fakeBucket();try{
 const org=await boot(client(db,alice,bucket,app));await boot(client(db,eve,bucket,app));db.raw.prepare("INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,'member')").run(org,eve.userId);
 db.raw.prepare('INSERT INTO lite_access_groups(org_id,id,name,members_json,version,created_at) VALUES(?,?,?,?,1,?)').run(org,'fixture','Fixture',JSON.stringify(['alice','eve']),new Date().toISOString());
 const seed=client(db,alice,bucket,app),visible=(await seed('modules/clients/records?workspace='+org,{method:'POST',body:{data:{...clientData,name:'Visible document',discount_percent:0}}})).body.record.id,hidden=(await seed('modules/clients/records?workspace='+org,{method:'POST',body:{data:{...clientData,name:'Invisible needleword',discount_percent:0}}})).body.record.id;
 for(const id of ['file-visible','file-hidden']){db.raw.prepare('INSERT INTO lite_files(id,org_id,name,object_key,size,content_type,created_by,created_at) VALUES(?,?,?,?,1,?,?,?)').run(id,org,id,id,'text/plain','alice',new Date().toISOString());await bucket.put(id,new Uint8Array([1]));}
 const seen=[];const scope={recordFilter:(p,r,a,access)=>{seen.push(access);return{sql:r.alias+'.'+r.idColumn+'<>?',bindings:[hidden]};},fileFilter:(p,r,a,access)=>{seen.push(access);return{sql:r.alias+'.'+r.idColumn+'<>?',bindings:['file-hidden']};}};
 const options={access:declaration,operations:[priceCommand],scope,beforeWrite:checkPrice};
 const setReceipt=(value=rec())=>db.raw.prepare('INSERT INTO lite_access_receipts(org_id,receipt_json,version,updated_at) VALUES(?,?,1,?) ON CONFLICT(org_id) DO UPDATE SET receipt_json=excluded.receipt_json,version=version+1').run(org,JSON.stringify(value),new Date().toISOString());
 const call=async(path,{method='GET',body,identity=alice,extra={},raw=false,headers={}}={})=>{const url=new URL(path.startsWith('/api/')?path:'/api/v1/'+path,'https://test.example');url.searchParams.set('workspace',org);const req=new Request(url,{method,headers:{origin:url.origin,accept:'application/json, text/event-stream',...headers,...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});const response=await dispatchRequest(req,{app,env:{DB:db,BUCKET:bucket},identity},{...options,...extra});return raw?response:{status:response.status,body:await response.json()};};
 await fn({db,bucket,org,visible,hidden,scope,seen,options,setReceipt,call});
}finally{db.close();}}

test('incomplete owner discovery is filtered and business execution is denied',async()=>fixture(async({call})=>{
 for(const path of ['modules','registry','openapi.json','modules/nav']){const r=await call(path);assert.equal(r.status,200,JSON.stringify(r));const text=JSON.stringify(r.body);assert.equal(text.includes('/modules/clients'),false,path);if(path==='modules')assert.deepEqual(r.body.modules,[]);}
 const me=await call('auth/me');assert.equal(me.status,200);assert.equal(me.body.permissions.includes('module.clients.read'),false);assert.equal(me.body.permissions.includes('platform.access.manage'),true);
 assert.equal((await call('modules/clients/records')).status,403);assert.equal((await call('email/meta')).status,403);assert.equal((await call('access/catalog')).status,200);
}));

test('discovery keeps explicit operation and module denies for owners',async()=>fixture(async({db,org,call,setReceipt})=>{
 setReceipt();for(const operationId of ['modules.list','module:core']){db.raw.prepare("INSERT INTO lite_api_policies(org_id,group_id,operation_id,effect) VALUES(?,'fixture',?,'deny')").run(org,operationId);assert.equal((await call('modules')).status,403);db.raw.prepare('DELETE FROM lite_api_policies WHERE org_id=?').run(org);}
 db.raw.prepare("INSERT INTO lite_api_policies(org_id,group_id,operation_id,effect) VALUES(?,'fixture','module.clients.list','deny')").run(org);assert.deepEqual((await call('modules')).body.modules,[]);assert.equal((await call('modules/clients/records')).status,403);
}));

test('owner row/file scope applies to list count detail dashboard download and audit search',async()=>fixture(async({db,org,call,setReceipt,visible,hidden,seen})=>{
 setReceipt();let r=await call('modules/clients/records');assert.equal(r.status,200);assert.equal(JSON.stringify(r.body).includes(hidden),false);assert.equal(JSON.stringify(r.body).includes(visible),true);
 assert.equal((await call('modules/clients/records/'+hidden)).status,404);assert.equal((await call('files/file-hidden/metadata')).status,404);assert.equal((await call('files/file-hidden',{raw:true})).status,404);assert.equal((await call('files/file-visible',{raw:true})).status,200);
 r=await call('dashboard');assert.equal(r.body.modules.find(m=>m.id==='clients').count,1);
 r=await call('audit');assert.equal(r.status,200);assert.equal(JSON.stringify(r.body).includes(hidden),false);
 const hiddenAudit=db.raw.prepare('SELECT id FROM lite_audit WHERE org_id=? AND resource_id=?').get(org,hidden).id;assert.equal((await call('audit/'+hiddenAudit)).status,404);
 r=await call('search?q=needleword');assert.equal(r.status,200);assert.equal(JSON.stringify(r.body).includes(hidden),false);
 r=await call('search?q='+hidden);assert.equal(r.status,200);assert.equal(JSON.stringify(r.body).includes(hidden),false);
 assert.ok(seen.length>0);assert.ok(seen.every(x=>x&&typeof x.evaluateAccess==='function'));assert.ok(seen.every(x=>!x.evaluateAccess({kind:'operation',operationId:'module.clients.list'}).allowed));
}));

test('exact BeforeWrite capability is required over HTTP CRUD and command API/MCP',async()=>fixture(async({call,setReceipt,visible,db,org})=>{
 setReceipt();const update={method:'PATCH',body:{data:{...clientData,discount_percent:15},version:1}};
 assert.equal((await call('modules/clients/records/'+visible,update)).status,403);
 assert.equal((await call(priceCommand.operation.path,{method:'POST',body:{discount_percent:15}})).status,403);
 let r=await call('mcp/call',{method:'POST',body:{name:priceCommand.operation.toolName,arguments:{body:{discount_percent:15}}}});assert.equal(r.status,403,JSON.stringify(r));
 r=await call('mcp/call',{method:'POST',body:{name:'lite_clients_update',arguments:{recordId:visible,...update.body}}});assert.equal(r.status,403);
 assert.equal(db.raw.prepare('SELECT version FROM lite_records WHERE id=?').get(visible).version,1);
 setReceipt(rec(true));assert.equal((await call('modules/clients/records/'+visible,update)).status,200);
 assert.equal((await call(priceCommand.operation.path,{method:'POST',body:{discount_percent:15}})).status,200);
 r=await call('mcp/call',{method:'POST',body:{name:priceCommand.operation.toolName,arguments:{body:{discount_percent:15}}}});assert.equal(r.status,200,JSON.stringify(r));
}));

test('receipt expiry and membership changes are observed by the next tool call',async()=>fixture(async({db,org,call,setReceipt})=>{
 setReceipt();let r=await call('mcp/tools');assert.ok(r.body.tools.some(t=>t.name==='lite_clients_list'));
 setReceipt({...rec(),validUntil:'2000-01-01T00:00:00Z'});r=await call('mcp/tools');assert.equal(r.body.tools.some(t=>t.name==='lite_clients_list'),false);
 r=await call('mcp/call',{method:'POST',body:{name:'lite_clients_list',arguments:{}}});assert.equal(r.status,403);
 setReceipt();db.raw.prepare("UPDATE lite_access_groups SET members_json='[]' WHERE org_id=? AND id='fixture'").run(org);assert.equal((await call('modules/clients/records')).status,403);
}));

test('ScopeProvider fails closed for omitted forged mismatched or disposed context; legacy has three args',async()=>fixture(async({db,org,setReceipt,scope})=>{
 setReceipt();const identity=alice,workspace={id:org,name:'Fixture',role:'owner'},request=new Request('https://test.example/api/v1/modules'),requestId='scope-fixture';
 const access=await createRequestAccessContext({db,request,requestId,workspace,identity,credential:{kind:'session'},declaration,catalog:operationCatalog({db,user:identity,workspace},app,[priceCommand])});
 const principal={userId:'alice',workspaceId:org,role:'owner',credential:'session'},bound=resolveScope(scope,access),ref={alias:'r',idColumn:'id',moduleColumn:'module_id'};
 assert.equal(recordScope(bound,principal,ref,'read').sql,'(0=1)');assert.equal(recordScope(bound,principal,ref,'read',{}).sql,'(0=1)');assert.equal(recordScope(bound,{...principal,userId:'eve'},ref,'read',access).sql,'(0=1)');assert.notEqual(recordScope(bound,principal,ref,'read',access).sql,'(0=1)');
 const wrong=await handleApi(request,{app,env:{DB:db},identity,workspace,requestId:'different',access},{access:declaration});assert.equal(wrong.status,403);
 disposeRequestAccessContext(access);assert.equal(fileScope(bound,principal,{alias:'f',idColumn:'id'},'read',access).sql,'(0=1)');
 let args;const legacy=resolveScope({recordFilter(...a){args=a;return{sql:'1=1',bindings:[]};},fileFilter(){return{sql:'1=1',bindings:[]};}});recordScope(legacy,principal,ref,'read');assert.equal(args.length,3);
}));

test('mail action discovery follows capabilities without owner bypass',async()=>fixture(async({call,setReceipt})=>{
 setReceipt();const r=await call('email/meta');assert.equal(r.status,200);assert.equal(r.body.canWrite,false);assert.equal((await call('email/drafts',{method:'POST',body:{subject:'No grant'}})).status,403);
}));

test('MCP JSON-RPC discovery and execution reuse effective permissions',async()=>fixture(async({call,setReceipt})=>{
 let r=await call('/api/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'}});assert.equal(r.status,200);assert.equal(r.body.result.tools.some(t=>t.name==='lite_clients_list'),false);
 setReceipt();r=await call('/api/mcp',{method:'POST',body:{jsonrpc:'2.0',id:2,method:'tools/list'}});assert.ok(r.body.result.tools.some(t=>t.name==='lite_clients_list'));
}));

test('file deletion receives live context only after filters and capabilities',async()=>fixture(async({call,setReceipt,scope,bucket})=>{
 setReceipt();let captured,calls=0;const extra={scope:{...scope,deleteFile:async ctx=>{calls++;captured=ctx.access;assert.equal(ctx.access.evaluateAccess({kind:'operation',operationId:'files.delete'}).allowed,true);return{cleanup:'complete'};}}};
 assert.equal((await call('files/file-hidden',{method:'DELETE',extra})).status,404);assert.equal(calls,0);assert.ok(bucket.store.has('file-hidden'));
 assert.equal((await call('files/file-visible',{method:'DELETE',extra})).status,200);assert.equal(calls,1);assert.equal(captured.evaluateAccess({kind:'operation',operationId:'files.delete'}).allowed,false);
}));

test('forged server context and disabled MCP binding cannot grant business access',async()=>fixture(async({db,org,call,setReceipt,visible})=>{
 assert.equal((await call('modules/clients/records?observedProfileIds=ordinary')).status,400);
 assert.equal((await call('modules/clients/records/'+visible,{method:'PATCH',body:{data:{...clientData,discount_percent:10},version:1,access:{evaluateAccess:true}}})).status,403);
 setReceipt();db.raw.prepare("INSERT INTO lite_mcp_policies(org_id,name,enabled,version) VALUES(?,'lite_clients_list',0,1)").run(org);assert.equal((await call('mcp/tools')).body.tools.some(t=>t.name==='lite_clients_list'),false);
 assert.equal((await call('mcp/call',{method:'POST',body:{name:'lite_clients_list',arguments:{}}})).status,403);
}));

test('binding never lifts a module writeRoles ceiling for a member',async()=>fixture(async({db,org,setReceipt,visible})=>{
 const restricted={...app,modules:app.modules.map(m=>m.id==='clients'?{...m,writeRoles:['owner']}:m)};
 const access={...declaration,capabilities:declaration.capabilities.map(c=>({...c,operations:c.operations.filter(id=>id!==priceCommand.operation.id)})),profiles:declaration.profiles.map(p=>({...p,receivableBy:['owner']}))};setReceipt(rec(true));
 const call=client(db,eve,undefined,restricted,{access,beforeWrite:checkPrice});const r=await call('modules/clients/records/'+visible+'?workspace='+org,{method:'PATCH',body:{data:{...clientData,discount_percent:25},version:1}});assert.equal(r.status,403);assert.equal(db.raw.prepare('SELECT version FROM lite_records WHERE id=?').get(visible).version,1);
}));

test('read-only machine context hides write tools and refuses mutation operation',async()=>fixture(async({db,org,setReceipt})=>{
 setReceipt();const {dataTools}=await import('../runtime/core/tools.ts');const workspace={id:org,name:'Fixture',role:'owner'},catalog=operationCatalog({db,user:alice,workspace},app,[priceCommand]),request=new Request('https://test.example/api/mcp');
 const access=await createRequestAccessContext({db,request,requestId:'machine',workspace,identity:alice,credential:{kind:'token',tokenId:'fixture-token',workspaceId:org,mode:'read'},declaration,catalog});
 try{const tools=dataTools(app,'owner',async()=>({}),true,{operations:catalog,workspace,access,machine:true});assert.ok(tools.some(t=>t.name==='lite_clients_list'));assert.equal(tools.some(t=>t.name==='lite_clients_update'),false);assert.equal(operationAllowed(catalog.find(o=>o.id==='module.clients.update'),workspace,access),false);}finally{disposeRequestAccessContext(access);}
}));

test('browser socket rechecks access after opening and closes on binding revocation',async()=>fixture(async({db,org,call,setReceipt})=>{
 setReceipt();const windowId='fixture-browser-window';db.raw.prepare('INSERT INTO lite_browser_sessions(org_id,user_id,kind,window_id,lease_until,path) VALUES(?,?,?,?,?,?)').run(org,'alice','desktop',windowId,new Date(Date.now()+60000).toISOString(),'/clients');
 const OriginalResponse=globalThis.Response,OriginalPair=globalThis.WebSocketPair;let server;
 class TestResponse extends OriginalResponse{constructor(body,init){super(body,init?.status===101?{...init,status:200}:init);}}
 class TestPair{constructor(){this[0]={};server=this[1]={events:{},sent:[],closeCode:null,accept(){},send(x){this.sent.push(x);},close(code){this.closeCode=code;},addEventListener(event,fn){this.events[event]=fn;}};}}
 globalThis.Response=TestResponse;globalThis.WebSocketPair=TestPair;
 try{const r=await call('assistant/browser/socket?windowId='+windowId,{raw:true,headers:{upgrade:'websocket'}});assert.equal(r.status,200);assert.ok(server?.events.message);
 db.raw.prepare("UPDATE lite_access_groups SET members_json='[]' WHERE org_id=? AND id='fixture'").run(org);await server.events.message({data:JSON.stringify({type:'pulse'})});assert.equal(server.closeCode,1008);assert.deepEqual(server.sent.map(x=>JSON.parse(x).type),['error']);
 }finally{globalThis.Response=OriginalResponse;globalThis.WebSocketPair=OriginalPair;}
}));


test('orphan and removed-module audit identifiers stay hidden while native recovery remains visible',async()=>fixture(async({db,org,call,setReceipt})=>{
 for(const [id,action,resource]of [['orphan','removedmodule.update','secretorphan'],['task','task.update','secrettask'],['recovery','access.rebind',org]])db.raw.prepare('INSERT INTO lite_audit(id,org_id,user_id,action,resource_id,details,created_at) VALUES(?,?,?,?,?,?,?)').run(id,org,'alice',action,resource,'{}',new Date().toISOString());
 for(const adopted of [false,true]){if(adopted)setReceipt();const list=await call('audit');assert.equal(list.status,200);assert.equal(JSON.stringify(list.body).includes('secretorphan'),false);assert.equal(JSON.stringify(list.body).includes('secrettask'),false);assert.ok(list.body.items.some(x=>x.id==='recovery'));assert.equal((await call('audit/orphan')).status,404);}
 const searched=await call('search?q=secretorphan');assert.equal(searched.status,200);assert.equal(JSON.stringify(searched.body).includes('secretorphan'),false);
}));
