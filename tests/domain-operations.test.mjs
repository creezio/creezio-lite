import './register-native-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { alice, bob, eve, client, boot, localDb, fakeBucket } from './helpers.mjs';
import { command, read, defineExtensions, defineApp, openScope } from '../runtime/core/index.ts';
import { objectSchema, operation } from '../runtime/core/operations.ts';
import { fail } from '../runtime/core/validation.ts';
import { hash } from '../runtime/core/http.ts';
const { dispatchRequest } = await import('../runtime/modules/sites-adapter/src/dispatch.ts');

const text=(key,label,extra={})=>({key,label,type:'text',...extra});
/** Same fixture as domain-registry: a plain module, a commanded entity, its collection and a hidden entity. */
const domainApp=defineApp({id:'domaine',name:'Domaine',description:'Fixture D01',modules:[
  {id:'clients',name:'Clients',singular:'Client',description:'Module natif inchangé',titleField:'name',fields:[text('name','Nom',{required:true}),{key:'status',label:'Statut',type:'select',options:['Prospect','Actif']}]},
  {id:'dossiers',name:'Dossiers',singular:'Dossier',description:'Entité commandée',kind:'entity',titleField:'title',fields:[text('title','Titre',{required:true}),{key:'status',label:'Statut',type:'select',options:['Ouvert','Terminé']}]},
  {id:'pieces',name:'Pièces',singular:'Pièce',description:'Collection du dossier',kind:'collection',parent:'dossiers',parentField:'dossier_id',titleField:'label',fields:[text('label','Libellé',{required:true}),text('dossier_id','Dossier',{required:true})]},
  {id:'archives',name:'Archives',singular:'Archive',description:'Entité hors navigation',kind:'entity',navigation:false,titleField:'title',fields:[text('title','Titre',{required:true})]},
]});
const now=()=>new Date().toISOString();
const rpc=(name,args={})=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
function caller(db,identity,org,options,definition=domainApp,token,bucket){return async(path,{method='GET',body,headers={},raw=false}={})=>{
  const url=new URL(path.startsWith('/api/')?path:'/api/v1/'+path,'https://test.example');if(org)url.searchParams.set('workspace',org);
  const request=new Request(url,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{origin:url.origin}),...(body!==undefined&&!(body instanceof Uint8Array)?{'content-type':'application/json'}:{}),accept:'application/json',...headers},body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)});
  const response=await dispatchRequest(request,{app:definition,env:{DB:db,BUCKET:bucket},identity},options);
  return raw?response:{status:response.status,body:await response.json(),headers:response.headers};
};}

/** Test fixture tables: an explicit grant list per record/file and the deletion requests. Never a cv_* table. */
function fixtureTables(db){
  db.raw.exec(`CREATE TABLE fx_record_grants(user_id TEXT NOT NULL,record_id TEXT NOT NULL,action TEXT NOT NULL);
    CREATE TABLE fx_file_grants(user_id TEXT NOT NULL,file_id TEXT NOT NULL,action TEXT NOT NULL);
    CREATE TABLE fx_idempotency(org_id TEXT NOT NULL,key TEXT NOT NULL,record_id TEXT NOT NULL,status INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(org_id,key));
    CREATE TABLE fx_deletions(file_id TEXT PRIMARY KEY,requested_by TEXT NOT NULL,request_id TEXT NOT NULL);`);
}
/** Owner and admin see the whole workspace (explicit fixture policy); other roles need a grant. Clients stays workspace-scoped. */
const grantScope={
  recordFilter(principal,ref,action){
    if(['owner','admin'].includes(principal.role))return {sql:'1=1',bindings:[]};
    return {sql:`${ref.alias}.${ref.moduleColumn}='clients' OR EXISTS(SELECT 1 FROM fx_record_grants g WHERE g.record_id=${ref.alias}.${ref.idColumn} AND g.user_id=? AND g.action=?)`,bindings:[principal.userId,action]};
  },
  fileFilter(principal,ref,action){
    if(['owner','admin'].includes(principal.role))return {sql:'1=1',bindings:[]};
    return {sql:`EXISTS(SELECT 1 FROM fx_file_grants g WHERE g.file_id=${ref.alias}.${ref.idColumn} AND g.user_id=? AND g.action=?)`,bindings:[principal.userId,action]};
  },
};
const deletingScope={...grantScope,async deleteFile(ctx){
  // Transactional policy: tombstone with conditional predicates, request row, no R2 access here.
  const result=await ctx.db.batch([
    ctx.db.prepare('UPDATE lite_files SET deleted_at=? WHERE id=? AND org_id=? AND deleted_at IS NULL').bind(ctx.now,ctx.fileId,ctx.workspace.id),
    ctx.db.prepare('INSERT INTO fx_deletions(file_id,requested_by,request_id) SELECT ?,?,? WHERE changes()=1').bind(ctx.fileId,ctx.principal.userId,ctx.requestId),
  ]);
  if(!result[0].meta.changes)fail(409,'file_locked','Suppression déjà demandée.');
  return {cleanup:'queued'};
}};
const insertRecord=(db,org,moduleId,data,user=alice.userId)=>{const id=crypto.randomUUID(),ts=now();db.raw.prepare('INSERT INTO lite_records(id,org_id,module_id,data,search_text,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)').run(id,org,moduleId,JSON.stringify(data),Object.values(data).join(' ').toLowerCase(),user,ts,ts);return id;};
const grant=(db,user,recordId,...actions)=>{for(const action of actions)db.raw.prepare('INSERT INTO fx_record_grants(user_id,record_id,action) VALUES(?,?,?)').run(user,recordId,action);};

