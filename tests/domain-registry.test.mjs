import './register-native-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { app, alice, bob, client, boot, localDb } from './helpers.mjs';
import { defineApp } from '../runtime/core/index.ts';
import { moduleRegistry, recordHref, navigableModules } from '../runtime/core/registry.ts';
import { coreOperations, appOperations, assertUniqueOperations, operation } from '../runtime/core/operations.ts';
import { MODULE_LIMIT } from '../runtime/core/validation.ts';
const { dispatchRequest } = await import('../runtime/modules/sites-adapter/src/dispatch.ts');
const { nativeEntries } = await import('../runtime/modules/sites-adapter/src/nav.ts');
const { operationCatalog } = await import('../runtime/modules/sites-adapter/src/catalog.ts');

const text=(key,label,extra={})=>({key,label,type:'text',...extra});
const domainModules=[
  {id:'clients',name:'Clients',singular:'Client',description:'Module natif inchangé',titleField:'name',fields:[text('name','Nom',{required:true}),{key:'status',label:'Statut',type:'select',options:['Prospect','Actif']}]},
  {id:'dossiers',name:'Dossiers',singular:'Dossier',description:'Entité commandée',kind:'entity',titleField:'title',fields:[text('title','Titre',{required:true}),{key:'status',label:'Statut',type:'select',options:['Ouvert','Terminé']}]},
  {id:'pieces',name:'Pièces',singular:'Pièce',description:'Collection du dossier',kind:'collection',parent:'dossiers',parentField:'dossier_id',titleField:'label',fields:[text('label','Libellé',{required:true}),text('dossier_id','Dossier',{required:true})]},
  {id:'archives',name:'Archives',singular:'Archive',description:'Entité hors navigation',kind:'entity',navigation:false,titleField:'title',fields:[text('title','Titre',{required:true})]},
];
const domainApp=defineApp({id:'domaine',name:'Domaine',description:'Fixture D01',modules:domainModules});
const variant=(mutate)=>{const copy=structuredClone({id:'domaine',name:'Domaine',description:'',modules:domainModules});mutate(copy);return copy;};
function caller(db,identity,org,definition=domainApp,options={},token){return async(path,{method='GET',body,headers={}}={})=>{
  const url=new URL(path.startsWith('/api/')?path:'/api/v1/'+path,'https://test.example');if(org)url.searchParams.set('workspace',org);
  const response=await dispatchRequest(new Request(url,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{origin:url.origin}),...(body?{'content-type':'application/json'}:{}),accept:'application/json',...headers},body:body?JSON.stringify(body):undefined}),{app:definition,env:{DB:db},identity},options);
  return {status:response.status,body:await response.json(),headers:response.headers};
};}

test('a module without kind keeps exactly its historical registry, operations and navigation',()=>{
  const before={...app,modules:app.modules.map(m=>({...m}))};
  const registered=moduleRegistry(before).find(m=>m.id==='clients');
  assert.equal(registered.moduleKind,'module');assert.equal(registered.writable,true);assert.equal(registered.navigation,true);assert.equal(registered.search.enabled,true);
  assert.equal(registered.parent,undefined);assert.equal(registered.parentField,undefined);
  const ids=coreOperations(before).filter(o=>o.moduleId==='clients').map(o=>o.id).sort();
  assert.deepEqual(ids,['module.clients.archive','module.clients.create','module.clients.get','module.clients.list','module.clients.update']);
  assert.ok(nativeEntries(before).some(e=>e.id==='module.clients'&&e.permission==='module.clients.read'));
  assert.equal(recordHref(registered,'abc',{}),'/clients?record=abc');
  // The plain module of the fixture behaves the same way next to entities and collections.
  const mixed=moduleRegistry(domainApp).find(m=>m.id==='clients');
  assert.deepEqual({kind:mixed.moduleKind,writable:mixed.writable,navigation:mixed.navigation},{kind:'module',writable:true,navigation:true});
});

