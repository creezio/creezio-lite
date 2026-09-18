import {cp,mkdir,rm,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const target=join(root,'template/runtime');
const staging=join(root,'template/.runtime-sync');
await rm(staging,{recursive:true,force:true});
await mkdir(staging,{recursive:true});
try {
  await cp(join(root,'runtime'),staging,{recursive:true,filter:path=>!/(?:^|[\\/])(?:node_modules|dist)(?:[\\/]|$)/.test(path)});
  await rm(target,{recursive:true,force:true});
  await rename(staging,target);
} catch(error) {
  await rm(staging,{recursive:true,force:true});
  throw error;
}
console.log('Runtime Lite synchronisé.');
