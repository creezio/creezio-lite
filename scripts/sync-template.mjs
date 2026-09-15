import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
for(const name of ['core','ui']) {
  const target=resolve(root,'template/creezio',name);
  await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
  await cp(resolve(root,'packages',name,'src'),target,{recursive:true});
}
console.log('Sources communes synchronisées dans le template local.');