test('entities and collections expose reads only, navigation and search follow the declared kind',()=>{
  const registry=moduleRegistry(domainApp),operations=coreOperations(domainApp);
  const dossiers=registry.find(m=>m.id==='dossiers'),pieces=registry.find(m=>m.id==='pieces'),archives=registry.find(m=>m.id==='archives');
  assert.deepEqual([dossiers.moduleKind,dossiers.writable,dossiers.navigation,dossiers.search.enabled],['entity',false,true,true]);
  assert.deepEqual([pieces.moduleKind,pieces.writable,pieces.navigation,pieces.search.enabled,pieces.parent,pieces.parentField],['collection',false,false,false,'dossiers','dossier_id']);
  assert.deepEqual([archives.moduleKind,archives.navigation],['entity',false]);
  for(const id of ['dossiers','pieces','archives'])assert.deepEqual(operations.filter(o=>o.moduleId===id).map(o=>o.id).sort(),[`module.${id}.get`,`module.${id}.list`]);
  const entries=nativeEntries(domainApp).map(e=>e.id);
  assert.ok(entries.includes('module.clients')&&entries.includes('module.dossiers'));
  assert.ok(!entries.includes('module.pieces')&&!entries.includes('module.archives'));
  assert.deepEqual(navigableModules(domainApp).map(m=>m.id),['clients','dossiers']);
  // A collection opting in keeps its explicit search setting.
  const searchable=defineApp(variant(a=>{a.modules[2].search={enabled:true};}));
  assert.equal(moduleRegistry(searchable).find(m=>m.id==='pieces').search.enabled,true);
  // recordHref reads the real parentField and never builds a URL to "undefined".
  assert.equal(recordHref(pieces,'p1',{label:'Devis',dossier_id:'d1'}),'/dossiers?record=d1&pieces=p1');
  assert.equal(recordHref(pieces,'p1',{label:'Devis'}),'/dossiers');
  assert.equal(recordHref(pieces,'p1',{label:'Devis',dossier_id:'../x'}),'/dossiers');
  assert.equal(recordHref(dossiers,'d1',{}),'/dossiers?record=d1');
});

test('defineApp validates kind, parent, parentField, navigation, cycles and the 64 module limit',()=>{
  const refused=[
    ['kind inconnu',a=>{a.modules[1].kind='table';}],
    ['parent absent',a=>{a.modules[2].parent='inconnu';}],
    ['parentField absent des champs',a=>{a.modules[2].parentField='missing';}],
    ['parentField non obligatoire',a=>{a.modules[2].fields[1].required=false;}],
    ['parent de kind module',a=>{a.modules[2].parent='clients';}],
    ['parent collection (cycle)',a=>{a.modules.push({...structuredClone(a.modules[2]),id:'sous-pieces',parent:'pieces'});a.modules[2].parent='sous-pieces';}],
    ['collection sans parent',a=>{delete a.modules[2].parent;}],
    ['collection sans parentField',a=>{delete a.modules[2].parentField;}],
    ['parent hors collection',a=>{a.modules[1].parent='clients';}],
    ['parentField hors collection',a=>{a.modules[0].parentField='name';}],
    ['collection navigable',a=>{a.modules[2].navigation=true;}],
    ['navigation non booléenne',a=>{a.modules[1].navigation='yes';}],
    ['auto-parent',a=>{a.modules[2].parent='pieces';}],
  ];
  for(const [label,mutate] of refused)assert.throws(()=>defineApp(variant(mutate)),undefined,label);
  const many=(count)=>variant(a=>{for(let i=a.modules.length;i<count;i++)a.modules.push({id:`extra-${i}`,name:`Extra ${i}`,singular:'Extra',description:'',titleField:'name',fields:[text('name','Nom',{required:true})]});});
  assert.equal(MODULE_LIMIT,64);
  assert.equal(defineApp(many(64)).modules.length,64);
  assert.throws(()=>defineApp(many(65)),/64/);
  assert.equal(defineApp(variant(a=>{a.modules[1].navigation=false;})).modules[1].navigation,false);
});

