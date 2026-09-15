import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp, doctor } from '../bin/creezio-lite.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const staging=await mkdtemp(join(tmpdir(),'creezio-lite-build-'));
function run(cwd,args){const r=spawnSync('pnpm',args,{cwd,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw new Error(`pnpm ${args.join(' ')}: ${r.status}`);}
try {
  for(const name of ['services','catalogue']){
    const specPath=join(root,'examples',`${name}.json`);
    const spec=JSON.parse(await readFile(specPath,'utf8'));
    const target=join(staging,name);
    await createApp({spec:specPath,out:target});
    const report=await doctor(target);if(!report.ok)throw new Error(report.issues.join('\n'));
    run(target,['install','--frozen-lockfile']);
    run(target,['run','typecheck']);
    run(target,['run','build']);
    console.log(`Application indépendante validée : ${spec.name}`);
  }
} finally { await rm(staging,{recursive:true,force:true}); }