/** Application fixture: every mutation of the entity is a declared command; history is a declared read. */
function extensions(scope){
  const target=async(ctx,action)=>{
    const filter=ctx.scope.recordFilter(ctx.principal,{alias:'r',idColumn:'id',moduleColumn:'module_id'},action);
    const row=await ctx.db.prepare(`SELECT r.id,r.data,r.version FROM lite_records r WHERE r.id=? AND r.org_id=? AND r.module_id='dossiers' AND r.deleted_at IS NULL AND (${filter.sql})`).bind(ctx.params.id,ctx.workspace.id,...filter.bindings).first();
    if(!row)fail(404,'record_not_found','Document introuvable.');
    return {...row,data:JSON.parse(row.data)};
  };
  return defineExtensions(domainApp,{scope,operations:[
    command({moduleId:'dossiers',moduleName:'Dossiers',name:'close',description:'Clore un dossier',fields:{outcome:{enum:['won','lost']}},required:['outcome'],async handle(ctx){
      const current=await target(ctx,'write');
      if(current.version!==ctx.body.expectedVersion)fail(409,'version_conflict','Version attendue différente.');
      const data={...current.data,status:'Terminé'};
      const result=await ctx.db.batch([
        ctx.db.prepare('UPDATE lite_records SET data=?,search_text=?,version=version+1,updated_at=? WHERE id=? AND org_id=? AND version=?').bind(JSON.stringify(data),'',ctx.now,current.id,ctx.workspace.id,current.version),
        ctx.db.prepare('INSERT INTO lite_audit(id,org_id,user_id,action,resource_id,details,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),ctx.workspace.id,ctx.principal.userId,'dossiers.close',current.id,JSON.stringify({outcome:ctx.body.outcome,reason:ctx.body.reason??null,credential:ctx.principal.credential}),ctx.now),
      ]);
      if(!result[0].meta.changes)fail(409,'version_conflict','Version attendue différente.');
      return {body:{result:{id:current.id,version:current.version+1,status:'Terminé'},events:['dossier.closed']},changed:['dossiers','pieces']};
    }}),
    command({moduleId:'dossiers',moduleName:'Dossiers',name:'get',description:'Commande nommée get : reste une mutation POST',fields:{},expectedVersion:'required',async handle(ctx){
      const current=await target(ctx,'write');
      return {body:{result:{id:current.id,touched:true},events:[]}};
    }}),
    command({moduleId:'dossiers',moduleName:'Dossiers',name:'open',target:'module',description:'Ouvrir un dossier',fields:{title:{type:'string',minLength:1,maxLength:120}},required:['title'],reason:'required',async handle(ctx){
      const replay=await ctx.db.prepare('SELECT status,body FROM fx_idempotency WHERE org_id=? AND key=?').bind(ctx.workspace.id,ctx.body.idempotencyKey).first();
      if(replay)return {status:replay.status,body:JSON.parse(replay.body),replayed:true};
      const id=crypto.randomUUID(),body={result:{id,title:ctx.body.title},events:['dossier.opened']};
      await ctx.db.batch([
        ctx.db.prepare('INSERT INTO lite_records(id,org_id,module_id,data,search_text,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)').bind(id,ctx.workspace.id,'dossiers',JSON.stringify({title:ctx.body.title,status:'Ouvert'}),ctx.body.title.toLowerCase(),ctx.principal.userId,ctx.now,ctx.now),
        ctx.db.prepare('INSERT INTO fx_record_grants(user_id,record_id,action) VALUES(?,?,?)').bind(ctx.principal.userId,id,'read'),
        ctx.db.prepare('INSERT INTO fx_record_grants(user_id,record_id,action) VALUES(?,?,?)').bind(ctx.principal.userId,id,'write'),
        ctx.db.prepare('INSERT INTO fx_idempotency(org_id,key,record_id,status,body) VALUES(?,?,?,?,?)').bind(ctx.workspace.id,ctx.body.idempotencyKey,id,201,JSON.stringify(body)),
      ]);
      return {status:201,body,changed:['dossiers']};
    }}),
    read({moduleId:'dossiers',moduleName:'Dossiers',name:'history',description:'Historique du dossier',querySchema:objectSchema({limit:{type:'integer',minimum:1,maximum:50}}),async handle(ctx){
      const current=await target(ctx,'read');
      const rows=await ctx.db.prepare('SELECT action,created_at FROM lite_audit WHERE org_id=? AND resource_id=? ORDER BY created_at DESC LIMIT ?').bind(ctx.workspace.id,current.id,ctx.query.limit??20).all();
      return {body:{items:rows.results,limit:ctx.query.limit??20,credential:ctx.principal.credential}};
    }}),
    {operation:operation({kind:'system',id:'jobs.get',moduleId:'fixture-jobs',moduleName:'Traitements',method:'GET',path:'/api/v1/jobs/:id',description:'Lire un traitement',roles:['owner','admin']}),async handle(ctx){return {body:{job:{id:ctx.params.id,workspace:ctx.workspace.id}}};}},
  ]});
}
async function oauthToken(db,org,userId,scope='crm:read crm:write'){
  const raw=`mcp_at_${Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}`,later=new Date(Date.now()+3600000).toISOString();
  db.raw.prepare("INSERT OR IGNORE INTO lite_oauth_clients(id,name,redirects_json,auth_method,created_at) VALUES('fx-client','Fixture','[]','none',?)").run(now());
  const grantId=crypto.randomUUID();
  db.raw.prepare('INSERT INTO lite_oauth_grants(id,client_id,org_id,user_id,scope,resource,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').run(grantId,'fx-client',org,userId,scope,'https://test.example/api/mcp',now(),later);
  db.raw.prepare('INSERT INTO lite_oauth_tokens(id,grant_id,scope,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),grantId,scope,await hash(raw),await hash(raw+'r'),later,later);
  return raw;
}

test('declared reads and commands join the catalogue, OpenAPI, access matrix, MCP tools and WebMCP with validated schemas',async()=>{
  const db=await localDb();try{
    fixtureTables(db);const ext=extensions(grantScope);
    const org=await boot(client(db,alice)),owner=caller(db,alice,org,ext);
    const endpoints=(await owner('admin/endpoints')).body.endpoints;
    const byId=id=>endpoints.find(e=>e.id===id);
    assert.deepEqual([byId('command.dossiers.close').method,byId('command.dossiers.close').path],['POST','/api/v1/modules/dossiers/records/:id/commands/close']);
    assert.deepEqual([byId('command.dossiers.get').method,byId('command.dossiers.get').path],['POST','/api/v1/modules/dossiers/records/:id/commands/get']);
    assert.deepEqual([byId('command.dossiers.open').method,byId('command.dossiers.open').path],['POST','/api/v1/modules/dossiers/commands/open']);
    assert.deepEqual([byId('read.dossiers.history').method,byId('read.dossiers.history').path],['GET','/api/v1/modules/dossiers/records/:id/history']);
    assert.deepEqual([byId('jobs.get').kind,byId('jobs.get').moduleId,byId('jobs.get').roles],['system','fixture-jobs',['owner','admin']]);
    assert.ok(!byId('module.dossiers.create'));
    const doc=(await owner('openapi.json')).body;
    const close=doc.paths['/api/v1/modules/dossiers/records/{id}/commands/close'].post;
    assert.deepEqual(close.parameters.map(p=>[p.name,p.in]),[['id','path']]);
    assert.deepEqual(Object.keys(close.requestBody.content['application/json'].schema.properties).sort(),['expectedVersion','idempotencyKey','outcome','reason']);
    assert.deepEqual(close.requestBody.content['application/json'].schema.required,['expectedVersion','outcome']);
    assert.equal(close.requestBody.content['application/json'].schema.additionalProperties,false);
    assert.equal(doc.paths['/api/v1/modules/dossiers/records/{id}/commands/get'].get,undefined,'a command named get is documented as POST only');
    const history=doc.paths['/api/v1/modules/dossiers/records/{id}/history'].get;
    assert.deepEqual(history.parameters.map(p=>[p.name,p.in]),[['id','path'],['limit','query']]);assert.equal(history.requestBody,undefined);
    assert.deepEqual(doc.paths['/api/v1/modules/dossiers/commands/open'].post.requestBody.content['application/json'].schema.required,['idempotencyKey','reason','title']);
    assert.ok((await owner('access/catalog')).body.operations.some(o=>o.id==='command.dossiers.close'&&o.locked===false));
    const tools=(await owner('/api/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'}})).body.result.tools;
    const tool=tools.find(t=>t.name==='lite_command_dossiers_close');
    assert.deepEqual(tool.inputSchema.required,['id','body']);assert.equal(tool.inputSchema.properties.body.properties.outcome.enum[0],'won');assert.equal(tool.annotations.readOnlyHint,false);
    assert.equal(tools.find(t=>t.name==='lite_read_dossiers_history').annotations.readOnlyHint,true);
    assert.ok(tools.some(t=>t.name==='lite_jobs_get'));
    assert.ok((await owner('mcp/tools')).body.tools.some(t=>t.name==='lite_command_dossiers_open'));
    const id=insertRecord(db,org,'dossiers',{title:'Chantier A',status:'Ouvert'});
    const bad=await owner('/api/mcp',{method:'POST',body:rpc('lite_command_dossiers_close',{id,body:{expectedVersion:1,outcome:'draw'}})});
    assert.equal(bad.body.result.isError,true,'tool arguments are validated against the declared schema');
    const viaMcp=await owner('/api/mcp',{method:'POST',body:rpc('lite_command_dossiers_close',{id,body:{expectedVersion:1,outcome:'won'}})});
    assert.equal(viaMcp.body.result.isError,undefined,JSON.stringify(viaMcp.body));assert.equal(viaMcp.body.result.structuredContent.result.status,'Terminé');
    const webmcp=await owner('mcp/call',{method:'POST',body:{name:'lite_read_dossiers_history',arguments:{id,query:{limit:5}}}});
    assert.equal(webmcp.status,200,JSON.stringify(webmcp.body));assert.equal(webmcp.body.limit,5);assert.equal(webmcp.body.items[0].action,'dossiers.close');
    const job=await owner('/api/mcp',{method:'POST',body:rpc('lite_jobs_get',{id:'job-1'})});assert.equal(job.body.result.structuredContent.job.workspace,org);
  }finally{db.close();}
});

