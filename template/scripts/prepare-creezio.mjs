import { readdir, lstat, symlink, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Original UI packages reference their public dist declarations. During a source
// build, the local directory link lets TypeScript resolve those to the same src.
const packages=resolve('creezio/packages');
for(const entry of await readdir(packages,{withFileTypes:true})) {
  if(!entry.isDirectory())continue;
  const root=join(packages,entry.name);
  try {await lstat(join(root,'src'));} catch {continue;}
  try {await lstat(join(root,'dist'));} catch {
    await symlink(process.platform==='win32'?join(root,'src'):'src',join(root,'dist'),process.platform==='win32'?'junction':'dir');
  }
}

// These original components target Recharts 2 and resizable-panels 3. Keep
// their type resolution aligned with the build resolver, without replacing
// the starter dependencies or editing the original package manifests.
for (const [name, alias] of [['recharts','creezio-recharts'],['react-resizable-panels','creezio-resizable-panels']]) {
  const local=join(packages,'node_modules');
  await mkdir(local,{recursive:true});
  try {await lstat(join(local,name));} catch {
    await symlink(resolve('node_modules',alias),join(local,name),process.platform==='win32'?'junction':'dir');
  }
}
