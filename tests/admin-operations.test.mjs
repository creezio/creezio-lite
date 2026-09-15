import './register-native-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {app,alice,bob,client,boot,localDb,clientData} from './helpers.mjs';
const {dispatchRequest}=await import('../runtime/modules/sites-adapter/src/dispatch.ts');
const {operationCatalog}=await import('../runtime/modules/sites-adapter/src/catalog.ts');
const {nativeMounts}=await import('../runtime/modules/sites-adapter/src/catalog.ts');

function caller(db,identity,org,definition=app,token){return async(path,{method='GET',body,headers={}}={})=>{
 const url=new URL(path.startsWith('/api/')?path:'/api/v1/'+path,'https://test.example');if(org)url.searchParams.set('workspace',org);
 const response=await dispatchRequest(new Request(url,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{origin:url.origin}),...(body?{'content-type':'application/json'}:{}),accept:'application/json',...headers},body:body?JSON.stringify(body):undefined}),{app:definition,env:{DB:db},identity});
 return {status:response.status,body:await response.json(),headers:response.headers};
};}
const rpc=(name,args={})=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});

test('administration: native and new modules register API, MCP, OpenAPI and permissions together',async()=>{
 const db=await localDb();try{
  const org=await boot(client(db,alice)),definition={...app,modules:[...app.modules,{id:'recettes',name:'Recettes',singular:'Recette',description:'Cuisine',titleField:'name',fields:[{key:'name',label:'Nom',type:'text',required:true}]}]};
  const call=caller(db,alice,org,definition),catalog=await call('admin/endpoints');assert.equal(catalog.status,200,JSON.stringify(catalog.body));
  const operations=operationCatalog({db,user:alice,workspace:{id:org,name:'',role:'owner'}},definition);
  for(const mount of nativeMounts({db,user:alice,workspace:{id:org,name:'',role:'owner'}},definition))for(const operation of mount.mount.operations??[])assert.ok(catalog.body.endpoints.some(e=>e.id===`${mount.id==='platform-support'?'support':mount.id}.${operation.id}`));
  assert.equal(new Set(catalog.body.endpoints.map(e=>`${e.method} ${e.path}`)).size,catalog.body.endpoints.length);
  const matrix=await call('access/catalog'),doc=await call('openapi.json'),list=await call('/api/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'}});
  assert.equal(list.status,200,JSON.stringify(list.body));
  for(const operation of operations){assert.ok(matrix.body.operations.some(o=>o.id===operation.id));assert.ok(doc.body.paths[operation.path.replace(/:([A-Za-z0-9_]+)/g,'{$1}')]);if(operation.mcp)assert.ok(list.body.result.tools.some(t=>t.name===operation.toolName),operation.id);}
  const created=await call('/api/mcp',{method:'POST',body:rpc('lite_tasks_create',{body:{title:'Tâche API complète',body:'Description'}})});assert.equal(created.body.result?.isError,undefined,JSON.stringify(created.body));assert.equal(created.body.result.structuredContent.task.title,'Tâche API complète');
  const taskId=created.body.result.structuredContent.task.id;
  assert.equal((await call('/api/mcp',{method:'POST',body:rpc('lite_tasks_get',{recordId:taskId})})).body.result.structuredContent.task.id,taskId);
  const recipe=await call('/api/mcp',{method:'POST',body:rpc('lite_recettes_create',{data:{name:'Soupe'}})});assert.equal(recipe.body.result.structuredContent.record.data.name,'Soupe');
  const tool=await call('admin/mcp/tools',{method:'POST',body:{name:'custom_recettes',operationId:'module.recettes.list',description:'Lister les recettes'}});assert.equal(tool.status,201);
  assert.equal((await call('/api/mcp',{method:'POST',body:rpc('custom_recettes')})).body.result.structuredContent.items.length,1);
  const policy=await call('admin/mcp/policies/custom_recettes',{method:'PATCH',body:{enabled:false,version:0}});assert.equal(policy.status,200);
  assert.ok((await call('/api/mcp',{method:'POST',body:rpc('custom_recettes')})).body.error);
  assert.equal((await call('mcp/call',{method:'POST',body:{name:'custom_recettes',arguments:{}}})).status,403);
  assert.equal((await call('admin/mcp/policies/custom_recettes',{method:'PATCH',body:{enabled:true,version:0}})).status,409);
  assert.equal((await call('admin/mcp/tools/custom_recettes',{method:'DELETE'})).status,200);
 }finally{db.close();}
});