test('commands validate path, query and body server-side; get stays POST; replay and data-changed headers are derived only',async()=>{
  const db=await localDb();try{
    fixtureTables(db);const ext=extensions(grantScope);
    const org=await boot(client(db,alice)),owner=caller(db,alice,org,ext);
    const id=insertRecord(db,org,'dossiers',{title:'Chantier B',status:'Ouvert'});
    assert.equal((await owner(`modules/dossiers/records/${id}/commands/get`)).status,404,'GET on a command named get is not a route');
    const touched=await owner(`modules/dossiers/records/${id}/commands/get`,{method:'POST',body:{expectedVersion:1}});
    assert.equal(touched.status,200);assert.equal(touched.body.result.touched,true);
    const cases=[
      [{expectedVersion:1,outcome:'won',extra:true},'unknown field'],[{outcome:'won'},'missing expectedVersion'],[{expectedVersion:0,outcome:'won'},'non positive version'],
      [{expectedVersion:1,outcome:'won',command:'close'},'command field'],[{expectedVersion:1,outcome:'won',payload:{}},'payload wrapper'],
      [{expectedVersion:1,outcome:'won',reason:'x'.repeat(501)},'reason too long'],[{expectedVersion:1,outcome:'draw'},'enum'],
    ];
    for(const [body,label] of cases){const r=await owner(`modules/dossiers/records/${id}/commands/close`,{method:'POST',body});assert.equal(r.status,400,label);assert.equal(r.body.error.code,'invalid_arguments',label);}
    assert.equal((await owner(`modules/dossiers/records/${id}/commands/close`,{method:'POST',body:{expectedVersion:1,outcome:'won'},headers:{'content-type':'text/plain'}})).status,415);
    assert.equal((await owner(`modules/dossiers/records/${id}/commands/close`,{method:'POST'})).status,400,'an empty body misses required fields');
    assert.equal((await owner(`modules/dossiers/records/${id}/commands/close?unexpected=1`,{method:'POST',body:{expectedVersion:1,outcome:'won'}})).status,400,'undeclared query');
    assert.equal((await owner(`modules/dossiers/records/${encodeURIComponent('a/b')}/commands/close`,{method:'POST',body:{expectedVersion:1,outcome:'won'}})).status,400,'path identifiers are validated');
    assert.equal((await owner(`modules/dossiers/records/${id}/history`,{headers:{'content-type':'application/json','content-length':'7'}})).status,400,'a read refuses a business body');
    assert.equal((await owner(`modules/dossiers/records/${id}/history?limit=abc`)).status,400);assert.equal((await owner(`modules/dossiers/records/${id}/history?limit=0`)).status,400);
    assert.equal((await owner(`modules/dossiers/records/${id}/history?limit=3`)).body.limit,3,'query values are coerced to the declared type');
    assert.equal((await owner(`modules/dossiers/records/${id}/history?other=1`)).status,400);
    assert.equal((await owner(`modules/dossiers/records/${crypto.randomUUID()}/history`)).status,404);
    const closed=await owner(`modules/dossiers/records/${id}/commands/close`,{method:'POST',body:{expectedVersion:1,outcome:'won',reason:'Remplacement confirmé'}});
    assert.equal(closed.status,200,JSON.stringify(closed.body));assert.deepEqual(closed.body,{result:{id,version:2,status:'Terminé'},events:['dossier.closed']});
    assert.equal(closed.headers.get('x-lite-data-changed'),'dossiers,pieces');assert.equal(closed.headers.get('idempotent-replayed'),null);
    assert.equal((await owner(`modules/dossiers/records/${id}/commands/close`,{method:'POST',body:{expectedVersion:1,outcome:'won'}})).status,409,'stale version');
    assert.equal((await owner(`modules/dossiers/records/${id}`)).body.record.data.status,'Terminé');
    // Idempotency-Key header is an alias of the body property; a conflicting pair is refused before the handler.
    assert.equal((await owner('modules/dossiers/commands/open',{method:'POST',body:{idempotencyKey:'a',title:'X',reason:'r'},headers:{'idempotency-key':'b'}})).status,400);
    assert.equal((await owner('modules/dossiers/commands/open',{method:'POST',body:{title:'X',reason:'r'}})).status,400,'idempotencyKey required for creation');
    const first=await owner('modules/dossiers/commands/open',{method:'POST',body:{title:'Nouveau',reason:'Ouverture'},headers:{'idempotency-key':'demo-001'}});
    assert.equal(first.status,201,JSON.stringify(first.body));assert.equal(first.headers.get('idempotent-replayed'),null);assert.equal(first.headers.get('x-lite-data-changed'),'dossiers');
    const again=await owner('modules/dossiers/commands/open',{method:'POST',body:{idempotencyKey:'demo-001',title:'Nouveau',reason:'Ouverture'}});
    assert.equal(again.status,201);assert.deepEqual(again.body,first.body);assert.equal(again.headers.get('idempotent-replayed'),'true');
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM lite_records WHERE module_id='dossiers'").get().n,2);
    assert.equal((await owner(`modules/dossiers/records/${id}/commands/close`,{method:'PUT',body:{expectedVersion:2,outcome:'won'}})).status,404,'method is never derived from the path');
  }finally{db.close();}
});

