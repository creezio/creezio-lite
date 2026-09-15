import './register-native-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { root,alice,client,boot,clientData,migrationSql } from './helpers.mjs';

function observe(db){
  const raw=new WeakMap(),stats={trips:0,writes:0};
  const write=sql=>/^(?:INSERT|UPDATE|DELETE)/i.test(sql.trim());
  function wrap(statement,sql){
    const wrapped={bind(...values){return wrap(statement.bind(...values),sql)}};
    for(const method of ['first','all','run'])wrapped[method]=async(...args)=>{stats.trips++;if(write(sql))stats.writes++;return statement[method](...args);};
    raw.set(wrapped,{statement,sql});return wrapped;
  }
  return {stats,reset(){stats.trips=0;stats.writes=0;},db:{prepare:sql=>wrap(db.prepare(sql),sql),async batch(statements){stats.trips++;const entries=statements.map(s=>raw.get(s));stats.writes+=entries.filter(e=>write(e.sql)).length;return db.batch(entries.map(e=>e.statement));}}};
}

test('Search has bounded D1 trips and no steady-state writes; policies stay current',async t=>{
  const deps=createRequire(join(root,'template/package.json')),wrangler=createRequire(deps.resolve('wrangler/package.json'));
  const {Miniflare}=await import(pathToFileURL(wrangler.resolve('miniflare')).href);
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],cf:false});
  try{
    const db=await mf.getD1Database('DB');for(const sql of (await migrationSql()).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
    const owner=client(db,alice);await boot(owner);
    const made=await owner('modules/clients/records',{method:'POST',body:{data:{...clientData,name:'Réda',notes:'secretword'}}});assert.equal(made.status,201);
    const meter=observe(db),search=client(meter.db,alice);
    let result=await search('search?q=reda');assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.indexing,false);assert.equal(result.body.items[0].id,made.body.record.id);
    assert.ok(meter.stats.trips<=5,JSON.stringify(meter.stats));t.diagnostic(`First one-record search: ${meter.stats.trips} D1 trips`);
    for(const route of ['search?q=reda','search?q=reda','modules/clients/records?q=reda']){
      meter.reset();result=await search(route);assert.equal(result.status,200);assert.equal(result.body.total,1);
      assert.ok(meter.stats.trips<=3,JSON.stringify(meter.stats));assert.equal(meter.stats.writes,0);
    }
    t.diagnostic(`Ready search: ${meter.stats.trips} D1 trips, ${meter.stats.writes} writes`);
    await owner('admin/search/clients',{method:'PUT',body:{enabled:true,fields:['name'],version:0}});
    meter.reset();assert.equal((await search('search?q=secretword')).body.total,0);assert.equal(meter.stats.writes,0);
    await owner('admin/search/clients',{method:'PUT',body:{enabled:false,fields:['name'],version:1}});
    assert.equal((await search('search?q=reda')).body.total,0);
    await owner('admin/search/clients',{method:'PUT',body:{enabled:true,fields:['name'],version:2}});
    await owner(`modules/clients/records/${made.body.record.id}`,{method:'PATCH',body:{version:1,data:{...clientData,name:'Changement immédiat'}}});
    assert.equal((await search('search?q=changement')).body.total,1);assert.equal((await search('search?q=reda')).body.total,0);
    const reset=await owner('admin/search/reindex',{method:'POST',body:{reset:true}});assert.equal(reset.status,200,JSON.stringify(reset.body));assert.equal(reset.body.indexing,false);
    assert.equal((await search('search?q=changement')).body.total,1);
  }finally{await mf.dispose();}
});
