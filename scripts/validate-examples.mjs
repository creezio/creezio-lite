import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp, doctor } from '../bin/lite.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export function runPnpm(cwd,args,{spawn=spawnSync,platform=process.platform,comspec=process.env.ComSpec??'cmd.exe'}={}){
  const options={cwd,stdio:'inherit'};
  let result;
  if(platform==='win32'){
    // .cmd shims must run through cmd.exe. Decide availability before running
    // the task: a failed install/check/build must never trigger a second run.
    const available=spawn(comspec,['/d','/s','/c','where pnpm'],{cwd,stdio:'ignore'});
    if(available.error)throw available.error;
    const command=available.status===0?['pnpm',...args]:['corepack','pnpm',...args];
    result=spawn(comspec,['/d','/s','/c',command.join(' ')],options);
  }else{
    result=spawn('pnpm',args,options);
    if(result.error?.code==='ENOENT')result=spawn('corepack',['pnpm',...args],options);
  }
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`pnpm ${args.join(' ')}: ${result.status??result.signal??'execution failed'}`);
}
export async function validateExamples(){
  const staging=await mkdtemp(join(tmpdir(),'lite-build-'));
  try {
    for(const name of ['services','catalogue']){
      const specPath=join(root,'examples',`${name}.json`);
      const spec=JSON.parse(await readFile(specPath,'utf8'));
      const target=join(staging,name);
      await createApp({spec:specPath,out:target});
      const report=await doctor(target);if(!report.ok)throw new Error(report.issues.join('\n'));
      runPnpm(target,['install','--frozen-lockfile']);
      runPnpm(target,['run','typecheck']);
      runPnpm(target,['run','build']);
      console.log(`Application indépendante validée : ${spec.name}`);
    }
  } finally { await rm(staging,{recursive:true,force:true}); }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await validateExamples();
