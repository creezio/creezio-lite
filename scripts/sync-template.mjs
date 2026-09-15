import { cp, mkdir, rm, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
for(const name of ['core','ui']) {
  const target=resolve(root,'template/creezio',name);
  await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
  await cp(resolve(root,'packages',name,'src'),target,{recursive:true});
}
const packagesTarget=resolve(root,'template/creezio/packages');
await rm(packagesTarget,{recursive:true,force:true});
for(const entry of await readdir(resolve(root,'packages'),{withFileTypes:true})) {
  if(!entry.isDirectory()||['core','ui'].includes(entry.name))continue;
  await cp(resolve(root,'packages',entry.name),resolve(packagesTarget,entry.name),{recursive:true,filter:path=>!/(?:^|\/)(?:node_modules|dist|dist-cjs)(?:\/|$)/.test(path)});
}
await cp(resolve(root,'tsconfig.base.json'),resolve(root,'template/creezio/tsconfig.base.json'));
console.log('Sources communes synchronisées dans le template local.');
