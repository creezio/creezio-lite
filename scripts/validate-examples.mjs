import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp, doctor } from '../bin/lite.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const staging=await mkdtemp(join(tmpdir(),'lite-build-'));
function run(cwd,args){
  const direct=spawnSync('pnpm',args,{cwd,stdio:'inherit'});
  if(!direct.error&&direct.status===0)return;
  const fallback=process.platform==='win32'
    ? spawnSync(process.env.ComSpec??'cmd.exe',['/d','/s','/c',['corepack','pnpm',...args].join(' ')],{cwd,stdio:'inherit'})
    : spawnSync('corepack',['pnpm',...args],{cwd,stdio:'inherit'});
  if(fallback.error)throw fallback.error;
  if(fallback.status!==0)throw new Error(`pnpm ${args.join(' ')}: ${fallback.status}`);
}
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