test('group restrictions apply to native aliases, data, search, HTTP MCP, WebMCP and existing API keys',async()=>{
 const db=await localDb();try{
  const org=await boot(client(db,alice));await boot(client(db,bob));db.raw.prepare('INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,?)').run(org,bob.userId,'admin');
  const owner=caller(db,alice,org),member=caller(db,bob,org);
  await owner('modules/clients/records',{method:'POST',body:{data:clientData}});
  const issued=await member('access-tokens',{method:'POST',body:{name:'Existing connection',mode:'write',days:7}});assert.equal(issued.status,201);
  const machine=caller(db,null,org,app,issued.body.token);
  assert.equal((await machine('tasks',{method:'POST',body:{title:'Clé autorisée'}})).status,201);
  const group=(await owner('access/groups',{method:'POST',body:{name:'Achats'}})).body;
  assert.equal((await owner(`access/groups/${group.id}`,{method:'PUT',body:{name:'Achats',userIds:[bob.userId],version:1}})).status,200);
  const changes=['module.clients.list','tasks.list'].map(operationId=>({operationId,effect:'deny'}));
  assert.equal((await owner(`access/policies/${group.id}`,{method:'PUT',body:{changes,version:0}})).status,200);
  assert.equal((await member('modules/clients/records')).status,403);assert.equal((await machine('tasks')).status,403);assert.equal((await member('modules/tasks')).status,403);
  const found=await member('search?q=Atelier');assert.equal(found.status,200);assert.equal(found.body.items.filter(r=>r.index==='clients').length,0);
  assert.equal((await member('registry')).body.modules.some(m=>m.id==='clients'),false);
  const tools=(await machine('/api/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'}})).body.result.tools;assert.equal(tools.some(t=>t.name==='lite_clients_list'),false);
  assert.ok((await machine('/api/mcp',{method:'POST',body:rpc('lite_clients_list')})).body.error);
  assert.equal((await member('mcp/call',{method:'POST',body:{name:'lite_clients_list',arguments:{}}})).status,403);
  assert.equal((await owner('modules/clients/records')).status,200);
  assert.equal((await owner(`access/policies/${group.id}`,{method:'PUT',body:{version:1,changes:[{operationId:'session.me',effect:'deny'}]}})).status,403);
  assert.equal((await owner('access/policies/role:owner',{method:'PUT',body:{version:0,changes}})).status,403);
  assert.equal((await owner(`access/policies/${group.id}`,{method:'PUT',body:{version:0,changes}})).status,409);
  assert.equal((await owner(`access/policies/${group.id}`,{method:'PUT',body:{version:1,changes:changes.map(x=>({...x,effect:'inherit'}))}})).status,200);
  assert.equal((await machine('tasks')).status,200);
  assert.equal((await machine('access/catalog')).status,403);
  db.raw.prepare('DELETE FROM lite_members WHERE org_id=? AND user_id=?').run(org,bob.userId);
  assert.equal((await machine('tasks')).status,401);
 }finally{db.close();}
});

test('request logs and native usage analytics persist within the workspace without credentials',async()=>{
 const db=await localDb();try{
  const org=await boot(client(db,alice)),other=await boot(client(db,bob)),a=caller(db,alice,org),b=caller(db,bob,other);
  const event={eventType:'page.view',category:'navigation',label:'Dashboard',path:'/dashboard?token=private-value',sessionId:'session-1',createdAt:new Date().toISOString(),userId:'forged'};
  assert.equal((await a('analytics/events',{method:'POST',body:{events:[event]}})).status,200);
  assert.equal((await a('admin/analytics/overview')).body.totals.pageViews,1);assert.equal((await b('admin/analytics/overview')).body.totals.pageViews,0);
  for(const action of ['timeline','pages','clicks','users','events','productivity'])assert.equal((await a(`admin/analytics/${action}`)).status,200,action);
  const events=(await a('admin/analytics/events')).body.events;assert.equal(events[0].username,alice.displayName);assert.equal(events[0].path,'/dashboard');
  await a('/api/mcp',{method:'POST',body:rpc('missing_tool',{token:'lite_'+'a'.repeat(64)})});
  const logs=(await a('admin/request-logs?source=mcp&errorsOnly=1')).body;assert.equal(logs.logs.length,1);assert.equal(logs.logs[0].detail.tool,'missing_tool');assert.equal(JSON.stringify(logs).includes('a'.repeat(64)),false);
  assert.equal((await b('admin/request-logs')).body.total,0);
  assert.equal((await a('admin/analytics/events',{method:'DELETE'})).status,200);assert.equal((await a('admin/analytics/overview')).body.totals.events,0);
 }finally{db.close();}
});
