import './register-native-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const {toolBindings}=await import('../runtime/core/mcp-admin.ts');

const operations=['read','write','advanced'].map(name=>({id:`fixture.${name}`,toolName:`lite_fixture_${name}`,description:name,moduleName:'Fixture',mcp:true}));
const org={id:'workspace',name:'Workspace',role:'owner'};
function context(policies=[]){return {env:{DB:{prepare:()=>({bind(){return this;}}),batch:async()=>[{results:policies},{results:[]}]}}};}

test('profile defaults use the union of server-observed profiles',async()=>{
 const defaults={profiles:{pos:['lite_fixture_read'],staff:['lite_fixture_write']}};
 const pos=await toolBindings(context(),org,operations,defaults,['pos']);
 assert.deepEqual(pos.filter(tool=>tool.enabled).map(tool=>tool.name),['lite_fixture_read']);
 const combined=await toolBindings(context(),org,operations,defaults,['pos','staff']);
 assert.deepEqual(combined.filter(tool=>tool.enabled).map(tool=>tool.name),['lite_fixture_read','lite_fixture_write']);
 const changed=await toolBindings(context(),org,operations,defaults,['staff']);
 assert.deepEqual(changed.filter(tool=>tool.enabled).map(tool=>tool.name),['lite_fixture_write']);
});

test('persisted administrator switches override profile defaults',async()=>{
 const defaults={profiles:{staff:['lite_fixture_read','lite_fixture_write']}};
 const policies=[{name:'lite_fixture_read',enabled:0,version:4},{name:'lite_fixture_advanced',enabled:1,version:2}];
 const bindings=await toolBindings(context(policies),org,operations,defaults,['staff']);
 assert.deepEqual(bindings.filter(tool=>tool.enabled).map(tool=>tool.name),['lite_fixture_write','lite_fixture_advanced']);
 assert.equal(bindings.find(tool=>tool.name==='lite_fixture_read').version,4);
});

test('applications without an MCP policy keep every eligible tool enabled',async()=>{
 const bindings=await toolBindings(context(),org,operations);
 assert.deepEqual(bindings.filter(tool=>tool.enabled).map(tool=>tool.name),operations.map(operation=>operation.toolName));
});
