import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {scaffoldModuleStorage} from '../bin/module-storage.mjs';
import {mkdir} from 'node:fs/promises';
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

test('historical SQL table names never collide with generated TypeScript imports',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'lite-table-names-')),app=join(parent,'app');
 try{
  await createApp({out:app,spec:fileURLToPath(new URL('../examples/services.json',import.meta.url))});
  for(const table of ['organizations','text','integer','real','index','check','sql']){
   const schema={id:'entity-'+table,name:table,singular:table,titleField:'name',fields:[{key:'name',label:'Name',type:'text',required:true},{key:'amount',label:'Amount',type:'number'},{key:'quantity',label:'Quantity',type:'number',integer:true}]};
   await mkdir(join(app,'app/modules',schema.id),{recursive:true});
   await scaffoldModuleStorage(app,schema,{table});
   const source=await readFile(join(app,'app/modules',schema.id,'db-schema.ts'),'utf8');
   const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{input:source,encoding:'utf8'});
   assert.equal(syntax.status,0,table+': '+syntax.stderr);
  }
  const db=new DatabaseSync(':memory:');try{
   for(const file of (await readdir(join(app,'drizzle'))).filter(f=>f.endsWith('.sql')).sort())db.exec(await readFile(join(app,'drizzle',file),'utf8'));
   for(const table of ['organizations','text','integer','real','index','check','sql'])assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table).name,table);
  }finally{db.close();}
 }finally{await rm(parent,{recursive:true,force:true});}
});

test('oversized new modules fail before changing configuration, existing modules or migration history',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'lite-module-limits-')),app=join(parent,'app');
 try{
  await createApp({out:app,spec:fileURLToPath(new URL('../examples/services.json',import.meta.url))});
  const config=join(app,'drizzle.config.ts');await writeFile(config,"export default {schema: './db/schema.ts'};\n");
  const snapshot=async()=>{
   const result={};
   async function walk(dir,prefix=''){for(const entry of await readdir(dir,{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())await walk(join(dir,entry.name),name+'/');else result[name]=(await readFile(join(dir,entry.name))).toString('base64');}}
   await walk(app);return result;
  };
  const before=await snapshot();
  const normal={id:'new-normal',name:'Normal',singular:'Normal',description:'New',titleField:'name',fields:[{key:'name',label:'Name',type:'text',required:true}]};
  const wide={...normal,id:'new-wide',serverFields:Array.from({length:93},(_,i)=>({key:'value_'+i,label:'Value '+i,type:'text'}))};
  const path=join(parent,'module.json');await writeFile(path,JSON.stringify(wide));
  await assert.rejects(addModule(app,path),/100 columns/);assert.deepEqual(await snapshot(),before);
  const {scaffoldModules}=await import('../bin/module-scaffold.mjs');
  await assert.rejects(scaffoldModules(app,[normal,wide]),/100 columns/);assert.deepEqual(await snapshot(),before);
 }finally{await rm(parent,{recursive:true,force:true});}
});