test('live rights: session, API key and OAuth credentials, group policies, read-only grants and foreign workspaces',async()=>{
  const db=await localDb();try{
    fixtureTables(db);const ext=extensions(grantScope);
    const org=await boot(client(db,alice)),other=await boot(client(db,bob));await boot(client(db,eve));
    db.raw.prepare('INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,?)').run(org,bob.userId,'member');
    db.raw.prepare('INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,?)').run(org,eve.userId,'viewer');
    const owner=caller(db,alice,org,ext),member=caller(db,bob,org,ext),viewer=caller(db,eve,org,ext),foreign=caller(db,bob,other,ext);
    const visible=insertRecord(db,org,'dossiers',{title:'Visible',status:'Ouvert'}),hidden=insertRecord(db,org,'dossiers',{title:'Caché',status:'Ouvert'});
    grant(db,bob.userId,visible,'read');
    // A read grant never suffices for a write; out of scope is not found without existence details.
    assert.equal((await member(`modules/dossiers/records/${visible}`)).status,200);
    const denied=await member(`modules/dossiers/records/${visible}/commands/close`,{method:'POST',body:{expectedVersion:1,outcome:'won'}});
    assert.equal(denied.status,404);assert.equal(denied.body.error.code,'record_not_found');
    assert.equal((await member(`modules/dossiers/records/${hidden}/commands/close`,{method:'POST',body:{expectedVersion:1,outcome:'won'}})).status,404);
    assert.equal((await member(`modules/dossiers/records/${hidden}/history`)).status,404);
    grant(db,bob.userId,visible,'write');
    const session=await member(`modules/dossiers/records/${visible}/commands/close`,{method:'POST',body:{expectedVersion:1,outcome:'won'}});
    assert.equal(session.status,200,JSON.stringify(session.body));
    assert.equal(JSON.parse(db.raw.prepare("SELECT details FROM lite_audit WHERE action='dossiers.close'").get().details).credential,'session');
    // Viewer: command roles default to writers; reads stay allowed; jobs need owner/admin.
    assert.equal((await viewer(`modules/dossiers/records/${visible}/commands/close`,{method:'POST',body:{expectedVersion:2,outcome:'won'}})).status,403);
    assert.equal((await viewer(`modules/dossiers/records/${visible}/history`)).status,404,'viewer without grant sees nothing');
    grant(db,eve.userId,visible,'read');assert.equal((await viewer(`modules/dossiers/records/${visible}/history`)).status,200);
    assert.equal((await viewer('jobs/j1')).status,403);assert.equal((await member('jobs/j1')).status,403);assert.equal((await owner('jobs/j1')).status,200);
    assert.equal((await viewer('/api/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'}})).body.result.tools.some(t=>t.name==='lite_command_dossiers_close'),false);
    // API keys: read mode refuses the mutation, write mode runs it with the live membership.
    const readKey=(await member('access-tokens',{method:'POST',body:{name:'lecture',mode:'read',days:7}}));
    assert.equal(readKey.status,403,'members cannot mint keys; admins can');
    db.raw.prepare('UPDATE lite_members SET role=? WHERE org_id=? AND user_id=?').run('admin',org,bob.userId);
    const read=(await member('access-tokens',{method:'POST',body:{name:'lecture',mode:'read',days:7}})).body.token,write=(await member('access-tokens',{method:'POST',body:{name:'écriture',mode:'write',days:7}})).body.token;
    db.raw.prepare('UPDATE lite_members SET role=? WHERE org_id=? AND user_id=?').run('member',org,bob.userId);
    const readClient=caller(db,null,org,ext,domainApp,read),writeClient=caller(db,null,org,ext,domainApp,write);
    assert.equal((await readClient(`modules/dossiers/records/${visible}/history`)).body.credential,'token');
    assert.equal((await readClient(`modules/dossiers/records/${visible}/commands/close`,{method:'POST',body:{expectedVersion:2,outcome:'won'}})).body.error.code,'read_only_token');
    const second=insertRecord(db,org,'dossiers',{title:'Second',status:'Ouvert'});grant(db,bob.userId,second,'read','write');
    const byKey=await writeClient(`modules/dossiers/records/${second}/commands/close`,{method:'POST',body:{expectedVersion:1,outcome:'lost'}});
    assert.equal(byKey.status,200,JSON.stringify(byKey.body));
    assert.equal((await caller(db,null,null,ext,domainApp,write)(`modules/dossiers/records/${second}/commands/close?workspace=${other}`,{method:'POST',body:{expectedVersion:2,outcome:'lost'}})).body.error.code,'token_workspace');
    // OAuth connection: same catalogue through the MCP endpoint, principal.credential is oauth.
    const third=insertRecord(db,org,'dossiers',{title:'Troisième',status:'Ouvert'});grant(db,bob.userId,third,'read','write');
    const oauth=caller(db,null,org,ext,domainApp,await oauthToken(db,org,bob.userId));
    const viaOAuth=await oauth('/api/mcp',{method:'POST',body:rpc('lite_command_dossiers_close',{id:third,body:{expectedVersion:1,outcome:'won'}})});
    assert.equal(viaOAuth.body.result.isError,undefined,JSON.stringify(viaOAuth.body));
    assert.equal((await oauth('/api/mcp',{method:'POST',body:rpc('lite_read_dossiers_history',{id:third})})).body.result.structuredContent.credential,'oauth');
    const readOnlyOAuth=caller(db,null,org,ext,domainApp,await oauthToken(db,org,bob.userId,'crm:read'));
    assert.equal((await readOnlyOAuth('/api/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'}})).body.result.tools.some(t=>t.name==='lite_command_dossiers_close'),false);
    // Group policies deny the command or the whole module for the live member, including existing keys.
    const group=(await owner('access/groups',{method:'POST',body:{name:'Lecture'}})).body;
    assert.equal((await owner(`access/groups/${group.id}`,{method:'PUT',body:{name:'Lecture',userIds:[bob.userId],version:1}})).status,200);
    assert.equal((await owner(`access/policies/${group.id}`,{method:'PUT',body:{changes:[{operationId:'command.dossiers.close',effect:'deny'}],version:0}})).status,200);
    const fourth=insertRecord(db,org,'dossiers',{title:'Quatrième',status:'Ouvert'});grant(db,bob.userId,fourth,'read','write');
    assert.equal((await member(`modules/dossiers/records/${fourth}/commands/close`,{method:'POST',body:{expectedVersion:1,outcome:'won'}})).body.error.code,'operation_forbidden');
    assert.equal((await writeClient(`modules/dossiers/records/${fourth}/commands/close`,{method:'POST',body:{expectedVersion:1,outcome:'won'}})).status,403);
    assert.equal((await member(`modules/dossiers/records/${fourth}/history`)).status,200);
    db.raw.prepare('INSERT INTO lite_api_policies(org_id,group_id,operation_id,effect) VALUES(?,?,?,?)').run(org,group.id,'module:dossiers','deny');
    assert.equal((await member(`modules/dossiers/records/${fourth}/history`)).status,403);
    assert.equal((await member('/api/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'}})).body.result.tools.some(t=>t.name==='lite_read_dossiers_history'),false);
    // Foreign workspace: the record of another workspace is unknown, whatever the credential.
    assert.equal((await foreign(`modules/dossiers/records/${visible}/history`)).status,404);
    assert.equal((await caller(db,bob,null,ext,domainApp)(`modules/dossiers/records/${fourth}/history?workspace=${other}`)).status,404,'owner of another workspace');
    db.raw.prepare('DELETE FROM lite_members WHERE org_id=? AND user_id=?').run(org,bob.userId);
    assert.equal((await writeClient(`modules/dossiers/records/${second}/history`)).status,401,'removed members lose their keys immediately');
  }finally{db.close();}
});

