import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {readdir} from 'node:fs/promises';
import {createApp,addModule,doctor} from '../bin/lite.mjs';
test('fresh apps and added modules receive executable contracts and local documentation',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'lite-module-scaffold-')),app=join(parent,'app');
 try{
  await createApp({out:app,spec:fileURLToPath(new URL('../examples/services.json',import.meta.url))});
  const check=()=>{const result=spawnSync(process.execPath,['scripts/check-module-contracts.mjs'],{cwd:app,encoding:'utf8'});assert.equal(result.status,0,result.stderr+result.stdout);};check();
  const spec={id:'notes',name:'Notes',singular:'Note',description:'Notes partagées',titleField:'name',fields:[{key:'name',type:'text',label:'Title',required:true}]},path=join(parent,'module.json');await writeFile(path,JSON.stringify(spec));await addModule(app,path);check();
  assert.match(await readFile(join(app,'app/modules/notes/PRD.md'),'utf8'),/Notes partagées/);assert.equal((await doctor(app)).ok,true);
  const db=new DatabaseSync(':memory:');
  try{
   for(const file of (await readdir(join(app,'drizzle'))).filter(f=>f.endsWith('.sql')).sort())db.exec(await readFile(join(app,'drizzle',file),'utf8'));
   const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
   const brand=JSON.parse(await readFile(join(app,'brand.json'),'utf8'));
   for(const module of brand.modules)assert.ok(tables.includes('mod_'+module.id.replaceAll('-','_')));
   db.exec("INSERT INTO lite_orgs(id,name,created_at) VALUES('scope','Scope','2026-09-21')");
   db.exec("INSERT INTO mod_notes(id,org_id,name,created_by,created_at,updated_at) VALUES('one','scope','Persisted','alice','2026-09-21','2026-09-21')");
   assert.equal(db.prepare("SELECT name FROM mod_notes WHERE id='one'").get().name,'Persisted');
   assert.equal(db.prepare("SELECT COUNT(*) n FROM lite_records WHERE module_id='notes'").get().n,0);
   assert.equal(db.prepare("SELECT COUNT(*) n FROM lite_search_documents WHERE module_id='notes'").get().n,1);
   assert.match(await readFile(join(app,'app/modules/notes/index.ts'),'utf8'),/kind:'relational'/);
   assert.ok(JSON.parse(await readFile(join(app,'drizzle/meta/_journal.json'),'utf8')).entries.some(e=>e.tag.endsWith('_mod_notes')));
  }finally{db.close();}
  const ownedPath=join(app,'app/modules/notes/schema.json');
  const owned=JSON.parse(await readFile(ownedPath,'utf8'));owned.fields.push({key:'memo',type:'text',label:'Memo'});await writeFile(ownedPath,JSON.stringify(owned));
  const stale=spawnSync(process.execPath,['scripts/check-module-contracts.mjs'],{cwd:app,encoding:'utf8'});assert.notEqual(stale.status,0);assert.match(stale.stderr,/Schema snapshot out of date|Storage migration required/);
  const sync=spawnSync(process.execPath,['scripts/sync-module-schemas.mjs'],{cwd:app,encoding:'utf8'});assert.equal(sync.status,0,sync.stderr);
  const missingMigration=spawnSync(process.execPath,['scripts/check-module-contracts.mjs'],{cwd:app,encoding:'utf8'});assert.notEqual(missingMigration.status,0);assert.match(missingMigration.stderr,/Storage migration required.*memo/);
  assert.equal(JSON.parse(await readFile(join(app,'brand.json'),'utf8')).modules.find(m=>m.id==='notes').fields.at(-1).key,'memo');
  const registry=join(app,'app/modules/index.ts');await writeFile(registry,'// Hand maintained registry\n');const brand=await readFile(join(app,'brand.json'),'utf8');await writeFile(path,JSON.stringify({...spec,id:'other'}));await assert.rejects(addModule(app,path),/customised/);assert.equal(await readFile(join(app,'brand.json'),'utf8'),brand);
 }finally{await rm(parent,{recursive:true,force:true});}
});
