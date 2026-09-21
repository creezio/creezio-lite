import './register-native-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {defineApp,createBrandModuleRegistry,read,defineExtensions as defineCoreExtensions} from '../runtime/core/index.ts';
const {defineExtensions}=await import('../runtime/modules/sites-adapter/src/catalog.ts');
const {dispatchRequest}=await import('../runtime/modules/sites-adapter/src/dispatch.ts');
import {client,boot,localDb,alice} from './helpers.mjs';
const schema={id:'products',name:'Products',singular:'Product',description:'Products',titleField:'name',fields:[{key:'name',label:'Name',type:'text',required:true}]};
const app=defineApp({id:'stock-proof',name:'Stock',description:'Module without CRUD entity',modules:[schema]});
const catalog={id:'catalog',entitySpecs:{products:{schema,storage:{kind:'records'}}}};
const settings=read({moduleId:'stock',name:'settings',target:'module',roles:['owner','admin','member'],description:'Read warehouse settings',async handle(ctx){return {body:{threshold:10,workspaceId:ctx.workspace.id}};}});
const registry=()=>createBrandModuleRegistry(app,[catalog,{id:'stock',entitySpecs:{},tables:['stock_settings'],operations:[settings]}]);

test('a declared module may own operations without a fictitious CRUD entity; unknown and unowned operations stay invalid',()=>{
 const declared=registry();assert.equal(declared.ownerOf('stock'),undefined);
 assert.equal(defineCoreExtensions(app,{registry:declared}).operations[0],settings);
 assert.equal(defineExtensions(app,{registry:declared}).operations[0],settings);
 assert.throws(()=>defineCoreExtensions(app,{operations:[settings]}),/module absent/);
 const empty=createBrandModuleRegistry(app,[catalog,{id:'stock',entitySpecs:{}}]);
 assert.throws(()=>defineCoreExtensions(app,{registry:empty,operations:[settings]}),/module absent/);
 assert.throws(()=>defineExtensions(app,{registry:declared,operations:[settings]}),/duplicate|dupliqu|collision/i);
});

test('native module-only operation is shared by HTTP and MCP, scoped and role checked',async t=>{
 const db=await localDb();t.after(()=>db.close());
 const options=defineExtensions(app,{registry:registry()});
 const core=client(db,alice,undefined,app,options),org=await boot(core);
 const call=async(path,{method='GET',body}={})=>{
  const request=new Request('https://test.example/api/v1/'+path,{method,headers:{origin:'https://test.example',...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const response=await dispatchRequest(request,{app,env:{DB:db},identity:alice},options);return {status:response.status,body:await response.json()};
 };
 const path='modules/stock/settings?workspace='+org;
 const result=await call(path);assert.equal(result.status,200,JSON.stringify(result.body));assert.deepEqual(result.body,{threshold:10,workspaceId:org});
 const tools=await call('mcp/tools?workspace='+org);assert.equal(tools.status,200);
 assert.ok(tools.body.tools.some(tool=>tool.name==='lite_read_stock_settings'));
 const mcp=()=>call('mcp/call?workspace='+org,{method:'POST',body:{name:'lite_read_stock_settings',arguments:{}}});
 assert.equal((await mcp()).status,200);
 assert.equal((await call('modules/stock/settings?workspace=foreign')).status,404);
 db.raw.prepare("UPDATE lite_members SET role='viewer' WHERE org_id=? AND user_id=?").run(org,alice.userId);
 assert.equal((await call(path)).status,403);assert.equal((await mcp()).status,403);
});

