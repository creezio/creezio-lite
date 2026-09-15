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