test('scope filters run before lists, counts, dashboard, search matches and snippets; the default scope leaves native routes unchanged',async()=>{
  const db=await localDb();try{
    fixtureTables(db);const ext=extensions(grantScope);
    const org=await boot(client(db,alice));await boot(client(db,bob));db.raw.prepare('INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,?)').run(org,bob.userId,'member');
    const owner=caller(db,alice,org,ext),member=caller(db,bob,org,ext);
    const a=insertRecord(db,org,'dossiers',{title:'Toiture Zermatt',status:'Ouvert'}),b=insertRecord(db,org,'dossiers',{title:'Toiture Genève',status:'Ouvert'});
    const c=insertRecord(db,org,'clients',{name:'Toiture SA'});
    grant(db,bob.userId,a,'read');
    assert.equal((await owner('modules/dossiers/records')).body.total,2);
    const list=await member('modules/dossiers/records');assert.equal(list.body.total,1);assert.equal(list.body.items[0].id,a);
    assert.equal((await member('modules/dossiers/records?q=toiture')).body.total,1);
    assert.equal((await member(`modules/dossiers/records/${b}`)).status,404);
    assert.deepEqual((await member('dashboard')).body.modules.map(m=>[m.id,m.count]),[['clients',1],['dossiers',1]]);
    assert.deepEqual((await owner('dashboard')).body.modules.map(m=>[m.id,m.count]),[['clients',1],['dossiers',2]]);
    const search=await member('search?q=toiture');
    assert.equal(search.status,200,JSON.stringify(search.body));
    assert.deepEqual(search.body.items.map(i=>i.id).sort(),[a,c].sort(),'matches exclude the hidden record before COUNT');
    assert.equal(search.body.total,2);assert.equal(JSON.stringify(search.body).includes('Genève'),false,'no snippet leaks a hidden record');
    assert.equal((await owner('search?q=toiture')).body.total,3);
    // Workspace-scoped Clients keep their behaviour; PATCH of a plain module still needs the write scope.
    assert.equal((await member(`modules/clients/records/${c}`,{method:'PATCH',body:{data:{name:'Toiture SA'},version:1}})).status,200);
    // A read grant on a native module record is insufficient for its CRUD write.
    const plainScope={...grantScope,recordFilter(principal,ref,action){if(principal.role!=='member')return {sql:'1=1',bindings:[]};return {sql:`EXISTS(SELECT 1 FROM fx_record_grants g WHERE g.record_id=${ref.alias}.${ref.idColumn} AND g.user_id=? AND g.action=?)`,bindings:[principal.userId,action]};}};
    const strict=caller(db,bob,org,extensions(plainScope));
    grant(db,bob.userId,c,'read');
    assert.equal((await strict(`modules/clients/records/${c}`)).status,200);
    assert.equal((await strict(`modules/clients/records/${c}`,{method:'PATCH',body:{data:{name:'Changé'},version:2}})).status,404);
    assert.equal((await strict(`modules/clients/records/${c}`,{method:'DELETE',body:{version:2}})).status,404);
    assert.equal(db.raw.prepare('SELECT version FROM lite_records WHERE id=?').get(c).version,2);
    grant(db,bob.userId,c,'write');
    assert.equal((await strict(`modules/clients/records/${c}`,{method:'PATCH',body:{data:{name:'Changé'},version:2}})).status,200);
    // Without a provider, openScope keeps the whole workspace visible.
    const open=caller(db,bob,org,defineExtensions(domainApp,{scope:openScope}));
    assert.equal((await open('modules/dossiers/records')).body.total,2);assert.equal((await caller(db,bob,org,{})('modules/dossiers/records')).body.total,2);
  }finally{db.close();}
});