test('generic writes on entities and collections are refused by the dispatcher (404) and by handleApi directly (405)',async()=>{
  const db=await localDb();try{
    const org=await boot(client(db,alice)),direct=client(db,alice,undefined,domainApp),http=caller(db,alice,org);
    const dossierId=crypto.randomUUID(),pieceId=crypto.randomUUID(),now=new Date().toISOString();
    db.raw.prepare('INSERT INTO lite_records(id,org_id,module_id,data,search_text,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)').run(dossierId,org,'dossiers',JSON.stringify({title:'Chantier A',status:'Ouvert'}),'chantier a',alice.userId,now,now);
    db.raw.prepare('INSERT INTO lite_records(id,org_id,module_id,data,search_text,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)').run(pieceId,org,'pieces',JSON.stringify({label:'Devis',dossier_id:dossierId}),'devis',alice.userId,now,now);
    for(const [moduleId,id,data] of [['dossiers',dossierId,{title:'X'}],['pieces',pieceId,{label:'X',dossier_id:dossierId}],['archives',null,{title:'X'}]]){
      assert.equal((await http(`modules/${moduleId}/records`,{method:'POST',body:{data}})).status,404,`${moduleId} create`);
      if(id){
        assert.equal((await http(`modules/${moduleId}/records/${id}`,{method:'PATCH',body:{data,version:1}})).status,404,`${moduleId} update`);
        assert.equal((await http(`modules/${moduleId}/records/${id}`,{method:'DELETE',body:{version:1}})).status,404,`${moduleId} archive`);
      }
      const created=await direct(`modules/${moduleId}/records`,{method:'POST',body:{data}});
      assert.equal(created.status,405);assert.equal(created.body.error.code,'command_required');
      if(id){
        assert.equal((await direct(`modules/${moduleId}/records/${id}`,{method:'PATCH',body:{data,version:1}})).body.error.code,'command_required');
        assert.equal((await direct(`modules/${moduleId}/records/${id}`,{method:'DELETE',body:{version:1}})).body.error.code,'command_required');
        assert.equal((await http(`modules/${moduleId}/records/${id}`)).body.record.version,1,'reads stay available');
      }
      assert.equal((await http(`modules/${moduleId}/records`)).status,200);
    }
    assert.equal((await http('modules/clients/records',{method:'POST',body:{data:{name:'Natif'}}})).status,201,'plain module CRUD unchanged');
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM lite_records WHERE module_id IN ('dossiers','pieces','archives')").get().n,2);
    // The dashboard counts navigable modules only; the registry still describes every readable module.
    const dashboard=(await http('dashboard')).body.modules.map(m=>m.id);
    assert.deepEqual(dashboard,['clients','dossiers']);
    const registry=(await http('registry')).body.modules;
    assert.deepEqual(registry.find(m=>m.id==='pieces').moduleKind,'collection');assert.equal(registry.find(m=>m.id==='pieces').navigation,false);
    const tools=(await http('/api/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'}})).body.result.tools.map(t=>t.name);
    assert.ok(tools.includes('lite_dossiers_list')&&tools.includes('lite_pieces_get'));
    assert.ok(!tools.some(t=>/^lite_(dossiers|pieces|archives)_(create|update|archive)$/.test(t)));
  }finally{db.close();}
});

test('roles apply to entity reads and native writes across owner, admin, member and viewer',async()=>{
  const db=await localDb();try{
    const restricted=defineApp(variant(a=>{a.modules[1].readRoles=['owner','admin','member'];}));
    const org=await boot(client(db,alice));await boot(client(db,bob));
    const now=new Date().toISOString();
    db.raw.prepare('INSERT INTO lite_records(id,org_id,module_id,data,search_text,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)').run('d1',org,'dossiers',JSON.stringify({title:'Chantier'}),'chantier',alice.userId,now,now);
    for(const [role,dossiers,clientsWrite] of [['admin',200,201],['member',200,201],['viewer',403,403]]){
      db.raw.prepare('INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,?) ON CONFLICT(org_id,user_id) DO UPDATE SET role=excluded.role').run(org,bob.userId,role);
      const call=caller(db,bob,org,restricted);
      assert.equal((await call('modules/dossiers/records')).status,dossiers,`${role} dossiers`);
      assert.equal((await call('modules/clients/records',{method:'POST',body:{data:{name:`Par ${role}`}}})).status,clientsWrite,`${role} clients`);
      assert.equal((await call('modules/dossiers/records',{method:'POST',body:{data:{title:'X'}}})).status,404,`${role} entity write`);
      const permissions=(await call('auth/me')).body.permissions;
      assert.equal(permissions.includes('module.dossiers.read'),role!=='viewer');assert.ok(permissions.includes('module.pieces.read'),'collection permission stays explicit');
    }
  }finally{db.close();}
});

