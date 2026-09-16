import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {localDatabase,migrate} from '../template/scripts/migrate-local.mjs';
test('all native migrations apply on empty D1 and replay without modification',async()=>{
 const local=await localDatabase();
 try{
 const dir=fileURLToPath(new URL('../template/drizzle',import.meta.url));
 assert.equal(await migrate(local.db,dir),11);
 assert.equal(await migrate(local.db,dir),0);
 assert.equal((await local.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='lite_search_document_insert'").all()).results.length,1);
 await local.db.prepare("INSERT INTO lite_orgs(id,name,created_at) VALUES('fixture-org','Fixture','2026-09-16T00:00:00Z')").run();
 await local.db.prepare("INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) VALUES('fixture-org','fixtures','fixture-record',?,?)").bind(JSON.stringify({title:'Fixture migration',active:true}),new Date().toISOString()).run();
 assert.equal((await local.db.prepare("SELECT value FROM lite_search_fts WHERE field_key='active'").first()).value,'true oui 1');
 }finally{await local.dispose();}
});
test('failed migration rolls back its schema and completion marker',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lite-migrate-'));const local=await localDatabase();
 try{
 await writeFile(join(dir,'0000_failure.sql'),'CREATE TABLE fixture(id TEXT);\n--> statement-breakpoint\nINSERT INTO absent_table VALUES(1);');
 await assert.rejects(migrate(local.db,dir));
 assert.equal((await local.db.prepare("SELECT name FROM sqlite_master WHERE name='fixture'").all()).results.length,0);
 assert.equal((await local.db.prepare('SELECT name FROM d1_migrations').all()).results.length,0);
 }finally{await local.dispose();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(dir.includes('lite-migrate-'));await rm(dir,{recursive:true,force:true});}
});
