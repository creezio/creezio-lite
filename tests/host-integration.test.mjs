import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp,doctor} from '../bin/lite.mjs';
test('doctor identifies legacy Sites bridge without overwriting app code',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'lite-host-contract-')),app=join(parent,'app');
 try{
  await createApp({out:app,spec:fileURLToPath(new URL('../examples/services.json',import.meta.url))});
  assert.deepEqual((await doctor(app)).hostIntegration,{paneRouter:'managed',migrationRequired:false});
  await writeFile(join(app,'app/sites-pane-router.tsx'),'export function SitesPaneRouter(){return null;}');
  const report=await doctor(app);assert.equal(report.ok,true);assert.deepEqual(report.hostIntegration,{paneRouter:'legacy',migrationRequired:true});
 }finally{await rm(parent,{recursive:true,force:true});}
});
