import {cp,mkdir,rm,rmdir,rename,realpath} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const defaultRoot=fileURLToPath(new URL('../',import.meta.url));
/** Writers serialize; Windows directory rename has a brief reader-visible gap.
 * A crashed process leaves its lock for explicit recovery; we never steal it.
 */
export async function syncTemplate({root=defaultRoot,copy=cp,move=rename,lockTimeoutMs=15000}={}) {
  root=await realpath(root);
  const template=join(root,'template');
  await mkdir(template,{recursive:true});
  if(await realpath(template)!==template)throw new Error('Template directory must stay inside the repository.');
  const target=join(template,'runtime'),lock=join(template,'.runtime-sync.lock');
  const token=randomUUID(),staging=join(template,'.runtime-sync-'+token),backup=join(template,'.runtime-backup-'+token);
  const remove=async(path)=>{
    // Every recursive removal is checked, including its resolved parent.
    if(dirname(resolve(path))!==template || await realpath(dirname(path))!==template || !['.runtime-sync-','.runtime-backup-'].some(prefix=>path.startsWith(join(template,prefix))))throw new Error('Unsafe synchronization cleanup path.');
    await rm(path,{recursive:true,force:true});
  };
  const deadline=performance.now()+lockTimeoutMs;
  for(;;){
    try{await mkdir(lock);break;}catch(error){
      if(error.code!=='EEXIST')throw error;
      if(performance.now()>=deadline)throw new Error('Runtime synchronization locked; another writer is active or a previous process needs explicit recovery: '+lock);
      await delay(Math.min(50,Math.max(1,deadline-performance.now())));
    }
  }
  let previous=false;
  try {
    await copy(join(root,'runtime'),staging,{recursive:true,filter:path=>!/(?:^|[\\/])(?:node_modules|dist)(?:[\\/]|$)/.test(path)});
    try{await move(target,backup);previous=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    try{await move(staging,target);}catch(error){
      if(previous){
        try{await move(backup,target);}catch(rollback){throw new AggregateError([error,rollback],'Installation and rollback failed; previous runtime retained at '+backup);}
      }
      throw error;
    }
    if(previous)await remove(backup);
  } finally {
    try{await remove(staging);}finally{await rmdir(lock);}
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  await syncTemplate();
  console.log('Runtime Lite synchronisé.');
}
