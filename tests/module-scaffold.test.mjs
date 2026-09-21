import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {createApp,addModule,doctor} from '../bin/lite.mjs';
test('fresh apps and added modules receive executable contracts and local documentation',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'lite-module-scaffold-')),app=join(parent,'app');
 try{
  await createApp({out:app,spec:fileURLToPath(new URL('../examples/services.json',import.meta.url))});
  const check=()=>{const result=spawnSync(process.execPath,['scripts/check-module-contracts.mjs'],{cwd:app,encoding:'utf8'});assert.equal(result.status,0,result.stderr+result.stdout);};check();
  const spec={id:'notes',name:'Notes',singular:'Note',description:'Notes partagées',titleField:'name',fields:[{key:'name',type:'text',label:'Title',required:true}]},path=join(parent,'module.json');await writeFile(path,JSON.stringify(spec));await addModule(app,path);check();
  assert.match(await readFile(join(app,'app/modules/notes/PRD.md'),'utf8'),/Notes partagées/);assert.equal((await doctor(app)).ok,true);
  const ownedPath=join(app,'app/modules/notes/schema.json');
  const owned=JSON.parse(await readFile(ownedPath,'utf8'));owned.fields.push({key:'memo',type:'text',label:'Memo'});await writeFile(ownedPath,JSON.stringify(owned));
  const stale=spawnSync(process.execPath,['scripts/check-module-contracts.mjs'],{cwd:app,encoding:'utf8'});assert.notEqual(stale.status,0);assert.match(stale.stderr,/Schema snapshot out of date/);
  const sync=spawnSync(process.execPath,['scripts/sync-module-schemas.mjs'],{cwd:app,encoding:'utf8'});assert.equal(sync.status,0,sync.stderr);check();
  assert.equal(JSON.parse(await readFile(join(app,'brand.json'),'utf8')).modules.find(m=>m.id==='notes').fields.at(-1).key,'memo');
  const registry=join(app,'app/modules/index.ts');await writeFile(registry,'// Hand maintained registry\n');const brand=await readFile(join(app,'brand.json'),'utf8');await writeFile(path,JSON.stringify({...spec,id:'other'}));await assert.rejects(addModule(app,path),/customised/);assert.equal(await readFile(join(app,'brand.json'),'utf8'),brand);
 }finally{await rm(parent,{recursive:true,force:true});}
});