test('files: read scope on list, metadata and download; write scope then the configured deleteFile owns every deletion without an R2 fallback',async()=>{
  const db=await localDb();const bucket=fakeBucket();try{
    fixtureTables(db);
    const org=await boot(client(db,alice));await boot(client(db,bob));db.raw.prepare('INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,?)').run(org,bob.userId,'member');
    const owner=caller(db,alice,org,extensions(deletingScope),domainApp,undefined,bucket),member=caller(db,bob,org,extensions(deletingScope),domainApp,undefined,bucket);
    const upload=await owner('files',{method:'POST',body:new TextEncoder().encode('contenu'),headers:{'x-file-name':'rapport.pdf'}});assert.equal(upload.status,201,JSON.stringify(upload.body));
    const fileId=upload.body.id;
    assert.equal((await member('files')).body.items.length,0);assert.equal((await member(`files/${fileId}/metadata`)).status,404);assert.equal((await member(`files/${fileId}`)).status,404);
    db.raw.prepare('INSERT INTO fx_file_grants(user_id,file_id,action) VALUES(?,?,?)').run(bob.userId,fileId,'read');
    assert.equal((await member('files')).body.items.length,1);assert.equal((await member(`files/${fileId}/metadata`)).body.file.name,'rapport.pdf');
    assert.equal((await member(`files/${fileId}`,{raw:true})).status,200);
    assert.equal((await member(`files/${fileId}`,{method:'DELETE'})).status,404,'a read grant never deletes');
    assert.equal(bucket.store.size,1);assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM fx_deletions').get().n,0);
    db.raw.prepare('INSERT INTO fx_file_grants(user_id,file_id,action) VALUES(?,?,?)').run(bob.userId,fileId,'write');
    const calls=[];const original=bucket.delete;bucket.delete=async(key)=>{calls.push(key);return original(key);};
    const removed=await member(`files/${fileId}`,{method:'DELETE'});
    assert.deepEqual(removed.body,{ok:true,cleanup:'queued'});
    assert.equal(calls.length,0,'the kit never deletes the R2 object itself when a policy is configured');assert.equal(bucket.store.size,1);
    assert.equal(db.raw.prepare('SELECT requested_by FROM fx_deletions WHERE file_id=?').get(fileId).requested_by,bob.userId);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM lite_audit WHERE action='file.delete'").get().n,0,'no native tombstone or audit runs in parallel');
    assert.equal((await member(`files/${fileId}`)).status,404,'the tombstone refuses the download even though R2 still holds the object');
    assert.equal((await owner(`files/${fileId}/metadata`)).status,404);
    assert.equal((await owner(`files/${fileId}`,{method:'DELETE'})).status,409,'the policy classifies a repeated request itself');
    // Without deleteFile the native path is unchanged: tombstone, audit, bucket delete, cleanup complete.
    const native=caller(db,alice,org,extensions(grantScope),domainApp,undefined,bucket);
    const again=await native('files',{method:'POST',body:new Uint8Array([1,2,3]),headers:{'x-file-name':'natif.bin'}});
    const nativeDelete=await native(`files/${again.body.id}`,{method:'DELETE'});
    assert.deepEqual(nativeDelete.body,{ok:true,cleanup:'complete'});assert.equal(bucket.store.size,1);assert.equal(calls.length,1);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM lite_audit WHERE action='file.delete'").get().n,1);
    // Viewers cannot delete at all, before any lookup.
    db.raw.prepare('UPDATE lite_members SET role=? WHERE org_id=? AND user_id=?').run('viewer',org,bob.userId);
    assert.equal((await member(`files/${fileId}`,{method:'DELETE'})).status,403);
  }finally{db.close();}
});

