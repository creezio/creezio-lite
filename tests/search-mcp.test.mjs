import './register-native-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app,root,alice,bob,client,boot,clientData,localDb } from './helpers.mjs';
import { defineApp } from '../runtime/core/validation.ts';
const { dispatchRequest } = await import('../runtime/modules/sites-adapter/src/dispatch.ts');
const { nativeEntries } = await import('../runtime/modules/sites-adapter/src/nav.ts');

test('D1 full text: existing Reda, automatic module registration, field policy, ACL and transactional updates',async()=>{
  const req=createRequire(join(root,'template/package.json')),wrangler=createRequire(req.resolve('wrangler/package.json'));
  const {Miniflare}=await import(pathToFileURL(wrangler.resolve('miniflare')).href);
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],cf:false});
  try{
    const db=await mf.getD1Database('DB');
    const files=(await readdir(join(root,'template/drizzle'))).filter(f=>f.endsWith('.sql')).sort();
    const migrate=async names=>{for(const file of names)for(const sql of (await readFile(join(root,'template/drizzle',file),'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();};
    await migrate(files.slice(0,2));
    const a=client(db,alice),b=client(db,bob),org=await boot(a);await boot(b);
    // Seed a real pre-upgrade row before the search/admin migrations exist.
    const id='legacy-record-001';
    await db.prepare('INSERT INTO lite_records(id,org_id,module_id,data,search_text,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)').bind(id,org,'clients',JSON.stringify({...clientData,name:'Réda',company:'Bureau',notes:'zebraprivate'}),'réda bureau zebraprivate',alice.userId,new Date().toISOString(),new Date().toISOString()).run();
    const beforeIndex=Array.from({length:51},(_,n)=>db.prepare('INSERT INTO lite_records(id,org_id,module_id,data,search_text,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)').bind(`old-${String(n).padStart(3,'0')}`,org,'clients',JSON.stringify({...clientData,name:`Lot historique ${n}`}),`lot historique ${n}`,alice.userId,new Date().toISOString(),new Date().toISOString()));
    await db.batch(beforeIndex);
    await migrate(files.slice(2));
    let found=await a('search?q=reda');assert.equal(found.status,200,JSON.stringify(found.body));assert.equal(found.body.indexing,true);
    found=await a('search?q=reda');assert.equal(found.body.indexing,false);assert.equal(found.body.items[0].id,id);
    const firstPage=(await a('search?q=historique&limit=30')).body,secondPage=(await a('search?q=historique&limit=30&offset=30')).body;
    assert.equal(firstPage.total,51);assert.equal(firstPage.items.length,30);assert.equal(secondPage.items.length,21);assert.equal(new Set([...firstPage.items,...secondPage.items].map(x=>x.id)).size,51);assert.match(found.body.items[0].href,new RegExp(`record=${id}`));
    assert.equal((await a('search?q=reda%20bureau')).body.total,1);
    assert.equal((await a('search?q=red')).body.total,1);
    assert.equal((await a('modules/clients/records?q=reda')).body.total,1);
    assert.equal((await b('search?q=reda')).body.total,0);
    assert.equal((await b(`search?q=reda&workspace=${org}`)).status,404);
    assert.equal((await a('admin/search/clients',{method:'PUT',body:{enabled:true,fields:['name','company'],version:0}})).status,200);
    assert.equal((await a('search?q=zebraprivate')).body.total,0);
    assert.equal((await a('modules/clients/records?q=zebraprivate')).body.total,0);
    assert.equal((await a('admin/search/clients',{method:'PUT',body:{enabled:false,fields:[],version:0}})).status,409);
    assert.equal((await a('admin/search/clients',{method:'PUT',body:{enabled:false,fields:[],version:1}})).status,200);
    assert.equal((await a('search?q=reda')).body.total,0);
    await a('admin/search/clients',{method:'PUT',body:{enabled:true,fields:['name','company'],version:2}});
    const invite=await a('invites',{method:'POST',body:{email:bob.email,role:'viewer'}});await b('invites/accept',{method:'POST',body:{token:invite.body.token}});
    assert.equal((await b(`search?q=reda&workspace=${org}`)).body.total,1);
    assert.equal((await b(`admin/search?workspace=${org}`)).status,403);
    assert.equal((await a(`modules/clients/records/${id}`,{method:'PATCH',body:{version:1,data:{...clientData,name:'Nouveau Nom'}}})).status,200);
    assert.equal((await a('search?q=reda')).body.total,0);assert.equal((await a('search?q=nouveau')).body.total,1);
    await a(`modules/clients/records/${id}`,{method:'DELETE',body:{version:2}});assert.equal((await a('search?q=nouveau')).body.total,0);
    const definition=defineApp({...app,modules:[...app.modules,{id:'recettes',name:'Recettes',singular:'Recette',description:'Cuisine',titleField:'name',readRoles:['owner','admin'],fields:[{key:'name',label:'Nom',type:'text',required:true}]}]});
    const custom=client(db,alice,undefined,definition),restricted=client(db,bob,undefined,definition);
    assert.ok(nativeEntries(definition).some(m=>m.href==='/recettes'));
    assert.ok((await custom('registry')).body.modules.some(m=>m.id==='recettes'));
    const recipe=await custom('modules/recettes/records',{method:'POST',body:{data:{name:'Soupe nouvelle carotte tomate salade maison chaude'}}});assert.equal(recipe.status,201);
    assert.equal((await custom('search?q=soupe')).body.total,1);
    assert.equal((await custom('search?q=soupe%20nouvelle%20carotte%20tomate%20salade%20maison%20chaude')).body.total,1);
    const {dataTools}=await import('../runtime/core/tools.ts');
    assert.ok(dataTools(definition,'owner',async()=>({})).some(t=>t.name==='lite_recettes_create'));
    assert.equal((await restricted(`search?q=soupe&workspace=${org}`)).body.total,0);
    const count=await db.prepare('SELECT COUNT(*) AS n FROM lite_search_fts').first();assert.ok(count.n>0);
  }finally{await mf.dispose();}
});

test('HTTP MCP and API credentials share modules, permissions, origin checks and revocation',async()=>{
  const db=await localDb();try{
    const owner=client(db,alice),org=await boot(owner);
    const issued=await owner('access-tokens',{method:'POST',body:{name:'Read test',mode:'read',days:7}});assert.equal(issued.status,201);
    const token=issued.body.token;
    const context={app,env:{DB:db},identity:null};
    const call=async(path,{method='GET',body,credential=token,origin}={})=>{
      const response=await dispatchRequest(new Request(`https://test.example${path}`,{method,headers:{...(credential?{authorization:`Bearer ${credential}`} : {}),...(body?{'content-type':'application/json',accept:'application/json, text/event-stream'}:{}),...(origin?{origin}:{})},...(body?{body:JSON.stringify(body)}:{})}),context);
      return {status:response.status,body:await response.json()};
    };
    const rpc=(method,params,credential=token)=>call('/api/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method,params},credential});
    assert.equal((await rpc('initialize',{protocolVersion:'2025-11-25'})).body.result.serverInfo.name,'lite');
    let tools=(await rpc('tools/list',{})).body.result.tools;
    assert.ok(tools.some(t=>t.name==='lite_clients_list'));assert.ok(!tools.some(t=>t.name==='lite_clients_create'));
    assert.equal((await call('/api/v1/modules/clients/records',{method:'POST',body:{data:clientData}})).status,403);
    assert.equal((await call('/api/v1/search?q=reda&workspace=another')).status,403);
    assert.equal((await call('/api/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'},origin:'https://evil.example'})).status,403);
    assert.equal((await call('/api/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'},credential:''})).status,401);
    const write=(await owner('access-tokens',{method:'POST',body:{name:'Write test',mode:'write',days:7}})).body.token;
    const made=await rpc('tools/call',{name:'lite_clients_create',arguments:{data:{...clientData,name:'Reda MCP'}}},write);assert.equal(made.body.result.isError,undefined,JSON.stringify(made.body));
    const id=made.body.result.structuredContent.record.id;
    const found=await rpc('tools/call',{name:'lite_search',arguments:{query:'reda'}},write);assert.equal(found.body.result.structuredContent.items[0].id,id);
    assert.equal((await call('/api/v1/access-tokens',{method:'POST',body:{name:'escape',mode:'write',days:7},credential:write})).status,403);
    await owner(`access-tokens/${issued.body.id}`,{method:'DELETE'});assert.equal((await rpc('tools/list',{})).status,401);
    const raw=db.raw.prepare('SELECT token_hash FROM lite_access_tokens').all();assert.ok(raw.every(r=>r.token_hash!==token&&!r.token_hash.startsWith('lite_')));
    db.raw.prepare('DELETE FROM lite_members WHERE org_id=? AND user_id=?').run(org,alice.userId);
    assert.equal((await rpc('tools/list',{},write)).status,401);
  }finally{db.close();}
});
