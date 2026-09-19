import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { root,alice,bob,client,boot,clientData,migrationSql } from './helpers.mjs';
test('Cloudflare D1/R2: migration, transaction, invitation, conflict and binary round trip',async()=>{
  const templateRequire=createRequire(join(root,'template/package.json'));
  const wranglerRequire=createRequire(templateRequire.resolve('wrangler/package.json'));
  const {Miniflare}=await import(pathToFileURL(wranglerRequire.resolve('miniflare')).href);
  const mf=new Miniflare({modules:true,script:'export default { fetch(){return new Response("ok")} }',compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET'],cf:false});
  try{const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET');
    for(const sql of (await migrationSql()).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
    const a=client(db,alice,bucket),b=client(db,bob,bucket),aw=await boot(a);await boot(b);
    const created=await a('modules/clients/records',{method:'POST',body:{data:clientData}});assert.equal(created.status,201,JSON.stringify(created.body));
    const id=created.body.record.id;
    assert.equal((await a(`modules/clients/records/${id}`,{method:'PATCH',body:{data:{...clientData,name:'D1 réel'},version:1}})).status,200);
    assert.equal((await a(`modules/clients/records/${id}`,{method:'PATCH',body:{data:clientData,version:1}})).status,409);
    const inv=await a('invites',{method:'POST',body:{email:bob.email,role:'viewer'}});assert.equal((await b('invites/accept',{method:'POST',body:{token:inv.body.token}})).status,200);
    assert.equal((await b(`modules/clients/records?workspace=${aw}`)).body.total,1);
    assert.equal((await b(`modules/clients/records?workspace=${aw}`,{method:'POST',body:{data:clientData}})).status,403);
    const bytes=new Uint8Array([0,1,2,255]),file=await a('files',{method:'POST',body:bytes,headers:{'x-file-name':'test.bin'}});assert.equal(file.status,201,JSON.stringify(file.body));
    const response=await a(`files/${file.body.id}`,{raw:true});assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
    await a(`files/${file.body.id}`,{method:'DELETE'});assert.equal((await a(`files/${file.body.id}`)).status,404);
    assert.equal((await a('audit')).body.items.filter(x=>x.action==='clients.update').length,1);
  }finally{await mf.dispose();}
});
test('Cloudflare D1 translates only a real unique record collision to opaque409 and rolls back its audit',async()=>{
  const templateRequire=createRequire(join(root,'template/package.json'));
  const wranglerRequire=createRequire(templateRequire.resolve('wrangler/package.json'));
  const {Miniflare}=await import(pathToFileURL(wranglerRequire.resolve('miniflare')).href);
  const mf=new Miniflare({modules:true,script:'export default { fetch(){return new Response("ok")} }',compatibilityDate:'2026-05-15',d1Databases:['DB'],cf:false});
  try{const db=await mf.getD1Database('DB');for(const sql of (await migrationSql()).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
    await db.prepare("CREATE UNIQUE INDEX uq_runtime_client_name ON lite_records(org_id,module_id,lower(trim(json_extract(data,'$.name')))) WHERE deleted_at IS NULL").run();
    const a=client(db,alice),org=await boot(a),created=await a('modules/clients/records',{method:'POST',body:{data:clientData}});assert.equal(created.status,201,JSON.stringify(created.body));
    const conflict=await a('modules/clients/records',{method:'POST',body:{data:{...clientData,email:'other@example.test'}}});assert.equal(conflict.status,409,JSON.stringify(conflict.body));assert.equal(conflict.body.error.code,'unique_conflict');assert.match(conflict.body.error.message,/unique.*utilisée/i);assert.doesNotMatch(JSON.stringify(conflict.body),/uq_runtime|lite_records|client_name/i);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM lite_records WHERE org_id=? AND module_id='clients'").bind(org).first()).n,1);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM lite_audit WHERE org_id=? AND action='clients.create'").bind(org).first()).n,1);
    const unknown=client({prepare:db.prepare.bind(db),async batch(){throw new Error('SQLITE_CONSTRAINT_CHECK private');}},alice);const failed=await unknown(`modules/clients/records?workspace=${org}`,{method:'POST',body:{data:{...clientData,name:'Autre'}}});assert.equal(failed.status,503);assert.equal(failed.body.error.code,'service_unavailable');assert.doesNotMatch(JSON.stringify(failed.body),/SQLITE|private/);
  }finally{await mf.dispose();}
});