test('a handler failure never leaks details and deferred work completes before the response is final without defer',async()=>{
  const db=await localDb();try{
    fixtureTables(db);
    let deferred=false;
    const ext=defineExtensions(domainApp,{operations:[
      command({moduleId:'dossiers',moduleName:'Dossiers',name:'explode',description:'Échoue',target:'module',idempotencyKey:'none',async handle(){throw new Error('secret detail');}}),
      command({moduleId:'dossiers',moduleName:'Dossiers',name:'later',description:'Diffère',target:'module',idempotencyKey:'none',async handle(ctx){ctx.defer(new Promise(r=>setTimeout(()=>{deferred=true;r();},10)));return {status:202,body:{queued:true}};}}),
      command({moduleId:'dossiers',moduleName:'Dossiers',name:'bogus',description:'Statut invalide',target:'module',idempotencyKey:'none',async handle(){return {status:302,body:{}};}}),
    ]});
    const org=await boot(client(db,alice)),owner=caller(db,alice,org,ext);
    const failed=await owner('modules/dossiers/commands/explode',{method:'POST',body:{}});
    assert.equal(failed.status,503);assert.equal(JSON.stringify(failed.body).includes('secret'),false);
    const later=await owner('modules/dossiers/commands/later',{method:'POST',body:{}});assert.equal(later.status,202);assert.equal(deferred,true);
    assert.equal((await owner('modules/dossiers/commands/bogus',{method:'POST',body:{}})).status,503);
    assert.throws(()=>command({moduleId:'dossiers',name:'x',description:'d',fields:{expectedVersion:{type:'integer'}},async handle(){}}),/réservé/);
    assert.throws(()=>command({moduleId:'dossiers',name:'x',description:'d',fields:{command:{type:'string'}},async handle(){}}),/refusé/);
    assert.throws(()=>command({moduleId:'dossiers',name:'Bad Name',description:'d',async handle(){}}),/invalide/);
    assert.throws(()=>read({moduleId:'dossiers',name:'records',description:'d',async handle(){}}),/invalide/);
    assert.throws(()=>defineExtensions(domainApp,{scope:{recordFilter:()=>({sql:'1=1',bindings:[]})}}),/ScopeProvider/);
  }finally{db.close();}
});