test('catalogue collisions on identifiers, routes and tool names are refused at declaration',async()=>{
  const db=await localDb();try{
    const c={db,user:alice,workspace:{id:'w',name:'',role:'owner'}};
    const handle=async()=>({body:{}});
    const declared=(value)=>({operation:operation({kind:'business',moduleId:'dossiers',moduleName:'Dossiers',description:'Test',roles:['owner'],...value}),handle});
    assert.throws(()=>appOperations(domainApp,[declared({id:'read.dossiers.a',method:'GET',path:'/api/v1/modules/dossiers/a'}),declared({id:'read.dossiers.a',method:'GET',path:'/api/v1/modules/dossiers/b'})]),/dupliqué/);
    assert.throws(()=>operationCatalog(c,domainApp,[declared({id:'read.dossiers.list2',method:'GET',path:'/api/v1/modules/dossiers/records'})]),/Duplicate route/);
    assert.throws(()=>operationCatalog(c,domainApp,[declared({id:'read.dossiers.alias',method:'GET',path:'/api/v1/modules/dossiers/other',aliases:['/api/v1/modules/dossiers/records/:id']})]),/Duplicate route/);
    assert.throws(()=>operationCatalog(c,domainApp,[declared({id:'read.dossiers.tool',method:'GET',path:'/api/v1/modules/dossiers/other',toolName:'lite_dossiers_list'})]),/Duplicate tool/);
    assert.throws(()=>operationCatalog(c,domainApp,[declared({id:'module.dossiers.list',method:'GET',path:'/api/v1/modules/dossiers/other'})]),/Duplicate operation/);
    assert.throws(()=>appOperations(domainApp,[declared({id:'read.absent.a',moduleId:'absent',method:'GET',path:'/api/v1/modules/absent/a'})]),/absent/);
    assert.throws(()=>appOperations(domainApp,[declared({id:'read.dossiers.body',method:'GET',path:'/api/v1/modules/dossiers/x',bodySchema:{type:'object'}})]),/corps/);
    assert.throws(()=>appOperations(domainApp,[declared({id:'read.dossiers.outside',method:'GET',path:'/other/path'})]),/api\/v1/);
    assert.throws(()=>appOperations(domainApp,[declared({id:'read.dossiers.essential',method:'GET',path:'/api/v1/modules/dossiers/x',essential:true})]),/indispensable/);
    assert.throws(()=>appOperations(domainApp,[{operation:operation({kind:'system',id:'jobs.get',moduleId:'dossiers',moduleName:'Jobs',method:'GET',path:'/api/v1/jobs/:id',description:'x',roles:['owner']}),handle}]),/module métier/);
    assert.ok(assertUniqueOperations(operationCatalog(c,domainApp)).length>0);
    const marked=appOperations(domainApp,[declared({id:'read.dossiers.ok',method:'GET',path:'/api/v1/modules/dossiers/ok',roles:['owner','viewer']})]);
    assert.equal(marked[0].source,'app');
    const readers=appOperations(defineApp(variant(a=>{a.modules[1].readRoles=['owner','admin'];})),[declared({id:'read.dossiers.ok',method:'GET',path:'/api/v1/modules/dossiers/ok',roles:['owner','viewer']})]);
    assert.deepEqual(readers[0].roles,['owner'],'roles never exceed the module read roles');
  }finally{db.close();}
});
