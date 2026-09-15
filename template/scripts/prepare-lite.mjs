import { mkdir,lstat,symlink } from 'node:fs/promises';
import { join,resolve } from 'node:path';
const local=resolve('runtime/modules/node_modules');
await mkdir(local,{recursive:true});
for(const [name,alias] of [['recharts','lite-recharts'],['react-resizable-panels','lite-resizable-panels']]){
  try{await lstat(join(local,name));}catch{await symlink(resolve('node_modules',alias),join(local,name),process.platform==='win32'?'junction':'dir');}
}
